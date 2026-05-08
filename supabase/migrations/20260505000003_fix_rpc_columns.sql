-- Migration: Fix get_session_detail_overview to include missing columns
-- Created: 2026-05-05

-- Ensure columns exist
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS no_show_count INTEGER DEFAULT 0;
ALTER TABLE public.session_players ADD COLUMN IF NOT EXISTS check_in_status TEXT DEFAULT 'pending';
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS check_in_completed BOOLEAN DEFAULT false;

DROP FUNCTION IF EXISTS public.get_session_detail_overview(UUID);

CREATE OR REPLACE FUNCTION public.get_session_detail_overview(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID; v_is_participant BOOLEAN; v_host_id UUID; v_result JSONB;
BEGIN
  v_uid := auth.uid();
  SELECT host_id INTO v_host_id FROM public.sessions WHERE id = p_session_id;
  IF v_host_id IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.session_players 
    WHERE session_id = p_session_id AND player_id = v_uid AND status = 'confirmed'
  ) INTO v_is_participant;

  WITH base_session AS (
    SELECT
      s.*,
      COALESCE(s.total_cost, (os.format_metadata->>'cost_per_person')::integer, os.total_cost, 0) as derived_total_cost
    FROM public.sessions s
    LEFT JOIN public.owner_sessions os ON s.id = os.id
    WHERE s.id = p_session_id
  ),
  owner_data AS (
    SELECT os.* FROM public.owner_sessions os WHERE os.id = p_session_id
  ),
  host_data AS (
    SELECT 
      p.id, p.name, p.elo, p.current_elo, p.gender, p.pvna, p.is_provisional, 
      p.skill_label, p.self_assessed_level, p.reliability_score,
      p.is_guest, p.sessions_joined, p.no_show_count
    FROM base_session s 
    JOIN public.players p ON p.id = s.host_id
  ),
  slot_data AS (
    SELECT cs.*, c.name as court_name, c.address, c.city, c.lat, c.lng, c.hours_open, c.hours_close, c.price_per_hour, c.booking_url, c.google_maps_url
    FROM base_session s
    JOIN public.court_slots cs ON cs.id = s.slot_id
    JOIN public.courts c ON c.id = cs.court_id
  ),
  players_data AS (
    SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'player_id', sp.player_id, 
      'status', sp.status, 
      'team_no', sp.team_no,
      'check_in_status', sp.check_in_status,
      'player', JSONB_BUILD_OBJECT(
        'id', p.id,
        'name', p.name,
        'elo', p.elo,
        'current_elo', p.current_elo,
        'gender', p.gender,
        'pvna', p.pvna,
        'is_provisional', p.is_provisional,
        'skill_label', p.skill_label,
        'self_assessed_level', p.self_assessed_level,
        'reliability_score', p.reliability_score,
        'is_guest', p.is_guest,
        'sessions_joined', p.sessions_joined,
        'no_show_count', p.no_show_count
      )
    ) ORDER BY p.name), '[]'::JSONB) AS items
    FROM public.session_players sp
    JOIN public.players p ON p.id = sp.player_id
    WHERE sp.session_id = p_session_id
  )
  SELECT JSONB_BUILD_OBJECT(
    'session', (
      SELECT to_jsonb(s) || JSONB_BUILD_OBJECT(
        'total_cost', s.derived_total_cost,
        'host', (SELECT items FROM (SELECT JSONB_AGG(to_jsonb(h)) as items FROM host_data h) as h_agg),
        'owner_sessions', (SELECT to_jsonb(od) FROM owner_data od),
        'slot', (SELECT to_jsonb(sd) || JSONB_BUILD_OBJECT('court', JSONB_BUILD_OBJECT('name', sd.court_name, 'address', sd.address, 'city', sd.city)) FROM slot_data sd),
        'session_players', (SELECT items FROM players_data)
      ) FROM base_session s
    )
  ) INTO v_result;

  -- Fix host nested array issue if it happens
  v_result := jsonb_set(
    v_result, 
    '{session,host}', 
    (v_result->'session'->'host'->0)
  );

  RETURN v_result;
END;
$$;
