-- Migration: Add metadata to session_players and isolate per-session preferences
-- Created: 2026-05-11

-- 1. Thêm cột metadata vào bảng session_players
ALTER TABLE public.session_players ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

-- 2. Cập nhật hàm register_and_join_session để lưu metadata vào session_players
DROP FUNCTION IF EXISTS public.register_and_join_session(UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC, JSONB);

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
BEGIN
  -- 0. Trích xuất preferences
  v_partner_pref := COALESCE(p_metadata->>'partner_gender_pref', 'any');
  v_opponent_pref := COALESCE(p_metadata->>'opponent_gender_pref', 'any');

  -- 1. Kiểm tra lịch sử No-show
  SELECT id, no_show_count INTO v_existing_id, v_no_show_count
  FROM public.players
  WHERE phone = p_phone
  LIMIT 1;

  IF v_no_show_count >= 5 THEN
    RETURN JSONB_BUILD_OBJECT('error', 'Tài khoản của bạn bị từ chối tham gia do có quá nhiều lần không trình diện (No-show).');
  END IF;

  -- 2. Xử lý Tạo mới hoặc Cập nhật Player
  IF v_existing_id IS NOT NULL THEN
    v_player_id := v_existing_id;
    -- CHỈ cập nhật thông tin chung, KHÔNG ép ghi đè preferences của kèo này làm mặc định trừ khi UI thực sự truyền giá trị mới hợp lệ
    UPDATE public.players
    SET 
      name = COALESCE(name, p_name),
      gender = COALESCE(gender, p_gender),
      elo = COALESCE(elo, p_elo),
      pvna = COALESCE(pvna, p_pvna),
      partner_gender_pref = CASE WHEN v_partner_pref != 'any' THEN v_partner_pref ELSE partner_gender_pref END,
      opponent_gender_pref = CASE WHEN v_opponent_pref != 'any' THEN v_opponent_pref ELSE opponent_gender_pref END
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

  -- 3. Kiểm tra xem đã join chưa
  IF EXISTS (
    SELECT 1 FROM public.session_players 
    WHERE session_id = p_session_id AND player_id = v_player_id
  ) THEN
    -- Update lại metadata nếu họ join lại để đổi sở thích
    UPDATE public.session_players 
    SET metadata = p_metadata
    WHERE session_id = p_session_id AND player_id = v_player_id;

    RETURN JSONB_BUILD_OBJECT('player_id', v_player_id, 'status', 'already_joined');
  END IF;

  -- 4. Quyết định Status (Waitlist logic)
  SELECT max_players INTO v_max_players FROM public.sessions WHERE id = p_session_id;
  
  SELECT COUNT(*) INTO v_current_players 
  FROM public.session_players 
  WHERE session_id = p_session_id AND status = 'confirmed';

  IF v_current_players >= v_max_players THEN
    v_status := 'waiting';
  ELSE
    v_status := 'confirmed';
  END IF;

  -- 5. Tham gia kèo và LƯU TRỰC TIẾP metadata vào session_players
  INSERT INTO public.session_players (
    session_id,
    player_id,
    status,
    metadata
  ) VALUES (
    p_session_id,
    v_player_id,
    v_status,
    p_metadata
  );

  RETURN JSONB_BUILD_OBJECT(
    'player_id', v_player_id, 
    'status', v_status,
    'no_show_warning', (v_no_show_count > 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_and_join_session(UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC, JSONB) TO anon, authenticated;

-- 3. Cập nhật hàm get_session_detail_overview để trả về cột metadata của session_players
CREATE OR REPLACE FUNCTION public.get_session_detail_overview(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
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
      p.is_guest, p.sessions_joined, p.no_show_count,
      p.partner_gender_pref, p.opponent_gender_pref
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
      'metadata', sp.metadata, -- ĐÃ THÊM METADATA Ở ĐÂY
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
        'no_show_count', p.no_show_count,
        'partner_gender_pref', p.partner_gender_pref,
        'opponent_gender_pref', p.opponent_gender_pref
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

  v_result := jsonb_set(
    v_result, 
    '{session,host}', 
    (v_result->'session'->'host'->0)
  );

  RETURN v_result;
END;
$func$;
