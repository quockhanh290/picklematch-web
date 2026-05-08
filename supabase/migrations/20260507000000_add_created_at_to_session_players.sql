-- Migration: Add created_at to session_players
-- Created: 2026-05-07

ALTER TABLE public.session_players 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing records if needed (they will all have the current time by default)
-- If you want to differentiate them, you could spread them, but for now this is sufficient.
