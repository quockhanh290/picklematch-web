-- End-to-end simulated session for P0-7, inside a rolled-back transaction.
--
-- Drives the REAL complete_live_session_match_versioned RPC over several rounds with two courts kept
-- deliberately out of step — the condition that broke the old bookkeeping gate, since a session-wide
-- round_no bucket never looks complete when courts finish at different times.
--
-- Clones an existing session's row and roster rather than inventing one, so every foreign key and
-- default matches production. Counters are zeroed on the clone so the numbers below are attributable.
--
-- Expected, if the fix works:
--   bench players accumulate rest_seat_misses (this was permanently 0 before)
--   a player who plays then sits has consecutive_play reset to 0 (this was the "stuck at 4" bug)
--   opted_rest set by a player survives other courts finishing

begin;

create temp table t_log(step text, detail text) on commit drop;

do $sim$
declare
  v_src uuid;
  v_host uuid;
  v_new uuid := gen_random_uuid();
  v_players uuid[];
  v_ver bigint;
  v_match uuid;
  v_seq int := 0;
  v_round int;
  v_court int;
begin
  -- A session with enough roster for two courts plus a bench.
  select sps.session_id, s.host_id
  into v_src, v_host
  from public.session_player_state sps
  join public.sessions s on s.id = sps.session_id
  where sps.checked_out_at is null
  group by sps.session_id, s.host_id
  having count(*) >= 12
  order by max(sps.session_id::text) desc
  limit 1;

  if v_src is null then
    insert into t_log values ('setup', 'no session with 12+ players; inconclusive');
    return;
  end if;

  -- Clone every column without naming them, so the copy cannot drift from the real schema.
  create temp table t_clone on commit drop as select * from public.sessions where id = v_src;
  update t_clone set id = v_new, live_state_version = 0;
  insert into public.sessions select * from t_clone;

  select array_agg(player_id order by player_id) into v_players
  from (select player_id from public.session_player_state
        where session_id = v_src and checked_out_at is null
        order by player_id limit 12) q;

  insert into public.session_player_state (session_id, player_id, matches_played, last_played_round,
                                           consecutive_play, consecutive_rest, rest_seat_misses, opted_rest)
  select v_new, unnest(v_players), 0, -1, 0, 0, 0, false;

  -- One player asks to sit out. It must still be set at the end.
  update public.session_player_state set opted_rest = true
  where session_id = v_new and player_id = v_players[12];

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host::text)::text, true);

  -- Four completions, courts intentionally out of step: court 0 finishes rounds 0,1,2 while court 1
  -- only finishes round 0. Under the old gate this session never looked "round complete".
  for v_round, v_court in
    select * from (values (0,0),(0,1),(1,0),(2,0)) as t(r, c)
  loop
    v_seq := v_seq + 1;
    insert into public.session_live_matches (session_id, sequence_no, status, round_no, court_idx, team_a, team_b, resting)
    values (
      v_new, v_seq, 'live', v_round, v_court,
      case when v_court = 0
        then jsonb_build_array(v_players[1]::text, v_players[2]::text)
        else jsonb_build_array(v_players[5]::text, v_players[6]::text) end,
      case when v_court = 0
        then jsonb_build_array(v_players[3]::text, v_players[4]::text)
        else jsonb_build_array(v_players[7]::text, v_players[8]::text) end,
      '[]'::jsonb
    )
    returning id into v_match;

    select live_state_version into v_ver from public.sessions where id = v_new;

    perform public.complete_live_session_match_versioned(
      v_new, v_ver, v_match, 11, 5, 11,
      jsonb_build_object('expected_round_matches', 2)
    );
  end loop;

  reset role;

  insert into t_log
  select 'counters',
         'played=' || count(*) filter (where matches_played > 0)
      || ' bench_with_misses=' || count(*) filter (where rest_seat_misses > 0)
      || ' max_misses=' || coalesce(max(rest_seat_misses), 0)
      || ' max_cp=' || coalesce(max(consecutive_play), 0)
      || ' opted_rest_kept=' || count(*) filter (where opted_rest)
  from public.session_player_state where session_id = v_new;

  -- Court 1's four played once (round 0) and sat through court 0's later rounds: their streak must be
  -- back to zero, which is exactly what the stuck-at-4 players on production are waiting for.
  insert into t_log
  select 'court1 players after sitting out',
         'cp=' || string_agg(distinct consecutive_play::text, ',')
      || ' misses=' || string_agg(distinct rest_seat_misses::text, ',')
  from public.session_player_state
  where session_id = v_new and player_id = any(v_players[5:8]);
end
$sim$;

select * from t_log;

rollback;
