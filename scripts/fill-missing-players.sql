-- SQL script to fill past-due sessions with dummy players
-- Run this in the Supabase SQL Editor

DO $$
DECLARE
    rec RECORD;
    v_missing_count INT;
    v_dummy_player_id UUID;
    v_team1_count INT;
    v_team2_count INT;
BEGIN
    FOR rec IN 
        SELECT s.id, s.max_players, 
               (SELECT count(*) FROM public.session_players sp WHERE sp.session_id = s.id AND sp.status = 'confirmed') as current_count
        FROM public.sessions s
        WHERE (s.status = 'open' OR s.status = 'pending_completion')
          AND s.end_time < now()
    LOOP
        v_missing_count := rec.max_players - rec.current_count;
        
        IF v_missing_count > 0 THEN
            RAISE NOTICE 'Filling session %: current count %, max %, missing %', rec.id, rec.current_count, rec.max_players, v_missing_count;
            
            -- Transition status if needed so it appears in "Kèo cần nhập kết quả"
            UPDATE public.sessions 
            SET status = 'pending_completion',
                pending_completion_marked_at = COALESCE(pending_completion_marked_at, now())
            WHERE id = rec.id AND status = 'open';

            FOR i IN 1..v_missing_count LOOP
                -- Pick a dummy player who is not already in the session
                SELECT id INTO v_dummy_player_id
                FROM public.players
                WHERE id IN (
                    '90000000-0000-0000-0000-000000000001',
                    '90000000-0000-0000-0000-000000000002',
                    '90000000-0000-0000-0000-000000000003',
                    '90000000-0000-0000-0000-000000000004',
                    '90000000-0000-0000-0000-000000000006',
                    '90000000-0000-0000-0000-000000000007'
                )
                AND id NOT IN (SELECT player_id FROM public.session_players WHERE session_id = rec.id)
                LIMIT 1;

                IF v_dummy_player_id IS NOT NULL THEN
                    -- Calculate team distribution
                    SELECT count(*) INTO v_team1_count FROM public.session_players WHERE session_id = rec.id AND team_no = 1;
                    SELECT count(*) INTO v_team2_count FROM public.session_players WHERE session_id = rec.id AND team_no = 2;

                    INSERT INTO public.session_players (session_id, player_id, status, team_no)
                    VALUES (rec.id, v_dummy_player_id, 'confirmed', (CASE WHEN v_team1_count <= v_team2_count THEN 1 ELSE 2 END));
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END $$;
