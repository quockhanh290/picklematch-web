## Task: Operation stabilization audit - full live-lane state machine
Status: IN PROGRESS

Audit ledger: `docs/OPERATION_STABILIZATION_AUDIT.md`

### Completed
- [x] Fix post-deploy client render loop: remove both derived-key state effects identified at lines 2302/2317; preview state now changes only in the fetch effect or at operation/timer boundaries.
- [x] Map the client -> Edge -> versioned RPC -> snapshot operation path.
- [x] Inventory load, preview, persist, start, complete, cancel, roster, refresh and end-session transitions.
- [x] Run focused gate: 6 suites / 74 tests pass; record the remaining round-projection drift warnings.
- [x] Fix OPS-P1-02: abortable preview requests no longer share cancellation ownership across React effect generations.
- [x] Add regression test proving aborting an older identical preview request does not cancel the newer request.

### Open findings
- [x] ENG-P1-01: apply fairness `config_changes` in the production live suggestion chain.
- [x] ENG-P1-02: make engine and client share canonical rolling-cycle reconstruction.
- [x] ENG-P1-03: honor `effective_pvna` throughout selection/search/rescue and direct state loading.
- [x] ENG-P2-01: give `suggestNextRound` a bounded default runtime and timing gate.
- [x] ENG-P2-02: fix gender fairness satisfiable numerator/denominator accounting.
- [x] ENG-P2-03: add a production-equivalent rolling-lane engine harness.
- [x] OPS-P1-01: replace ambiguous rolling `round_no` semantics with one canonical logical cycle model.
- [ ] OPS-P1-03: replace legacy/dirty E2E reset and CTA assertions with disposable live-lane lifecycle tests.
- [x] OPS-P1-04: replace permanent assignment-conflict blocking with refetch + bounded recovery.
- [x] OPS-P2-01: unify manual and automatic starts on persisted match identity.
- [x] OPS-P2-02: include all preview policies in one request/cache fingerprint.
- [x] OPS-P2-03: detect version changes from another tab/device while focused.
- [x] OPS-P3-01: remove duplicate dead live-cycle implementation after canonical tests are in place.

### Discipline
- Do not tune engine ranking during this pass without a replay proving a ranking defect.
- Every state-machine fix needs a regression test before deploy.
- SQL changes use migrations; Edge bundle changes require the affected function deploys.
- Do not deploy Vercel without Kevin's explicit approval.

---

## Task: Precomputed session planner - one engine, hybrid execution
Status: PLANNED; Phase 0 shadow proof complete

Architecture and rollout ledger: `docs/PRECOMPUTED_SESSION_PLANNER.md`

### Decision
- Keep `lib/next-round-suggester` as the only matchmaking engine and source of
  scoring/invariant truth.
- Build a resumable multi-round planner above the existing engine primitives;
  do not fork scoring, fairness, state, or persistence behavior.
- Keep live suggestion authoritative. A stale/invalid/unavailable plan falls
  back immediately to the current live engine and must never block a court.
- Do not run the current full search in one Supabase Free Edge request. Choose
  single invocation, queued chunks, or host/external compute only after isolated
  CPU benchmarks.

### Completed
- [x] Add real-session shadow planner diagnostic and commit as `4457408`.
- [x] Produce 48/48 valid planned matches for the 32-player, 6-court, 8-round
  session with match counts 6-6, no consecutive rest, and no partner/opponent
  repeats.
- [x] Document objective order, Free Plan decision gates, invalidation contract,
  rollout phases, and rollback.
- [x] Instrument isolated planner stages: the real 32-player plan takes 32.2s at
  three passes and 9.8s at one pass; local search owns nearly all runtime.
- [x] Add/run quick quality and full structural benchmark matrices. Six-court
  one-pass rounds peak around 1.8-2.1s, so current chunks are not Free Edge safe.
- [x] Generalize diagnostic rest scheduling; 36 players on four courts now caps
  the mathematically unavoidable rest streak at two instead of three.
- [x] Phase 1 probe: cache match/board scoring without changing one-pass output;
  real-session runtime fell from 9.8s to 1.88s and slowest round to 263ms.
- [x] Add bounded anytime search. A 400ms deadline returns a valid best-so-far
  board; deterministic one-pass remains the current quality/runtime baseline.
- [x] Extract shared deterministic rest scheduling and checkpointable pair-swap
  search under `lib/next-round-suggester/planner/`; focused tests pass 3/3.
- [x] Define a shared social objective with debt bands and a bounded opponent-
  repeat budget; real-session shadow has no hard gap, no partner repeats, and
  improves intra-team warnings from 8 actual to 7.
- [x] Add shared planned-board validation/minimal repair for checked-out,
  opted-rest, busy, reserved, missing, and duplicate players.
- [x] Add deterministic continuation state. A no-mutation resume after round 3
  changes 0 future lineups.
- [x] Run the real-session mutation gate for checkout, opted rest, late arrival,
  slow/out-of-order courts, cancellation, and manual replacement. No invalid or
  double-booked lineup is emitted; real invalidation changes only the affected
  nearest-visible match.
- [x] Run the mutation matrix at 24/4, 28/6, 32/6, and 36/6. All configurations
  preserve zero no-event churn, zero unavailable/busy selections, full boards,
  hard quality invariants, and per-player quality-debt tails at or below 0.92.
- [x] Re-run full unit gate: 170/171 pass; only the documented pre-existing
  Cap-2 A1 2000ms-budget fixture remains red.

### Next steps
- [x] Phase 0: split timing by planning stage and run quick/structural matrices.
- [x] Phase 1: extract and optimize the shared planner kernel without changing
  live-engine outputs.
- [x] Phase 2: pass the first real-session mutation/hybrid-replan gate.
- [x] Phase 2 hardening: run mutation gates across synthetic roster/court
  combinations and report per-player quality tails.
- [x] Phase 3: add the versioned, idempotent, owner-guarded shadow persistence
  contract without touching live suggestions.
- [x] Stage the Phase 3 shadow schema migration: host-read/service-write RLS,
  idempotent job/version keys, composite session ownership FKs, compact rounds,
  and no dependency on live-match tables. Keep it unapplied until shadow Edge
  passes its end-to-end gate.
- [x] Extract deployable `planner/session-plan.ts`; it imports the existing
  scorer/state projection, has no diagnostic or Node I/O dependency, matches
  the diagnostic oracle exactly, and passes quick + 36-case structural gates.
- [x] Implement `session-plan-shadow`: host auth, canonical input/plan hashes,
  idempotent job reuse, stale-version rejection, compact round publication,
  failed-job capture, and `persist:false` compute smoke mode. It writes no live
  state and passes Deno check.
- [x] Push commits, dry-run/apply the one planner migration, deploy only the new
  shadow function, then verify remote migration/function state. Do not deploy
  client or existing live Edge functions.
- [x] Remote smoke `session-plan-shadow` in dry-run and persisted modes; both
  pass, and repeating the same input reuses job `4fb2d0ae-...`. Function is
  ACTIVE v2, DB is up to date, and planner active compute is about 3.5ms for the
  two-round one-court smoke.
- [x] Add deterministic round-checkpoint execution for pass three. The hosted
  32-player, 6-court, 8-round smoke completed all eight chunks without 546;
  maximum chunk compute was 1066ms, all 48 boards were published, and an
  identical retry reused job `9c79984b-...` and version `3bb1a9e4-...`.
- [ ] Phase 5 advisory integration remains gated. Do not connect shadow plans to
  `session-live-matches-suggest` until planned matches pass the live validator,
  stale/mutated plans fall back without blocking, and the feature flag rollback
  is covered end to end. Six-court hosted runtime and quality are now proven.

### Deployment discipline
- No migration, Edge deploy, or client deploy is required for Phase 0-2.
- Any future planner Edge function is shadow-only before advisory integration.
- Planner failure must be equivalent to planner-disabled behavior.
- Do not deploy Vercel without Kevin's explicit approval.

---

## Task: Stabilization pass - live lane audit/replay
Status: IN PROGRESS

### Completed
- [x] Audit stabilization hot path after live-lane fixes.
- [x] Identify P1 trace gap: `debug_dumps` insert in `session-live-matches-suggest` was fire-and-forget and not registered with `EdgeRuntime.waitUntil`.
- [x] Fix P1 trace gap: register replay dump and instrumentation writes with Edge Runtime background work so `VERIFY_DUMP=1` captures are much less likely to be lost after the response returns.
- [x] Deploy `session-live-matches-suggest` edge function after replay dump `waitUntil` fix.
- [x] Add client audit lifecycle flush on page hide / visibility hidden / before unload to reduce tail-event loss.
- [x] Set Supabase secret `VERIFY_DUMP=1` for project `mzqsxgfvtgmsscbqugni`.
- [x] Add `client_event_id` idempotency path for client-side `session_audit_events` retry duplicates.
- [x] Apply `20260704000001_add_client_event_id_to_session_audit_events.sql` via linked DB query because `db push` is blocked by historical migration drift.
- [x] Smoke cloned session `1ac2c0c1-119d-4e62-b110-3e86a929e1ad`: 7 edge suggests, no 546/timeout, debug dumps wrote required replay keys, edge audit timeline wrote 7 events.
- [x] Add abortable preview edge requests so soft timeout/cleanup cancels the underlying fetch instead of leaving stale `session-live-matches-suggest` requests pending.
- [x] Clean Supabase migration-history drift: normalize date-only/duplicate migration filenames to 14-digit versions, repair remote migration history, and verify `supabase db push` reports remote DB up to date.
- [x] Stabilization slice 1: tag preview provenance in `NextRoundSuggesterScreenV2`, stop local fallback from committing to the startable board, and block start from untrusted/stale preview rows.
- [x] Stabilization slice 2: throttle preview retry storms with keyed retry timers, slower incomplete/error backoff, and no auto-refresh from stale preview finally.
- [x] Stabilization slice 3: surface untrusted/partial/fallback preview state in the suggested-match card, disable unsafe start CTA with clear labels, and fix the card's `visibleMatch` undefined type gap.
- [x] Browser smoke local V2 board on session `967e6682-207d-4d92-aec9-dbe56b54ca2b`: board rendered without mutating the real session; observed 2 `session-live-matches-suggest` calls under 1s and 2 audit batch calls, with no 25s request storm.
- [x] Review current open diff by deploy-risk group. Runtime `features/` and `supabase/functions/` no longer call legacy round start/end/swap paths; only diagnostics scripts still reference them. `npm run build:web` passed. `npx jest tests/next-round-suggester/unit/live-preview.test.ts --runInBand --no-cache` passed 50/50.
- [x] Commit stabilization/runtime group: `8bf912e fix(live-lane): stabilize previews and retire legacy round flow`.
- [x] Commit migration filename normalization group: `ae16e47 chore(db): normalize historical migration filenames`.
- [x] Commit replay docs/tooling group: `695feec chore(diagnostics): document live-lane replay workflow`.
- [x] Commit task memory update: `d03630b chore(task): record stabilization commit plan`.
- [x] Run `supabase db push` against project `mzqsxgfvtgmsscbqugni`: remote database reported up to date.
- [x] Deploy Supabase edge functions touched by live-lane stabilization: `session-live-matches-suggest`, `session-rounds-start`, `session-rounds-start-versioned`, `session-rounds-end`, `session-rounds-end-versioned`, `session-rounds-swap-player`.
- [x] Reduce `debug_dumps` write weight: `session-live-matches-suggest` now writes lite replay payloads by default and full replay payloads only for anomalies or `VERIFY_DUMP_FULL=1`; diagnostics scripts understand lite/full dump metadata.
- [x] Reduce browser audit payload weight: client preview telemetry now sends compact `hash:length` trace keys instead of full preview/incomplete/retry keys in `session_audit_events` details.

### Next steps
- [ ] Deploy client bundle when Kevin wants production client to pick up lifecycle audit flush + idempotent client audit writes. Do not deploy Vercel without explicit approval.

### Key decisions
- Replay source of truth is `debug_dumps.payload`; `session_audit_events` is the timeline/index layer.
- `VERIFY_DUMP=1` does not mean every row is full-heavy anymore. Normal rows are `dump_level='lite'`; anomaly rows are `dump_level='full'` with `full_dump_reason='anomaly'`.
- Client `session_audit_events` should keep counts, court IDs, request IDs, and compact trace keys. Do not store full preview keys or board snapshots in routine client audit events.
- Do not deploy Vercel unless Kevin explicitly asks. Edge-only changes can be deployed to Supabase functions.
- Stabilization pass should avoid engine-ranking changes unless a real dump proves engine behavior is wrong.

### Files touched in this stabilization slice
supabase/functions/session-live-matches-suggest/index.ts
docs/CODEBASE_MAP.md
TASK.md

---

## Task: Watch script alignment + UX improvements
Status: IN PROGRESS

### Completed
- [x] Fix fairness bug: c_rest=2 false positive từ partial rounds (metrics.ts)
- [x] Fix available pool skipping MUST_PLAY players (live-preview.ts)
- [x] Deploy 2 bug fixes lên 4 Supabase edge functions
- [x] Redesign capacity/tradeoff UX (ScreenComponents.tsx):
  - ℹ info block "Tốt nhất từ X/Y người đang rảnh"
  - startDisabled = busy || hasLockedPlayers (fix: không cho start khi có locked player)
  - "Xem lineup thay thế" dùng hasLockedPlayers thay vì showWaitUI
  - Invalidate suggestions chất lượng kém sau khi sân hoàn thành
- [x] Fix watch script sai mode và thiếu params:
  - Bỏ prefer_available_pool: true
  - Thêm planned_total_rounds và court_preset
  - Fix TypeScript errors
  - Luôn dùng replace_courts (không dùng full_board — UI không bao giờ dùng full_board)
- [x] Điều tra watch script vs UI mismatch (session 7d64d01b-...):
  - Player pool GIỐNG NHAU (34 players, cùng pvna, cùng cr=0/mp=0)
  - Algorithm là stochastic (beamsearch) — không phải simple pvna sort
  - Tìm optimal grouping (ghép 6 trận cân bằng) → nhiều local optima khác nhau
  - Cả hai giải pháp đều valid (pvna_gap=0.00 cho tất cả sân)
  - KẾT LUẬN: Expected behavior — watch script không cần phải exact match UI ở vòng đầu

### In progress
- [ ] Hoàn thiện UX của ScreenComponents.tsx

### Next steps
- [ ] [FUTURE — developer only] Debug view: expose full candidate list từ engine để verify lineup quality

### Key decisions
- Watch script mismatch vs UI là expected khi không có match history (nhiều equally-valid solutions)
- Watch script hữu ích để debug algorithm flow và fairness qua nhiều vòng, không để verify exact lineup

### Files touched
features/host/session-detail/next-round-v2/components/ScreenComponents.tsx
features/host/session-detail/NextRoundSuggesterScreenV2.tsx
lib/next-round-suggester/fairness/metrics.ts
lib/next-round-suggester/live-preview.ts
scripts/watch-court-lane.ts
