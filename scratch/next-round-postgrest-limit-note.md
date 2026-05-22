# Next-round PostgREST limit note

Date: 2026-05-21

Context: host next-round versioned Start/End load testing on Supabase project `mzqsxgfvtgmsscbqugni`, current plan observed as Free/shared CPU.

## Current practical limit

- Production path tested: `round-edge` (`session-rounds-start-versioned` + `session-rounds-end-versioned`).
- 125 concurrent: PASS 125/125, p95 total about 4.7s.
- 135 concurrent: PASS 135/135, p95 total about 7.5s, visible tail latency.
- 145 concurrent: FAIL 142/145, p95 total about 33.6s, Edge `BOOT_ERROR`, left active rounds that required cleanup.

Operational guidance for current plan:

- Safe target: 100-125 concurrent.
- Stretch/risky target: 135 concurrent.
- Do not claim support for 145+ concurrent on current plan.

## Evidence

PostgREST/API logs during failed high-concurrency tests showed:

```text
PGRST003 Timed out acquiring connection from connection pool.
POST /rpc/complete_live_session_round_versioned HTTP/1.1 504
POST /rpc/start_live_session_round_versioned HTTP/1.1 504
canceling statement due to statement timeout
```

DB/query evidence:

- `complete_live_session_round_versioned`: mean execution about 248ms, max about 6.6s across observed calls.
- `start_live_session_round_versioned`: mean execution about 93ms, max about 4.6s across observed calls.
- DB CPU, memory, swap, disk I/O were not saturated in screenshots.
- Cache hit rate was near 100%.
- `max_connections` observed as 60, but failed requests can time out in the PostgREST pool before becoming visible as active DB sessions.

Conclusion:

- Primary bottleneck at 145+ concurrent is PostgREST/API/Edge/platform connection pressure, not the suggester and not primarily SQL execution time.
- Direct RPC does not remove this bottleneck because it still goes through PostgREST.
- Edge adds its own failure mode (`BOOT_ERROR`), but direct RPC also showed pool/timeout failures under higher spikes.

## Revisit options

If production needs 150-200 concurrent synchronous Start/End:

1. Upgrade Supabase plan/compute/pool capacity, then rerun `round-edge` 125/135/145/150/200.
2. Add idempotent Start/End retry + reconcile so timeouts do not leave ambiguous UI state.
3. Audit Realtime subscriptions, since `realtime.list_changes` was the top DB-time query group.
4. Consider queue/worker architecture only if large spikes must be absorbed without keeping synchronous UX.

Always summarize/cleanup benchmark sessions after load tests:

```powershell
npx tsx scratch/summarize-live-load-test-sessions.ts
npx tsx scratch/cleanup-live-load-test-active-rounds.ts --concurrency 25
```
