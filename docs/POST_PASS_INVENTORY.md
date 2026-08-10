# Post-Pass Inventory for `lib/next-round-suggester/live-preview.ts`

Scope: read-only archaeology for P2-2. This inventory treats each post-pass unit as a separate row when it can rewrite payload lineups or final metadata after the per-court builder has chosen a lineup. Commit origins use `git log -S '<name>' --oneline --reverse`; bug statements are grounded in commit messages or `TASK.md`. Anything derived from current code is marked as inference.

Current tail order in `buildSuggestedMatchPayloads`: `repairSuggestedPayloadBatch` -> `repairAllIdlePayloadBatchParticipation` -> `repairPayloadBatchSevereRepeatFromPool` -> `repairPayloadBatchBlowoutFromPool` -> inline `invariantSafePayloads` -> `applyJointRepartition` -> `normalizeRepairedPayload` -> `dropStaleDerivedMetadata` -> `rebuildDerivedMetadataForSeatedLineup`.

## Inventory

| Pass | Origin commit | Bug / symptom it was added for | Tests locking behavior | Hard constraints it preserves |
|---|---|---|---|---|
| `repairSuggestedPayloadBatch` initial cross-court swap, `lib/next-round-suggester/live-preview.ts:3025` | `84b5277` `Add scripts for session round breakdown and live preview policy simulation`. `-S repairSuggestedPayloadBatch` first adds the wrapper and PVNA-improving swap. Commit message does not name a prod bug; it is a broad live-preview policy/simulation commit. | No explicit bug/ALGO in commit message or `TASK.md` found. Code inference only: reduce worst team-total PVNA gap across a batch before final warnings are derived. | `tests/next-round-suggester/unit/live-preview.test.ts:1888`, `:1916`, `:1944`, `:1985` exercise `repairSuggestedPayloadBatch` through severe PVNA / early beam scenarios; `tests/next-round-suggester/unit/live-preview-derived-metadata.test.ts:125` covers retaining choices on untouched courts. No test found that isolates the original `84b5277` simple swap alone. | Code inference: only accepts candidates that improve max PVNA materially; rejects increasing `pvnaOver`; allows at most small intra degradation (`intraOverHard + 1`, `maxIntra + 0.5`); limits repeat regressions depending on current repeat pressure. Preserves selected player set because it swaps already seated players only. |
| `repairRoundOnePayloadBatchWithCleanPool`, `lib/next-round-suggester/live-preview.ts:2165` | `e4f3dfc` `feat(trace): implement manual session trace watcher with status persistence`; `3460089` later fixes it. The original `-S` commit adds the clean-pool round-one search. `3460089` message: baseBusyIds were included in the clean-pool sample and caused double-booking in cap-2 partial-fill. | Original bug is not named in commit/TASK. Code inference only: first true round can start with bad intra-team quality, so rebuild from the whole clean eligible pool. Grounded later bug: `3460089` fixes double-booking caused by this pass sampling busy override-row players. | Covered indirectly by `tests/next-round-suggester/unit/live-preview.test.ts:1953` ("repairs early-round intra-team outliers without exceeding the PVNA cap"). I found no direct test by function name because it is private. | Code inference: true first round only, round_no 0 only, all selected players unique, eligible pool bounded; candidates must be within PVNA tolerance and preferred intra cap; result must improve early batch score; recomputes global `resting`. Later `3460089` protects busy players from being sampled via `repairState`. |
| `repairEarlyPayloadBatchQuality`, `lib/next-round-suggester/live-preview.ts:2269` | `e4f3dfc` `feat(trace): implement manual session trace watcher with status persistence`. | No explicit prod bug/ALGO in commit message or TASK found. Code inference only: early rounds and severe outliers needed batch-level quality repair beyond the simple swap. | `tests/next-round-suggester/unit/live-preview.test.ts:1869`, `:1896`, `:1924`, `:1953` lock severe PVNA repair, PVNA-before-intra priority, beam overflow tracking, and early intra repair. | Code inference: never increases count of PVNA-over courts; if current has no PVNA-over, rejects candidates above tolerance; improves lexicographic early score; uses single-player and pair swaps across already selected players, so selected set is preserved. |
| `repairEarlyPayloadBatchQualityWithBeam`, `lib/next-round-suggester/live-preview.ts:2072` | `e4f3dfc` `feat(trace): implement manual session trace watcher with status persistence`. | No explicit prod bug/ALGO in commit/TASK found. Code inference only: fallback beam search when local swaps cannot clear early/severe batch quality. | `tests/next-round-suggester/unit/live-preview.test.ts:1924` explicitly names early-round beam search overflow tracking; `:1953` checks early intra repair without exceeding PVNA cap. | Code inference: selected set must be unique and <= `LIVE_EARLY_QUALITY_BEAM_MAX_PLAYERS`; rebuilds complete partition of same selected player set; candidates are filtered to PVNA tolerance, then scored on PVNA-over, intra-over, repeats; only returns if early batch score improves. |
| `repairPayloadBatchRepeatExposure`, `lib/next-round-suggester/live-preview.ts:2622` | `84b5277` first adds it; `14bebf5` later changes scoring/guards in the ALGO 47-50 bundle. | Original commit has no explicit bug/ALGO. Later grounded context from `14bebf5`: ALGO 47/48 pull-from-bench repairs address repeat-3/blowout, while comments say cross-court swaps cannot fix fresh players that are still on the bench. Code inference: this pass is the seated-player-only repeat exposure reducer before the pool pass. | I found no direct test for this private function. Indirect `repairSuggestedPayloadBatch` tests in `tests/next-round-suggester/unit/live-preview.test.ts:1888` etc. focus on PVNA/early quality, not repeat exposure. Marking behavior lock: **KHÔNG CÓ TEST** for this pass specifically. | Code inference: only swaps selected players across payloads; reduces repeat score; rejects increased PVNA-over and rejects crossing tolerance when currently clean; limits max PVNA increase to +0.15; allows at most +1 hard intra and +0.45 max intra. |
| `repairAllIdlePayloadBatchParticipation`, `lib/next-round-suggester/live-preview.ts:2539` | `c4018b8` `fix(suggester): globally repair all-idle participation balance`. `TASK.md` in that commit says "All-idle global participation rescue": real dump line 272, six courts, 32 players, ten rest-required players; CP-SAT proved rest misses 0 and match-count spread 1 optimal; add all-idle-only substitution improving spread 2 -> 1 without dropping rest-required players; keep out of rolling lanes. | Fixes all-idle six-court quality miss where feasible optimal batch had zero rest misses and spread one, but engine returned spread two. No ALGO number found for this commit. | `tests/next-round-suggester/unit/live-preview.test.ts:1780` "repairs all-idle participation spread without dropping rest-required players". | Grounded by TASK plus code: only runs all-idle (`liveCourtIdxs.size === 0` at call-site), full effective batch, >=2 courts; never increases rest misses; prioritizes restMisses, matchSpread, selectedMatchTotal, quality debt, PVNA/intra/repeat; rejects avoid-pair; rejects worse pair counts beyond 1; caps PVNA and intra regression; recomputes `resting`. |
| `repairPayloadBatchSevereRepeatFromPool`, `lib/next-round-suggester/live-preview.ts:2681` | `14bebf5` `feat(suggester): generator + scoring fixes ALGO 47-50 + degraded persistence`. Commit message: "ALGO 47/48: pull-from-bench repairs for multi-court repeat-3 and rolling single-court blowout". Current code comment: greedy per-court multi-court fill can leave repeat-3 while a fresh player is benched; cross-court swaps cannot fix that. | ALGO 47 repeat-3 prod class: multi-court greedy steal leaves stale cluster at a 3rd meeting even though a fresh compatible benched player exists. | `tests/next-round-suggester/unit/live-preview-severe-repeat-pool-repair.test.ts:44`, `:63`, `:77`, `:88`. | Grounded in commit/comment and code: no-op unless payload projected max meeting >=3 and bench exists; incoming can replace outgoing only if at least as owed (`consecutive_rest` higher or matches <= outgoing); rejects avoid-pair; rejects increased PVNA-over and crossing tolerance from clean; rejects increased hard intra; rejects max intra above hard cap/current; strictly reduces repeat-repair score; recomputes `resting`. |
| `repairPayloadBatchBlowoutFromPool`, `lib/next-round-suggester/live-preview.ts:2765` | `14bebf5` `feat(suggester): generator + scoring fixes ALGO 47-50 + degraded persistence`. Commit message: ALGO 47/48 pull-from-bench repairs include "rolling single-court blowout (defer skill-outlier, keep near-level peer)". `TASK.md` current notes ALGO 48 added this pass for session 60d0586b / "sân 3 vòng 3 lệch nhiều". | ALGO 48: rolling single-court owed pool can force a skill outlier into a team-total blowout; pass swaps out the outlier for a near-level filler while keeping a near-level peer for the deferred outlier. | `tests/next-round-suggester/unit/live-preview-blowout-pool-repair.test.ts:32`, `:47`, `:57`, `:64`, `:71`. | Grounded in commit/comment and code: only touches payloads already flagged `degraded_reason === 'blowout'`; stops if gap already <= tolerance; replacement must reduce gap; rejected if avoid-pair, intra gap > hard cap, or it creates a 3rd meeting when current did not have one; deferred player must retain a near-level bench peer; cost prefers within tolerance, fewer repeats, tighter gap; recomputes `resting`. |
| Inline `invariantSafePayloads`, `lib/next-round-suggester/live-preview.ts:5693` | `0394c1c` `fix(suggester): enforce shared rolling invariants across planner and fallback`. `-S invariantSafePayloads` first adds the guard. | Rolling planner/fallback invariant bug: when an active rolling plan target exists, post-pass player substitutions could violate plan caps/checkpoints. Commit message is the grounding; no ALGO number found. | `tests/next-round-suggester/unit/rolling-invariants.test.ts:57`, `:96`; `tests/next-round-suggester/unit/rolling-horizon.test.ts:143`; `tests/next-round-suggester/unit/joint-allocation-integration.test.ts:166` explicitly says "#70 preserved". | Code inference plus tests: if `getActiveRollingInvariantTarget` is active and selected player set differs from original payloads, discard all prior substitution repairs and return original payloads. This preserves selected set/plan quota, but can erase participation/repeat/blowout improvements. It compares selected-player multiset only, not team split. |
| `applyJointRepartition`, `lib/next-round-suggester/live-preview.ts:2844` | `4bb4f45` `feat(joint-alloc): flag-gated joint re-partition in buildSuggestedMatchPayloads`. Commit message: wires `jointRepartition` last against `invariantSafePayloads`, flag-gated by quality-cost model and >=2 payloads, identity when off/single-court/missing court_idx. | Bounded joint allocation Task 2. Later `TASK.md` and `ENGINE_FRAGMENTATION_AUDIT.md` tie this to ALGO 55 within-tolerance-first and note it is part of the post-pass rewrite problem. Commit itself does not name a prod bug; it states the adapter purpose and gate. | `tests/next-round-suggester/unit/joint-allocation-integration.test.ts:80`, `:86`, `:93`, `:149`, `:155`, `:166`. | Grounded in commit/tests: flag-off identity; single-court identity; requires court_idx; preserves seated player set and court_idx; emits `joint`; integration checks total gap not worse than flag-off and #70 selected set unchanged. Code comment says "Never-worse under computeQualityCost"; that is an implementation claim from current code/comment. |
| `normalizeRepairedPayload`, `lib/next-round-suggester/live-preview.ts:2977` | `84b5277` first adds it. Later modifications: `e4f3dfc` adds `REPEAT_CAP_REACHED`; `cb72215` ALGO 56 collapses `clearTradeoffChoices` behavior because stale/preserved choices caused opposite bugs. | Initial purpose: derive warnings/tradeoffs from repaired lineups. Grounded later bug from `cb72215`: four mid-pipeline call-sites wiped `tradeoff_choices` for untouched courts while final call preserved choices made stale by joint; ALGO 56 moved stale handling to `dropStaleDerivedMetadata`. | Direct function is private; no direct grep by name. Indirect locks: `tests/next-round-suggester/unit/live-preview.test.ts:1088` "surfaces an intra-team tradeoff from the exact final lineup"; `tests/next-round-suggester/unit/live-preview-derived-metadata.test.ts:125` locks retention on an untouched repaired batch. | Code inference: recomputes PVNA/intra warnings and tradeoffs from exact current teams; strips old PVNA/intra/repeat warnings before recalculating; sets `approval_required` from tradeoffs; does not change teams/resting. It now leaves derived choice fields alone for `dropStaleDerivedMetadata` to decide. |
| `dropStaleDerivedMetadata`, `lib/next-round-suggester/live-preview.ts:2950` | `cb72215` `fix(suggester): derived metadata must describe the persisted lineup (ALGO 56)`. | ALGO 56: per-court loop built `forced_tradeoff` / `wait_rescue_options` / `tradeoff_choices` before repair/joint. Client seats whatever metadata describes, so stale metadata silently undid ALGO 47/48/55 and could name a player moved to another court. Fuzz: stale 335 -> 0 with joint on, 264 -> 0 with joint off. | `tests/next-round-suggester/unit/live-preview-derived-metadata.test.ts:65`, `:79`, `:92`, `:108`, plus `:125` for untouched-court retention. | Grounded in commit/tests: drops `forced_tradeoff` and `wait_rescue_options` if acceptRepeat lineup does not match seated lineup; drops `tradeoff_choices`/recommendation when the recommended/seated choice no longer describes the seated lineup; treats team swap as same lineup; does not alter teams. |
| `rebuildDerivedMetadataForSeatedLineup`, `lib/next-round-suggester/live-preview.ts:2899` | `98362d4` `feat(suggester): rebuild the tradeoff panel from the lineup actually seated, and count rest in seat misses`. Commit message: ALGO 59 -> 60; passes rewrote 935/1160 payloads, `dropStaleDerivedMetadata` left only 21/458 panels; rebuild from the seated four's alternate splits. | ALGO 60 panel loss after post-pass rewrites: stale panel was correctly dropped in ALGO 56, but host lost too many tradeoff panels. Cheaper repairs were measured and rejected; same-four re-split reaches ~17% and cannot conflict cross-court. | `tests/next-round-suggester/unit/live-preview-rebuild-metadata.test.ts:44`, `:50`, `:60`, `:73`. | Grounded in commit/tests/code: only rebuilds when no valid choices remain at final call-site; offers only the four already on the court; scores with `allowPvnaToleranceOverflow`, `allowIntraTeamGapOverflow`, `allowRepeatOverflow`; avoid partners remain hard via finite `scoreMatch`; pins recommendation to persisted lineup; requires visible over-threshold improvement (`MIN_RESPLIT_IMPROVEMENT`). |

## Overlap

- PVNA / blowout quality overlap: `repairSuggestedPayloadBatch` initial swap, `repairEarlyPayloadBatchQuality`, `repairEarlyPayloadBatchQualityWithBeam`, `repairRoundOnePayloadBatchWithCleanPool`, `repairPayloadBatchBlowoutFromPool`, and `applyJointRepartition` can all improve bad team-total or intra-team PVNA in different scopes.
- Repeat overlap: `repairPayloadBatchRepeatExposure`, `repairPayloadBatchSevereRepeatFromPool`, `applyJointRepartition` through quality-cost, and `rebuildDerivedMetadataForSeatedLineup` all address repeat pressure. The first two rewrite payloads; the metadata rebuild only offers host choices for the seated four.
- Bench substitution overlap: `repairAllIdlePayloadBatchParticipation`, `repairPayloadBatchSevereRepeatFromPool`, and `repairPayloadBatchBlowoutFromPool` all change who plays by pulling from currently unselected eligible players; they differ by objective: participation spread, repeat-3, blowout outlier.
- Final metadata overlap: `normalizeRepairedPayload`, `dropStaleDerivedMetadata`, and `rebuildDerivedMetadataForSeatedLineup` all operate after lineup rewrites. `normalize` recalculates warnings; `dropStale` removes dangerous stale decisions; `rebuild` creates a safe replacement panel.
- Hard override overlap: inline `invariantSafePayloads` can discard the selected-player changes from participation/repeatPool/blowoutPool before joint runs.

## Unique Constraints Not Covered Elsewhere

- `repairAllIdlePayloadBatchParticipation`: the only pass explicitly optimizing all-idle rest misses and projected match-count spread from an unselected bench pool, and the only one grounded by CP-SAT optimality in `TASK.md`.
- `repairPayloadBatchSevereRepeatFromPool`: the only pass that can fix repeat-3 by bringing in a fresh benched player while refusing to bench a more-owed player.
- `repairPayloadBatchBlowoutFromPool`: the only pass that requires a deferred skill outlier to keep a near-level peer on the bench, avoiding stranding a lone outlier.
- Inline `invariantSafePayloads`: the only final guard that can preserve active rolling-plan selected-player invariants by reverting earlier substitution repairs wholesale.
- `dropStaleDerivedMetadata`: the only pass that prevents client metadata from seating a dead lineup or double-booking a moved player.
- `rebuildDerivedMetadataForSeatedLineup`: the only pass that restores a host-visible panel after stale metadata is dropped without changing who plays.
- `normalizeRepairedPayload`: the only pass that recalculates warning/tradeoff fields from the exact final lineup after all rewrites.

## Passes With No Direct Test Found

- `repairPayloadBatchRepeatExposure`: **KHÔNG CÓ TEST** isolating this private repeat-exposure swap pass; only broader `repairSuggestedPayloadBatch` tests were found, and those focus on PVNA/early quality.
- `repairSuggestedPayloadBatch` initial cross-court PVNA swap: **KHÔNG CÓ TEST** found for the original simple swap behavior from `84b5277`; later wrapper behavior is covered by broader tests.
- `normalizeRepairedPayload`: **KHÔNG CÓ TEST** by function name because it is private; warning derivation is indirectly covered, but the normalization pass itself is not isolated.

## Correction: one "unique constraint" is dead code (verified 2026-08-10)

The inventory credits `repairPayloadBatchRepeatExposure` with refusing to cross tolerance while the
board is clean. That guard cannot fire. It sits immediately after the guard that already subsumes it,
at three separate copy-pasted sites (`live-preview.ts:2283-2284`, `:2646-2647`, `:2730-2731`):

```ts
if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
if (currentStats.pvnaOver === 0 && candidateStats.maxPvna > pvnaTolerance) continue
```

`pvnaOver` counts courts whose gap exceeds tolerance and `maxPvna` is the largest gap, so whenever the
second condition holds — no court over tolerance now, some court over tolerance in the candidate — the
candidate has at least one court over and the first guard has already rejected it. The second line can
never reject anything the first does not.

Found by trying to write a test that locks it: the test passed with the guard removed. A test that
cannot fail is worse than no test, so it was deleted rather than committed. The empirical result and the
reading agree, which is why this is recorded as a finding rather than a suspicion.

For P2-2 this is one less constraint to carry into the merged optimizer, and one less place where three
copies of the same rule can drift apart. Removing the three dead lines is behaviour-neutral but was left
out of today's changes, since three deploys had already gone out and a no-op edit to live-preview.ts is
not worth the churn.

**Still untested, still needing a lock before the merge:** the cross-court PVNA swap in
`repairSuggestedPayloadBatch`, and `normalizeRepairedPayload`.

## Checking the "unique constraints" one by one (2026-08-10)

The list of seven was taken on trust once and one entry turned out to be unreachable, so the rest are
being read individually. Three done.

**1. Clean-board tolerance guard in `repairPayloadBatchRepeatExposure` — NOT REAL.** Dead code, see the
correction above.

**2. Near-level peer in `repairPayloadBatchBlowoutFromPool` — REAL, and easy to lose.** Two functions
answer almost the same question under nearly the same name. `hasNearLevelPeerInActiveRoster` asks
whether anyone in the active roster is close in rating; the closure inside blowoutPool asks whether the
bench *after the swap* still holds someone close, counting the player just displaced. Only the second
answers the question that matters — whether the benched outlier will have anyone to play with next
round — because the roster-wide version is satisfied by players currently busy on other courts. That is
the exact situation that produced this pass (session bbf721bd: five weaker players in the roster, all
busy when the last court was filled). Substituting the roster-wide version during a merge would silently
undo it.

**3. Owed-player guard in `repairPayloadBatchSevereRepeatFromPool` — REAL, and its absence next door is
already a known bug.** `mayReplace` allows a bench player in only if they are at least as owed a turn as
the player going out: rest recovery first, then fewer matches played. `repairPayloadBatchBlowoutFromPool`
pulls from the bench with no such guard — which is BUG #18 / P0-4 in the audit, still open, reached here
from a different direction.

Two consequences for P2-2:
- Merging the three bench-substitution passes **fixes P0-4 by construction**, since they would share one
  guard instead of one of them having it. That turns an open HIGH item into a side effect of the merge.
- `mayReplace` ranks on `consecutive_rest`, the counter frozen until the P0-7 migration landed on
  2026-08-09.

  **Correction, same day.** The first version of this note said every player read 0 and the guard was
  therefore inert. That is wrong, and production says so: of 5657 player-state rows, 1405 carry
  `consecutive_rest >= 1`, up to 6. The counter was frozen, not empty — it holds whatever value it had
  reached the last time the round-complete gate fired for that session.

  The damage is subtler than being inert and worse to reason about. Inside sessions currently playing:
  988 active players, 194 with `consecutive_rest >= 1`, **maximum 2**, while the average player has
  already played **4 matches**. The counter advanced a couple of times early, when rounds still finished
  cleanly, then stopped as the courts drifted out of step. So the guard has been ordering players by a
  number that is real but badly out of date, which is harder to spot than a column of zeros.

  Any before/after comparison of bench substitution predating that migration is measuring a guard fed
  stale input, not a guard running blind.

Still to check: participation's rest-miss objective, the rolling-plan invariant guard, and the two
metadata passes (`dropStaleDerivedMetadata`, `rebuildDerivedMetadataForSeatedLineup`).

## Production firing rates

Checked 2026-08-10 against code first, before querying prod.

Instrumentation path in current code:

- `buildSuggestedMatchPayloads` wraps `options.onInstrumentEvent` into `onRepairInstrument`, emitting
  `{ event: 'repair', detail, court_count, available }`.
- The edge function writes those events to `public.engine_instrumentation` with columns
  `session_id`, `event`, `detail`, `court_count`, and `available`.
- `debug_dumps` does not receive a top-level event list. The only code path that copies the in-memory
  event list into a dump is `payload.slow_diagnostic.engine_instrumentation_events`, and only when a
  slow diagnostic payload exists.
- `repairAllIdlePayloadBatchParticipation` can emit `detail = 'participation'`, but only if it changes
  the batch, survives the invariant guard, and is not masked by a later repeat/blowout-pool change in
  the final `else if` chain.
- `repairPayloadBatchBlowoutFromPool` has no distinct `blowoutPool` label. If it changes and survives
  the invariant guard, the code emits `detail = 'swap'`, which is ambiguous with the earlier
  cross-court swap repair.
- Inline `invariantSafePayloads` emits no event at all. When it reverts a selected-player change, it
  also suppresses the final participation/repeat/blowout-pool label because the final label block
  requires `invariantSafePayloads === blowoutPoolRepairedPayloads`.

Result: existing labels are not sufficient to confirm all three requested paths. `participation` is at
best a lower-bound label; `blowoutPool` is indistinguishable from generic `swap`; `invariantSafePayloads`
is unobservable in current dumps/instrumentation.

Read-only prod query prepared and attempted via Supabase Management API project
`mzqsxgfvtgmsscbqugni`, token `~/.supabase/access-token`, script
`scratch/post-pass-prod-readonly.ts`. Execution did not reach prod because outbound network from this
workspace is blocked (`node fetch`: `EACCES`; PowerShell `Invoke-WebRequest`: unable to connect).
Therefore there are no production counts from this run.

Queries prepared for the 60-day check:

```sql
select
  count(*) as dump_rows_60d,
  count(*) filter (where payload ? 'engine_instrumentation_events') as dump_rows_with_top_level_engine_events,
  count(*) filter (where payload #> '{slow_diagnostic,engine_instrumentation_events}' is not null) as dump_rows_with_slow_diagnostic_engine_events
from public.debug_dumps
where created_at >= now() - interval '60 days';
```

```sql
with dump_events as (
  select d.id, d.session_id, d.created_at, ev->>'event' as event, ev->>'detail' as detail
  from public.debug_dumps d
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(d.payload #> '{slow_diagnostic,engine_instrumentation_events}') = 'array'
        then d.payload #> '{slow_diagnostic,engine_instrumentation_events}'
      else '[]'::jsonb
    end
  ) ev
  where d.created_at >= now() - interval '60 days'
)
select event, detail, count(*) as event_count, count(distinct id) as request_count,
       min(created_at) as first_seen, max(created_at) as last_seen
from dump_events
where event in ('repair', 'joint')
   or detail in ('swap', 'early', 'repeat', 'participation', 'joint')
group by event, detail
order by event_count desc, event, detail;
```

```sql
select event, detail, count(*) as event_count,
       count(distinct session_id || '|' || date_trunc('second', created_at)::text) as approximate_request_count,
       min(created_at) as first_seen, max(created_at) as last_seen
from public.engine_instrumentation
where created_at >= now() - interval '60 days'
  and (event in ('repair', 'joint') or detail in ('swap', 'early', 'repeat', 'participation', 'joint'))
group by event, detail
order by event_count desc, event, detail;
```

Per requested pass:

- `repairAllIdlePayloadBatchParticipation`: not confirmed on prod in this run. If
  `payload.slow_diagnostic.engine_instrumentation_events` exists, `detail = 'participation'` can count
  only surfaced/surviving participation repairs, not all actual function changes.
- `repairPayloadBatchBlowoutFromPool`: not confirmable from existing labels. The surviving-change label
  is `detail = 'swap'`, shared with the generic cross-court swap pass.
- `invariantSafePayloads` (#70): not confirmable from existing labels. The guard has no positive or
  negative instrumentation event, and prod currently passes `rollingPlanTarget: null` while rolling
  policy is disabled.

Needed before this can be answered from production data: add distinct instrumentation details such as
`participation`, `blowoutPool`, and `invariantGuardRevert` into both durable instrumentation and the
debug dump payload, preferably with `suggestion_request_id` so request counts are exact rather than
approximated from timestamp/session.

P2-2 retire evidence from current production data: none. These three paths are not proven dead by prod
data available through current instrumentation.

## Constraint check, final tally (2026-08-10)

Seven claimed constraints, each read individually rather than taken on trust. One was not real.

| # | constraint | verdict |
|---|---|---|
| 1 | clean-board tolerance guard, `repairPayloadBatchRepeatExposure` | **NOT REAL** — dead code, subsumed by the line above it |
| 2 | near-level peer on the bench, `repairPayloadBatchBlowoutFromPool` | REAL — and easy to lose to the similarly-named roster-wide version |
| 3 | owed-player guard, `repairPayloadBatchSevereRepeatFromPool` | REAL — its absence next door is BUG #18 |
| 4 | rest-miss objective, `repairAllIdlePayloadBatchParticipation` | REAL, but its trigger reads `consecutive_rest`, frozen until 2026-08-09 |
| 5 | rolling-plan invariant, `invariantSafePayloads` | REAL **but dormant**: `getActiveRollingInvariantTarget` returns null while rolling-plan is off, which it is |
| 6 | stale-metadata guard, `dropStaleDerivedMetadata` | REAL — nothing else compares metadata against the seated lineup |
| 7 | panel rebuild, `rebuildDerivedMetadataForSeatedLineup` | REAL — nothing else creates `tradeoff_choices` after the passes run |

## The instrumentation cannot answer "is this pass dead" (2026-08-10)

Retiring a pass in P2-2 was going to be justified by production firing rates. It cannot be, and the
blocker is the instrumentation rather than access to the data (`live-preview.ts:5700-5715`):

```ts
if (blowoutPool changed && invariantSafe === blowoutPool) onRepairInstrument?.('swap')
else if (repeatPool changed && ...)                        onRepairInstrument?.('repeat')
else if (participation changed && ...)                     onRepairInstrument?.('participation')
```

Three problems compound:
- `blowoutPool` reports under `'swap'`, the same label the cross-court swap uses, so the two cannot be
  told apart.
- `invariantSafePayloads` emits nothing at all, and when it reverts, `invariantSafe === blowoutPool`
  goes false and **suppresses all three of the other labels**.
- The chain is `if / else if / else if`, so a batch reports at most one label even when several passes
  acted. participation is masked whenever blowoutPool also fired.

So the §7.11 finding that three passes "never fired" in simulation cannot be promoted to a production
claim, and no amount of dump data would change that. **No pass currently has the evidence needed to
retire it.**

What would fix it: a distinct label per pass (`blowoutPool`, `invariantGuardRevert`), emitting
independently rather than in an else-chain, and a request id in the dump so firings can be counted per
request. That is a small, behaviour-neutral instrumentation change, and it has to land and collect a few
days of production data before the retire half of P2-2 can be argued at all.

## Ablation: turn each pass off and replay the corpus (2026-08-10)

Firing rates were the wrong question. "Did this pass run" cannot be answered by the instrumentation, and
it would not settle anything anyway — a pass that runs and changes nothing is as retirable as one that
never runs. The answerable question is: **turn it off and does the board come out different?**

Getting a trustworthy answer needed the harness fixed first. Two runs of identical code differed by up
to 1.4 points, the same size as the effects being measured, because the search is bounded by wall-clock
deadlines and moves with CPU load. Raising the budgets did not help — there are several independent
deadlines and `suggest.ts` reads `Date.now()` directly. Freezing `Date.now` and `performance.now` in the
harness makes every `now >= deadline` false, so the search runs to its iteration caps instead. Two runs
then match to the digit. Determinism also made a large sample unnecessary: without noise, any difference
is real, so 20 sessions answer the question that 60 noisy ones could not. It also made parallel runs safe
again, since load no longer changes results.

Boards are compared by hashing every seated lineup, not just the quality averages — a pass can move
players around while the aggregates stay put, and that is a different verdict from doing nothing.

**Legacy model (flag OFF — what most of production runs), 20 sessions, 1008 matches:**

| pass ablated | board |
|---|---|
| participation, repeatPool, blowoutPool, repeatExposure, joint | **identical, hash `5eae564d4f2e`** |

Every one of the five is a complete no-op. Not "similar quality" — the same players, in the same teams,
on the same courts, in all 1008 matches. `joint` is inert here by construction, since it returns early
when the cost model is off, but the other four are not.

**Quality-cost model (flag ON), same corpus:**

| pass ablated | board | effect |
|---|---|---|
| participation, repeatPool, blowoutPool, repeatExposure | identical, hash `2509833cbdaa` | none |
| `applyJointRepartition` | hash `c02990026aad` | real change, see below |

**`applyJointRepartition` lowers its own objective while worsening everything else:**

| | joint on | joint off |
|---|---|---|
| avg cost | **2.4826** | 2.5590 |
| over-tolerance | 10.91% | **9.82%** |
| repeat-3 | 13.59% | **13.19%** |
| blowout | 2.58% | **1.98%** |
| intra > 1.0 | 26.59% | **24.80%** |

It succeeds at the job it was given — cost drops when it runs — and every measure a host would
recognise gets worse: more courts past tolerance, more third meetings, more blowouts, more stacked
teams. This is the same disease caught in the gender-gap investigation, where the quadratic
`balanceOver * over²` made crossing tolerance nearly free; ALGO 55 patched that with within-tol-first,
and in aggregate the symptom is still here.

**What this means for P2-2.** The merge is far smaller than planned: on the legacy path nothing to
merge changes anything, and on the cost path only `joint` does. But `joint` needs its own investigation
first — if turning it off improves four metrics out of five, the question is not how to merge it.

**Limits, stated plainly.** 20 corpus sessions, replayed state (players start fresh, nobody opted out,
nobody checked out), so trigger conditions that depend on session history may never arise here. The
passes are entered — counted at 5 to 222 calls each — so this is "runs and declines to act", not "never
called". And the cost model is a canary flag in production today, so the flag-ON column describes a
path most sessions do not take yet. None of this is grounds to delete a pass; it is grounds to stop
assuming the chain earns its complexity.
