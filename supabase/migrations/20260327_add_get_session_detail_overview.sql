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
      s.slot_id
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

grant execute on function public.get_session_detail_overview(uuid) to authenticated, service_role;
