-- Migration: Add bio column to players table
-- Description: Adds a self-description (bio) field to the players table for user profiles.

alter table public.players
  add column if not exists bio text;

-- Add a comment for documentation
comment on column public.players.bio is 'Self-description/biography of the player for their profile.';
