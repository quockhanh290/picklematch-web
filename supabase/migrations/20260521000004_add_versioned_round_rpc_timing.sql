-- Add opt-in internal stage timing for the versioned start/end round RPCs.
-- Timing is returned only when p_audit_payload contains benchmark=true or
-- debug_timing=true, so normal production responses keep the same shape.

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

create or replace function public.complete_live_session_round_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_round_no int,
  p_player_state jsonb,
  p_pair_history jsonb,
  p_score_after int,
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
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_resting_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
  v_t0 timestamptz := clock_timestamp();
  v_t_session_locked timestamptz;
  v_t_round_locked timestamptz;
  v_t_played_state_updated timestamptz;
  v_t_resting_state_updated timestamptz;
  v_t_pair_history_upserted timestamptz;
  v_t_round_updated timestamptz;
  v_t_adjustments_updated timestamptz;
  v_t_audit_inserted timestamptz;
  v_t_version_bumped timestamptz;
  v_include_timing boolean := coalesce(p_audit_payload ->> 'benchmark', '') = 'true'
    or coalesce(p_audit_payload ->> 'debug_timing', '') = 'true';
  v_result jsonb;
begin
  -- Keep arguments in the signature for backward compatibility. Commit deltas
  -- are derived from the persisted active round below.
  perform p_player_state, p_pair_history;

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
    raise exception 'Only the host can complete round';
  end if;

  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  select *
  into v_round
  from public.session_rounds
  where session_id = p_session_id
    and round_no = p_round_no
    and status = 'active'
  for update;
  v_t_round_locked := clock_timestamp();

  if v_round.id is null then
    raise exception 'Active round not found';
  end if;

  with match_rows as (
    select
      array(select jsonb_array_elements_text(match.value -> 'team_a')::uuid) as team_a,
      array(select jsonb_array_elements_text(match.value -> 'team_b')::uuid) as team_b
    from jsonb_array_elements(coalesce(v_round.matches, '[]'::jsonb)) as match(value)
  ),
  played as (
    select distinct ids.player_id
    from match_rows
    cross join lateral unnest(team_a || team_b) as ids(player_id)
  ),
  updated as (
    update public.session_player_state sps
    set
      matches_played = sps.matches_played + 1,
      last_played_round = p_round_no,
      consecutive_rest = 0,
      consecutive_play = sps.consecutive_play + 1,
      opted_rest = false
    from played
    where sps.session_id = p_session_id
      and sps.player_id = played.player_id
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.player_id), '[]'::jsonb)
  into v_changed_player_state
  from updated;
  v_t_played_state_updated := clock_timestamp();

  with match_rows as (
    select
      array(select jsonb_array_elements_text(match.value -> 'team_a')::uuid) as team_a,
      array(select jsonb_array_elements_text(match.value -> 'team_b')::uuid) as team_b
    from jsonb_array_elements(coalesce(v_round.matches, '[]'::jsonb)) as match(value)
  ),
  played as (
    select distinct ids.player_id
    from match_rows
    cross join lateral unnest(team_a || team_b) as ids(player_id)
  ),
  resting as (
    select distinct jsonb_array_elements_text(coalesce(v_round.resting, '[]'::jsonb))::uuid as player_id
  ),
  updated as (
    update public.session_player_state sps
    set
      consecutive_rest = sps.consecutive_rest + 1,
      consecutive_play = 0,
      opted_rest = false
    from resting
    where sps.session_id = p_session_id
      and sps.player_id = resting.player_id
      and sps.checked_out_at is null
      and not exists (
        select 1
        from played
        where played.player_id = sps.player_id
      )
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.player_id), '[]'::jsonb)
  into v_changed_resting_state
  from updated;
  v_t_resting_state_updated := clock_timestamp();

  v_changed_player_state := v_changed_player_state || v_changed_resting_state;

  with match_rows as (
    select
      array(select jsonb_array_elements_text(match.value -> 'team_a')::uuid) as team_a,
      array(select jsonb_array_elements_text(match.value -> 'team_b')::uuid) as team_b
    from jsonb_array_elements(coalesce(v_round.matches, '[]'::jsonb)) as match(value)
  ),
  pair_deltas as (
    select
      least(team_a[1], team_a[2]) as player_a,
      greatest(team_a[1], team_a[2]) as player_b,
      1::int as partner_count,
      0::int as opponent_count
    from match_rows
    where array_length(team_a, 1) = 2
    union all
    select
      least(team_b[1], team_b[2]) as player_a,
      greatest(team_b[1], team_b[2]) as player_b,
      1::int as partner_count,
      0::int as opponent_count
    from match_rows
    where array_length(team_b, 1) = 2
    union all
    select
      least(a.player_id, b.player_id) as player_a,
      greatest(a.player_id, b.player_id) as player_b,
      0::int as partner_count,
      1::int as opponent_count
    from match_rows
    cross join lateral unnest(team_a) as a(player_id)
    cross join lateral unnest(team_b) as b(player_id)
    where array_length(team_a, 1) = 2
      and array_length(team_b, 1) = 2
  ),
  grouped_pair_deltas as (
    select
      player_a,
      player_b,
      sum(partner_count)::int as partner_count,
      sum(opponent_count)::int as opponent_count
    from pair_deltas
    group by player_a, player_b
  ),
  upserted as (
    insert into public.session_pair_history (
      session_id,
      player_a,
      player_b,
      partner_count,
      opponent_count
    )
    select
      p_session_id,
      player_a,
      player_b,
      partner_count,
      opponent_count
    from grouped_pair_deltas
    on conflict (session_id, player_a, player_b) do update set
      partner_count = public.session_pair_history.partner_count + excluded.partner_count,
      opponent_count = public.session_pair_history.opponent_count + excluded.opponent_count
    returning public.session_pair_history.*
  )
  select coalesce(jsonb_agg(to_jsonb(upserted) order by upserted.player_a, upserted.player_b), '[]'::jsonb)
  into v_changed_pair_history
  from upserted;
  v_t_pair_history_upserted := clock_timestamp();

  update public.session_rounds
  set
    status = 'completed',
    ended_at = now()
  where id = v_round.id
  returning * into v_round;
  v_t_round_updated := clock_timestamp();

  update public.suggester_adjustments
  set fairness_score_after = p_score_after
  where session_id = p_session_id
    and round_no = p_round_no;
  v_t_adjustments_updated := clock_timestamp();

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
    'round_ended',
    'system',
    auth.uid(),
    coalesce(p_audit_payload, '{}'::jsonb) ||
      jsonb_build_object(
        'round_id', v_round.id,
        'experimental_versioned_rpc', true,
        'db_delta_commit', true
      )
  );
  v_t_audit_inserted := clock_timestamp();

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;
  v_t_version_bumped := clock_timestamp();

  v_result := jsonb_build_object(
    'round', to_jsonb(v_round),
    'live_state_version', v_next_version,
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );

  if v_include_timing then
    v_result := v_result || jsonb_build_object(
      'rpc_timing_ms',
      jsonb_build_object(
        'session_lock', round(extract(epoch from v_t_session_locked - v_t0) * 1000)::int,
        'round_lock', round(extract(epoch from v_t_round_locked - v_t_session_locked) * 1000)::int,
        'update_played_state', round(extract(epoch from v_t_played_state_updated - v_t_round_locked) * 1000)::int,
        'update_resting_state', round(extract(epoch from v_t_resting_state_updated - v_t_played_state_updated) * 1000)::int,
        'upsert_pair_history', round(extract(epoch from v_t_pair_history_upserted - v_t_resting_state_updated) * 1000)::int,
        'update_round', round(extract(epoch from v_t_round_updated - v_t_pair_history_upserted) * 1000)::int,
        'update_adjustments', round(extract(epoch from v_t_adjustments_updated - v_t_round_updated) * 1000)::int,
        'insert_audit', round(extract(epoch from v_t_audit_inserted - v_t_adjustments_updated) * 1000)::int,
        'bump_version', round(extract(epoch from v_t_version_bumped - v_t_audit_inserted) * 1000)::int,
        'total', round(extract(epoch from v_t_version_bumped - v_t0) * 1000)::int
      )
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.complete_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, int, jsonb) to authenticated;
