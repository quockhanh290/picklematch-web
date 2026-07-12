-- Partial replacement payloads must not silently expand beyond the courts
-- explicitly requested by the caller.

do $$
declare
  v_definition text;
  v_updated text;
  v_marker text := E'  select coalesce(array_agg(distinct court_idx order by court_idx), \'{}\')';
  v_guard text := E'  if not p_replace_all and exists (\n'
    || E'    select 1\n'
    || E'    from jsonb_array_elements(p_matches) as match(value)\n'
    || E'    where not exists (\n'
    || E'      select 1\n'
    || E'      from jsonb_array_elements(p_replace_court_idxs) as requested(value)\n'
    || E'      where (requested.value #>> \'{}\') ~ \'^-?[0-9]+$\'\n'
    || E'        and (requested.value #>> \'{}\')::integer = (match.value ->> \'court_idx\')::integer\n'
    || E'    )\n'
    || E'  ) then\n'
    || E'    raise exception \'Partial preview matches must belong to explicitly requested replacement courts\';\n'
    || E'  end if;\n\n';
begin
  select pg_get_functiondef(
    'public.replace_live_session_suggestions_versioned(uuid,bigint,jsonb,jsonb,boolean,jsonb)'::regprocedure
  )
  into v_definition;

  if position('Partial preview matches must belong to explicitly requested replacement courts' in v_definition) > 0 then
    return;
  end if;
  if position(v_marker in v_definition) = 0 then
    raise exception 'Could not locate target-court construction in replace_live_session_suggestions_versioned';
  end if;

  v_updated := replace(v_definition, v_marker, v_guard || v_marker);
  execute v_updated;
end;
$$;

revoke all on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
