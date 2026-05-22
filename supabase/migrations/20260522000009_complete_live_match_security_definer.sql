alter function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb)
security definer;

alter function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb)
set search_path = public;

notify pgrst, 'reload schema';
