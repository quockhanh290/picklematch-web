-- Experimental versioned Start/End Round RPCs for benchmarking.
-- These RPCs are isolated and do not replace the production live-session RPCs.

create or replace function public.get_live_session_version_guard(
  p_session_id uuid
)
returns table (
  live_state_version bigint,
  current_round int,
  active_round_no int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
begin
  select host_id
  into v_host_id
  from public.sessions
  where id = p_session_id;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;

  if v_host_id <> auth.uid() then
    raise exception 'Only the host can read live session version';
  end if;

  return query
  select
    s.live_state_version,
    coalesce((select max(sr.round_no) + 1 from public.session_rounds sr where sr.session_id = p_session_id), 0)::int as current_round,
    (
      select sr.round_no
      from public.session_rounds sr
      where sr.session_id = p_session_id
        and sr.status = 'active'
      order by sr.round_no desc
      limit 1
    )::int as active_round_no
  from public.sessions s
  where s.id = p_session_id;
end;
$$;

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
  v_session public.sessions;
  v_round public.session_rounds;
  v_next_version bigint;
  v_played_count int;
  v_available_count int;
begin
  select *
  into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'Session not found';
  end if;

  if v_session.host_id <> auth.uid() then
    raise exception 'Only the host can start round';
  end if;

  if v_session.live_state_version <> p_expected_live_state_version then
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

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  return jsonb_build_object(
    'round', to_jsonb(v_round),
    'live_state_version', v_next_version
  );
end;
$$;

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
  v_session public.sessions;
  v_round public.session_rounds;
  v_next_version bigint;
begin
  select *
  into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'Session not found';
  end if;

  if v_session.host_id <> auth.uid() then
    raise exception 'Only the host can complete round';
  end if;

  if v_session.live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  insert into public.session_player_state (
    session_id,
    player_id,
    matches_played,
    last_played_round,
    consecutive_rest,
    consecutive_play,
    opted_rest
  )
  select
    p_session_id,
    payload.player_id,
    payload.matches_played,
    payload.last_played_round,
    payload.consecutive_rest,
    payload.consecutive_play,
    payload.opted_rest
  from jsonb_to_recordset(coalesce(p_player_state, '[]'::jsonb)) as payload(
    player_id uuid,
    matches_played int,
    last_played_round int,
    consecutive_rest int,
    consecutive_play int,
    opted_rest boolean
  )
  on conflict (session_id, player_id) do update set
    matches_played = excluded.matches_played,
    last_played_round = excluded.last_played_round,
    consecutive_rest = excluded.consecutive_rest,
    consecutive_play = excluded.consecutive_play,
    opted_rest = excluded.opted_rest;

  insert into public.session_pair_history (
    session_id,
    player_a,
    player_b,
    partner_count,
    opponent_count
  )
  select
    p_session_id,
    payload.player_a,
    payload.player_b,
    payload.partner_count,
    payload.opponent_count
  from jsonb_to_recordset(coalesce(p_pair_history, '[]'::jsonb)) as payload(
    player_a uuid,
    player_b uuid,
    partner_count int,
    opponent_count int
  )
  on conflict (session_id, player_a, player_b) do update set
    partner_count = excluded.partner_count,
    opponent_count = excluded.opponent_count;

  update public.session_rounds
  set
    status = 'completed',
    ended_at = now()
  where session_id = p_session_id
    and round_no = p_round_no
    and status = 'active'
  returning * into v_round;

  if v_round.id is null then
    raise exception 'Active round not found';
  end if;

  update public.suggester_adjustments
  set fairness_score_after = p_score_after
  where session_id = p_session_id
    and round_no = p_round_no;

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
      jsonb_build_object('round_id', v_round.id, 'experimental_versioned_rpc', true)
  );

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  return jsonb_build_object(
    'round', to_jsonb(v_round),
    'live_state_version', v_next_version
  );
end;
$$;

revoke all on function public.get_live_session_version_guard(uuid) from public, anon, authenticated;
revoke all on function public.start_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.complete_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, int, jsonb) from public, anon, authenticated;

grant execute on function public.get_live_session_version_guard(uuid) to authenticated;
grant execute on function public.start_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.complete_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, int, jsonb) to authenticated;
