-- pgTAP test for the "start suggested live match" gate.
-- Run with:  supabase test db   (needs the local stack + pgtap extension)
--
-- Reproduces the false-positive "Session changed": a preview re-persist on ANOTHER
-- court advances live_state_version, yet the host's suggested match on their court
-- is still perfectly valid. The start MUST succeed. It also asserts the real
-- conflict checks still reject (safety is preserved without the coarse version CAS).
--
-- Mirrors the Jest contract model in tests/host/startGateModel.ts. Keep in sync
-- with migration start_live_session_match_versioned.

begin;
select plan(5);

-- Bypass FK checks so the fixture is self-contained (no auth.users/players rows needed).
set local session_replication_role = replica;

-- Fixtures ------------------------------------------------------------------
-- host + session at version 10
insert into public.sessions (id, host_id, live_state_version, status)
values ('11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        10, 'active');

-- four available checked-in players
insert into public.session_player_state (session_id, player_id, checked_out_at, opted_rest)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', null, false),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', null, false),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', null, false),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000004', null, false);

-- the suggested match the host is about to start (court 2, round 3)
insert into public.session_live_matches
  (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b)
values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   0, 3, 2, 'suggested',
   '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
   '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb);

-- Act as the host for auth.uid()
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Simulate a concurrent preview re-persist on another court: version 10 -> 13.
update public.sessions set live_state_version = 13
where id = '11111111-1111-1111-1111-111111111111';

-- TEST 1: start with the pre-churn expected version (10) MUST still succeed --------
select lives_ok(
  $$ select public.start_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 10,
       '33333333-3333-3333-3333-333333333333'::uuid, '{}'::jsonb) $$,
  'start succeeds even though live_state_version advanced (unrelated preview churn)'
);

-- TEST 2: the match is now live
select is(
  (select status from public.session_live_matches where id = '33333333-3333-3333-3333-333333333333'),
  'live', 'target match transitioned suggested -> live'
);

-- TEST 3: caller who is not the host is still rejected
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
insert into public.session_live_matches
  (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b)
values
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   1, 3, 4, 'suggested',
   '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
   '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb);
select throws_ok(
  $$ select public.start_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 13,
       '44444444-4444-4444-4444-444444444444'::uuid, '{}'::jsonb) $$,
  'Only the host can start live match',
  'non-host is rejected'
);

-- TEST 4: player already in a live match is still rejected (real conflict) ---------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.start_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 14,
       '44444444-4444-4444-4444-444444444444'::uuid, '{}'::jsonb) $$,
  'A player is already in a live match or already played in this round',
  'double-book (players still live on court 2) is rejected without the CAS'
);

-- TEST 5: starting an already-live match is rejected
select throws_ok(
  $$ select public.start_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 14,
       '33333333-3333-3333-3333-333333333333'::uuid, '{}'::jsonb) $$,
  'Only suggested matches can be started',
  'a match already started cannot be started again'
);

select * from finish();
rollback;
