-- Migration: Add guest join RPC and support for guest players
-- Created: 2026-05-04

-- 1. Add missing columns and ensure phone is unique
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS elo INTEGER;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS pvna NUMERIC(3,2);
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Đảm bảo cột phone là duy nhất để tránh trùng lặp dữ liệu
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'players_phone_key'
    ) THEN
        ALTER TABLE public.players ADD CONSTRAINT players_phone_key UNIQUE (phone);
    END IF;
END $$;

-- 2. Create RPC for fast registration and join
CREATE OR REPLACE FUNCTION public.register_and_join_session(
  p_session_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_gender TEXT,
  p_elo INTEGER,
  p_pvna NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_existing_id UUID;
BEGIN
  -- 1. Check if player with this phone already exists
  SELECT id INTO v_existing_id
  FROM public.players
  WHERE phone = p_phone
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    v_player_id := v_existing_id;
    -- Update existing guest info if needed
    UPDATE public.players
    SET 
      name = COALESCE(name, p_name),
      gender = COALESCE(gender, p_gender),
      elo = COALESCE(elo, p_elo),
      pvna = COALESCE(pvna, p_pvna)
    WHERE id = v_player_id AND is_guest = true;
  ELSE
    -- 2. Create new guest player
    v_player_id := gen_random_uuid();
    INSERT INTO public.players (
      id,
      name,
      phone,
      gender,
      elo,
      pvna,
      is_guest,
      onboarding_completed
    ) VALUES (
      v_player_id,
      p_name,
      p_phone,
      p_gender,
      p_elo,
      p_pvna,
      true,
      true
    );
  END IF;

  -- 3. Join the session (no max players check for Zalo guest join)
  -- Check if already joined
  IF EXISTS (
    SELECT 1 FROM public.session_players 
    WHERE session_id = p_session_id AND player_id = v_player_id
  ) THEN
    RETURN v_player_id;
  END IF;

  INSERT INTO public.session_players (
    session_id,
    player_id,
    status
  ) VALUES (
    p_session_id,
    v_player_id,
    'confirmed'
  );

  RETURN v_player_id;
END;
$$;

-- 3. Update get_session_detail_overview to include gender and pvna
CREATE OR REPLACE FUNCTION public.get_session_detail_overview(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_is_participant BOOLEAN;
  v_host_id UUID;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();

  -- Determine if viewer has access to sensitive data.
  SELECT host_id INTO v_host_id
  FROM public.sessions
  WHERE id = p_session_id;

  IF v_host_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.session_players
    WHERE session_id = p_session_id
      AND player_id = v_uid
      AND status = 'confirmed'
  ) INTO v_is_participant;

  WITH base_session AS (
    SELECT
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
      CASE WHEN v_uid = v_host_id OR v_is_participant THEN s.booking_reference ELSE NULL END AS booking_reference,
      CASE WHEN v_uid = v_host_id OR v_is_participant THEN s.booking_name ELSE NULL END AS booking_name,
      CASE WHEN v_uid = v_host_id OR v_is_participant THEN s.booking_phone ELSE NULL END AS booking_phone,
      CASE WHEN v_uid = v_host_id OR v_is_participant THEN s.booking_notes ELSE NULL END AS booking_notes,
      s.booking_confirmed_at,
      s.host_id,
      s.slot_id,
      s.is_ranked,
      s.elo_processed,
      s.elo_skip_reason
    FROM public.sessions s
    WHERE s.id = p_session_id
  ),
  host_data AS (
    SELECT
      p.id,
      p.name,
      p.auto_accept,
      p.is_provisional,
      p.placement_matches_played,
      p.elo,
      p.current_elo,
      p.self_assessed_level,
      p.skill_label,
      p.gender,
      p.pvna
    FROM base_session s
    JOIN public.players p ON p.id = s.host_id
  ),
  slot_data AS (
    SELECT
      cs.id,
      cs.start_time,
      cs.end_time,
      cs.price,
      c.id AS court_id,
      c.name AS court_name,
      c.address,
      c.city,
      c.lat,
      c.lng,
      c.hours_open,
      c.hours_close,
      c.price_per_hour,
      c.booking_url,
      c.google_maps_url
    FROM base_session s
    JOIN public.court_slots cs ON cs.id = s.slot_id
    JOIN public.courts c ON c.id = cs.court_id
  ),
  players_data AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'player_id', sp.player_id,
          'status', sp.status,
          'team_no', sp.team_no,
          'elo_snapshot', sp.elo_snapshot,
          'match_result', sp.match_result,
          'proposed_result', sp.proposed_result,
          'result_confirmation_status', sp.result_confirmation_status,
          'result_dispute_note', sp.result_dispute_note,
          'player', JSONB_BUILD_OBJECT(
            'name', p.name,
            'is_provisional', p.is_provisional,
            'elo', p.elo,
            'current_elo', p.current_elo,
            'self_assessed_level', p.self_assessed_level,
            'skill_label', p.skill_label,
            'gender', p.gender,
            'pvna', p.pvna
          )
        )
        ORDER BY p.name
      ),
      '[]'::JSONB
    ) AS items
    FROM public.session_players sp
    JOIN public.players p ON p.id = sp.player_id
    WHERE sp.session_id = p_session_id
  ),
  viewer_request AS (
    SELECT
      jr.status,
      jr.host_response_template,
      jr.intro_note
    FROM public.join_requests jr
    WHERE jr.match_id = p_session_id
      AND jr.player_id = v_uid
    LIMIT 1
  ),
  viewer_rating AS (
    SELECT EXISTS(
      SELECT 1
      FROM public.ratings r
      WHERE r.session_id = p_session_id
        AND r.rater_id = v_uid
    ) AS already_rated
  )
  SELECT JSONB_BUILD_OBJECT(
    'session',
    (
      SELECT JSONB_BUILD_OBJECT(
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
        'host', (SELECT to_jsonb(h) FROM host_data h),
        'slot', (
          SELECT JSONB_BUILD_OBJECT(
            'id', sd.id,
            'start_time', sd.start_time,
            'end_time', sd.end_time,
            'price', sd.price,
            'court', JSONB_BUILD_OBJECT(
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
          FROM slot_data sd
        ),
        'session_players', (SELECT items FROM players_data)
      )
      FROM base_session s
    ),
    'viewer_request_status', COALESCE((SELECT status FROM viewer_request), 'none'),
    'viewer_host_response_template', (SELECT host_response_template FROM viewer_request),
    'viewer_intro_note', COALESCE((SELECT intro_note from viewer_request), ''),
    'viewer_already_rated', COALESCE((SELECT already_rated FROM viewer_rating), false)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_and_join_session(UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_detail_overview(UUID) TO anon, authenticated;
