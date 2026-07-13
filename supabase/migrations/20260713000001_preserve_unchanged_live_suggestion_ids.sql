-- Metadata and resting snapshots may change while the playable court assignment
-- remains identical. Preserve the canonical row identity in that case so clients
-- do not receive a cancelled id for the same visible match.

do $$
declare
  v_definition text;
  v_marker text := E'  if v_existing_norm = v_incoming_norm then\n';
  v_identity_noop text := E'  if v_match_count = jsonb_array_length(v_existing_matches)\n'
    || E'    and not exists (\n'
    || E'      select 1\n'
    || E'      from jsonb_array_elements(p_matches) as incoming(value)\n'
    || E'      where not exists (\n'
    || E'        select 1\n'
    || E'        from public.session_live_matches slm\n'
    || E'        where slm.session_id = p_session_id\n'
    || E'          and slm.status = ''suggested''\n'
    || E'          and slm.court_idx = (incoming.value ->> ''court_idx'')::integer\n'
    || E'          and slm.team_a = incoming.value -> ''team_a''\n'
    || E'          and slm.team_b = incoming.value -> ''team_b''\n'
    || E'          and (p_replace_all or slm.court_idx = any(v_target_courts))\n'
    || E'      )\n'
    || E'    ) then\n'
    || E'    update public.session_live_matches slm\n'
    || E'    set resting = coalesce(incoming.value -> ''resting'', ''[]''::jsonb),\n'
    || E'        suggestion_metadata = incoming.value - array[''id'', ''session_id'', ''sequence_no'', ''round_no'', ''court_idx'', ''status'', ''team_a'', ''team_b'', ''resting'', ''score_a'', ''score_b'', ''suggested_at'', ''started_at'', ''ended_at'', ''created_at'', ''updated_at'', ''suggestion_metadata'']\n'
    || E'    from jsonb_array_elements(p_matches) as incoming(value)\n'
    || E'    where slm.session_id = p_session_id\n'
    || E'      and slm.status = ''suggested''\n'
    || E'      and slm.court_idx = (incoming.value ->> ''court_idx'')::integer\n'
    || E'      and slm.team_a = incoming.value -> ''team_a''\n'
    || E'      and slm.team_b = incoming.value -> ''team_b'';\n\n'
    || E'    select coalesce(jsonb_agg(to_jsonb(slm) order by slm.court_idx, slm.sequence_no), ''[]''::jsonb)\n'
    || E'    into v_existing_matches\n'
    || E'    from public.session_live_matches slm\n'
    || E'    where slm.session_id = p_session_id\n'
    || E'      and slm.status = ''suggested''\n'
    || E'      and (p_replace_all or slm.court_idx = any(v_target_courts));\n\n'
    || E'    return jsonb_build_object(\n'
    || E'      ''live_state_version'', v_live_state_version,\n'
    || E'      ''matches'', v_existing_matches,\n'
    || E'      ''persisted_preview_noop'', true\n'
    || E'    );\n'
    || E'  end if;\n\n';
begin
  select pg_get_functiondef(
    'public.replace_live_session_suggestions_versioned(uuid,bigint,jsonb,jsonb,boolean,jsonb)'::regprocedure
  ) into v_definition;

  if position('Metadata and resting snapshots may change while the playable court assignment' in v_definition) > 0 then
    return;
  end if;
  if position(v_marker in v_definition) = 0 then
    raise exception 'Could not locate live suggestion no-op block';
  end if;

  v_definition := replace(
    v_definition,
    v_marker,
    E'  -- Metadata and resting snapshots may change while the playable court assignment is stable.\n'
      || v_identity_noop
      || v_marker
  );
  execute v_definition;
end;
$$;

revoke all on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
