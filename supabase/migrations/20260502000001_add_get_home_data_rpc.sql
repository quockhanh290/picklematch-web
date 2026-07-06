-- Migration: Add get_home_data RPC
-- Description: Consolidates multiple queries for the Home screen into a single optimized RPC.

CREATE OR REPLACE FUNCTION public.get_home_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
  v_stats jsonb;
  v_pending_matches jsonb;
  v_post_match_actions jsonb;
  v_open_sessions jsonb;
  v_upcoming_sessions jsonb;
  v_favorite_courts jsonb;
  v_user_ratings uuid[];
  v_pending_request_session_ids uuid[];
BEGIN
  -- 1. Profile Data
  SELECT to_jsonb(p) INTO v_profile
  FROM public.players p
  WHERE p.id = p_user_id;

  -- 2. Player Stats
  SELECT to_jsonb(ps) INTO v_stats
  FROM public.player_stats ps
  WHERE ps.player_id = p_user_id;

  -- 3. Pre-fetch user's current context
  SELECT coalesce(array_agg(session_id), '{}') INTO v_user_ratings
  FROM public.ratings
  WHERE rater_id = p_user_id;

  SELECT coalesce(array_agg(match_id), '{}') INTO v_pending_request_session_ids
  FROM public.join_requests
  WHERE player_id = p_user_id AND status = 'pending';

  -- 4. Pending Matches (Host needs to submit results)
  WITH host_pending AS (
    SELECT 
      s.id, s.status, s.results_status, s.max_players,
      jsonb_build_object(
        'start_time', cs.start_time,
        'end_time', cs.end_time,
        'court', jsonb_build_object('name', c.name, 'thumbnail_url', c.thumbnail_url)
      ) as slot,
      (
        SELECT jsonb_agg(jsonb_build_object('status', sp.status))
        FROM public.session_players sp
        WHERE sp.session_id = s.id
      ) as session_players
    FROM public.sessions s
    JOIN public.court_slots cs ON cs.id = s.slot_id
    JOIN public.courts c ON c.id = cs.court_id
    WHERE s.host_id = p_user_id
      AND s.results_status IN ('not_submitted', 'disputed')
      AND s.status IN ('pending_completion', 'done')
      AND cs.end_time < now()
    ORDER BY s.created_at DESC
    LIMIT 10
  )
  SELECT coalesce(jsonb_agg(hp), '[]'::jsonb) INTO v_pending_matches FROM host_pending hp;

  -- 5. Post Match Actions (Player needs to confirm or rate)
  WITH player_actions AS (
    SELECT 
      sp.player_id, sp.status, sp.result_confirmation_status,
      jsonb_build_object(
        'id', s.id,
        'status', s.status,
        'results_status', s.results_status,
        'host_id', s.host_id,
        'slot', jsonb_build_object(
          'start_time', cs.start_time,
          'end_time', cs.end_time,
          'court', jsonb_build_object('name', c.name, 'thumbnail_url', c.thumbnail_url)
        )
      ) as session
    FROM public.session_players sp
    JOIN public.sessions s ON s.id = sp.session_id
    JOIN public.court_slots cs ON cs.id = s.slot_id
    JOIN public.courts c ON c.id = cs.court_id
    WHERE sp.player_id = p_user_id
      AND sp.status = 'confirmed'
      AND s.host_id <> p_user_id
      AND cs.end_time < now()
      -- Either results need confirmation OR it's done and needs rating
      AND (
        s.results_status IN ('pending_confirmation', 'disputed') 
        OR (s.status = 'done' AND NOT (s.id = ANY(v_user_ratings)))
      )
    ORDER BY cs.end_time DESC
    LIMIT 10
  )
  SELECT coalesce(jsonb_agg(pa), '[]'::jsonb) INTO v_post_match_actions FROM player_actions pa;

  -- 6. Open Sessions (Available for join)
  WITH open_sessions AS (
    SELECT 
      s.id, s.host_id, s.is_ranked, s.elo_min, s.elo_max, s.max_players, s.status, s.court_booking_status, s.created_at,
      jsonb_build_object(
        'id', h.id, 'name', h.name, 'current_elo', h.current_elo, 'elo', h.elo, 
        'self_assessed_level', h.self_assessed_level, 'skill_label', h.skill_label, 
        'reliability_score', h.reliability_score, 'host_reputation', h.host_reputation
      ) as host,
      jsonb_build_object(
        'id', cs.id, 'start_time', cs.start_time, 'end_time', cs.end_time, 'price', cs.price,
        'court', jsonb_build_object(
          'id', c.id, 'name', c.name, 'address', c.address, 'city', c.city, 
          'thumbnail_url', c.thumbnail_url, 'images', c.images, 'rating', c.rating, 
          'rating_count', c.rating_count, 'amenities', c.amenities, 'highlight', c.highlight
        )
      ) as slot,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'player_id', sp2.player_id, 'status', sp2.status,
          'player', jsonb_build_object('id', p2.id, 'name', p2.name, 'reliability_score', p2.reliability_score, 'current_elo', p2.current_elo, 'self_assessed_level', p2.self_assessed_level, 'skill_label', p2.skill_label)
        ))
        FROM public.session_players sp2
        JOIN public.players p2 ON p2.id = sp2.player_id
        WHERE sp2.session_id = s.id AND sp2.status = 'confirmed'
      ) as session_players
    FROM public.sessions s
    JOIN public.players h ON h.id = s.host_id
    JOIN public.court_slots cs ON cs.id = s.slot_id
    JOIN public.courts c ON c.id = cs.court_id
    WHERE s.status = 'open'
      AND s.host_id <> p_user_id
      AND NOT EXISTS (SELECT 1 FROM public.session_players sp3 WHERE sp3.session_id = s.id AND sp3.player_id = p_user_id)
      AND NOT (s.id = ANY(v_pending_request_session_ids))
      AND s.is_owner_managed = false
      AND cs.start_time > now()
    ORDER BY cs.start_time ASC
    LIMIT 40
  )
  SELECT coalesce(jsonb_agg(os), '[]'::jsonb) INTO v_open_sessions FROM open_sessions os;

  -- 7. Upcoming Sessions (User is participant)
  WITH upcoming AS (
    SELECT 
      s.id, s.host_id, s.is_ranked, s.elo_min, s.elo_max, s.max_players, s.status, s.court_booking_status, s.created_at,
      jsonb_build_object(
        'id', h.id, 'name', h.name, 'current_elo', h.current_elo, 'elo', h.elo, 
        'self_assessed_level', h.self_assessed_level, 'skill_label', h.skill_label, 
        'reliability_score', h.reliability_score, 'host_reputation', h.host_reputation
      ) as host,
      jsonb_build_object(
        'id', cs.id, 'start_time', cs.start_time, 'end_time', cs.end_time, 'price', cs.price,
        'court', jsonb_build_object(
          'id', c.id, 'name', c.name, 'address', c.address, 'city', c.city, 
          'thumbnail_url', c.thumbnail_url, 'images', c.images, 'rating', c.rating, 
          'rating_count', c.rating_count, 'amenities', c.amenities, 'highlight', c.highlight
        )
      ) as slot,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'player_id', sp2.player_id, 'status', sp2.status,
          'player', jsonb_build_object('id', p2.id, 'name', p2.name, 'reliability_score', p2.reliability_score, 'current_elo', p2.current_elo, 'self_assessed_level', p2.self_assessed_level, 'skill_label', p2.skill_label)
        ))
        FROM public.session_players sp2
        JOIN public.players p2 ON p2.id = sp2.player_id
        WHERE sp2.session_id = s.id AND sp2.status = 'confirmed'
      ) as session_players
    FROM public.sessions s
    JOIN public.players h ON h.id = s.host_id
    JOIN public.court_slots cs ON cs.id = s.slot_id
    JOIN public.courts c ON c.id = cs.court_id
    WHERE (s.host_id = p_user_id OR EXISTS (SELECT 1 FROM public.session_players sp4 WHERE sp4.session_id = s.id AND sp4.player_id = p_user_id AND sp4.status = 'confirmed'))
      AND s.status IN ('open', 'closed_recruitment')
      AND cs.start_time > now()
    ORDER BY cs.start_time ASC
    LIMIT 10
  )
  SELECT coalesce(jsonb_agg(u), '[]'::jsonb) INTO v_upcoming_sessions FROM upcoming u;

  -- 8. Favorite Courts full metadata
  IF v_profile->'favorite_court_ids' IS NOT NULL AND jsonb_array_length(v_profile->'favorite_court_ids') > 0 THEN
    SELECT jsonb_agg(to_jsonb(c)) INTO v_favorite_courts
    FROM public.courts c
    WHERE c.id::text = ANY(SELECT jsonb_array_elements_text(v_profile->'favorite_court_ids'));
  ELSE
    v_favorite_courts := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'stats', v_stats,
    'pending_matches', v_pending_matches,
    'post_match_actions', v_post_match_actions,
    'open_sessions', v_open_sessions,
    'upcoming_sessions', v_upcoming_sessions,
    'favorite_courts', v_favorite_courts,
    'server_time', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_home_data(uuid) TO authenticated, service_role;
