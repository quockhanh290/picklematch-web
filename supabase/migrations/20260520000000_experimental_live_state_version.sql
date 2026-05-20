-- Experimental live session version counter for Start/End Round benchmarking.
-- This migration only adds the version column. It does not change production flows.

alter table public.sessions
add column if not exists live_state_version bigint not null default 0;
