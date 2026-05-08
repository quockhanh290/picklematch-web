create or replace function public.process_final_ratings(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_is_internal boolean := false;
  v_session_end timestamptz;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);
  v_is_internal := coalesce(v_role, '') = 'service_role' or current_user in ('postgres', 'supabase_admin');

  if v_uid is null and not v_is_internal then
    raise exception 'Not authenticated';
  end if;

  if not v_is_internal and not exists (
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
      r.skill_validation,
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
      end as host_reputation_delta,
      case r.skill_validation
        when 'weaker' then -15
        when 'outclass' then 15
        else 0
      end as elo_delta
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
      host_reputation = greatest(0, coalesce(p.host_reputation, 0) + ready.host_reputation_delta),
      current_elo = greatest(0, coalesce(p.current_elo, p.elo::integer, 1000) + ready.elo_delta),
      elo = greatest(0, coalesce(p.current_elo, p.elo::integer, 1000) + ready.elo_delta)
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
  )
  update public.ratings r
  set processed_at = now()
  from ready
  where r.id = ready.id;

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
