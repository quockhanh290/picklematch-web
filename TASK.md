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
Status: PHASE 5B ALLOWLIST GATE PASSED; global rollout remains off

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
- [ ] Phase 5C rolling court-lane planner: replace synchronized-round-only
  consumption with an availability-aware rolling horizon. At each idle-lane
  checkpoint, consume the nearest feasible unconsumed planned lineup across the
  remaining suffix, never wait for another court, and replan from authoritative
  commitments after any out-of-order consumption. Gate across multiple lane
  completion orders, roster/manual mutations, operation safety, session quality,
  and Free Edge runtime before widening the rollout.
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
- [x] Harden roster mutation around checkpoints: plan only
  `target_rounds-current_round`, correct projected round advancement, stale old
  input jobs, and link deduplicated jobs to their immutable result version.
  Real-roster checkout simulation replans only rounds 4-8 with zero unavailable
  selections; pass three reduces opponent repeat events 12->8. Hosted v5 smoke
  completed without 546 and idempotently reuses job `d6725c59-...`.
- [x] Phase 5A read-only advisory probe: use a stable planning identity that
  ignores ordinary round progress, classify each planned court as `usable`,
  `repair_required`, or `fallback` with the existing live validator, and emit a
  background `session_plan_advisory_shadow` audit event only when
  `SESSION_PLAN_ADVISORY_SHADOW=1`. The live engine remains the sole source of
  returned and persisted suggestions; planner lookup failures are swallowed.
- [x] Hosted Phase 5A usable-path probe: v6 job `0f77c10e-...` completed eight
  pass-three checkpoints without 546 and reused immutable version
  `3bb1a9e4-...`. A six-court live-suggest probe recorded roster/config/history
  identity match with `usable=6`, `repair_required=0`, `fallback=0`; the live
  engine remained authoritative and chose six different lineups.
- [x] Phase 5A manual-mutation hardening: persist host-edited lineups through a
  dedicated owner-guarded RPC, increment `planning_mutation_version`, classify
  same-four repartitions separately from player replacements, and invalidate
  advisory plans while the edited row is either `suggested` or `live`.
- [x] Replace the overly broad global-idle replan guard with a rolling planning
  frontier. Only started (`live`) lineups are immutable commitments projected
  into the planner clone. A host-edited `suggested` lineup defers replanning
  until Start or Cancel, so a pre-start edit never increments match/rest/repeat
  history. Live validation still blocks busy consumption.
- [x] Checkpoint shadow jobs against `planning_mutation_version` plus a canonical
  frontier fingerprint instead of raw `live_state_version`. The fingerprint is
  stable when the same lineup moves from `live` to completed history, but a new,
  canceled, replaced, or materially changed commitment supersedes the job.
- [x] Apply the planning-mutation migration and deploy planner v8 plus the
  read-only live advisory reader. Cap-2 A1 returns a full six-court board in
  about 0.5s. Hosted rolling smoke planned two suffix rounds while one match
  remained live (`fixed_commitment_count=1`, `busy_player_count=4`) and cleaned
  the test match afterward; manual repartition increments the planning version
  and falls back to the live engine.
- [x] Lock advisory consumption to the current rolling frontier. After the live
  commitment was canceled, the old job returned a full 6/6 live-engine board
  with all six advisory decisions rejected as `frontier_changed`. A fresh
  two-round plan at the new frontier completed in 276ms active compute and was
  then accepted as `usable=6`, `fallback=0`, with all identity checks true.
- [x] Complete the hosted Phase 5A matrix. Opted-rest and PVNA mutations each
  invalidated all six old plan rows with the expected roster/config reason,
  while the live engine still filled 6/6; restoring and replanning returned to
  `usable=6`. A session with no v8 job filled 6/6 with `plan_missing`. Disabling
  `SESSION_PLAN_ADVISORY_SHADOW` kept 6/6 output and wrote zero advisory events;
  re-enabling it restored audit writes. With one court live, the other five
  courts stayed full and identity checks passed, while busy validation split
  the plan into per-court `usable` and `repair_required` rows with zero fallback.
- [x] Lock manual pre-start semantics and suffix quality. Hosted same-four
  repartition and player-replacement probes left every `matches_played` counter
  unchanged before Start and returned `manual_suggestion_pending` instead of
  planning through host intent. After Start, each lineup became one fixed live
  commitment; two-round suffixes had zero partner repeats, zero team gaps above
  1.0, zero intra-team gaps above 2.0, and the optimal 1-2 match-count spread
  for 32 players across 52 total commitment-plus-suffix slots. Carrying signed
  live commitment debt removed the prior avoidable 1-3 spread.
- [x] Phase 5B advisory consumption is implemented behind a session allowlist.
  It consumes only
  per-court `usable` rows, leaves `repair_required`/`fallback` courts to the live
  engine, and automatically schedule one idempotent suffix replan after an
  invalidation. Replan scheduling must be single-flight, coalesced, and backed
  off under 546/resource pressure; manual `suggested` rows wait for Start or
  Cancel. Six-court runtime, quality, mutation safety, missing-plan safety, and
  rollback are proven. Hosted consumption is enabled only for test session
  `940399e0-...`; global consumption remains off.
- [x] Add the Phase 5B session-quality comparator before enabling consumption.
  Replay identical session/mutation timelines through `live-only` and `hybrid`,
  then report session fairness, board gaps/repeats/relaxations, and per-player
  rest/diversity/quality-debt tails. Gate lexicographically: zero hard regression,
  feasible match-count spread at most one, no avoidable two-round rest, no
  regression in team-gap-over-1/intra-gap-over-2/partner repeats/max player debt,
  and no hidden lower-priority trade-off without an explicit delta.
- [x] Hosted auto-replan gate: an opted-rest mutation rejected all six stale
  planned courts while the live engine still filled 6/6. Coordinator generation
  2 rebuilt the eight-round plan in about 46s; the next request consumed 6/6
  planned courts and excluded the resting player. Cleanup generation 3 completed
  without error. Coalescing now keys on roster, config, frontier, planning
  version, and manual-mutation identity, not frontier alone.
- [x] Hosted full-session quality gate on the same 32-player/6-court/8-round
  state: both modes produced 48/48 matches with zero hard/operation/rest/incomplete
  violations. Hybrid improved match spread 2->0, intra-gap-over-2 1->0, maximum
  intra gap 2.57->1.31, and maximum player debt 1.57->0.31. The explicit
  lower-priority trade-off was opponent repeats 19->29, still with zero opponent
  repeat overflow under the configured budget.
- [x] Fix the first live Phase 5B canary findings from session `c61b9d49-...`.
  Every idle physical court is now a required preview lane, so a six-court board
  cannot stop at five persisted suggestions. The planner now builds state from
  `get_live_session_snapshot_versioned` instead of legacy `session_rounds`, and
  advances its suffix past live and partially completed rows. Starting or
  completing a lineup produced by the active plan is accepted as monotonic plan
  progress instead of triggering frontier churn. Planned matches are consumed
  as a per-round pool: an idle physical court may take any unused feasible
  lineup from that round, while busy/unavailable lineups remain protected by
  repair/live-engine fallback. Targeted planner, preview, TypeScript, and web
  build gates pass. A combined full-suite timing run was invalidated by two
  duplicate Jest processes competing for CPU; no matching-engine module changed.
- [x] Make plan adoption durable across active and newly loaded clients. Publishing
  a plan now atomically marks persisted suggestions with the target plan version
  and advances `live_state_version`; the client bypasses lane caches and requests
  a full-board replacement until Edge persists the plan rows. The canary returned
  6/6 courts in about 1.9s, all six persisted rows use the same `session_plan`
  version with match indexes 0-5, and the adoption marker cleared automatically.
- [x] Replace synchronized-round plan consumption with a receding rolling-lane
  policy. For each idle court, rank live-engine candidates across bounded
  completion-order scenarios, including player release timing, future board
  feasibility, match-count/rest debt, PVNA/intra-team quality, and repeats.
  Commit only the current lane and recompute from authoritative state at the
  next completion. Keep the eight-round plan as a quality target/benchmark,
  not an immutable lineup schedule.
- [ ] Deploy the rolling policy only to the planner session allowlist, then run
  a hosted asynchronous-lane canary and compare its dump quality/runtime with
  the fixed-round advisory baseline before widening exposure.
- [x] Feed a soft full-session target envelope into rolling decisions. The
  envelope carries absolute per-player match targets plus planned p95 team and
  intra-team gaps. It may rank feasible candidates but cannot reject one;
  stale roster/config/planning identity or pending manual mutation removes the
  target and falls back to production rolling ranking. Ordinary live progress
  may diverge from exact planned lineups without invalidating the envelope.
- [x] Freeze the pre-enhancement rolling quality baseline across court-order,
  reverse-order, and slow-middle completion timelines. Stable quality ceilings
  cover match-count spread, partner/opponent repeats, warning exposure, and
  average/maximum team and intra-team gaps while retaining the per-request
  two-second operation gate. The measured reverse-order run exposed the current
  tail risk directly: max intra-team gap 2.24 and five warning matches.
- [x] Enrich the rolling target with checkpoint match/rest debt, per-player
  quality debt, diversity/repeat budgets, and consecutive play/rest limits.
  The target is derived from the existing immutable planner payload and round
  rows, so no schema change is required. Legacy match-only targets retain their
  old behavior, missing availability counters cannot produce NaN scores, and
  the enriched path passes four asynchronous completion timelines with every
  lane request below two seconds.
- [x] Add lineup flexibility/scarcity scoring as a bounded tie-breaker over the
  engine's own feasible candidates. Players appearing in many alternatives are
  treated as flexible connectors; consuming several at once carries a small
  cost, while actual future infeasibility remains owned by real lookahead. An
  initially stronger heuristic regressed suffix participation and was rejected
  by the rolling matrix before commit.
- [ ] Add bounded worst-case search and counterfactual diagnostics behind the
  existing planner allowlist.

### Deployment discipline
- No migration, Edge deploy, or client deploy is required for Phase 0-2.
- Any future planner Edge function is shadow-only before advisory integration.
- Planner failure must be equivalent to planner-disabled behavior.
- Phase 5A rollback is `SESSION_PLAN_ADVISORY_SHADOW=0`; it requires no DB or
  client rollback because the probe runs after live persistence via `waitUntil`.
- Phase 5B rollback is `SESSION_PLAN_CONSUMPTION=0` and
  `SESSION_PLAN_AUTO_REPLAN=0`. Current hosted exposure is additionally bounded
  by `SESSION_PLAN_ROLLOUT_SESSION_IDS=940399e0-...`.
- Durable canary adoption requires migration
  `20260716000001_publish_session_plan_adoption_signal.sql` and an Edge deploy of
  `session-plan-shadow`. `session-live-matches-suggest` already contains the
  full-board plan adoption path. The client guard reaches localhost through
  Metro, but production still needs the normal client release path.
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
