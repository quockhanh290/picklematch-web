alter table public.session_players
  add column if not exists elo_snapshot integer;

alter table public.sessions
  add column if not exists elo_processed boolean not null default false,
  add column if not exists elo_skip_reason text,
  add column if not exists is_ranked boolean not null default true;

create table if not exists public.elo_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  elo_before integer not null,
  elo_after integer not null,
  delta integer not null,
  k_factor integer not null,
  expected_score numeric(5,3) not null,
  actual_score numeric(3,1) not null,
  opponent_avg_elo integer not null,
  matches_played_at_time integer not null,
  source text not null default 'match_result',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_elo_history_session_player_source
  on public.elo_history(session_id, player_id, source);

create index if not exists idx_elo_history_player_created_at
  on public.elo_history(player_id, created_at desc);

create or replace function public.prevent_session_players_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.sessions s
    where s.id = old.session_id
      and s.results_status = 'finalized'
  ) then
    if old.team_no is distinct from new.team_no
       or old.match_result is distinct from new.match_result then
      raise exception 'Cannot mutate team_no or match_result after session finalized';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists lock_session_players_after_finalized on public.session_players;
create trigger lock_session_players_after_finalized
before update on public.session_players
for each row
execute function public.prevent_session_players_mutation();

create or replace function public.process_match_elo(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_is_internal boolean := false;
  v_session_id uuid;
  v_is_ranked boolean := true;
  v_confirmed_count integer := 0;
  v_team_ready_count integer := 0;
  v_win_count integer := 0;
  v_loss_count integer := 0;
  v_draw_count integer := 0;
  v_winner_team smallint;
  v_winner_team_count integer := 0;
  v_loser_team_count integer := 0;
  v_floor constant integer := 800;
  v_ceiling constant integer := 2000;
  v_players_per_team integer;
  v_required_players integer;
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
    raise exception 'You do not have access to process Elo for this session';
  end if;

  begin
    select s.id, s.is_ranked
    into v_session_id, v_is_ranked
    from public.sessions s
    where s.id = p_session_id
      and s.results_status = 'finalized'
      and coalesce(s.elo_processed, false) = false
    for update nowait;
  exception
    when lock_not_available then
      return 'busy';
  end;

  if v_session_id is null then
    return 'not_eligible';
  end if;

  if coalesce(v_is_ranked, true) = false then
    return 'not_eligible';
  end if;

  select
    count(*) filter (where sp.status = 'confirmed'),
    count(*) filter (where sp.status = 'confirmed' and sp.team_no is not null),
    count(*) filter (where sp.status = 'confirmed' and sp.match_result = 'win'),
    count(*) filter (where sp.status = 'confirmed' and sp.match_result = 'loss'),
    count(*) filter (where sp.status = 'confirmed' and sp.match_result = 'draw')
  into
    v_confirmed_count,
    v_team_ready_count,
    v_win_count,
    v_loss_count,
    v_draw_count
  from public.session_players sp
  where sp.session_id = p_session_id;

  -- Support ONLY 4 players for ranked matches
  if v_confirmed_count <> 4 or v_team_ready_count <> 4 then
    update public.sessions
    set elo_skip_reason = 'skipped_insufficient_players'
    where id = p_session_id;
    return 'skipped_insufficient_players';
  end if;

  v_required_players := 4;
  v_players_per_team := 2;

  if v_draw_count > 0 then
    -- v1: draw skipped. v2 candidate: process with S = 0.5
    update public.sessions
    set elo_skip_reason = 'skipped_draw_result'
    where id = p_session_id;
    return 'skipped_draw_result';
  end if;

  select min(sp.team_no), count(distinct sp.team_no)
  into v_winner_team, v_winner_team_count
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.match_result = 'win';

  select count(distinct sp.team_no)
  into v_loser_team_count
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.match_result = 'loss';

  if v_win_count <> v_players_per_team
     or v_loss_count <> v_players_per_team
     or v_winner_team is null
     or v_winner_team_count <> 1
     or v_loser_team_count <> 1
     or exists (
       select 1
       from public.session_players sp
       where sp.session_id = p_session_id
         and sp.status = 'confirmed'
         and (
           sp.match_result not in ('win', 'loss')
           or (sp.match_result = 'win' and sp.team_no <> v_winner_team)
           or (sp.match_result = 'loss' and sp.team_no = v_winner_team)
         )
     ) then
    update public.sessions
    set elo_skip_reason = 'skipped_inconsistent_team'
    where id = p_session_id;
    return 'skipped_inconsistent_team';
  end if;

  update public.session_players sp
  set elo_snapshot = coalesce(p.current_elo, p.elo, 1000)
  from public.players p
  where sp.player_id = p.id
    and sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.elo_snapshot is null;

  with player_base as (
    select
      sp.player_id,
      sp.team_no,
      sp.match_result,
      sp.elo_snapshot as elo_before,
      coalesce(p.elo_matches_played, 0) as matches_played_at_time
    from public.session_players sp
    join public.players p on p.id = sp.player_id
    where sp.session_id = p_session_id
      and sp.status = 'confirmed'
  ),
  team_avgs as (
    select
      pb.team_no,
      avg(pb.elo_before::numeric) as team_avg_elo
    from player_base pb
    group by pb.team_no
  ),
  calc as (
    select
      pb.player_id,
      pb.elo_before,
      pb.matches_played_at_time,
      case
        when pb.matches_played_at_time < 10 then 40
        when pb.matches_played_at_time < 30 then 24
        else 16
      end as k_factor,
      case when pb.match_result = 'win' then 1.0::numeric else 0.0::numeric end as actual_score,
      round(opponent.team_avg_elo)::integer as opponent_avg_elo,
      1.0::numeric / (
        1.0::numeric + power(10::numeric, (opponent.team_avg_elo - mine.team_avg_elo) / 400.0::numeric)
      ) as expected_score_raw
    from player_base pb
    join team_avgs mine on mine.team_no = pb.team_no
    join team_avgs opponent on opponent.team_no <> pb.team_no
  ),
  final_values as (
    select
      calc.player_id,
      calc.elo_before,
      calc.matches_played_at_time,
      calc.k_factor,
      round(calc.expected_score_raw, 3) as expected_score,
      calc.actual_score,
      calc.opponent_avg_elo,
      round(calc.k_factor * (calc.actual_score - calc.expected_score_raw))::integer as delta,
      least(v_ceiling, greatest(v_floor, calc.elo_before + round(calc.k_factor * (calc.actual_score - calc.expected_score_raw))::integer)) as new_elo
    from calc
  ),
  updated_players as (
    update public.players p
    set
      current_elo = fv.new_elo,
      elo = fv.new_elo,
      elo_matches_played = coalesce(p.elo_matches_played, 0) + 1,
      placement_matches_played = case 
        when coalesce(p.is_provisional, false) and coalesce(p.placement_matches_played, 0) < 5 then coalesce(p.placement_matches_played, 0) + 1
        else p.placement_matches_played
      end,
      is_provisional = case
        when coalesce(p.is_provisional, false) and (coalesce(p.placement_matches_played, 0) + 1) < 5 then true
        else false
      end
    from final_values fv
    where p.id = fv.player_id
    returning
      p.id as player_id,
      fv.elo_before,
      fv.new_elo,
      fv.delta,
      fv.k_factor,
      fv.expected_score,
      fv.actual_score,
      fv.opponent_avg_elo,
      fv.matches_played_at_time
  )
  insert into public.elo_history (
    player_id,
    session_id,
    elo_before,
    elo_after,
    delta,
    k_factor,
    expected_score,
    actual_score,
    opponent_avg_elo,
    matches_played_at_time,
    source,
    created_at
  )
  select
    up.player_id,
    p_session_id,
    up.elo_before,
    up.new_elo,
    up.delta,
    up.k_factor,
    up.expected_score,
    up.actual_score,
    up.opponent_avg_elo,
    up.matches_played_at_time,
    'match_result',
    now()
  from updated_players up;

  update public.sessions
  set
    elo_processed = true,
    elo_skip_reason = null
  where id = p_session_id;

  return 'processed';
end;
$$;

grant execute on function public.process_match_elo(uuid) to authenticated, service_role;

create or replace function public.finalize_session_results(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_session public.sessions%rowtype;
  v_pending_count integer := 0;
  v_disputed_count integer := 0;
  v_player_id uuid;
  v_match_elo_status text;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);

  select *
  into v_session
  from public.sessions
  where id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if coalesce(v_role, '') <> 'service_role' and not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
  ) and v_session.host_id <> v_uid then
    raise exception 'You do not have access to finalize this session';
  end if;

  select count(*)::int
  into v_disputed_count
  from public.session_players
  where session_id = p_session_id
    and result_confirmation_status = 'disputed';

  if v_disputed_count > 0 then
    raise exception 'Session results are disputed and cannot be finalized';
  end if;

  select count(*)::int
  into v_pending_count
  from public.session_players
  where session_id = p_session_id
    and player_id <> v_session.host_id
    and result_confirmation_status <> 'confirmed';

  if v_pending_count > 0
     and (v_session.results_confirmation_deadline is null or v_session.results_confirmation_deadline > now()) then
    raise exception 'Session results are still awaiting confirmation';
  end if;

  update public.session_players
  set
    match_result = proposed_result,
    result_confirmation_status = 'confirmed',
    result_confirmed_at = coalesce(result_confirmed_at, now())
  where session_id = p_session_id;

  update public.sessions
  set results_status = 'finalized'
  where id = p_session_id;

  begin
    v_match_elo_status := public.process_match_elo(p_session_id);
  exception
    when others then
      raise warning 'process_match_elo failed for session %: %', p_session_id, SQLERRM;
      v_match_elo_status := 'failed';
  end;

  for v_player_id in
    select distinct player_id
    from public.session_players
    where session_id = p_session_id
      and status = 'confirmed'
  loop
    perform public.check_achievements(v_player_id);
  end loop;
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

create or replace function public.get_session_detail_overview(p_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with base_session as (
    select
      s.id,
      s.elo_min,
      s.elo_max,
      s.max_players,
      s.status,
      s.results_status,
      s.results_submitted_at,
      s.results_confirmation_deadline,
      s.auto_closed_at,
      s.auto_closed_reason,
      s.require_approval,
      s.fill_deadline,
      s.court_booking_status,
      s.booking_reference,
      s.booking_name,
      s.booking_phone,
      s.booking_notes,
      s.booking_confirmed_at,
      s.host_id,
      s.slot_id,
      s.is_ranked,
      s.elo_processed,
      s.elo_skip_reason
    from public.sessions s
    where s.id = p_session_id
  ),
  host_data as (
    select
      p.id,
      p.name,
      p.auto_accept,
      p.is_provisional,
      p.placement_matches_played,
      p.elo,
      p.current_elo,
      p.self_assessed_level,
      p.skill_label
    from base_session s
    join public.players p on p.id = s.host_id
  ),
  slot_data as (
    select
      cs.id,
      cs.start_time,
      cs.end_time,
      cs.price,
      c.id as court_id,
      c.name as court_name,
      c.address,
      c.city,
      c.lat,
      c.lng,
      c.hours_open,
      c.hours_close,
      c.price_per_hour,
      c.booking_url,
      c.google_maps_url
    from base_session s
    join public.court_slots cs on cs.id = s.slot_id
    join public.courts c on c.id = cs.court_id
  ),
  players_data as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'player_id', sp.player_id,
          'status', sp.status,
          'team_no', sp.team_no,
          'elo_snapshot', sp.elo_snapshot,
          'match_result', sp.match_result,
          'proposed_result', sp.proposed_result,
          'host_unprofessional_reported_at', sp.host_unprofessional_reported_at,
          'host_unprofessional_report_note', sp.host_unprofessional_report_note,
          'result_confirmation_status', sp.result_confirmation_status,
          'result_dispute_note', sp.result_dispute_note,
          'player', jsonb_build_object(
            'name', p.name,
            'is_provisional', p.is_provisional,
            'elo', p.elo,
            'current_elo', p.current_elo,
            'self_assessed_level', p.self_assessed_level,
            'skill_label', p.skill_label
          )
        )
        order by p.name
      ),
      '[]'::jsonb
    ) as items
    from public.session_players sp
    join public.players p on p.id = sp.player_id
    where sp.session_id = p_session_id
  ),
  viewer_request as (
    select
      jr.status,
      jr.host_response_template,
      jr.intro_note
    from public.join_requests jr
    where jr.match_id = p_session_id
      and jr.player_id = auth.uid()
    limit 1
  ),
  viewer_rating as (
    select exists(
      select 1
      from public.ratings r
      where r.session_id = p_session_id
        and r.rater_id = auth.uid()
    ) as already_rated
  )
  select jsonb_build_object(
    'session',
    (
      select jsonb_build_object(
        'id', s.id,
        'elo_min', s.elo_min,
        'elo_max', s.elo_max,
        'max_players', s.max_players,
        'status', s.status,
        'results_status', s.results_status,
        'results_submitted_at', s.results_submitted_at,
        'results_confirmation_deadline', s.results_confirmation_deadline,
        'auto_closed_at', s.auto_closed_at,
        'auto_closed_reason', s.auto_closed_reason,
        'require_approval', s.require_approval,
        'fill_deadline', s.fill_deadline,
        'court_booking_status', s.court_booking_status,
        'booking_reference', s.booking_reference,
        'booking_name', s.booking_name,
        'booking_phone', s.booking_phone,
        'booking_notes', s.booking_notes,
        'booking_confirmed_at', s.booking_confirmed_at,
        'is_ranked', s.is_ranked,
        'elo_processed', s.elo_processed,
        'elo_skip_reason', s.elo_skip_reason,
        'host', (select to_jsonb(h) from host_data h),
        'slot', (
          select jsonb_build_object(
            'id', sd.id,
            'start_time', sd.start_time,
            'end_time', sd.end_time,
            'price', sd.price,
            'court', jsonb_build_object(
              'id', sd.court_id,
              'name', sd.court_name,
              'address', sd.address,
              'city', sd.city,
              'lat', sd.lat,
              'lng', sd.lng,
              'hours_open', sd.hours_open,
              'hours_close', sd.hours_close,
              'price_per_hour', sd.price_per_hour,
              'booking_url', sd.booking_url,
              'google_maps_url', sd.google_maps_url
            )
          )
          from slot_data sd
        ),
        'session_players', (select items from players_data)
      )
      from base_session s
    ),
    'viewer_request_status', coalesce((select status from viewer_request), 'none'),
    'viewer_host_response_template', (select host_response_template from viewer_request),
    'viewer_intro_note', coalesce((select intro_note from viewer_request), ''),
    'viewer_already_rated', coalesce((select already_rated from viewer_rating), false)
  );
$$;

grant execute on function public.finalize_session_results(uuid) to authenticated, service_role;
