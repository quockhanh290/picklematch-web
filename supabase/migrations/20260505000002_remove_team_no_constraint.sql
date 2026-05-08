-- Migration: Remove team_no constraint to support multiple teams
-- Created: 2026-05-05

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'session_players_team_no_check'
    ) THEN
        ALTER TABLE public.session_players DROP CONSTRAINT session_players_team_no_check;
    END IF;
END $$;

-- Add a new, more flexible constraint (optional, but good practice)
-- Let's allow up to 32 teams for very large sessions
ALTER TABLE public.session_players 
ADD CONSTRAINT session_players_team_no_check 
CHECK (team_no >= 1 AND team_no <= 32 OR team_no IS NULL);
