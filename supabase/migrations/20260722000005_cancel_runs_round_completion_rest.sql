-- Fix: cancelling the LAST non-terminal match of a round skipped the round-completion
-- rest bookkeeping, leaving resters' consecutive_rest / consecutive_play / opted_rest stale.
--
-- Root cause: round-completion detection + the rester update lived ONLY in
-- complete_live_session_match_versioned. If a round's final live/suggested match is CANCELLED
-- (dead court, players left) instead of completed, the round becomes fully terminal but no
-- rest bookkeeping ran, so subsequent suggestions read a stale rest state (a player who
-- should be MUST_PLAY after resting is under-prioritized; opted_rest never clears).
--
-- Fix: after cancelling, run the same round-completion rest bookkeeping the complete RPC does
-- (a no-op unless this cancel made the round's board fully terminal). expected_round_matches
-- is resolved from the audit payload, else the session court override, else the number of
-- distinct courts in that round; if it cannot be determined the bookkeeping is safely skipped.
-- Players in the cancelled match did not play, so they are correctly treated as resters.

create or replace function public.cancel_live_session_match_versioned(
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
  v_expected_round_matches int;
  v_round_complete boolean := false;
  v_changed_player_state jsonb := '[]'::jsonb;
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
    raise exception 'Only the host can cancel live match';
  end if;
  -- Intentionally no `v_live_state_version <> p_expected_live_state_version` CAS.
  -- The `status in ('suggested','live')` check below (under the row lock) is the guard.

  select *
  into v_match
  from public.session_live_matches
  where id = p_match_id
    and session_id = p_session_id
  for update;

  if v_match.id is null then
    raise exception 'Live match not found';
  end if;
  if v_match.status not in ('suggested', 'live') then
    raise exception 'Only suggested/live matches can be cancelled';
  end if;

  update public.session_live_matches
  set status = 'cancelled',
      ended_at = now()
  where id = p_match_id
  returning * into v_match;

  -- Round-completion rest bookkeeping (parity with complete_live_session_match_versioned).
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
    select nullif(count(distinct court_idx), 0)
    into v_expected_round_matches
    from public.session_live_matches
    where session_id = p_session_id
      and round_no = v_match.round_no
      and court_idx is not null;
  end if;

  if v_expected_round_matches is not null and v_expected_round_matches >= 1 then
    select
      count(*) filter (where status in ('completed', 'cancelled')) >= v_expected_round_matches
      and count(*) filter (where status not in ('completed', 'cancelled')) = 0
    into v_round_complete
    from public.session_live_matches
    where session_id = p_session_id
      and round_no = v_match.round_no;

    if v_round_complete then
      with round_played as (
        select distinct jsonb_array_elements_text(team_a)::uuid as player_id
        from public.session_live_matches
        where session_id = p_session_id
          and round_no = v_match.round_no
          and status = 'completed'
        union
        select distinct jsonb_array_elements_text(team_b)::uuid
        from public.session_live_matches
        where session_id = p_session_id
          and round_no = v_match.round_no
          and status = 'completed'
      ),
      updated_resting as (
        update public.session_player_state sps
        set consecutive_rest = sps.consecutive_rest + 1,
            consecutive_play = 0,
            opted_rest = false
        where sps.session_id = p_session_id
          and sps.checked_out_at is null
          and sps.player_id not in (select player_id from round_played)
        returning sps.*
      )
      select coalesce(jsonb_agg(to_jsonb(updated_resting) order by updated_resting.player_id), '[]'::jsonb)
      into v_changed_player_state
      from updated_resting;
    end if;
  end if;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_cancelled',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match), 'round_complete', v_round_complete)
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', '[]'::jsonb
  );
end;
$$;

revoke all on function public.cancel_live_session_match_versioned(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cancel_live_session_match_versioned(uuid, bigint, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
