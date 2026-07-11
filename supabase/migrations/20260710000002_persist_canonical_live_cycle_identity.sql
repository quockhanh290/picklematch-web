-- Persist the engine's reconstructed logical cycle per match. Keep round_no
-- mirrored during the compatibility window because completion/report RPCs
-- still expose that legacy field.

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.replace_live_session_suggestions_versioned(uuid,bigint,jsonb,jsonb,boolean,jsonb)'::regprocedure
  )
  into v_definition;

  v_updated := regexp_replace(
    v_definition,
    '(insert into public[.]session_live_matches [(][[:space:]]*session_id,[[:space:]]*sequence_no,[[:space:]]*)round_no,',
    E'\\1round_no,\n      cycle_no,',
    'n'
  );
  if v_updated = v_definition then
    raise exception 'Could not add cycle_no to live preview persistence';
  end if;

  v_definition := v_updated;
  v_updated := regexp_replace(
    v_definition,
    '([[:space:]]*v_base_sequence [+] ordinality::integer - 1,[[:space:]]*)v_round_no,',
    E'\\1coalesce((match.value ->> ''round_no'')::integer, v_round_no),\n      coalesce((match.value ->> ''round_no'')::integer, v_round_no),',
    'n'
  );
  if v_updated = v_definition then
    raise exception 'Could not persist canonical cycle_no from preview payload';
  end if;

  execute v_updated;
end;
$$;

revoke all on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
