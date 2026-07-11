-- Make completion accounting consume canonical cycles. Snapshot live rows use
-- select *, while synthetic legacy round rows remain compatible because the
-- writer mirrors cycle_no into round_no during the transition.

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.complete_live_session_match_versioned(uuid,bigint,uuid,integer,integer,integer,jsonb)'::regprocedure
  )
  into v_definition;

  v_updated := replace(
    v_definition,
    'v_match.round_no',
    'coalesce(v_match.cycle_no, v_match.round_no)'
  );
  if v_updated = v_definition then
    raise exception 'Could not switch live completion to canonical cycle_no';
  end if;
  execute v_updated;
end;
$$;

revoke all on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
