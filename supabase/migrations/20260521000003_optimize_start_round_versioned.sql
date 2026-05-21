-- Reduce hot-path overhead for versioned round start.
-- The signature stays unchanged for existing Edge/client callers.

create unique index if not exists idx_session_rounds_one_active
on public.session_rounds(session_id)
where status = 'active';

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
begin
  select id, host_id, live_state_version
  into v_session_id, v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

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

grant execute on function public.start_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, jsonb) to authenticated;
