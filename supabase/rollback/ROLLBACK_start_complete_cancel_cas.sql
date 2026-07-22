-- ============================================================================
-- EMERGENCY ROLLBACK for migrations:
--   20260721000001_relax_start_gate_session_version_cas.sql
--   20260722000001_relax_complete_gate_session_version_cas.sql
--   20260722000002_relax_cancel_gate_session_version_cas.sql
--   20260722000003_relax_start_from_payload_gate_session_version_cas.sql
--
-- Restores the ORIGINAL function bodies (with the coarse live_state_version CAS).
-- Paste the whole file into the Supabase SQL Editor and run to revert instantly.
-- Safe to run anytime: these are plain `create or replace function` — no data change.
-- ============================================================================

-- 1) start_live_session_match_versioned  (original from 20260703000007)
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
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
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

-- 2) complete_live_session_match_versioned  (original from 20260601000001)
create or replace function public.complete_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_score_after int,
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
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
  v_round_complete boolean := false;
  v_expected_round_matches int;
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
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
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
        consecutive_play = sps.consecutive_play + 1,
        consecutive_rest = 0,
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
    select coalesce(
      v_changed_player_state || jsonb_agg(to_jsonb(updated_resting) order by updated_resting.player_id),
      v_changed_player_state
    )
    into v_changed_player_state
    from updated_resting;
  end if;

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
      'expected_round_matches', v_expected_round_matches
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );
end;
$$;

-- 3) cancel_live_session_match_versioned  (original from 20260522000003)
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
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
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
  if v_match.status not in ('suggested', 'live') then
    raise exception 'Only suggested/live matches can be cancelled';
  end if;

  update public.session_live_matches
  set status = 'cancelled',
      ended_at = now()
  where id = p_match_id
  returning * into v_match;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_cancelled',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', '[]'::jsonb,
    'changed_pair_history', '[]'::jsonb
  );
end;
$$;

-- 4) start_live_session_match_from_payload_versioned  (original from 20260624000001)
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
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;
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

  v_round_no := floor(v_next_sequence::numeric / v_expected_round_matches)::int;

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
$$;

notify pgrst, 'reload schema';
