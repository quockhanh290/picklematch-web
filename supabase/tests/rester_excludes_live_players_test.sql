-- pgTAP: round-completion rest bookkeeping must NOT mark a player as rested if that player is
-- currently in a live match (async/out-of-order: a straggler from round N completes after a
-- round-N rester has already started a round N+1 match). Run with: supabase test db.

begin;
select plan(2);
set local session_replication_role = replica;

insert into public.sessions (id, host_id, live_state_version, status)
values ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',10,'playing');

insert into public.session_next_round_settings (session_id, court_count_override, pvna_tolerance)
values ('33333333-3333-3333-3333-333333333333', 2, 0.5);

-- 10 players, all consecutive_rest = 0
insert into public.session_player_state (session_id, player_id, checked_out_at, opted_rest, consecutive_rest, consecutive_play)
select '33333333-3333-3333-3333-333333333333', ('00000000-0000-0000-0000-00000000000'||g)::uuid, null, false, 0, 0
from generate_series(1,9) g;
insert into public.session_player_state (session_id, player_id, checked_out_at, opted_rest, consecutive_rest, consecutive_play)
values ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000010', null, false, 0, 0);

-- Round 0, 2 courts: court 0 COMPLETED, court 1 LIVE (straggler). p9 & p10 rest round 0.
insert into public.session_live_matches (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, started_at, ended_at)
values
 ('dddddd00-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',0,0,0,'completed',
  '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
  '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb, now(), now()),
 ('dddddd01-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',1,0,1,'live',
  '["00000000-0000-0000-0000-000000000005","00000000-0000-0000-0000-000000000006"]'::jsonb,
  '["00000000-0000-0000-0000-000000000007","00000000-0000-0000-0000-000000000008"]'::jsonb, now(), null);

-- Round 1, court 0 LIVE, pulling in p9 (a round-0 rester) — p9 is now actively playing.
insert into public.session_live_matches (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, started_at, ended_at)
values
 ('dddddd02-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',2,1,0,'live',
  '["00000000-0000-0000-0000-000000000009","00000000-0000-0000-0000-000000000001"]'::jsonb,
  '["00000000-0000-0000-0000-000000000002","00000000-0000-0000-0000-000000000003"]'::jsonb, now(), null);

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

-- Complete the round-0 straggler (court 1) -> round 0 becomes fully terminal -> rest bookkeeping runs.
select lives_ok(
  $$ select public.complete_live_session_match_versioned(
       '33333333-3333-3333-3333-333333333333'::uuid, 10,
       'dddddd01-0000-0000-0000-000000000000'::uuid, 11, 5, 0, '{}'::jsonb) $$,
  'completing the round-0 straggler succeeds');

-- p9 rested round 0 but is LIVE in round 1: must NOT be marked as resting.
select is(
  (select consecutive_rest from public.session_player_state
   where session_id='33333333-3333-3333-3333-333333333333' and player_id='00000000-0000-0000-0000-000000000009'),
  0, 'p9 (live in round 1) is NOT counted as rested (bug: was incremented to 1 while mid-match)');

select * from finish();
rollback;
