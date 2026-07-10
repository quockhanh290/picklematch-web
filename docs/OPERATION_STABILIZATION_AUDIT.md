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
Status: OPEN - foundational fix required

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

Required fix:

- Define one canonical `cycle_no`/logical round for rolling lanes, separate from physical court lane and active overlap.
- Assign it transactionally when suggestions are persisted.
- Make snapshot, completion counters, fairness, report and UI consume that value.
- Backfill/compatibility logic must remain for old sessions only.

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
Status: OPEN

Evidence:

- `e2e/global-setup.ts` deletes `session_rounds`, `session_player_state`, and pair history, but not `session_live_matches` or the live version.
- `e2e/next-round.spec.ts` still expects the old single CTA flow (`Bắt đầu vòng` / `Kết thúc vòng`) instead of per-court start/complete.

Impact:

- Test sessions can begin dirty.
- Green E2E does not cover persisted suggestions, asynchronous court completion, stale-version recovery, lane refill, or end-of-session behavior.

Required fix:

- Provision a dedicated disposable session per test run through a guarded test helper/RPC.
- Exercise 2+ courts completing out of order, refresh during requests, stale response ordering, and final target-round transition.

### OPS-P1-04 - Persist assignment conflicts can become a permanent client block

Severity: P1  
Status: OPEN

Evidence:

The preview catch path adds `incompleteRequestKey` to `previewBlockedIncompleteKeysRef` for an assignment conflict and returns without scheduling expiry. It is cleared only by another state-version change, completion watchdog, or session reset.

Impact:

If the authoritative conflict is caused by a stale/inconsistent preview row but does not produce a new version visible to this client, the same courts remain stuck indefinitely, including after ordinary rerenders.

Required fix:

- Refetch once and classify the conflict against the authoritative snapshot.
- If state advanced, regenerate immediately.
- If state did not advance, emit a terminal invariant event with conflicting match/player IDs and use bounded recovery, never an unbounded block.

### OPS-P2-01 - Two independent start models remain active

Severity: P2  
Status: OPEN

The normal edge preview starts a persisted match by ID, while `manual_available_pool` still calls `start_live_session_match_from_payload_versioned`. These paths have different identity, stale checks, and persistence semantics. They can drift as either RPC evolves.

Required fix: persist every startable lineup first, including host replacements, then use only `start_live_session_match_versioned`.

### OPS-P2-02 - Preview policy changes are absent from the request identity

Severity: P2  
Status: OPEN

`planned_total_rounds`, `court_preset`, and `avoid_pairs` are sent to Edge from `previewBodyRef`, but they are not all represented in `previewRequestKey`. A setting change can therefore update the body without invalidating the committed/cached preview.

Required fix: create one canonical preview-policy fingerprint and use it for request identity, lane cache identity, dump trace, and tests.

### OPS-P2-03 - External state changes have no live subscription

Severity: P2  
Status: OPEN / product decision

The query has no polling or realtime subscription. It refreshes after local operations, focus changes, app activation, and manual refresh. A second host tab/device can mutate the session while the first tab remains stale until one of those triggers occurs.

Required fix: subscribe to the session version or use a low-cost version poll while this screen is focused, then refetch the full versioned snapshot only when the version advances.

### OPS-P3-01 - Dead duplicate live-cycle implementation remains in the model

Severity: P3  
Status: OPEN cleanup

`useNextRoundModel.ts` still exports an older `buildCompletedLiveCycleRows` implementation while runtime imports and uses the newer implementation from `live-cycle-rows.ts`. Keeping two definitions invites tests or future imports to validate the wrong model.

Required fix: remove the dead implementation and keep all cycle tests against the canonical module.

## Engine audit - 2026-07-10

Scope: all production modules under `lib/next-round-suggester`, the live Edge call chain, and the unit/fairness/scenario/property/simulation gates. This pass is review-only; no engine behavior was changed.

### ENG-P1-01 - Live corrector drops config changes

Status: FIXED IN WORKTREE

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

Status: OPEN

`suggestNextRound` is unbounded unless the caller supplies `max_runtime_ms`. Property tests passed 100/100 invariants, but several seeds took 8-30 seconds in the full suite. The worst seed reproduced at 2.66 seconds in isolation; a 1000 ms budget constrained it to about 1.08 seconds. The live single-match path remained fast for the same state.

Required fix: make a runtime budget mandatory/defaulted at the public API boundary and add per-seed wall-clock assertions. Keep quality diagnostics when timeout truncates the search.

### ENG-P2-02 - Gender fairness score mixes incompatible numerator/denominator

Status: OPEN; targeted repro confirmed

The metric subtracts all historical opportunities of players who are unsatisfiable under the current roster from the denominator, but leaves their satisfied opportunities in the numerator. A repro with two opportunities, one currently-unsatisfiable satisfied case and one satisfiable failed case produced a gender score of `20/20` instead of `0/20` for the satisfiable subset.

Required fix: track satisfiable satisfied-count and opportunity-count together at opportunity time, with explicit temporal semantics for roster mutations.

### ENG-P2-03 - Engine gates are not production-equivalent

Status: OPEN test gap

Simulation applies `applyFairnessAdjustment`, models synchronous completed rounds, and has no effective-PVNA scenarios. Production live lanes do none of those in the same way. Existing drift monitoring logs warnings without failing. Green aggregate gates therefore prove many local invariants, but do not prove the deployed live chain.

Required fix: add an authoritative-snapshot -> corrector -> live builder -> persisted preview replay harness covering asynchronous lane completion, stale/noncanonical round groups, effective PVNA, opted rest, roster churn and runtime limits.

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
