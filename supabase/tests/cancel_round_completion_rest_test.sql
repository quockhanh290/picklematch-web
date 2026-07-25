-- pgTAP: cancelling the LAST non-terminal match of a round must run the round-completion
-- rest bookkeeping (parity with complete). Run with: supabase test db.

begin;
select plan(3);
set local session_replication_role = replica;

insert into public.sessions (id, host_id, live_state_version, status)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',10,'playing');

-- 9 present players, all consecutive_rest = 0 (p9 will be the rester)
insert into public.session_player_state (session_id, player_id, checked_out_at, opted_rest, consecutive_rest)
select '11111111-1111-1111-1111-111111111111', ('00000000-0000-0000-0000-00000000000'||g)::uuid, null, true, 0
from generate_series(1,9) g;

-- Round 0, 2 courts: court 0 COMPLETED, court 1 LIVE (to be cancelled). p9 rests.
insert into public.session_live_matches (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, started_at, ended_at)
values
 ('ccccccc0-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',0,0,0,'completed',
  '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
  '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb, now(), now()),
 ('ccccccc1-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',1,0,1,'live',
  '["00000000-0000-0000-0000-000000000005","00000000-0000-0000-0000-000000000006"]'::jsonb,
  '["00000000-0000-0000-0000-000000000007","00000000-0000-0000-0000-000000000008"]'::jsonb, now(), null);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- sanity: rester p9 has not rested yet
select is(
  (select consecutive_rest from public.session_player_state
   where session_id='11111111-1111-1111-1111-111111111111' and player_id='00000000-0000-0000-0000-000000000009'),
  0, 'before: rester p9 consecutive_rest = 0');

-- cancel the round's last non-terminal match (no expected in audit -> exercises the fallback)
select lives_ok(
  $$ select public.cancel_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 10,
       'ccccccc1-0000-0000-0000-000000000000'::uuid, '{}'::jsonb) $$,
  'cancel succeeds');

-- after: the round is fully terminal -> rest bookkeeping ran -> p9 rested one round
select is(
  (select consecutive_rest from public.session_player_state
   where session_id='11111111-1111-1111-1111-111111111111' and player_id='00000000-0000-0000-0000-000000000009'),
  1, 'after cancel completed the round, rester p9 consecutive_rest advanced to 1 (bug: stayed 0)');

select * from finish();
rollback;
