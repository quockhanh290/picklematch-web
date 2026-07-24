-- pgTAP: an open court must get a startable suggestion even when a "straggler" court is
-- still playing an OLDER round. Run with: supabase test db
--
-- Reproduces: courts 2..6 finished and moved on; court 1 (idx 0) is still LIVE on round 1.
-- The open court (idx 5) has completed rounds 0 and 1, so its next round is 2. Before the
-- fix, replace_* labelled the new suggestion round_no = min(live round) = 1, and the persist
-- "already played in this round" guard rejected it because those players played round 1.
-- After the fix, round_no derives from the target court's own progress (= 2), so it persists.

begin;
select plan(2);
set local session_replication_role = replica;

insert into public.sessions (id, host_id, live_state_version, status)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',10,'active');

-- 8 available players
insert into public.session_player_state (session_id, player_id, checked_out_at, opted_rest)
select '11111111-1111-1111-1111-111111111111',
       ('00000000-0000-0000-0000-00000000000'||g)::uuid, null, false
from generate_series(1,8) g;

-- straggler: court 0 still LIVE on round 1 (pins min(live round)=1)
insert into public.session_live_matches (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, started_at)
values ('aaaaaaa1-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',6,1,0,'live',
        '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
        '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb, now());

-- open court idx 5 has COMPLETED round 0 and round 1 (players p5..p8 played round 1)
insert into public.session_live_matches (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, started_at, ended_at)
values
 ('aaaaaaa2-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',5,0,5,'completed',
  '["00000000-0000-0000-0000-000000000005","00000000-0000-0000-0000-000000000006"]'::jsonb,
  '["00000000-0000-0000-0000-000000000007","00000000-0000-0000-0000-000000000008"]'::jsonb, now(), now()),
 ('aaaaaaa3-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',11,1,5,'completed',
  '["00000000-0000-0000-0000-000000000005","00000000-0000-0000-0000-000000000006"]'::jsonb,
  '["00000000-0000-0000-0000-000000000007","00000000-0000-0000-0000-000000000008"]'::jsonb, now(), now());

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- suggest court 5 with the players who just played round 1
select lives_ok(
  $$ select public.replace_live_session_suggestions_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 10,
       '[{"court_idx":5,"team_a":["00000000-0000-0000-0000-000000000005","00000000-0000-0000-0000-000000000006"],"team_b":["00000000-0000-0000-0000-000000000007","00000000-0000-0000-0000-000000000008"]}]'::jsonb,
       '[5]'::jsonb, false, '{}'::jsonb) $$,
  'suggestion for the open court persists (not blocked by the straggler-pinned round guard)'
);

select is(
  (select round_no from public.session_live_matches
   where session_id='11111111-1111-1111-1111-111111111111' and court_idx=5 and status='suggested'),
  2, 'the new suggestion is labelled round 2 (target court''s own next round), not the straggler''s round 1'
);

select * from finish();
rollback;
