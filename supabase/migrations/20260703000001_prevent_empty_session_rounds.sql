-- Prevent stale empty active rows in session_rounds.
-- Security-definer RPCs bypass RLS; body guards are the source of truth.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_rounds_active_matches_nonempty'
      and conrelid = 'public.session_rounds'::regclass
  ) then
    alter table public.session_rounds
      add constraint session_rounds_active_matches_nonempty
      check (
        status <> 'active'
        or coalesce(jsonb_array_length(matches), 0) > 0
      ) not valid;
  end if;
end;
$$;

create or replace function public.start_live_session_round(
  p_session_id uuid,
  p_round_no int,
  p_matches jsonb,
  p_resting jsonb,
  p_event_source text,
  p_actor_id uuid,
  p_audit_payload jsonb,
  p_adjustment_warnings text[] default '{}'::text[],
  p_adjustment_config_changes jsonb default '{}'::jsonb,
  p_adjustment_tier_overrides jsonb default '{}'::jsonb,
  p_fairness_score_before int default null
)
returns public.session_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.session_rounds;
begin
  if coalesce(jsonb_array_length(p_matches), 0) = 0 then
    raise exception 'Cannot start an empty round';
  end if;

  insert into public.session_rounds (
    session_id,
    round_no,
    status,
    matches,
    resting,
    started_at
  )
  values (
    p_session_id,
    p_round_no,
    'active',
    p_matches,
    p_resting,
    now()
  )
  returning * into v_round;

  if coalesce(array_length(p_adjustment_warnings, 1), 0) > 0 then
    insert into public.suggester_adjustments (
      session_id,
      round_no,
      triggered_by_warnings,
      config_changes,
      tier_overrides,
      fairness_score_before
    )
    values (
      p_session_id,
      p_round_no,
      p_adjustment_warnings,
      p_adjustment_config_changes,
      p_adjustment_tier_overrides,
      p_fairness_score_before
    );
  end if;

  insert into public.suggester_decision_events (
    session_id,
    round_no,
    event_type,
    event_source,
    actor_id,
    payload
  )
  values (
    p_session_id,
    p_round_no,
    'round_started',
    p_event_source,
    p_actor_id,
    coalesce(p_audit_payload, '{}'::jsonb)
  );

  return v_round;
end;
$$;

revoke all on function public.start_live_session_round(
  uuid,
  int,
  jsonb,
  jsonb,
  text,
  uuid,
  jsonb,
  text[],
  jsonb,
  jsonb,
  int
) from public, anon, authenticated;

grant execute on function public.start_live_session_round(
  uuid,
  int,
  jsonb,
  jsonb,
  text,
  uuid,
  jsonb,
  text[],
  jsonb,
  jsonb,
  int
) to service_role;

create or replace function public.start_live_session_round_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_round_no int,
  p_matches jsonb,
  p_resting jsonb,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_host_id uuid;
  v_live_state_version bigint;
  v_round public.session_rounds;
  v_next_version bigint;
  v_played_count int;
  v_available_count int;
  v_t0 timestamptz := clock_timestamp();
  v_t_session_locked timestamptz;
  v_t_active_checked timestamptz;
  v_t_played_validated timestamptz;
  v_t_available_validated timestamptz;
  v_t_round_inserted timestamptz;
  v_t_audit_inserted timestamptz;
  v_t_version_bumped timestamptz;
  v_include_timing boolean := coalesce(p_audit_payload ->> 'benchmark', '') = 'true'
    or coalesce(p_audit_payload ->> 'debug_timing', '') = 'true';
  v_result jsonb;
begin
  select id, host_id, live_state_version
  into v_session_id, v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;
  v_t_session_locked := clock_timestamp();

  if v_session_id is null then
    raise exception 'Session not found';
  end if;

  if v_host_id <> auth.uid() then
    raise exception 'Only the host can start round';
  end if;

  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  if exists (
    select 1
    from public.session_rounds
    where session_id = p_session_id
      and status = 'active'
  ) then
    raise exception 'A round is already active';
  end if;
  v_t_active_checked := clock_timestamp();

  if coalesce(jsonb_array_length(p_matches), 0) = 0 then
    raise exception 'Cannot start an empty round';
  end if;

  with played as (
    select distinct ids.player_id
    from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) as match(value)
    cross join lateral (
      select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
      union all
      select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
    ) ids
  )
  select count(*)
  into v_played_count
  from played;

  if v_played_count <> coalesce(jsonb_array_length(p_matches), 0) * 4 then
    raise exception 'A player can only be assigned once per round';
  end if;
  v_t_played_validated := clock_timestamp();

  with played as (
    select distinct ids.player_id
    from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) as match(value)
    cross join lateral (
      select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
      union all
      select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
    ) ids
  )
  select count(*)
  into v_available_count
  from public.session_player_state sps
  join played on played.player_id = sps.player_id
  where sps.session_id = p_session_id
    and sps.checked_out_at is null
    and sps.opted_rest is false;

  if v_available_count <> v_played_count then
    raise exception 'Manual matches must use checked-in players';
  end if;
  v_t_available_validated := clock_timestamp();

  insert into public.session_rounds (
    session_id,
    round_no,
    status,
    matches,
    resting,
    started_at
  )
  values (
    p_session_id,
    p_round_no,
    'active',
    p_matches,
    p_resting,
    now()
  )
  returning * into v_round;
  v_t_round_inserted := clock_timestamp();

  insert into public.suggester_decision_events (
    session_id,
    round_no,
    event_type,
    event_source,
    actor_id,
    payload
  )
  values (
    p_session_id,
    p_round_no,
    'round_started',
    'host',
    auth.uid(),
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('experimental_versioned_rpc', true)
  );
  v_t_audit_inserted := clock_timestamp();

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;
  v_t_version_bumped := clock_timestamp();

  v_result := jsonb_build_object(
    'round', to_jsonb(v_round),
    'live_state_version', v_next_version
  );

  if v_include_timing then
    v_result := v_result || jsonb_build_object(
      'rpc_timing_ms',
      jsonb_build_object(
        'session_lock', round(extract(epoch from v_t_session_locked - v_t0) * 1000)::int,
        'active_check', round(extract(epoch from v_t_active_checked - v_t_session_locked) * 1000)::int,
        'played_validation', round(extract(epoch from v_t_played_validated - v_t_active_checked) * 1000)::int,
        'availability_validation', round(extract(epoch from v_t_available_validated - v_t_played_validated) * 1000)::int,
        'insert_round', round(extract(epoch from v_t_round_inserted - v_t_available_validated) * 1000)::int,
        'insert_audit', round(extract(epoch from v_t_audit_inserted - v_t_round_inserted) * 1000)::int,
        'bump_version', round(extract(epoch from v_t_version_bumped - v_t_audit_inserted) * 1000)::int,
        'total', round(extract(epoch from v_t_version_bumped - v_t0) * 1000)::int
      )
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.start_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, jsonb) to authenticated;
