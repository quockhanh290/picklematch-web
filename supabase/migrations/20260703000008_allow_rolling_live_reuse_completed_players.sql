do $$
declare
  v_definition text;
  v_updated text;
  v_replace_guard text := $guard$
       or (
         slm.round_no = v_round_no
         and slm.status not in ('cancelled', 'suggested')
       )
$guard$;
  v_start_guard text := $guard$
       or (
         live.round_no = v_match.round_no
         and live.status not in ('cancelled', 'suggested')
       )
$guard$;
begin
  select pg_get_functiondef(
    'public.replace_live_session_suggestions_versioned(uuid,bigint,jsonb,jsonb,boolean,jsonb)'::regprocedure
  )
  into v_definition;

  v_updated := replace(v_definition, v_replace_guard, '');
  if v_updated = v_definition then
    raise exception 'Could not find same-round completed-player guard in replace_live_session_suggestions_versioned';
  end if;
  execute v_updated;

  select pg_get_functiondef(
    'public.start_live_session_match_versioned(uuid,bigint,uuid,jsonb)'::regprocedure
  )
  into v_definition;

  v_updated := replace(v_definition, v_start_guard, '');
  if v_updated = v_definition then
    raise exception 'Could not find same-round completed-player guard in start_live_session_match_versioned';
  end if;
  execute v_updated;
end;
$$;

revoke all on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb) to authenticated;

revoke all on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
