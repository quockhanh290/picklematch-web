-- BUG #14 / P1-11: last_played_round records the round number of ONE court, and courts drift apart.
-- Court 3 can be on round 2 while court 1 is on round 8, so a player who just walked off court 3 carries
-- 2 and someone idle since early carries 8. select.ts orders by it ascending, meaning "waited longest
-- first", which inverts the priority exactly when the board is most uneven.
--
-- sequence_no is session-wide: unique within every session (139 of 139 sampled) and 0.886 correlated
-- with wall-clock time. A new column carries it rather than redefining last_played_round, so nothing
-- reading the old field silently changes meaning — the same shape used for rest_seat_misses.

alter table public.session_player_state
  add column if not exists last_played_seq bigint;

comment on column public.session_player_state.last_played_seq is
  'Session-wide sequence_no of this player''s last match. Comparable across courts, unlike last_played_round which counts rounds within one court.';


-- Same function as production, one assignment added: record the session-wide sequence alongside
-- the per-court round, so the engine can order by something comparable across courts.
CREATE OR REPLACE FUNCTION public.complete_live_session_match_versioned(p_session_id uuid, p_expected_live_state_version bigint, p_match_id uuid, p_score_a integer, p_score_b integer, p_score_after integer, p_audit_payload jsonb DEFAULT '{}'::jsonb)
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
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
  v_round_complete boolean := false;
  v_expected_round_matches int;
  v_rest_event jsonb := '{}'::jsonb;
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
    raise exception 'Only the host can complete live match';
  end if;

  select *
  into v_match
  from public.session_live_matches
  where id = p_match_id
    and session_id = p_session_id
  for update;

  if v_match.id is null then
    raise exception 'Live match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'Only live matches can be completed';
  end if;

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
    raise exception 'Missing expected round match count';
  end if;

  update public.session_live_matches
  set status = 'completed',
      score_a = greatest(0, p_score_a),
      score_b = greatest(0, p_score_b),
      ended_at = now()
  where id = p_match_id
  returning * into v_match;

  with played as (
    select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
    union
    select jsonb_array_elements_text(v_match.team_b)::uuid as player_id
  ),
  updated_played as (
    update public.session_player_state sps
    set matches_played = sps.matches_played + 1,
        last_played_round = v_match.round_no,
        last_played_seq = v_match.sequence_no,
        consecutive_play = sps.consecutive_play + 1,
        consecutive_rest = 0,
        rest_seat_misses = 0,
        opted_rest = false
    from played
    where sps.session_id = p_session_id
      and sps.player_id = played.player_id
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated_played) order by updated_played.player_id), '[]'::jsonb)
  into v_changed_player_state
  from updated_played;

  with match_teams as (
    select
      array(select jsonb_array_elements_text(v_match.team_a)::uuid) as team_a,
      array(select jsonb_array_elements_text(v_match.team_b)::uuid) as team_b
  ),
  partner_pairs as (
    select least(team_a[1], team_a[2]) as player_a, greatest(team_a[1], team_a[2]) as player_b
    from match_teams
    union
    select least(team_b[1], team_b[2]) as player_a, greatest(team_b[1], team_b[2]) as player_b
    from match_teams
  ),
  opponent_pairs as (
    select least(a.player_id, b.player_id) as player_a, greatest(a.player_id, b.player_id) as player_b
    from match_teams
    cross join lateral unnest(team_a) as a(player_id)
    cross join lateral unnest(team_b) as b(player_id)
  ),
  pair_deltas as (
    select player_a, player_b, count(*)::int as partner_delta, 0::int as opponent_delta
    from partner_pairs
    group by player_a, player_b
    union all
    select player_a, player_b, 0::int as partner_delta, count(*)::int as opponent_delta
    from opponent_pairs
    group by player_a, player_b
  ),
  merged_deltas as (
    select player_a, player_b, sum(partner_delta)::int as partner_delta, sum(opponent_delta)::int as opponent_delta
    from pair_deltas
    group by player_a, player_b
  ),
  upserted as (
    insert into public.session_pair_history(session_id, player_a, player_b, partner_count, opponent_count)
    select p_session_id, player_a, player_b, partner_delta, opponent_delta
    from merged_deltas
    on conflict (session_id, player_a, player_b)
    do update set
      partner_count = public.session_pair_history.partner_count + excluded.partner_count,
      opponent_count = public.session_pair_history.opponent_count + excluded.opponent_count
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(upserted) order by upserted.player_a, upserted.player_b), '[]'::jsonb)
  into v_changed_pair_history
  from upserted;

  -- Legacy telemetry only. Rest bookkeeping below no longer waits for this gate.
  select
    count(*) filter (where status in ('completed', 'cancelled')) >= v_expected_round_matches
    and count(*) filter (where status not in ('completed', 'cancelled')) = 0
  into v_round_complete
  from public.session_live_matches
  where session_id = p_session_id
    and round_no = v_match.round_no;

  select public.apply_live_match_rest_bookkeeping_event(
    p_session_id,
    p_match_id,
    array(
      select jsonb_array_elements_text(v_match.team_a)::uuid
      union
      select jsonb_array_elements_text(v_match.team_b)::uuid
    )
  )
  into v_rest_event;

  v_changed_player_state :=
    v_changed_player_state || coalesce(v_rest_event -> 'changed_player_state', '[]'::jsonb);

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.round_no,
    'live_match_completed',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'match', to_jsonb(v_match),
      'score_after', p_score_after,
      'round_complete', v_round_complete,
      'expected_round_matches', v_expected_round_matches,
      'rest_bookkeeping_mode', 'per_match_event',
      'rested_player_count', coalesce((v_rest_event ->> 'rested_player_count')::int, 0),
      'busy_player_count', coalesce((v_rest_event ->> 'busy_player_count')::int, 0)
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );
end;
$function$
;
