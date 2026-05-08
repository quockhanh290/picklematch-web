-- Migration: Expand owner_sessions table with match details
-- Created: 2024-05-04
-- Purpose: Mirror common session fields into owner_sessions for easier access and persistence of owner intent.

ALTER TABLE public.owner_sessions 
ADD COLUMN IF NOT EXISTS elo_min NUMERIC,
ADD COLUMN IF NOT EXISTS elo_max NUMERIC,
ADD COLUMN IF NOT EXISTS total_cost INTEGER,
ADD COLUMN IF NOT EXISTS require_approval BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS max_players INTEGER;

-- Sync existing data
UPDATE public.owner_sessions os
SET 
  elo_min = s.elo_min,
  elo_max = s.elo_max,
  total_cost = s.total_cost,
  require_approval = s.require_approval,
  max_players = s.max_players,
  start_time = cs.start_time,
  end_time = cs.end_time
FROM public.sessions s
JOIN public.court_slots cs ON cs.id = s.slot_id
WHERE os.id = s.id;
