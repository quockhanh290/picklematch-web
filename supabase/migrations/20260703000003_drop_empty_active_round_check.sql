-- The RPC-level guards prevent empty legacy round starts. The table-level check
-- is too broad for live-match flows that may use session_rounds as a round shell.

alter table public.session_rounds
  drop constraint if exists session_rounds_active_matches_nonempty;
