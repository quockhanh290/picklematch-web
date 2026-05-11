-- Migration: Prevent registration for ended sessions
-- Created: 2026-05-11

CREATE OR REPLACE FUNCTION public.register_and_join_session(
  p_session_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_gender TEXT,
  p_elo INTEGER,
  p_pvna NUMERIC,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_existing_id UUID;
  v_no_show_count INTEGER;
  v_max_players INTEGER;
  v_current_players INTEGER;
  v_status TEXT;
  v_partner_pref TEXT;
  v_opponent_pref TEXT;
  v_session_status TEXT;
  v_end_time TIMESTAMPTZ;
BEGIN
  -- 0. Check session status and end time
  SELECT s.status, slot.end_time 
  INTO v_session_status, v_end_time
  FROM public.sessions s
  JOIN public.court_slots slot ON s.slot_id = slot.id
  WHERE s.id = p_session_id;

  IF v_session_status IN ('done', 'cancelled', 'pending_completion') OR v_end_time < NOW() THEN
    RETURN JSONB_BUILD_OBJECT('error', 'Kèo đấu này đã kết thúc hoặc bị hủy, không thể đăng ký thêm.');
  END IF;

  -- 1. Extract preferences from metadata
  v_partner_pref := COALESCE(p_metadata->>'partner_gender_pref', 'any');
  v_opponent_pref := COALESCE(p_metadata->>'opponent_gender_pref', 'any');

  -- 2. Check for No-show history
  SELECT id, no_show_count INTO v_existing_id, v_no_show_count
  FROM public.players
  WHERE phone = p_phone
  LIMIT 1;

  IF v_no_show_count >= 5 THEN
    RETURN JSONB_BUILD_OBJECT('error', 'Tài khoản của bạn bị từ chối tham gia do có quá nhiều lần không trình diện (No-show).');
  END IF;

  -- 3. Handle Player Creation/Update
  IF v_existing_id IS NOT NULL THEN
    v_player_id := v_existing_id;
    UPDATE public.players
    SET 
      name = COALESCE(name, p_name),
      gender = COALESCE(gender, p_gender),
      elo = COALESCE(elo, p_elo),
      pvna = COALESCE(pvna, p_pvna),
      partner_gender_pref = v_partner_pref,
      opponent_gender_pref = v_opponent_pref
    WHERE id = v_player_id;
  ELSE
    v_player_id := gen_random_uuid();
    INSERT INTO public.players (
      id, name, phone, gender, elo, pvna, is_guest, onboarding_completed,
      partner_gender_pref, opponent_gender_pref
    ) VALUES (
      v_player_id, p_name, p_phone, p_gender, p_elo, p_pvna, true, true,
      v_partner_pref, v_opponent_pref
    );
  END IF;

  -- 4. Check if already joined
  IF EXISTS (
    SELECT 1 FROM public.session_players 
    WHERE session_id = p_session_id AND player_id = v_player_id
  ) THEN
    RETURN JSONB_BUILD_OBJECT('player_id', v_player_id, 'status', 'already_joined');
  END IF;

  -- 5. Determine Status (Waitlist logic)
  SELECT max_players INTO v_max_players FROM public.sessions WHERE id = p_session_id;
  
  SELECT COUNT(*) INTO v_current_players 
  FROM public.session_players 
  WHERE session_id = p_session_id AND status = 'confirmed';

  IF v_current_players >= v_max_players THEN
    v_status := 'waiting';
  ELSE
    v_status := 'confirmed';
  END IF;

  -- 6. Join
  INSERT INTO public.session_players (
    session_id,
    player_id,
    status
  ) VALUES (
    p_session_id,
    v_player_id,
    v_status
  );

  RETURN JSONB_BUILD_OBJECT(
    'player_id', v_player_id, 
    'status', v_status,
    'no_show_warning', (v_no_show_count > 0)
  );
END;
$$;
