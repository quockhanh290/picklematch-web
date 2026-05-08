-- Migration: Add Round Robin support and XP system
-- Created: 2026-05-05

-- 1. Add format to sessions
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'social' CHECK (format IN ('social', 'round_robin', 'king_of_court', 'fixed_teams'));
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS results_finalized BOOLEAN DEFAULT false;

-- 2. Add XP and Level to profiles (if not exists)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS xp_points INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;

-- 3. Create a function to calculate Round Robin standings for a session
CREATE OR REPLACE FUNCTION public.get_round_robin_standings(p_session_id UUID)
RETURNS TABLE (
    player_id UUID,
    player_name TEXT,
    matches_played BIGINT,
    wins BIGINT,
    losses BIGINT,
    points_for BIGINT,
    points_against BIGINT,
    point_diff BIGINT,
    total_points BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH player_stats AS (
        -- Matches where player was in Team 1
        SELECT 
            sp.player_id,
            sm.team1_score as p_for,
            sm.team2_score as p_against,
            CASE WHEN sm.winner_team = 1 THEN 1 ELSE 0 END as is_win
        FROM public.session_matches sm
        JOIN public.session_players sp ON sp.session_id = sm.session_id AND sp.team_no = 1
        WHERE sm.session_id = p_session_id AND sm.status = 'completed'
        
        UNION ALL
        
        -- Matches where player was in Team 2
        SELECT 
            sp.player_id,
            sm.team2_score as p_for,
            sm.team1_score as p_against,
            CASE WHEN sm.winner_team = 2 THEN 1 ELSE 0 END as is_win
        FROM public.session_matches sm
        JOIN public.session_players sp ON sp.session_id = sm.session_id AND sp.team_no = 2
        WHERE sm.session_id = p_session_id AND sm.status = 'completed'
    )
    SELECT 
        ps.player_id,
        p.name as player_name,
        COUNT(*) as matches_played,
        SUM(ps.is_win) as wins,
        (COUNT(*) - SUM(ps.is_win)) as losses,
        SUM(ps.p_for) as points_for,
        SUM(ps.p_against) as points_against,
        (SUM(ps.p_for) - SUM(ps.p_against)) as point_diff,
        (SUM(ps.is_win) * 3) as total_points -- 3 points per win
    FROM player_stats ps
    JOIN public.players p ON p.id = ps.player_id
    GROUP BY ps.player_id, p.name
    ORDER BY total_points DESC, point_diff DESC, points_for DESC;
END;
$$;
