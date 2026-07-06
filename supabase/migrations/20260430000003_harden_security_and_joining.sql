-- Harden security for session management and joining.

-- 1. Create a secure, atomic join_session RPC.
create or replace function public.join_session(
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_host_id uuid;
  v_max_players integer;
  v_confirmed_count integer;
  v_status text;
  v_fill_deadline timestamptz;
  v_existing_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Lock the session for update to prevent race conditions.
  select host_id, max_players, status, fill_deadline
  into v_host_id, v_max_players, v_status, v_fill_deadline
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;

  -- 2. Check if already joined.
  select player_id into v_existing_id
  from public.session_players
  where session_id = p_session_id
    and player_id = v_uid;

  if v_existing_id is not null then
    return v_uid; -- Already joined, return success.
  end if;

  -- 3. Check status and deadline.
  if v_status <> 'open' then
    raise exception 'Session is not accepting new players';
  end if;

  if v_fill_deadline is not null and v_fill_deadline <= now() then
    raise exception 'Join deadline has passed';
  end if;

  -- 4. Check capacity.
  select count(*)
  into v_confirmed_count
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed';

  if v_confirmed_count >= coalesce(v_max_players, 0) then
    raise exception 'Session is already full';
  end if;

  -- 5. Insert participant.
  insert into public.session_players (
    session_id,
    player_id,
    status
  ) values (
    p_session_id,
    v_uid,
    'confirmed'
  );

  -- 6. Clean up/Update join request if it exists.
  update public.join_requests
  set status = 'accepted'
  where match_id = p_session_id
    and player_id = v_uid
    and status = 'pending';

  return v_uid;
end;
$$;

-- 2. Update get_session_detail_overview to mask sensitive booking data.
create or replace function public.get_session_detail_overview(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_participant boolean;
  v_host_id uuid;
  v_result jsonb;
begin
  v_uid := auth.uid();

  -- Determine if viewer has access to sensitive data.
  select host_id into v_host_id
  from public.sessions
  where id = p_session_id;

  if v_host_id is null then
    return null;
  end if;

  select exists (
    select 1
    from public.session_players
    where session_id = p_session_id
      and player_id = v_uid
      and status = 'confirmed'
  ) into v_is_participant;

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
      -- Mask sensitive fields for non-participants.
      case when v_uid = v_host_id or v_is_participant then s.booking_reference else null end as booking_reference,
      case when v_uid = v_host_id or v_is_participant then s.booking_name else null end as booking_name,
      case when v_uid = v_host_id or v_is_participant then s.booking_phone else null end as booking_phone,
      case when v_uid = v_host_id or v_is_participant then s.booking_notes else null end as booking_notes,
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
      and jr.player_id = v_uid
    limit 1
  ),
  viewer_rating as (
    select exists(
      select 1
      from public.ratings r
      where r.session_id = p_session_id
        and r.rater_id = v_uid
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
  ) into v_result;

  return v_result;
end;
$$;

-- 3. Secure report_host_unprofessional to only allow participants.
drop function if exists public.report_host_unprofessional(uuid, text);
create or replace function public.report_host_unprofessional(
  p_session_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.session_players
    where session_id = p_session_id
      and player_id = v_uid
      and status = 'confirmed'
  ) then
    raise exception 'Only confirmed participants can report unprofessional behavior';
  end if;

  update public.session_players
  set
    host_unprofessional_reported_at = now(),
    host_unprofessional_report_note = trim(p_note)
  where session_id = p_session_id
    and player_id = v_uid;

  -- Notify host (optional logic could go here)
end;
$$;

grant execute on function public.join_session(uuid) to authenticated;
grant execute on function public.get_session_detail_overview(uuid) to authenticated;
grant execute on function public.report_host_unprofessional(uuid, text) to authenticated;
