create or replace function public.publish_session_plan_signal_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_marked_suggestion_count integer;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authenticated host access required';
  end if;
  if auth.uid() is not null and v_host_id <> auth.uid() then
    raise exception 'Only the host can publish a session plan';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;
  if not exists (
    select 1
    from public.session_plan_versions spv
    where spv.id = p_plan_version_id
      and spv.session_id = p_session_id
  ) then
    raise exception 'Session plan version not found';
  end if;

  update public.session_live_matches
  set suggestion_metadata = coalesce(suggestion_metadata, '{}'::jsonb)
    || jsonb_build_object('plan_adoption_pending', p_plan_version_id)
  where session_id = p_session_id
    and status = 'suggested';
  get diagnostics v_marked_suggestion_count = row_count;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_live_state_version;

  return jsonb_build_object(
    'live_state_version', v_live_state_version,
    'plan_version_id', p_plan_version_id,
    'marked_suggestion_count', v_marked_suggestion_count
  );
end;
$$;

revoke all on function public.publish_session_plan_signal_versioned(uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_session_plan_signal_versioned(uuid, bigint, uuid)
  to authenticated, service_role;

create or replace function public.replace_planned_live_session_suggestions_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_expected_planning_mutation_version bigint,
  p_matches jsonb,
  p_replace_court_idxs jsonb default '[]'::jsonb,
  p_replace_all boolean default false,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_planning_mutation_version bigint;
begin
  select host_id, live_state_version, planning_mutation_version
  into v_host_id, v_live_state_version, v_planning_mutation_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authenticated host access required';
  end if;
  if auth.uid() is not null and v_host_id <> auth.uid() then
    raise exception 'Only the host can replace live match suggestions';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;
  if v_planning_mutation_version <> p_expected_planning_mutation_version then
    raise exception 'Session planning changed';
  end if;

  return public.replace_live_session_suggestions_versioned(
    p_session_id,
    p_expected_live_state_version,
    p_matches,
    p_replace_court_idxs,
    p_replace_all,
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'plan_consumption_cas', true,
      'planning_mutation_version', p_expected_planning_mutation_version
    )
  );
end;
$$;

revoke all on function public.replace_planned_live_session_suggestions_versioned(
  uuid, bigint, bigint, jsonb, jsonb, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_planned_live_session_suggestions_versioned(
  uuid, bigint, bigint, jsonb, jsonb, boolean, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';
