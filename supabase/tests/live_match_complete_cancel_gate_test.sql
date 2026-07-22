-- pgTAP test for the complete / cancel gates.
-- Run with:  supabase test db
--
-- Same contract as the start gate: an unrelated version bump must NOT block completing
-- or cancelling a specific match; the status guard under the row lock stays authoritative.
-- Mirrors tests/host/startGateModel.ts::evaluateCompleteGate / evaluateCancelGate.

begin;
select plan(6);

set local session_replication_role = replica;

insert into public.sessions (id, host_id, live_state_version, status)
values ('11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', 10, 'active');

insert into public.session_player_state (session_id, player_id, checked_out_at, opted_rest)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', null, false),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', null, false),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', null, false),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000004', null, false);

-- a LIVE match to complete, and a SUGGESTED match to cancel
insert into public.session_live_matches
  (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, started_at)
values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 0, 0, 0, 'live',
   '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
   '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb,
   now());
insert into public.session_live_matches
  (id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b)
values
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111', 1, 1, 1, 'suggested',
   '["00000000-0000-0000-0000-000000000001","00000000-0000-0000-0000-000000000002"]'::jsonb,
   '["00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004"]'::jsonb);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- unrelated churn: 10 -> 13
update public.sessions set live_state_version = 13 where id = '11111111-1111-1111-1111-111111111111';

-- COMPLETE with stale expected version (10) must still succeed
select lives_ok(
  $$ select public.complete_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 10,
       '33333333-3333-3333-3333-333333333333'::uuid, 11, 9, 0,
       '{"expected_round_matches":"1"}'::jsonb) $$,
  'complete succeeds even though live_state_version advanced'
);
select is(
  (select status from public.session_live_matches where id = '33333333-3333-3333-3333-333333333333'),
  'completed', 'match transitioned live -> completed'
);
-- completing again is rejected by the status guard (not the CAS)
select throws_ok(
  $$ select public.complete_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 14,
       '33333333-3333-3333-3333-333333333333'::uuid, 11, 9, 0,
       '{"expected_round_matches":"1"}'::jsonb) $$,
  'Only live matches can be completed',
  'double-complete rejected by status guard'
);

-- CANCEL with stale expected version must still succeed
select lives_ok(
  $$ select public.cancel_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 10,
       '44444444-4444-4444-4444-444444444444'::uuid, '{}'::jsonb) $$,
  'cancel succeeds even though live_state_version advanced'
);
select is(
  (select status from public.session_live_matches where id = '44444444-4444-4444-4444-444444444444'),
  'cancelled', 'match transitioned suggested -> cancelled'
);
-- cancelling again is rejected by the status guard
select throws_ok(
  $$ select public.cancel_live_session_match_versioned(
       '11111111-1111-1111-1111-111111111111'::uuid, 15,
       '44444444-4444-4444-4444-444444444444'::uuid, '{}'::jsonb) $$,
  'Only suggested/live matches can be cancelled',
  'double-cancel rejected by status guard'
);

select * from finish();
rollback;
