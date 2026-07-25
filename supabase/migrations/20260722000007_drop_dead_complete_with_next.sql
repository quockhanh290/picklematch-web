-- Remove dead, broken RPC complete_live_session_match_with_next_versioned.
--
-- It is never called (no rpc() reference in the app / edge functions; zero decision events),
-- and it is broken: its insert of the next match omits round_no, which was later made NOT NULL
-- with no default (20260522000010), so any call would throw and roll back the whole completion.
-- It also wrote last_played_round = sequence_no instead of round_no. Delete it rather than leave
-- a landmine. The live path uses complete_live_session_match_versioned.

drop function if exists public.complete_live_session_match_with_next_versioned(uuid, bigint, uuid, integer, integer, integer, jsonb, jsonb);

notify pgrst, 'reload schema';
