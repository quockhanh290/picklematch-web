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
