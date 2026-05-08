create or replace function public.get_skill_label_for_elo(p_elo integer)
returns text
language plpgsql
immutable
as $$
begin
  if p_elo < 900 then
    return 'beginner';
  elsif p_elo < 1075 then
    return 'basic';
  elsif p_elo < 1250 then
    return 'intermediate';
  elsif p_elo < 1450 then
    return 'intermediate';
  end if;

  return 'advanced';
end;
$$;

create or replace function public.apply_session_skill_calibration(
  p_session_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_match_result text := 'pending';
  v_peer_score numeric := 0;
  v_result_delta integer := 0;
  v_peer_delta integer := 0;
  v_total_delta integer := 0;
  v_effective_elo integer := 1000;
  v_next_elo integer := 1000;
  v_is_provisional boolean := false;
  v_placement_played integer := 0;
  v_next_placement integer := 0;
  v_next_provisional boolean := false;
  v_multiplier numeric := 1.0;
begin
  select *
  into v_player
  from public.players
  where id = p_player_id;

  if not found then
    return;
  end if;

  v_effective_elo := coalesce(v_player.current_elo, v_player.elo::integer, 1000);
  v_is_provisional := coalesce(v_player.is_provisional, false);
  v_placement_played := coalesce(v_player.placement_matches_played, 0);

  select sp.match_result
  into v_match_result
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.player_id = p_player_id;

  if v_match_result is null or v_match_result = 'pending' then
    return;
  end if;

  select coalesce(avg(
    case r.skill_validation
      when 'outclass' then 1
      when 'weaker' then -1
      else 0
    end
  ), 0)
  into v_peer_score
  from public.ratings r
  where r.session_id = p_session_id
    and r.rated_id = p_player_id
    and r.processed_at is not null;

  v_multiplier := case
    when v_is_provisional and v_placement_played < 5 then 2.5
    else 1.0
  end;

  v_result_delta := case v_match_result
    when 'win' then 12
    when 'loss' then -12
    else 0
  end;

  v_peer_delta := round(v_peer_score * 16 * v_multiplier);
  v_total_delta := round(v_result_delta * v_multiplier) + v_peer_delta;
  v_next_elo := greatest(0, v_effective_elo + v_total_delta);

  v_next_placement := case
    when v_is_provisional and v_placement_played < 5 then v_placement_played + 1
    else v_placement_played
  end;

  v_next_provisional := case
    when v_is_provisional and v_next_placement < 5 then true
    else false
  end;

  update public.players
  set
    current_elo = v_next_elo,
    elo = v_next_elo,
    skill_label = public.get_skill_label_for_elo(v_next_elo),
    placement_matches_played = v_next_placement,
    is_provisional = v_next_provisional
  where id = p_player_id;
end;
$$;

create or replace function public.process_final_ratings(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_session_end timestamptz;
  v_processed_at timestamptz := now();
  v_player_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.sessions s
    left join public.session_players sp on sp.session_id = s.id and sp.player_id = v_uid
    where s.id = p_session_id
      and (s.host_id = v_uid or sp.player_id is not null)
  ) then
    raise exception 'You do not have access to process ratings for this session';
  end if;

  select cs.end_time
  into v_session_end
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where s.id = p_session_id;

  if v_session_end is null then
    v_session_end := now();
  end if;

  update public.ratings r
  set reveal_at = coalesce(r.reveal_at, v_session_end + interval '24 hours')
  where r.session_id = p_session_id;

  update public.ratings r
  set is_hidden = false
  where r.session_id = p_session_id
    and (
      coalesce(r.reveal_at, v_session_end + interval '24 hours') <= now()
      or exists (
        select 1
        from public.ratings r2
        where r2.session_id = r.session_id
          and r2.rater_id = r.rated_id
          and r2.rated_id = r.rater_id
      )
    );

  with ready as (
    select
      r.id,
      r.rated_id,
      r.tags,
      r.no_show,
      s.host_id,
      case
        when r.no_show then -20
        else 0
      end
      + case
          when coalesce(r.tags, '{}'::text[]) && array['late']::text[] then -5
          else 0
        end
      + case
          when coalesce(r.tags, '{}'::text[]) && array['toxic', 'dishonest']::text[] then -10
          else 0
        end as reliability_delta,
      case
        when r.rated_id = s.host_id then
          (case when coalesce(r.tags, '{}'::text[]) && array['good_description']::text[] then 4 else 0 end) +
          (case when coalesce(r.tags, '{}'::text[]) && array['well_organized']::text[] then 4 else 0 end) +
          (case when coalesce(r.tags, '{}'::text[]) && array['fair_pairing']::text[] then 4 else 0 end) +
          (case when coalesce(r.tags, '{}'::text[]) && array['court_mismatch']::text[] then -5 else 0 end) +
          (case when coalesce(r.tags, '{}'::text[]) && array['poor_organization']::text[] then -5 else 0 end)
        else 0
      end as host_reputation_delta
    from public.ratings r
    join public.sessions s on s.id = r.session_id
    where r.session_id = p_session_id
      and r.processed_at is null
      and (r.is_hidden = false or coalesce(r.reveal_at, v_session_end + interval '24 hours') <= now())
  ),
  player_updates as (
    update public.players p
    set
      reliability_score = greatest(0, least(100, coalesce(p.reliability_score, 100) + ready.reliability_delta)),
      host_reputation = greatest(0, coalesce(p.host_reputation, 0) + ready.host_reputation_delta)
    from ready
    where p.id = ready.rated_id
    returning p.id
  ),
  no_show_updates as (
    update public.players p
    set no_show_count = coalesce(p.no_show_count, 0) + 1
    from ready
    where p.id = ready.rated_id
      and ready.no_show = true
    returning p.id
  ),
  marked as (
    update public.ratings r
    set processed_at = v_processed_at
    from ready
    where r.id = ready.id
    returning ready.rated_id
  )
  select 1;

  for v_player_id in
    select distinct r.rated_id
    from public.ratings r
    where r.session_id = p_session_id
      and r.processed_at = v_processed_at
  loop
    perform public.apply_session_skill_calibration(p_session_id, v_player_id);
  end loop;

  update public.players p
  set earned_badges = array(
    select distinct badge
    from unnest(
      coalesce(p.earned_badges, '{}'::text[]) ||
      case
        when (
          select count(*)
          from public.ratings r
          where r.rated_id = p.id
            and coalesce(r.tags, '{}'::text[]) && array['friendly']::text[]
        ) >= 5 then array['Friendly']::text[]
        else '{}'::text[]
      end ||
      case
        when (
          select count(*)
          from public.ratings r
          where r.rated_id = p.id
            and coalesce(r.tags, '{}'::text[]) && array['on_time']::text[]
        ) >= 5 then array['On-time']::text[]
        else '{}'::text[]
      end ||
      case
        when (
          select count(*)
          from public.ratings r
          where r.rated_id = p.id
            and coalesce(r.tags, '{}'::text[]) && array['fair_play']::text[]
        ) >= 5 then array['Fair Play']::text[]
        else '{}'::text[]
      end ||
      case
        when coalesce(p.host_reputation, 0) >= 20 then array['Great Host']::text[]
        else '{}'::text[]
      end
    ) as badge
  )
  where exists (
    select 1
    from public.ratings r
    where r.session_id = p_session_id
      and r.rated_id = p.id
  );
end;
$$;

grant execute on function public.get_skill_label_for_elo(integer) to authenticated, service_role;
grant execute on function public.apply_session_skill_calibration(uuid, uuid) to authenticated, service_role;
