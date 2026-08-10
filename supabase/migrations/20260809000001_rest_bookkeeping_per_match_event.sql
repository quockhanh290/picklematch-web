-- P0-7 / BUG #15: rest/play streak bookkeeping must advance on each terminal
-- live-match event, not only when a session-wide round_no bucket appears complete.
--
-- Prod evidence (2026-08-09, read-only Management API):
--   select pg_get_functiondef(...) for complete/cancel both still contained the
--   global "where session_id = ... and round_no = v_match.round_no" completion gate.
--   Session f43a9338-6ed1-4600-9c63-69cd664cf02a had 6 courts with per-court
--   round spread 5; replaying terminal match events found 24/33 active players
--   with stale consecutive_play/consecutive_rest in session_player_state.

-- SQL records a fact it can state without ambiguity: how many times this player was passed over while
-- a match finished. It deliberately does NOT try to say "a round went by" — guessing that from a
-- session-wide round_no bucket is exactly what broke the old gate, because courts run out of step.
-- The engine converts misses into rounds at the one place that knows the court count (state.ts), so no
-- threshold downstream has to move and `consecutive_rest` keeps meaning rounds everywhere it is read.
alter table public.session_player_state
  add column if not exists rest_seat_misses int not null default 0;

comment on column public.session_player_state.rest_seat_misses is
  'Times this player was idle while some match finished, since they last played. Raw count, not rounds: divide by court count for the round-scale consecutive_rest the engine uses.';

create or replace function public.apply_live_match_rest_bookkeeping_event(
  p_session_id uuid,
  p_match_id uuid,
  p_played_player_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed_player_state jsonb := '[]'::jsonb;
  v_rested_player_count int := 0;
  v_busy_player_count int := 0;
begin
  with busy_players as (
    select distinct jsonb_array_elements_text(team_a)::uuid as player_id
    from public.session_live_matches
    where session_id = p_session_id
      and id <> p_match_id
      and status in ('suggested', 'live')
    union
    select distinct jsonb_array_elements_text(team_b)::uuid
    from public.session_live_matches
    where session_id = p_session_id
      and id <> p_match_id
      and status in ('suggested', 'live')
  )
  select count(*)
  into v_busy_player_count
  from busy_players;

  with played_players as (
    select unnest(coalesce(p_played_player_ids, '{}'::uuid[])) as player_id
  ),
  busy_players as (
    select distinct jsonb_array_elements_text(team_a)::uuid as player_id
    from public.session_live_matches
    where session_id = p_session_id
      and id <> p_match_id
      and status in ('suggested', 'live')
    union
    select distinct jsonb_array_elements_text(team_b)::uuid
    from public.session_live_matches
    where session_id = p_session_id
      and id <> p_match_id
      and status in ('suggested', 'live')
  ),
  updated_resting as (
    update public.session_player_state sps
    -- opted_rest is deliberately NOT cleared here. A player who asked to sit out has not changed their
    -- mind because someone else's match ended; the flag is cleared where they actually play again (the
    -- played block below already does it) or when the host clears it. Clearing it here would make
    -- "Xin nghỉ" stop sticking, since some court finishes every couple of minutes.
    set rest_seat_misses = sps.rest_seat_misses + 1,
        consecutive_play = 0
    where sps.session_id = p_session_id
      and sps.checked_out_at is null
      and not exists (
        select 1 from played_players pp where pp.player_id = sps.player_id
      )
      and not exists (
        select 1 from busy_players bp where bp.player_id = sps.player_id
      )
    returning sps.*
  )
  select
    coalesce(jsonb_agg(to_jsonb(updated_resting) order by updated_resting.player_id), '[]'::jsonb),
    count(*)::int
  into v_changed_player_state, v_rested_player_count
  from updated_resting;

  return jsonb_build_object(
    'changed_player_state', v_changed_player_state,
    'rested_player_count', v_rested_player_count,
    'busy_player_count', v_busy_player_count
  );
end;
$$;

revoke all on function public.apply_live_match_rest_bookkeeping_event(uuid, uuid, uuid[]) from public, anon, authenticated;

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
$$;

revoke all on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb) to authenticated;

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
    raise exception 'Only the host can cancel live match';
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
    -- Legacy telemetry only. Rest bookkeeping below no longer waits for this gate.
    select
      count(*) filter (where status in ('completed', 'cancelled')) >= v_expected_round_matches
      and count(*) filter (where status not in ('completed', 'cancelled')) = 0
    into v_round_complete
    from public.session_live_matches
    where session_id = p_session_id
      and round_no = v_match.round_no;
  end if;

  select public.apply_live_match_rest_bookkeeping_event(
    p_session_id,
    p_match_id,
    '{}'::uuid[]
  )
  into v_rest_event;

  v_changed_player_state := coalesce(v_rest_event -> 'changed_player_state', '[]'::jsonb);

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_cancelled',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'match', to_jsonb(v_match),
      'round_complete', v_round_complete,
      'rest_bookkeeping_mode', 'per_match_event',
      'rested_player_count', coalesce((v_rest_event ->> 'rested_player_count')::int, 0),
      'busy_player_count', coalesce((v_rest_event ->> 'busy_player_count')::int, 0)
    )
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

-- Backfill statement for already-corrupted counters.
-- Intentionally NOT executed by this migration file. Run manually after the function
-- deploy is verified, preferably in bounded batches by session_id.
--
-- do $backfill$
-- declare
--   v_session_id uuid;
--   v_match public.session_live_matches;
-- begin
--   create temp table if not exists tmp_live_rest_backfill (
--     session_id uuid not null,
--     player_id uuid not null,
--     matches_played int not null default 0,
--     last_played_round int,
--     consecutive_play int not null default 0,
--     consecutive_rest int not null default 0,
--     rest_seat_misses int not null default 0,
--     opted_rest boolean not null default false,
--     primary key (session_id, player_id)
--   ) on commit drop;
--
--   for v_session_id in
--     select distinct session_id from public.session_live_matches
--   loop
--     delete from tmp_live_rest_backfill where session_id = v_session_id;
--
--     insert into tmp_live_rest_backfill(session_id, player_id)
--     select session_id, player_id
--     from public.session_player_state
--     where session_id = v_session_id;
--
--     for v_match in
--       select *
--       from public.session_live_matches
--       where session_id = v_session_id
--         and status in ('completed', 'cancelled')
--         and ended_at is not null
--       order by ended_at, sequence_no nulls last, created_at
--     loop
--       if v_match.status = 'completed' then
--         with played as (
--           select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
--           union
--           select jsonb_array_elements_text(v_match.team_b)::uuid
--         )
--         update tmp_live_rest_backfill b
--         set matches_played = b.matches_played + 1,
--             last_played_round = v_match.round_no,
--             consecutive_play = b.consecutive_play + 1,
--             consecutive_rest = 0,
--             rest_seat_misses = 0,
--             opted_rest = false
--         from played
--         where b.session_id = v_session_id
--           and b.player_id = played.player_id;
--       end if;
--
--       with played as (
--         select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
--         where v_match.status = 'completed'
--         union
--         select jsonb_array_elements_text(v_match.team_b)::uuid
--         where v_match.status = 'completed'
--       ),
--       busy as (
--         select distinct jsonb_array_elements_text(slm.team_a)::uuid as player_id
--         from public.session_live_matches slm
--         where slm.session_id = v_session_id
--           and slm.id <> v_match.id
--           and slm.created_at <= v_match.ended_at
--           and (
--             slm.status in ('suggested', 'live')
--             or (
--               slm.status in ('completed', 'cancelled')
--               and slm.ended_at is not null
--               and slm.ended_at > v_match.ended_at
--             )
--           )
--         union
--         select distinct jsonb_array_elements_text(slm.team_b)::uuid
--         from public.session_live_matches slm
--         where slm.session_id = v_session_id
--           and slm.id <> v_match.id
--           and slm.created_at <= v_match.ended_at
--           and (
--             slm.status in ('suggested', 'live')
--             or (
--               slm.status in ('completed', 'cancelled')
--               and slm.ended_at is not null
--               and slm.ended_at > v_match.ended_at
--             )
--           )
--       )
--       update tmp_live_rest_backfill b
--       -- Mirrors the runtime helper: count seat misses, and leave opted_rest alone.
--       set rest_seat_misses = b.rest_seat_misses + 1,
--           consecutive_play = 0
--       where b.session_id = v_session_id
--         and not exists (select 1 from played p where p.player_id = b.player_id)
--         and not exists (select 1 from busy bp where bp.player_id = b.player_id);
--     end loop;
--
--     update public.session_player_state sps
--     set matches_played = b.matches_played,
--         last_played_round = b.last_played_round,
--         consecutive_play = b.consecutive_play,
--         consecutive_rest = b.consecutive_rest,
--         rest_seat_misses = b.rest_seat_misses,
--         opted_rest = b.opted_rest
--     from tmp_live_rest_backfill b
--     where sps.session_id = b.session_id
--       and sps.player_id = b.player_id
--       and sps.session_id = v_session_id;
--   end loop;
-- end
-- $backfill$;
