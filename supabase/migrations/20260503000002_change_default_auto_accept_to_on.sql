-- Migration to change default auto_accept to true
-- Created: 2026-05-03

-- 1. Change the default value for future records
alter table public.players 
  alter column auto_accept set default true;

-- 2. Update existing users who currently have it set to false
-- We do this because the previous default was false, and we want to align 
-- existing users with the new expected default behavior.
update public.players
set auto_accept = true
where auto_accept = false;
