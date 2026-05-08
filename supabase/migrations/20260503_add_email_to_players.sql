-- Add email column to players table
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS email TEXT;

-- Update RLS if needed (optional, assuming existing policies are broad enough)
-- COMMENT ON COLUMN public.players.email IS 'User email captured during onboarding';
