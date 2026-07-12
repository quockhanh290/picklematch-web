# Operation Stabilization Audit

Status: IN PROGRESS  
Started: 2026-07-10  
Scope: host live-lane session flow, from client state through Edge Functions and versioned SQL RPCs.

## Objective

Make every operational state transition deterministic, idempotent, recoverable, and replayable. The audit treats UI symptoms such as a stuck court, stale suggestion, wrong round label, or reverted start as state-machine failures rather than isolated display bugs.

## Source-of-truth model

| Data | Authoritative owner | Client may project? | Required conflict guard |
| --- | --- | --- | --- |
| Roster/presence/rest | `session_player_state` | Yes, while mutation is pending | `live_state_version` + rollback/refetch |
| Live/suggested/completed match | `session_live_matches` | Display-only optimistic row | Versioned RPC under session row lock |
| Preview that can be started | Persisted `session_live_matches.status='suggested'` | No local-only startable preview | Exact persisted match ID + version |
| Pair/repeat history | `session_pair_history` | Project after completion | Completion RPC transaction |
| Round/fairness history | Derived live lifecycle | Yes, but client and SQL must agree | One canonical cycle definition |
| Loading/retry state | Client request generation | Yes | Every latch needs timeout and deterministic exit |

## Operation inventory

| Operation | Entry point | Commit point | Recovery path | Audit status |
| --- | --- | --- | --- | --- |
| Load/refresh snapshot | `useLiveSessionQuery` | React Query cache accepts newest version | focus/app-active/manual refetch | PARTIAL |
| Generate preview | preview effect | Edge returns version-consistent board | abort, retry, blocked-key expiry | REVIEWED, findings below |
| Persist preview | `replace_live_session_suggestions_versioned` | transaction increments version | refetch and regenerate | REVIEWED, findings below |
| Start persisted match | `start_live_session_match_versioned` | suggested -> live | idempotent snapshot reconcile | REVIEWED |
| Start manual replacement | payload start RPC | new live row | snapshot reconcile | OPEN: dual write model |
| Complete match | `complete_live_session_match_versioned` | live -> completed + counters/history | idempotent snapshot reconcile + watchdog | REVIEWED, round model open |
| Cancel match | versioned cancel RPC | live/suggested -> cancelled | refetch | PARTIAL |
| Roster mutation | versioned roster RPCs | player state + version | optimistic rollback/refetch | PARTIAL |
| End session | derived target state | recap/report | no further preview calls | OPEN: depends on round model |

## Findings

### OPS-P1-01 - Rolling lanes do not have a canonical round identity

Severity: P1  
Status: FIXED IN CODE; migrations not applied

Evidence:

- `replace_live_session_suggestions_versioned` assigns a replacement to the minimum round number still live.
- `20260703000008_allow_rolling_live_reuse_completed_players.sql` then removes the same-round completed-player guard so rolling lanes can continue.
- The snapshot closes a round only when every non-cancelled row sharing that `round_no` is completed.
- Client fallback groups by persisted round number when it appears reliable, otherwise by sequence chunks.
- Current tests pass while printing `live round projection drift` warnings.

Impact:

- `round_no` can remain `0` for most or all of a rolling session.
- DB snapshot, client display, fairness counters, target-round completion, and replay can disagree.
- UI fixes that infer display rounds hide the symptom but do not repair historical semantics.

Fix:

- `session_live_matches.cycle_no` is now the canonical rolling logical-cycle identity, separate from court lane and overlap state.
- Preview persistence assigns `cycle_no` transactionally from each engine payload and mirrors it to legacy `round_no` during the compatibility window.
- Shared reconstruction prefers `cycle_no` only when the full row set has canonical identity. Mixed and historical sessions retain sequence validation/fallback; ambiguous history is intentionally not backfilled.
- Completion counters, `last_played_round`, and completion audit events use `coalesce(cycle_no, round_no)`. Snapshot live rows already use `select *`; synthetic rows stay aligned because the writer mirrors the canonical value.
- Focused canonical/legacy/live-chain gate passes 59/59; property invariants pass 100/100.

Deployment boundary: apply migrations `20260710000001` through `20260710000003`, then redeploy the six Edge bundles and ship a client build so every reader prefers `cycle_no`. Old clients remain compatible through mirrored `round_no`.

Residual gate note: the pre-existing cap-2 A1 timing test currently returns no board at about 1.977s under its 2s deadline, both in the full unit run and in isolation. Giving forced rescue the regular probe's extra 100ms did not change that result, so no unrelated engine change is included in OPS-P1-01.

### OPS-P1-02 - Abortable preview requests shared cancellation ownership

Severity: P1  
Status: FIXED IN WORKTREE, regression test added

Root cause:

`fetchLiveMatchesPreview` deduplicated identical requests by returning one Promise. React effect generations supplied different AbortControllers, so cleanup of an older generation could abort the network request now awaited by a newer generation.

Fix:

- Abortable calls are no longer shared.
- Non-abortable calls retain existing deduplication.
- Regression test proves aborting request A does not cancel identical request B.

Verification: `tests/next-round-v2/api-preview-request.test.ts` PASS.

### OPS-P1-03 - E2E reset and assertions target the retired round flow

Severity: P1 test-gap  
Status: IMPLEMENTED IN CODE; live E2E gate pending Supabase credentials

Evidence:

- `e2e/global-setup.ts` deletes `session_rounds`, `session_player_state`, and pair history, but not `session_live_matches` or the live version.
- `e2e/next-round.spec.ts` still expects the old single CTA flow (`Bắt đầu vòng` / `Kết thúc vòng`) instead of per-court start/complete.

Impact:

- Test sessions can begin dirty.
- Green E2E does not cover persisted suggestions, asynchronous court completion, stale-version recovery, lane refill, or end-of-session behavior.

Implementation:

- Global setup creates a fresh session through the production `create_session_with_host` RPC, clones only a confirmed roster with service-role access, configures two courts and a one-round target, and never resets an existing session.
- Global teardown deletes the disposable session and slot; setup also cleans partial fixtures when provisioning fails.
- Without `SUPABASE_SERVICE_ROLE_KEY`, the next-round suite skips instead of falling back to a fixed/real session.
- The active lifecycle starts two persisted court matches, refreshes while both are live, completes court 2 before court 1, verifies lane refill, then verifies the final target transition to recap. Retired single-CTA round tests are disabled pending dead-code removal.

Verification: Playwright collection and scoped TypeScript validation pass. The live browser gate remains pending because the configured Supabase credentials currently return 401.

### OPS-P1-04 - Persist assignment conflicts can become a permanent client block

Severity: P1  
Status: FIXED IN CODE

Evidence:

The preview catch path adds `incompleteRequestKey` to `previewBlockedIncompleteKeysRef` for an assignment conflict and returns without scheduling expiry. It is cleared only by another state-version change, completion watchdog, or session reset.

Impact:

If the authoritative conflict is caused by a stale/inconsistent preview row but does not produce a new version visible to this client, the same courts remain stuck indefinitely, including after ordinary rerenders.

Fix:

- Assignment-conflict handling now refetches the authoritative snapshot once before deciding recovery.
- If the live version advanced, stale preview/cache state is cleared and regeneration happens immediately.
- If the version is unchanged, the client records authoritative conflicting match, player, and court IDs, retries once, then emits a terminal invariant event.
- Exhausted recovery enters a six-second cooldown with a scheduled unblock and counter reset; no conflict key remains blocked indefinitely.
- The recovery counter resets on version advance and session change. The full next-round-v2 gate passes 26/26, including focused classification coverage.

### OPS-P2-01 - Two independent start models remain active

Severity: P2  
Status: FIXED IN CODE

The normal edge preview starts a persisted match by ID, while `manual_available_pool` still calls `start_live_session_match_from_payload_versioned`. These paths have different identity, stale checks, and persistence semantics. They can drift as either RPC evolves.

Fix: manual available-pool lineups are now persisted through `replace_live_session_suggestions_versioned`, then started through the same persisted-ID Edge path as automatic previews. The persistence response supplies the authoritative match ID and advanced version to `session-live-matches-start`; client mutations and E2E helpers no longer call `start_live_session_match_from_payload_versioned`. The API regression gate proves persist happens before start and that the returned ID/version are forwarded. Next-round-v2 passes 27/27.

### OPS-P2-02 - Preview policy changes are absent from the request identity

Severity: P2  
Status: FIXED IN CODE

`planned_total_rounds`, `court_preset`, and `avoid_pairs` are sent to Edge from `previewBodyRef`, but they are not all represented in `previewRequestKey`. A setting change can therefore update the body without invalidating the committed/cached preview.

Fix: `buildPreviewPolicyFingerprint` now canonically covers court count, configured PVNA tolerance, target rounds, court preset, live-quality policy, and stable-sorted avoid pairs. The same fingerprint participates in batch identity, lane-cache identity, request identity, and request audit traces. Focused tests prove every policy change invalidates identity while avoid-pair direction/order remains stable. Next-round-v2 passes 33/33.

### OPS-P2-03 - External state changes have no live subscription

Severity: P2  
Status: FIXED IN CODE

The query has no polling or realtime subscription. It refreshes after local operations, focus changes, app activation, and manual refresh. A second host tab/device can mutate the session while the first tab remains stale until one of those triggers occurs.

Fix: while the screen is focused and the app is active, a guarded four-second poll reads only `sessions.live_state_version`. It never overlaps itself and fetches the full authoritative snapshot only when the server version is greater than the local version. Blur/background cleanup stops useful work, local mutations still use their immediate reconcile paths, and external advances emit an audit trace. Next-round-v2 passes 35/35.

### OPS-P3-01 - Dead duplicate live-cycle implementation remains in the model

Severity: P3  
Status: FIXED IN CODE

`useNextRoundModel.ts` exported an older `buildCompletedLiveCycleRows` implementation while runtime imported and used the newer implementation from `live-cycle-rows.ts`. Keeping two definitions invited tests or future imports to validate the wrong model.

Fix: removed both the exported duplicate and the commented legacy reconstruction block. The model now imports `buildCompletedLiveCycleRows` directly from `live-cycle-rows.ts`, so runtime and cycle tests share one canonical implementation.

### OPS-REG-01 - Focus polling triggers a React update-depth loop

Severity: P1 client runtime
Status: FIXED IN CODE

The focused-version poll stored navigation focus in React state and changed that state from `useFocusEffect` mount/cleanup. The route also omitted the optional `players` prop while the component defaulted it to a fresh `[]`, and the model allocated a fresh empty `LiveRows` object whenever query data was unavailable. Those changing identities repeatedly invalidated downstream memo/effect dependencies during loading and error states, allowing focus and state-synchronization effects to feed another render until React raised `Maximum update depth exceeded`.

Fix: focus is now an imperative ref because it only gates the polling callback and has no visual output. The optional roster default and empty query rows are module-level constants, so empty inputs retain identity across renders. Focus mount/cleanup no longer schedules component renders, and loading/error renders no longer manufacture new dependency graphs. The poll still skips work while blurred or backgrounded. Focused client gates pass 37/37 and the web production bundle builds successfully.

## Engine audit - 2026-07-10

Scope: all production modules under `lib/next-round-suggester`, the live Edge call chain, and the unit/fairness/scenario/property/simulation gates. This pass is review-only; no engine behavior was changed.

### ENG-P1-01 - Live corrector drops config changes

Status: FIXED

`correctForFairness` returns both `tier_overrides` and `config_changes`. The live Edge passes the adjustment to `buildSuggestedMatchPayloads`, but that builder consumes only tier overrides. Repeat-weight, gender-weight and PVNA-tolerance corrections therefore do not affect live suggestions. The synchronous simulator and retired round Edge call `applyFairnessAdjustment`, so their green results do not represent production live behavior.

Fix: `buildSuggestedMatchPayloads` now applies the full fairness adjustment before generating its cache key or entering any initial/rescue branch. The live timing harness passes the production adjustment shape, and a regression test locks the configured/effective PVNA tolerance boundary.

### ENG-P1-02 - Engine and client use different logical-round reconstruction

Status: FIXED IN WORKTREE; SQL canonical identity remains OPS-P1-01

`buildSuggestedMatchPayloads` trusts every non-null persisted `round_no`. The client first validates round groups and falls back to sequence chunks when rolling-lane round numbers are unreliable. The persistence model can reuse completed players while the minimum active `round_no` remains unchanged, so engine repeat windows, rest projection and fairness state can drift from the client and snapshot.

Fix: `reconstructLiveRounds` now owns filtering, de-duplication, persisted-group validation and sequence fallback. The live engine, completed-cycle synthesis and round display all consume the same map, with regression coverage for valid persisted groups, dirty repeated-court groups and cancelled rows. Focused live gates pass 58/58.

Remaining boundary: persistence/snapshot still need one schema-level cycle identity and drift warnings still need to become failing contract tests; that work remains OPS-P1-01 rather than being hidden inside this engine fix. Full-project typecheck remains blocked by pre-existing diagnostic/tmp errors unrelated to these files.

### ENG-P1-03 - Effective PVNA is only partially honored

Status: FIXED IN WORKTREE

Core match scoring uses `effective_pvna`, but player priority, exhaustive-combination ordering, live rescue/repair quality metrics and diagnostics still use raw `pvna`. A five-player repro returned a lineup with score `4.75` and rested `p5`, while brute force using effective PVNA found score `2.60` by resting `p1`. No engine test currently covers `effective_pvna`.

The direct `loadSessionState` query also omits the `effective_pvna` column, so `session-fairness`, `session-summary`, the retired round suggester and diagnostics silently lose overrides. The live snapshot path uses `sps.*` and does receive the field.

Fix: selection priority, exhaustive ordering, partition seeds, live rescue/repair, outlier detection and diagnostics now use `getEffectivePvna`. The preview cache fingerprint includes the override, dumps preserve both raw and effective values, and the direct loader selects `effective_pvna`. Regression tests lock the five-player bench decision, loader query/mapping and cache invalidation. The focused gate passes 119/119.

### ENG-P2-01 - Full-round search has no default runtime budget

Status: FIXED IN WORKTREE

`suggestNextRound` is unbounded unless the caller supplies `max_runtime_ms`. Property tests passed 100/100 invariants, but several seeds took 8-30 seconds in the full suite. The worst seed reproduced at 2.66 seconds in isolation; a 1000 ms budget constrained it to about 1.08 seconds. The live single-match path remained fast for the same state.

Fix: `suggestNextRound` now defaults to a 1000 ms public budget with a 50 ms return guard, propagates the remaining deadline into every partition pass, and records budget/elapsed/timeout diagnostics. Larger explicit budgets fail fast through regular search and reserve the remaining shared deadline for forced rescue. The 100-seed property gate asserts each call stays below 1800 ms and requires deterministic equality whenever neither call reports timeout; truncated calls remain subject to all invariants. The 40-player/6-court cap-2 fixture still fills the full board under its explicit 2000 ms budget. Long-horizon quality simulations can opt into an explicit budget; the 12-player/3-court benchmark retains its five-partner diversity floor at 1500 ms.

### ENG-P2-02 - Gender fairness score mixes incompatible numerator/denominator

Status: FIXED IN WORKTREE

The metric subtracts all historical opportunities of players who are unsatisfiable under the current roster from the denominator, but leaves their satisfied opportunities in the numerator. A repro with one historically satisfiable success whose supporting player later checked out and one satisfiable failure produced `20/20`; round-time accounting correctly preserves both historical opportunities and scores `10/20`.

Fix: each round now classifies preference feasibility from that round's roster before incrementing either the satisfiable numerator or denominator. Impossible opportunities are tracked separately, and current-roster impossibility is retained only for present-time warnings. A regression with one historically satisfied player who later loses all eligible partners and one satisfiable failure now scores 10/20 instead of 20/20. Round availability is historical; preference and gender values remain current-profile semantics because `RoundRecord` does not snapshot those fields. The fairness and gender scenario gate passes 67/67.

### ENG-P2-03 - Engine gates are not production-equivalent

Status: FIXED IN WORKTREE

Simulation applies `applyFairnessAdjustment`, models synchronous completed rounds, and has no effective-PVNA scenarios. Production live lanes do none of those in the same way. Existing drift monitoring logs warnings without failing. Green aggregate gates therefore prove many local invariants, but do not prove the deployed live chain.

Fix: `runProductionLiveChain` now executes authoritative DB rows through state mapping, corrector/warnings and the real live payload builder without pre-applying adjustments. Its rolling-lane scenario covers asynchronous completion, noncanonical persisted groups, effective PVNA ingestion, opted rest, checkout/late check-in churn, persisted preview replay, double-book protection and a 2-second runtime gate. The first run completes in about 309 ms. The harness exposed and locked a production bug: cross-court live players are now protected independently of logical-round reconstruction, while same-court future previews remain allowed.

## Gate results

- Focused unit/integration gate: 6 suites, 74 tests PASS.
- Full engine unit gate: 9 suites, 143 tests PASS.
- Fairness gate: 6 suites, 62 tests PASS.
- Scenario gate: 5 suites, 12 tests PASS.
- Property gate: 100/100 generated seeds PASS for invariants, but several seeds took 8-30 seconds in the combined run.
- ENG-P1-01 focused gate: 60/60 tests PASS. Small live timing A/B was unchanged by the fix (`1178-1179ms` average, `1218ms` max), below the 2s operational ceiling but above the benchmark's stale 50ms assertion.
- Full simulation gate was stopped after more than 15 minutes without completing or emitting a suite result; it is NOT counted as PASS.
- The gate emits three round-projection drift warnings; these are tracked by OPS-P1-01 and are not considered clean.
- Full TypeScript check remains red only in pre-existing scratch/diagnostic scripts; no new error was reported in the changed runtime/test files.
- No DB migration, Edge deploy, or production client deploy was performed in this audit slice.

## Fix order

1. OPS-P1-02 request ownership - fixed and locked by test.
2. OPS-P1-04 bounded conflict recovery.
3. OPS-P1-03 modern disposable E2E lifecycle.
4. OPS-P1-01 canonical rolling cycle model, with migration + replay compatibility.
5. OPS-P2-01 unify persisted start path.
6. OPS-P2-02 canonical preview policy fingerprint.
7. OPS-P2-03 focused version subscription/poll.
8. OPS-P3-01 dead-code cleanup after behavior is locked.

## Exit criteria

- No request/loading/block latch lacks a bounded exit.
- Start and complete are idempotent under timeout and duplicated input.
- Out-of-order court completion refills the correct lane and never reuses a busy player.
- Refresh reconstructs the same board from DB alone.
- Client, Edge, SQL snapshot, replay, and report agree on logical cycles.
- A complete target session stops requesting suggestions and enters recap.
- Automated tests cover slow Edge, stale response, abort, double click, two-tab version advance, partial board, 546/non-JSON response, and final round.
