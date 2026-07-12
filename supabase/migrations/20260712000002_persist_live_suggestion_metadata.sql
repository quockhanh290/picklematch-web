alter table public.session_live_matches
  add column if not exists suggestion_metadata jsonb not null default '{}'::jsonb;

do $$
declare
  v_definition text;
  v_updated text;
  v_incoming_old text := E'      \'resting\', coalesce(match.value -> \'resting\', \'[]\'::jsonb)\n';
  v_incoming_new text := E'      \'resting\', coalesce(match.value -> \'resting\', \'[]\'::jsonb),\n'
    || E'      \'suggestion_metadata\', match.value - array[\'id\', \'session_id\', \'sequence_no\', \'round_no\', \'court_idx\', \'status\', \'team_a\', \'team_b\', \'resting\', \'score_a\', \'score_b\', \'suggested_at\', \'started_at\', \'ended_at\', \'created_at\', \'updated_at\', \'suggestion_metadata\']\n';
  v_existing_old text := E'      \'resting\', coalesce(slm.resting, \'[]\'::jsonb)\n';
  v_existing_new text := E'      \'resting\', coalesce(slm.resting, \'[]\'::jsonb),\n'
    || E'      \'suggestion_metadata\', coalesce(slm.suggestion_metadata, \'{}\'::jsonb)\n';
  v_columns_old text := E'      team_b,\n      resting\n';
  v_columns_new text := E'      team_b,\n      resting,\n      suggestion_metadata\n';
  v_values_old text := E'      match.value -> \'team_b\',\n      coalesce(match.value -> \'resting\', \'[]\'::jsonb)\n';
  v_values_new text := E'      match.value -> \'team_b\',\n      coalesce(match.value -> \'resting\', \'[]\'::jsonb),\n'
    || E'      match.value - array[\'id\', \'session_id\', \'sequence_no\', \'round_no\', \'court_idx\', \'status\', \'team_a\', \'team_b\', \'resting\', \'score_a\', \'score_b\', \'suggested_at\', \'started_at\', \'ended_at\', \'created_at\', \'updated_at\', \'suggestion_metadata\']\n';
begin
  select pg_get_functiondef(
    'public.replace_live_session_suggestions_versioned(uuid,bigint,jsonb,jsonb,boolean,jsonb)'::regprocedure
  ) into v_definition;

  if position('suggestion_metadata' in v_definition) > 0 then
    return;
  end if;
  if position(v_incoming_old in v_definition) = 0
    or position(v_existing_old in v_definition) = 0
    or position(v_columns_old in v_definition) = 0
    or position(v_values_old in v_definition) = 0 then
    raise exception 'Could not locate suggestion persistence blocks';
  end if;

  v_updated := replace(v_definition, v_incoming_old, v_incoming_new);
  v_updated := replace(v_updated, v_existing_old, v_existing_new);
  v_updated := replace(v_updated, v_columns_old, v_columns_new);
  v_updated := replace(v_updated, v_values_old, v_values_new);
  execute v_updated;
end;
$$;

revoke all on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
