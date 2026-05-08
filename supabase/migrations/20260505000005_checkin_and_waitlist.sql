-- 0. Update sessions_status_check to allow 'playing'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_status_check'
  ) THEN
    ALTER TABLE public.sessions DROP CONSTRAINT sessions_status_check;
  END IF;
  
  ALTER TABLE public.sessions 
    ADD CONSTRAINT sessions_status_check 
    CHECK (status IN ('open', 'full', 'cancelled', 'finished', 'closed', 'playing', 'closed_recruitment', 'pending_completion', 'done'));
END $$;

-- 1. Update register_and_join_session to support waitlist and no-show check
DROP FUNCTION IF EXISTS public.register_and_join_session(UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC);

CREATE OR REPLACE FUNCTION public.register_and_join_session(
  p_session_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_gender TEXT,
  p_elo INTEGER,
  p_pvna NUMERIC
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
BEGIN
  -- 1. Check for No-show history
  SELECT id, no_show_count INTO v_existing_id, v_no_show_count
  FROM public.players
  WHERE phone = p_phone
  LIMIT 1;

  IF v_no_show_count >= 5 THEN
    RETURN JSONB_BUILD_OBJECT('error', 'Tài khoản của bạn bị từ chối tham gia do có quá nhiều lần không trình diện (No-show).');
  END IF;

  -- 2. Handle Player Creation/Update
  IF v_existing_id IS NOT NULL THEN
    v_player_id := v_existing_id;
    UPDATE public.players
    SET 
      name = COALESCE(name, p_name),
      gender = COALESCE(gender, p_gender),
      elo = COALESCE(elo, p_elo),
      pvna = COALESCE(pvna, p_pvna)
    WHERE id = v_player_id AND is_guest = true;
  ELSE
    v_player_id := gen_random_uuid();
    INSERT INTO public.players (
      id, name, phone, gender, elo, pvna, is_guest, onboarding_completed
    ) VALUES (
      v_player_id, p_name, p_phone, p_gender, p_elo, p_pvna, true, true
    );
  END IF;

  -- 3. Check if already joined
  IF EXISTS (
    SELECT 1 FROM public.session_players 
    WHERE session_id = p_session_id AND player_id = v_player_id
  ) THEN
    RETURN JSONB_BUILD_OBJECT('player_id', v_player_id, 'status', 'already_joined');
  END IF;

  -- 4. Determine Status (Waitlist logic)
  SELECT max_players INTO v_max_players FROM public.sessions WHERE id = p_session_id;
  
  SELECT COUNT(*) INTO v_current_players 
  FROM public.session_players 
  WHERE session_id = p_session_id AND status = 'confirmed';

  IF v_current_players >= v_max_players THEN
    v_status := 'waiting';
  ELSE
    v_status := 'confirmed';
  END IF;

  -- 5. Join
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

-- 5. Complete Check-in RPC
CREATE OR REPLACE FUNCTION public.complete_session_check_in(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Mark session as check-in completed
  UPDATE public.sessions
  SET check_in_completed = true, status = 'playing'
  WHERE id = p_session_id;

  -- 2. Increment no_show_count for players marked as no_show
  UPDATE public.players p
  SET no_show_count = p.no_show_count + 1
  FROM public.session_players sp
  WHERE sp.session_id = p_session_id
    AND sp.player_id = p.id
    AND sp.check_in_status = 'no_show';
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_session_check_in(UUID) TO authenticated;
