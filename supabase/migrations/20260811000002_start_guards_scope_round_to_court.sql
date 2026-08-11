-- BUG #6: both start paths reject a player because of a round number belonging to a different court.
--
-- round_no counts cycles on ONE court and courts drift, so "round 2" on court 5 and "round 2" on court 7
-- are different moments. Both guards compare the number alone:
--   start_live_session_match_versioned          live.round_no = v_match.round_no
--   start_..._from_payload_versioned            slm.round_no  = v_round_no        (v_round_no is already
--                                                                                 derived per court)
-- A player who finished round 2 on court 7 is therefore refused a seat on court 5's round 2, with
-- "already played in this round" — while being free.
--
-- The guard is NOT dropped here, unlike the persist-side fix in 20260811000001. These rows become 'live'
-- and the case it catches is real: a suggestion persisted for a court, another match on that same court
-- completes, and starting the now-stale suggestion would seat someone twice in one cycle. That case is
-- covered by tests/host/live-match-start-gate.test.ts:217. Scoping the comparison to the court keeps it
-- and drops only the cross-court half.
--
-- 'is not distinct from' rather than '=': court_idx is nullable, and a null on either side must compare,
-- not vanish into null.
--
-- Both bodies are the definitions read back from production, with only the guard lines changed.

CREATE OR REPLACE FUNCTION public.start_live_session_match_versioned(p_session_id uuid, p_expected_live_state_version bigint, p_match_id uuid, p_audit_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_match public.session_live_matches;
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
  -- Intentionally no `v_live_state_version <> p_expected_live_state_version` CAS.
  -- The specific conflict checks below guarantee correctness under the row lock.

  select *
  into v_match
  from public.session_live_matches
  where id = p_match_id
    and session_id = p_session_id
  for update;

  if v_match.id is null then
    raise exception 'Live match not found';
  end if;
  if v_match.status <> 'suggested' then
    raise exception 'Only suggested matches can be started';
  end if;

  if exists (
    with players as (
      select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
      union all
      select jsonb_array_elements_text(v_match.team_b)::uuid as player_id
    )
    select 1
    from players p
    left join public.session_player_state sps
      on sps.session_id = p_session_id and sps.player_id = p.player_id
    where sps.player_id is null
      or sps.checked_out_at is not null
      or sps.opted_rest
  ) then
    raise exception 'Live match must use available checked-in players';
  end if;

  if exists (
    with players as (
      select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
      union all
      select jsonb_array_elements_text(v_match.team_b)::uuid as player_id
    )
    select 1
    from players p
    join public.session_live_matches live
      on live.session_id = p_session_id
     and live.id <> p_match_id
     and (live.team_a ? p.player_id::text or live.team_b ? p.player_id::text)
    where live.status = 'live'
       or (
         live.round_no = v_match.round_no
         and live.court_idx is not distinct from v_match.court_idx
         and live.status not in ('cancelled', 'suggested')
       )
  ) then
    raise exception 'A player is already in a live match or already played in this round';
  end if;

  if v_match.court_idx is not null and exists (
    select 1
    from public.session_live_matches live
    where live.session_id = p_session_id
      and live.id <> p_match_id
      and live.status = 'live'
      and live.court_idx = v_match.court_idx
  ) then
    raise exception 'Court already has a live match';
  end if;

  update public.session_live_matches
  set status = 'live',
      started_at = coalesce(started_at, now())
  where id = p_match_id
  returning * into v_match;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.round_no,
    'live_match_started',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_live_session_match_from_payload_versioned(p_session_id uuid, p_expected_live_state_version bigint, p_match jsonb, p_audit_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_preview_live_state_version bigint;
  v_preview_countable_match_count int;
  v_current_countable_match_count int;
  v_match public.session_live_matches;
  v_next_sequence int;
  v_round_no int;
  v_client_round_no int;
  v_expected_round_matches int;
  v_next_version bigint;
  v_court_idx int;
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
  -- Intentionally no `v_live_state_version <> p_expected_live_state_version` CAS.
  -- The lenient preview-stale block and the specific checks below are the real guards.
  if p_match is null or jsonb_typeof(p_match) <> 'object' then
    raise exception 'Match payload is required';
  end if;

  if coalesce(p_match ->> 'round_no', '') ~ '^-?[0-9]+$' then
    v_client_round_no := nullif((p_match ->> 'round_no')::int, -1);
  end if;

  if coalesce(p_match ->> 'court_idx', '') !~ '^-?[0-9]+$' then
    raise exception 'Court is required';
  end if;
  v_court_idx := nullif((p_match ->> 'court_idx')::int, -1);

  if coalesce(p_audit_payload ->> 'expected_round_matches', '') ~ '^[0-9]+$' then
    v_expected_round_matches := greatest(1, (p_audit_payload ->> 'expected_round_matches')::int);
  end if;

  if v_expected_round_matches is null then
    select court_count_override
    into v_expected_round_matches
    from public.session_next_round_settings
    where session_id = p_session_id
      and court_count_override is not null
      and court_count_override >= 1;
  end if;

  if v_expected_round_matches is null then
    select greatest(1, coalesce(max(court_idx) + 1, 1))
    into v_expected_round_matches
    from public.session_live_matches
    where session_id = p_session_id
      and status <> 'cancelled'
      and court_idx is not null;
  end if;

  if coalesce(p_audit_payload ->> 'source', '') = 'client-preview-start-live-match' then
    if coalesce(p_audit_payload ->> 'preview_live_state_version', '') !~ '^[0-9]+$' then
      raise exception 'Preview is stale';
    end if;

    v_preview_live_state_version := (p_audit_payload ->> 'preview_live_state_version')::bigint;

    if v_preview_live_state_version <> v_live_state_version then
      if coalesce(p_audit_payload ->> 'preview_countable_match_count', '') !~ '^[0-9]+$' then
        raise exception 'Preview is stale';
      end if;

      v_preview_countable_match_count := (p_audit_payload ->> 'preview_countable_match_count')::int;

      select count(*)::int
      into v_current_countable_match_count
      from public.session_live_matches
      where session_id = p_session_id
        and status not in ('cancelled', 'suggested');

      if v_live_state_version < v_preview_live_state_version
        or v_current_countable_match_count < v_preview_countable_match_count
      then
        raise exception 'Preview is stale';
      end if;
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

  if v_court_idx is not null and exists (
    select 1
    from public.session_live_matches
    where session_id = p_session_id
      and status = 'live'
      and court_idx = v_court_idx
  ) then
    raise exception 'Court already has a live match';
  end if;

  select coalesce(max(sequence_no) + 1, 0)
  into v_next_sequence
  from public.session_live_matches
  where session_id = p_session_id;

  -- Round for the new match = the round THIS court is up to (one past its own last
  -- completed match). Per-court progression is straggler-safe and immune to cancelled-row
  -- sequence inflation, and matches replace_live_session_suggestions_versioned's scheme.
  select max(round_no)
  into v_round_no
  from public.session_live_matches
  where session_id = p_session_id
    and status = 'completed'
    and court_idx = v_court_idx;

  if v_round_no is null then
    select coalesce(max(round_no) + 1, 0)
    into v_round_no
    from public.session_live_matches
    where session_id = p_session_id
      and status = 'completed';
  else
    v_round_no := v_round_no + 1;
  end if;

  -- Prevent a player from playing twice in the same round.
  -- This catches re-suggested lineups where already-completed players were re-picked
  -- because their first match in the round was no longer 'live'.
  -- (Preserved from 20260625000001 — must NOT be dropped when removing the CAS.)
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
     and slm.round_no = v_round_no
     and slm.court_idx is not distinct from v_court_idx
     and slm.status not in ('cancelled', 'suggested')
     and (slm.team_a ? mp.player_id::text or slm.team_b ? mp.player_id::text)
  ) then
    raise exception 'A player already played in this round';
  end if;

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
    v_court_idx,
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
    coalesce(p_audit_payload, '{}'::jsonb)
      || jsonb_build_object(
        'client_round_no', v_client_round_no,
        'server_round_no', v_round_no,
        'server_sequence_no', v_next_sequence,
        'expected_round_matches', v_expected_round_matches,
        'safe_preview_sibling_start', v_preview_live_state_version is not null and v_preview_live_state_version <> v_live_state_version,
        'match', to_jsonb(v_match)
      )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match)
  );
end;
$function$
;
