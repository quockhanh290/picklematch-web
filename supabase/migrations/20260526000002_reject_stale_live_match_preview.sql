-- Reject live-match starts when the suggested preview was built from an older
-- live_state_version than the session currently has.

create or replace function public.start_live_session_match_from_payload_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match jsonb,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_preview_live_state_version bigint;
  v_match public.session_live_matches;
  v_next_sequence int;
  v_round_no int;
  v_next_version bigint;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can start live match';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;
  if p_match is null or jsonb_typeof(p_match) <> 'object' then
    raise exception 'Match payload is required';
  end if;

  if coalesce(p_audit_payload ->> 'source', '') = 'client-preview-start-live-match' then
    if coalesce(p_audit_payload ->> 'preview_live_state_version', '') !~ '^[0-9]+$' then
      raise exception 'Preview version missing';
    end if;

    v_preview_live_state_version := (p_audit_payload ->> 'preview_live_state_version')::bigint;
    if v_preview_live_state_version <> v_live_state_version then
      raise exception 'Preview is stale';
    end if;
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(p_match -> 'team_a')::uuid as player_id
      union all
      select jsonb_array_elements_text(p_match -> 'team_b')::uuid as player_id
    )
    select 1
    from match_players mp
    left join public.session_player_state sps
      on sps.session_id = p_session_id and sps.player_id = mp.player_id
    where sps.player_id is null
      or sps.checked_out_at is not null
      or sps.opted_rest
  ) then
    raise exception 'Live match must use available checked-in players';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(p_match -> 'team_a')::uuid as player_id
      union all
      select jsonb_array_elements_text(p_match -> 'team_b')::uuid as player_id
    )
    select 1
    from match_players mp
    join public.session_live_matches slm
      on slm.session_id = p_session_id
     and slm.status = 'live'
     and (slm.team_a ? mp.player_id::text or slm.team_b ? mp.player_id::text)
  ) then
    raise exception 'A player is already in a live match';
  end if;

  select coalesce(max(sequence_no) + 1, 0)
  into v_next_sequence
  from public.session_live_matches
  where session_id = p_session_id;

  v_round_no := coalesce(
    nullif((p_match ->> 'round_no')::int, -1),
    (
      select max(round_no)
      from public.session_live_matches
      where session_id = p_session_id
        and status in ('suggested', 'live')
    ),
    coalesce(
      (select max(round_no) + 1 from public.session_live_matches where session_id = p_session_id),
      0
    )
  );

  insert into public.session_live_matches (
    session_id,
    sequence_no,
    round_no,
    court_idx,
    status,
    team_a,
    team_b,
    resting,
    started_at
  )
  values (
    p_session_id,
    v_next_sequence,
    v_round_no,
    nullif((p_match ->> 'court_idx')::int, -1),
    'live',
    p_match -> 'team_a',
    p_match -> 'team_b',
    coalesce(p_match -> 'resting', '[]'::jsonb),
    now()
  )
  returning * into v_match;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.round_no,
    'live_match_started_from_payload',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match)
  );
end;
$$;

revoke all on function public.start_live_session_match_from_payload_versioned(uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.start_live_session_match_from_payload_versioned(uuid, bigint, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
