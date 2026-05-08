-- Migration: Add skill points (PVNA) to owner_sessions
-- Created: 2024-05-04

ALTER TABLE public.owner_sessions 
ADD COLUMN IF NOT EXISTS min_skill NUMERIC,
ADD COLUMN IF NOT EXISTS max_skill NUMERIC;

-- Function to convert Elo to PVNA skill point in SQL
CREATE OR REPLACE FUNCTION public.elo_to_pvna(p_elo numeric)
RETURNS numeric AS $$
BEGIN
  IF p_elo IS NULL THEN RETURN NULL; END IF;
  -- New Formula: (elo - 1000) / 428.57 + 2.0
  RETURN ROUND(((p_elo - 1000) / 428.57 + 2.0)::numeric, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Sync existing data
UPDATE public.owner_sessions
SET 
  min_skill = public.elo_to_pvna(elo_min),
  max_skill = public.elo_to_pvna(elo_max);
