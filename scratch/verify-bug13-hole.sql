-- BUG #13: a round with some courts finished and some still playing disappears from the snapshot
-- entirely, taking its completed matches with it.
--
-- closable_rounds requires bool_and(status = 'completed') across the whole round. round_agg and
-- round_players already filter to completed rows on their own, so that gate decides only whether the
-- round appears at all — and a round in progress is the normal state of a live board.
--
-- state.rounds is what the engine reads for recency, so a hole there means it forgets those matches
-- happened and is free to suggest the same pairing again.
--
-- Builds its own session, rolls everything back.

begin;

create temp table t_out(check_name text, result text) on commit drop;

do $verify$
declare
  v_src uuid;
  v_new uuid := gen_random_uuid();
  v_players uuid[];
  v_snapshot jsonb;
  v_rounds jsonb;
begin
  select sps.session_id into v_src
  from public.session_player_state sps
  where sps.checked_out_at is null
  group by sps.session_id having count(*) >= 8
  limit 1;

  if v_src is null then
    insert into t_out values ('setup', 'no session with 8 players'); return;
  end if;

  create temp table t_clone on commit drop as select * from public.sessions where id = v_src;
  update t_clone set id = v_new, live_state_version = 0;
  insert into public.sessions select * from t_clone;

  select array_agg(player_id order by player_id) into v_players
  from (select player_id from public.session_player_state
        where session_id = v_src and checked_out_at is null order by player_id limit 8) q;

  insert into public.session_player_state (session_id, player_id, matches_played, last_played_round,
                                           consecutive_play, consecutive_rest, opted_rest)
  select v_new, unnest(v_players), 0, -1, 0, 0, false;

  -- Round 0: court 0 finished, court 1 still playing. The ordinary shape of a live board.
  insert into public.session_live_matches (session_id, sequence_no, status, round_no, court_idx, team_a, team_b, resting)
  values
    (v_new, 1, 'completed', 0, 0,
     jsonb_build_array(v_players[1]::text, v_players[2]::text),
     jsonb_build_array(v_players[3]::text, v_players[4]::text), '[]'::jsonb),
    (v_new, 2, 'live', 0, 1,
     jsonb_build_array(v_players[5]::text, v_players[6]::text),
     jsonb_build_array(v_players[7]::text, v_players[8]::text), '[]'::jsonb);

  select public.get_live_session_snapshot_versioned(v_new) into v_snapshot;
  v_rounds := coalesce(v_snapshot -> 'round_rows', '[]'::jsonb);

  insert into t_out values (
    'completed match of a partially finished round is visible',
    case when jsonb_array_length(v_rounds) > 0
      then 'PASS'
      else 'FAIL: round_rows empty — the finished match on court 0 is invisible to the engine' end
  );

  -- The half that makes the first change safe: players still on court 1 must not be reported as resting
  -- during that round. Without widening round_players they would be, because their match has not
  -- finished and the resting list is "checked in and not playing".
  insert into t_out
  select 'players on the live court are not counted as resting',
         case when not exists (
           select 1 from jsonb_array_elements(v_rounds) r,
                        jsonb_array_elements_text(r -> 'resting') rest
           where rest::uuid = any(v_players[5:8])
         ) then 'PASS' else 'FAIL: someone on court 1 is listed as resting while still playing' end;

  -- Control: finish court 1 too, and the same round appears.
  update public.session_live_matches set status = 'completed'
  where session_id = v_new and court_idx = 1;

  select public.get_live_session_snapshot_versioned(v_new) into v_snapshot;
  v_rounds := coalesce(v_snapshot -> 'round_rows', '[]'::jsonb);

  insert into t_out values (
    'control: same round once every court is finished',
    case when jsonb_array_length(v_rounds) > 0 then 'PASS (appears)' else 'FAIL (still missing)' end
  );
end
$verify$;

select * from t_out;

rollback;
