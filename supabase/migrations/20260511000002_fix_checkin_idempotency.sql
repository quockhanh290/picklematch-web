-- Migration: Fix idempotency of complete_session_check_in
-- Created: 2026-05-11

CREATE OR REPLACE FUNCTION public.complete_session_check_in(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_completed BOOLEAN;
BEGIN
  -- Check if already completed to prevent double-counting no-shows
  SELECT check_in_completed INTO v_already_completed
  FROM public.sessions
  WHERE id = p_session_id;

  IF v_already_completed THEN
    -- If already completed, just ensure status is 'playing'
    UPDATE public.sessions
    SET status = 'playing'
    WHERE id = p_session_id AND status != 'playing';
    RETURN;
  END IF;

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
