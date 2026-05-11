DO $$
BEGIN
  -- 1. Thêm cột metadata vào bảng session_players (Để chạy được logic Per-Session)
  ALTER TABLE public.session_players ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

  -- 2. Cập nhật RPC get_session_detail_overview để trả về thêm metadata
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
        'metadata', sp.metadata, -- ĐÃ THÊM METADATA VÀO ĐÂY
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
END $$;

DO $$
DECLARE
  v_host_id uuid;
  v_court_id uuid;
  v_slot_id uuid;
  v_session_id uuid;
  v_player_id uuid;
  v_gender text;
  v_elo int;
  v_pvna numeric;
  v_partner_pref text;
  v_opponent_pref text;
  i int;
BEGIN
  -- 1. Tìm chính xác Host ID thông qua bảng auth.users bằng email host@test.com
  SELECT id INTO v_host_id FROM auth.users WHERE email = 'host@test.com' LIMIT 1;

  IF v_host_id IS NULL THEN
    -- Fallback
    SELECT host_id INTO v_host_id FROM public.sessions LIMIT 1;
  END IF;

  -- 2. Tạo hoặc lấy một Sân (Court)
  SELECT id INTO v_court_id FROM public.courts LIMIT 1;
  IF v_court_id IS NULL THEN
    INSERT INTO public.courts (id, name, address, total_courts, status)
    VALUES (gen_random_uuid(), 'Sân Test Pickleball', '123 Test Street', 4, 'active')
    RETURNING id INTO v_court_id;
  END IF;

  -- 3. Tạo một Slot thời gian: Diễn ra trong 2 giờ tới
  INSERT INTO public.court_slots (id, court_id, start_time, end_time, status)
  VALUES (
    gen_random_uuid(), 
    v_court_id, 
    now() + interval '2 hours', 
    now() + interval '4 hours', 
    'booked'
  )
  RETURNING id INTO v_slot_id;

  -- 4. Tạo 1 Kèo (Session) khẩn cấp: Tối đa 24 người
  INSERT INTO public.sessions (
    id, host_id, slot_id, max_players, total_cost, status, format_type, sub_courts_used
  )
  VALUES (
    gen_random_uuid(), v_host_id, v_slot_id, 24, 50000, 'open', 'social', 2
  )
  RETURNING id INTO v_session_id;

  -- 5. Vòng lặp: Tạo 12 người chơi giả
  FOR i IN 1..12 LOOP
    -- Luân phiên giới tính
    IF i % 2 = 0 THEN v_gender := 'female'; ELSE v_gender := 'male'; END IF;
    
    -- ELO ngẫu nhiên và PVNA tương ứng
    v_elo := 700 + (i * 40) % 500;
    v_pvna := 2.0 + (v_elo - 700) * 0.005; 
    
    -- Sở thích xếp cặp
    IF i % 3 = 0 THEN v_partner_pref := 'same'; 
    ELSIF i % 3 = 1 THEN v_partner_pref := 'mixed'; 
    ELSE v_partner_pref := 'any'; END IF;
    
    IF i % 4 = 0 THEN v_opponent_pref := 'same'; 
    ELSIF i % 4 = 1 THEN v_opponent_pref := 'mixed'; 
    ELSE v_opponent_pref := 'any'; END IF;

    -- Map sang giới tính
    IF v_partner_pref = 'same' THEN v_partner_pref := v_gender;
    ELSIF v_partner_pref = 'mixed' THEN
      IF v_gender = 'female' THEN v_partner_pref := 'male'; ELSE v_partner_pref := 'female'; END IF;
    END IF;

    IF v_opponent_pref = 'same' THEN v_opponent_pref := v_gender;
    ELSIF v_opponent_pref = 'mixed' THEN
      IF v_gender = 'female' THEN v_opponent_pref := 'male'; ELSE v_opponent_pref := 'female'; END IF;
    END IF;

    -- Tạo người chơi vào bảng players
    INSERT INTO public.players (
      id, name, phone, gender, current_elo, pvna,
      partner_gender_pref, opponent_gender_pref
    ) 
    VALUES (
      gen_random_uuid(), 
      'Dummy ' || i || ' (' || CASE WHEN v_gender = 'male' THEN 'Nam' ELSE 'Nữ' END || ' ' || ROUND(v_pvna, 1) || ')', 
      '09' || lpad((extract(epoch from now())::bigint % 100000000 + i)::text, 8, '0'),
      v_gender,
      v_elo,
      v_pvna,
      v_partner_pref,
      v_opponent_pref
    ) 
    RETURNING id INTO v_player_id;

    -- Thêm vào kèo và GHI CHÉP CHÍNH XÁC VÀO METADATA CỦA KÈO
    INSERT INTO public.session_players (session_id, player_id, status, metadata)
    VALUES (
      v_session_id, 
      v_player_id, 
      'confirmed',
      json_build_object(
        'partner_gender_pref', v_partner_pref,
        'opponent_gender_pref', v_opponent_pref
      )::jsonb
    );
  END LOOP;

  RAISE NOTICE 'Đã thêm cột metadata vào session_players và tạo thành công Kèo Test!';
END $$;
