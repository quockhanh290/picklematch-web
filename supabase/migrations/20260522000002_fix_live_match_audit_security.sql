-- Live-match RPCs write host audit rows inside the same transaction.
-- Match the existing versioned round RPCs by running as security definer so
-- audit RLS cannot roll back the user-facing mutation.

alter table public.suggester_decision_events
  alter column event_source set default 'host',
  alter column actor_id set default auth.uid();

alter function public.create_live_session_matches_versioned(uuid, bigint, jsonb, jsonb)
  security definer;
alter function public.create_live_session_matches_versioned(uuid, bigint, jsonb, jsonb)
  set search_path = public;

alter function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb)
  security definer;
alter function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb)
  set search_path = public;

alter function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb)
  security definer;
alter function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb)
  set search_path = public;

notify pgrst, 'reload schema';
