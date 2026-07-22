-- Fix false-positive "Session changed" when starting a suggested live match.
--
-- Root cause: start_live_session_match_versioned rejected the start whenever the
-- session's live_state_version differed from the version the client last saw.
-- That version is bumped by EVERY session mutation — including a preview re-persist
-- on an unrelated court (replace_live_session_suggestions_versioned). In a rolling
-- multi-court session the version churns constantly, so a host's in-flight start is
-- almost always "stale" by the time it lands → 'Session changed' → forced refresh.
--
-- The coarse whole-session CAS adds no safety: the specific checks below —
-- status='suggested', players available/checked-in, no player already in a live
-- match or already played this round, court free — run under the `for update` row
-- lock on the session and fully serialize concurrent starts. A genuine conflict is
-- still rejected with an accurate, specific error; only the false positives go away.
--
-- Fix: drop the `live_state_version <> p_expected_live_state_version` rejection.
-- The p_expected_live_state_version parameter is kept for signature compatibility
-- (clients still pass it) but no longer gates the start.
--
-- Contract mirrored by tests/host/startGateModel.ts (Jest) and
-- supabase/tests/live_match_start_gate_test.sql (pgTAP).

create or replace function public.start_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
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
$$;

revoke all on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
