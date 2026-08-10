-- P0-7 verification. Everything runs inside a transaction that is rolled back: the migration is
-- applied, a REAL match completion is driven end to end, counters are compared, none of it is kept.
--
-- Both RPCs check `auth.uid() = host_id`, and auth.uid() just reads current_setting('request.jwt.claims'),
-- so the session's own host id is set as the claim. No password, and no PostgREST call — an rpc call over
-- PostgREST autocommits and would really finish somebody's match.
--
-- The role switch is confined to a DO block that reads the target ids into variables first. Temp tables
-- are owned by postgres, so touching one while acting as `authenticated` would need a GRANT; keeping the
-- switch inside the block avoids handing out privileges just to run a test.
--
-- Run: paste the migration file where marked and send the whole thing as one statement.

begin;

-- ========== paste supabase/migrations/20260809000001_rest_bookkeeping_per_match_event.sql here ==========

-- Newest session that actually has a live match to complete, so the data resembles what production is
-- doing right now rather than some long-finished session.
create temp table t_target on commit drop as
select s.id as session_id,
       s.host_id,
       s.live_state_version,
       slm.id as match_id,
       slm.round_no
from public.sessions s
join public.session_live_matches slm on slm.session_id = s.id and slm.status = 'live'
order by slm.created_at desc
limit 1;

create temp table t_before on commit drop as
select sps.player_id, sps.consecutive_rest, sps.consecutive_play, sps.rest_seat_misses,
       sps.opted_rest, sps.matches_played
from public.session_player_state sps
join t_target t on t.session_id = sps.session_id
where sps.checked_out_at is null;

do $verify$
declare
  v_session uuid;
  v_host uuid;
  v_version bigint;
  v_match uuid;
begin
  select session_id, host_id, live_state_version, match_id
  into v_session, v_host, v_version, v_match
  from t_target;

  if v_session is null then
    raise notice 'no live match available to test against';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host::text)::text, true);

  perform public.complete_live_session_match_versioned(
    v_session, v_version, v_match, 11, 7, 11,
    jsonb_build_object('expected_round_matches', 6)
  );

  reset role;
end
$verify$;

-- What moved. Expectations:
--   played_gained_a_match = 4   the four who just played
--   idle_gained_a_miss    > 0   the whole point; this was 0 before the fix
--   opted_rest_changed    = 0   "Xin nghi" must survive someone else's match ending
--   legacy_column_touched = 0   consecutive_rest is derived now, not written here
--   seated_elsewhere      = 0   a player on another live court is not resting
-- One statement, because the Management API only returns the last result set.
select
  count(*) filter (where a.matches_played = b.matches_played + 1) as played_gained_a_match,
  count(*) filter (where a.rest_seat_misses = b.rest_seat_misses + 1) as idle_gained_a_miss,
  count(*) filter (where a.rest_seat_misses = b.rest_seat_misses + 1
                     and a.opted_rest <> b.opted_rest) as opted_rest_changed_should_be_0,
  count(*) filter (where a.rest_seat_misses = b.rest_seat_misses + 1
                     and a.consecutive_rest <> b.consecutive_rest) as legacy_column_touched_should_be_0,
  count(*) filter (
    where a.rest_seat_misses > b.rest_seat_misses
      and exists (
        select 1 from public.session_live_matches slm
        where slm.session_id = (select session_id from t_target)
          and slm.id <> (select match_id from t_target)
          and slm.status in ('suggested', 'live')
          and (slm.team_a @> to_jsonb(b.player_id::text) or slm.team_b @> to_jsonb(b.player_id::text))
      )
  ) as seated_elsewhere_wrongly_counted_should_be_0,
  count(*) as players_examined
from t_before b
join public.session_player_state a
  on a.player_id = b.player_id
 and a.session_id = (select session_id from t_target);

rollback;
