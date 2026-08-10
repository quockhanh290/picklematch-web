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

### Why joint hurts: locally never-worse, globally harmful (2026-08-10)

The ablation and the ALGO 55 guarantee appeared to contradict each other. ALGO 55 made
`jointRepartition` return a board whose over-tolerance count never exceeds its input, yet turning joint
on raises session-wide over-tolerance from 9.82% to 10.91%.

Both are true. Instrumenting every call over the corpus:

```
JOINT: calls=20, worse=0, better=0, same=20
```

Twenty calls, and the over-tolerance count is unchanged in every one. The guarantee holds exactly as
designed. The damage is **path-dependent**: joint rewrites the lineups of the opening board, which
changes partner and opponent counts and the projected state, so every single-court refill afterwards
plays out differently, and the accumulated difference is worse.

It fires **once per session** — 20 calls across 20 sessions — because it needs two or more courts and
every refill after the opening board is a single court. So one decision at setup propagates through the
whole session.

No per-request guard can catch this. Never-worse-within-a-request is exactly what joint promises, and
that promise is kept; the entire safety argument is local while the cost is sequential. Any pass that
reshuffles players across courts has the same exposure, which is worth knowing before P2-2 designs a
merged optimizer around per-request invariants.

Caveat: 20 sessions is one deterministic sample, not a distribution. What raises confidence is that four
independent metrics — tolerance, repeat-3, blowout, stacked teams — all move the same direction, which
is unlikely to be coincidence. Confirming it properly needs several disjoint corpus slices.

### RETRACTION: joint is not reliably harmful — the sample was (2026-08-10)

The section above says `applyJointRepartition` lowers its own cost while worsening every other metric.
**That is withdrawn.** It held on the twenty sessions that happened to be sampled and does not
generalise. Three disjoint slices, joint on versus off, counting how many of four metrics improve when
it is turned off:

| slice | matches | metrics better with joint OFF |
|---|---|---|
| sessions 1-20 | 1008 | **4 of 4** ← the original sample |
| sessions 21-40 | 1024 | **1 of 4** (joint is better on three) |
| sessions 41-60 | 1056 | 2 of 4 |

One slice out of three supports the claim. The caveat written alongside the original numbers — "one
deterministic sample, not a distribution" — turned out to be the whole story, and the argument that four
metrics moving together made coincidence unlikely was wrong: they move together *within* a slice because
they are not independent, being computed from the same boards.

**What survives, and it is the more useful half.** The mechanism is still measured and still true: joint
never increases the over-tolerance count on the request that runs it (20 of 20 calls unchanged), yet the
session it opens finishes differently. What the slices add is that the direction of that difference is
**not stable** — joint helps some session mixes and hurts others, and nothing in its per-request
guarantee predicts which.

For P2-2 that is a sharper conclusion than "joint is bad". A pass can be provably never-worse per
request and still move session outcomes either way, so **per-request invariants cannot justify a pass,
and cannot condemn one either**. Any merged optimizer needs session-level evaluation across several
disjoint slices before its value can be claimed at all. One slice proves nothing, including when it
agrees with you.

### Why the passes decline, and why that weakens the ablation (2026-08-10)

The four passes that changed nothing are entered and then decline. Counting where participation exits:

```
WHY: {"participation:bail_no_need": 20}
```

Twenty calls, twenty exits at the same check — no player owed rest recovery was left out, and the
projected match-count spread was at most 1. It is not blocked by a strict guard; it looks at the board
and finds it already fair.

The reason the board is always fair is the problem. The corpus filter excludes every session where
anyone checked out:

```ts
.filter(sid => !(rBySid[sid] || []).some(r => r.co != null))
```

and the replay starts every player at zero matches. Between them, that removes exactly the conditions
`repairAllIdlePayloadBatchParticipation` exists for — players joining late, leaving early, and the
participation spread that follows.

So "these passes are no-ops" has to be narrowed: on clean sessions with a stable roster they contribute
nothing, which is not the same as contributing nothing. The corpus was selected for replay fidelity, and
that selection quietly excluded the messy sessions where several of these repairs were introduced to
help.

Before any of them can be retired, the corpus needs sessions with checkouts and mid-session joins, or a
harness that injects them. Until then the ablation supports a narrower claim: **on stable-roster
sessions, four of the five passes are inert on both scoring models** — worth knowing, and not grounds
for deletion.

### Correction, and a pressure test the finding survives (2026-08-10)

**Correction first.** The section above blames the corpus filter for excluding sessions with checkouts.
That is wrong, and it was reached by reading the filter instead of counting the data. Of 2215 roster rows
across the 60 sessions: **zero checkouts, zero opt-outs**. The filter excludes nothing; the corpus simply
never contained that data.

The real bias is different and larger. Bench depth across the corpus is **minimum 8, median 12, maximum
16** — never once tight. Bench depth was already measured, earlier in this work, as the variable that
decides whether the two scoring models diverge at all. Every measurement built today — the scorecard
baselines, both ablations, the three slices used to retract the joint finding — ran on sessions with
room to spare.

**Pressure test.** Trimming the roster to `courts*4 + n` and re-running with all four idle passes
disabled at once:

| bench | matches | boards |
|---|---|---|
| 0 | 1008 | **identical** |
| 2 | 1008 | **identical** |
| 4 | 1008 | **identical** |

The finding survives. The four passes are inert not only on roomy sessions but at exact fill, which is
the hardest case they exist for. That is a considerably stronger claim than the one made before.

**What is still untested:** churn. Trimming produces a thin bench but a stable roster, and nobody joins
late, leaves early, or opts out. `repairAllIdlePayloadBatchParticipation` exists for participation spread
that builds up through churn, and no amount of bench trimming creates that.

**Worth noting separately:** at bench 0 the repeat-3 rate is **72.62%** — nearly three matches in four
involve a third meeting between the same players. Exact-fill sessions are brutal for repeats regardless
of which passes run, which is the structural version of the complaint hosts raise about late-session
rematches.

### participation is structurally dead in rolling play (2026-08-10)

Adding churn to the harness — three players leaving and three fresh ones arriving after round three, so
veterans carry three matches and newcomers none — did not wake `repairAllIdlePayloadBatchParticipation`.
It still exits at `bail_no_need` every time. The reason is its call condition
(`live-preview.ts:5675-5679`):

```ts
const participationRepairedPayloads = liveCourtIdxs.size === 0
  && repairedPayloads.length === effectiveCount
  && effectiveCount >= 2
  ? repairAllIdlePayloadBatchParticipation(...)
  : repairedPayloads
```

It requires **no court to be running**. In rolling play that is true exactly once, at the opening board,
when every player has zero matches and the participation spread it looks for is zero by construction.
Every refill afterwards has live courts, so it is never called again.

So this pass is not idle because the corpus is easy. It is written for full-board suggestion and invited
in only at the one moment it is guaranteed to have nothing to do. No amount of churn changes that — the
spread appears at round three and its door closed at round one.

This does not depend on the corpus, which makes it the strongest conclusion about any of these passes so
far. Two options follow, and they are different work: retire it, or move the call to where spread
actually exists — the single-court refill path, which would mean rewriting it, since it is built around
having the whole board to rearrange.

The audit credits it with being "the only pass optimising all-idle rest misses and projected match-count
spread, and the only one grounded by CP-SAT optimality". Both are true of the code, and neither matters
while it runs only when the board is empty.

### Call conditions decide more than the pass bodies do (2026-08-10)

Reading the four call sites rather than the function bodies, in the order the chain runs:

| pass | gate | consequence in rolling play |
|---|---|---|
| participation | `liveCourtIdxs.size === 0` | **structurally dead** — only the opening board, where spread is 0 by construction |
| repeatPool | `payloads.length >= 2` | opening board, or a refill covering two or more courts |
| blowoutPool | bench recomputed with no court-count gate | runs on single-court refills too, deliberately |
| repeatExposure | inside `repairSuggestedPayloadBatch` | runs on every batch |

The distinction between the first two matters and is easy to blur. participation needs a completely
empty board, which in a rolling session happens once, at the start, when nobody has played and the
participation spread it looks for cannot exist. repeatPool needs only two or more courts in one request,
which does happen in production when several courts finish together — four of the twelve production
dumps are multi-court requests. So participation is dead by construction; repeatPool is merely rare, and
rare in a way the replay corpus makes look like never, since every refill there is single-court.

blowoutPool is the counter-example that shows this was thought about: its bench is recomputed
independently precisely so it can act on a single-court refill, and the comment above it says so.

The lesson for P2-2 is that the merge cannot be reasoned about from the pass bodies alone. Two of these
passes contribute nothing in rolling play not because their logic declines but because they are asked at
the wrong moment, and a merged optimizer that runs on every request would give both of them a voice they
have never had. That is a behaviour change disguised as a refactor, and it is exactly the kind that
would not show up as a failing test.

### Part of the "overlap" is an escalation ladder, not duplication (2026-08-10)

The inventory lists six passes that can all improve team or intra-team PVNA and files that under
overlap. Reading how they call each other, three of them are stages of one escalation rather than
parallel attempts at the same job (`live-preview.ts:2275-2336`):

```ts
let current = repairRoundOnePayloadBatchWithCleanPool(...)   // round-one special case first
... four hill-climb passes ...
if (currentStats.pvnaOver === 0 && currentStats.intraOverHard === 0) return current
return repairEarlyPayloadBatchQualityWithBeam(...)           // only when the cheap steps failed
```

The beam variant runs **only if** the cheaper hill-climb left a court over tolerance or badly stacked.
That is a deliberate cost ladder — try cheap, escalate when it did not work — and the entry point has a
gate of its own: `allowEarlyQualityRepair` is `payloads.length >= openCourtIdxsForBatch.length`, with an
`|| hasSeverePayloadPvnaOutlier(...)` escape so a genuinely lopsided court is always repaired even when
the batch is partial.

This matters for how P2-2 is framed. "Six passes doing the same thing" overstates it: some of the six
are one pass with three levels of effort. Collapsing them into a single optimizer would not remove
duplicated logic so much as remove the ability to stop early, which is what keeps the common case cheap.
The audit's overlap table should be read as a starting point, not a specification.

What remains genuinely overlapping after this reading is the bench-substitution group — participation,
repeatPool, blowoutPool — which really are three answers to one question, differing only in objective.
That group is still the right first merge, and it is now the only one this evidence supports.

### CORRECTION: both gates open far more often than the replay suggested (2026-08-10)

The two entries above call participation "structurally dead" and repeatPool "rare". Measured against
4035 production requests over 60 days:

```sql
count(*) filter (where jsonb_array_length(payload->'occupied_live_court_idxs') = 0)  -- participation's gate
count(*) filter (where (payload->>'target_expected_count')::int >= 2)                -- repeatPool's gate
```

| gate | opens | share |
|---|---|---|
| board completely empty | **568** | **14.1%** |
| two or more courts in one request | **1599** | **39.6%** |
| single-court refill | 2436 | 60.4% |

Both claims were wrong. participation is offered 568 chances, not one per session; repeatPool at 39.6%
is not rare by any reading.

The error was reading a property of my own harness as a property of the system. The replay loop refills
one court at a time by construction, so an empty board only ever occurs at its start — and I turned that
into a claim about rolling play. Production empties the board regularly: every court finishing together
between rounds, or a host resetting it.

**What survives, and it is now the sharper question.** Across those 568 chances the pass is entered and
exits at `bail_no_need` every time in replay. So the question is no longer whether it is ever invited.
It is whether a board that arrives with no courts running is simply already fair — in which case the
pass is redundant — or whether its trigger is too narrow to notice unfairness that is really there. That
is unanswered, and answering it needs the entry and exit counted in production, which the current
instrumentation cannot do.

Method note for anything downstream: the replay corpus and the production request mix differ in shape,
not just in size. 60% of production requests are single-court refills and 14% arrive on an empty board;
the harness produces one empty board per session and single courts thereafter. Any claim about how often
something fires has to come from `debug_dumps`, not from the replay.

### The open question, answered from production: participation has real work to do (2026-08-10)

The question left hanging was whether a board arriving with no courts running is simply already fair, or
whether the participation trigger is too narrow to see unfairness that is there. Neither: the boards are
unfair and the trigger sees it.

Across production dumps from empty-board requests that carry player state, measuring
`max(matches_played) - min(matches_played)` over players still checked in — the same quantity the pass
tests as `projectedSpread`:

| | dumps | share |
|---|---|---|
| spread ≤ 1 (pass would bail) | 305 | 12% |
| **spread ≥ 2 (pass proceeds)** | **2213** | **88%** |
| average spread | 2.04 | |
| worst spread | 4 | |

On 88% of the requests where it runs, the condition it exists for is met. It is not redundant, and its
trigger is not too narrow.

**So the replay result was backwards.** In replay the pass bails every single time, because every player
starts at zero matches and the spread never accumulates. Production has late arrivals, early departures
and opt-outs, and by the time the board next empties the spread averages two full matches. The corpus
cannot produce the state this pass exists for, so it measured the pass at the one moment it has nothing
to do and reported that as its nature.

**participation should not be retired.** That reverses the direction three earlier entries were heading,
and the reversal came from production data rather than a better replay — which is the pattern for
everything in this file. Of the passes examined, none now has evidence supporting deletion; what the
evidence supports is that the replay corpus is the wrong instrument for this particular question.

### The harness never asked the question (2026-08-10)

Three separate conclusions in this file — "idle because the corpus is easy", "structurally dead in
rolling play", "trigger too narrow" — were all drawn from the same observation: participation exits at
`bail_no_need` every time in replay. All three were wrong, and the explanation is simpler than any of
them. The harness never gave it a chance to do anything.

Three things were missing, and each had to be measured to find:

| missing | why it mattered |
|---|---|
| uneven court pacing | the replay completed courts in strict order, so participation spread never accumulated; production averages 1.84 at the same bench depth and court count |
| a mid-session empty board | the replay had exactly one empty board, its first, when nobody had played and the spread is zero by definition |
| full-board refill | an empty board was being refilled court by court, so the request never had `liveCourtIdxs.size === 0` |

With all three, participation goes from 10 calls and 0 useful ones to **50 calls, 15 of which proceed**.
Any two of the three still leave it silent, which is why each earlier attempt looked like confirmation.

Production sees an empty board on 568 requests, 14% of the total, most of them mid-session with an
average spread of 2.04. The harness asked once, at zero.

**The lesson, and it applies to everything measured today:** when a component is silent, that is
evidence about the instrument before it is evidence about the component. Each time this file concluded
a pass does nothing, the honest next step was to ask what the harness would have to do for that pass to
act at all, and check whether it does it.

Everything the ablations concluded about `participation` and `repeatPool` is void — both were judged by
a harness that never presented their conditions. The `blowoutPool` and `repeatExposure` results stand,
since those run on single-court refills which the harness does produce. Re-running the ablation on the
corrected harness is the next step, and its numbers are the first ones about these two passes worth
quoting.

### Ablation, re-run on the corrected harness (2026-08-10)

With uneven court pacing, a periodic full-board drain, and empty boards refilled in one request:

| pass ablated | board | cost | over-tol | repeat-3 | blowout |
|---|---|---|---|---|---|
| — (baseline) | `8053bb90` | 1.5194 | 3.27% | 3.08% | 0.50% |
| participation | **differs** | 1.5762 | 3.27% | **3.37%** | **0.60%** |
| repeatPool | **differs** | 1.4402 | **3.57%** | **3.47%** | 0.50% |
| blowoutPool | identical | — | — | — | — |
| repeatExposure | identical | — | — | — | — |

**participation and repeatPool both contribute.** Turning either off raises repeat-3, and turning off
participation also raises blowouts. The earlier "no-op" verdict on both was entirely an artefact of the
harness.

**blowoutPool and repeatExposure remain inert**, and that verdict stands: both run on single-court
refills, which the harness produced correctly all along, so their silence was never in question.

repeatPool shows the shape of a real trade: disabling it *lowers* cost, to 1.4402 from 1.5194, while
raising over-tolerance and repeat-3. It is spending the cost objective to buy the things a host notices
— the opposite of what was suspected of joint earlier in this file.

**Unresolved and possibly larger than P2-2.** The baseline itself moved enormously: repeat-3 from 13.6%
to 3.1% and over-tolerance from 10.9% to 3.3%. The only difference is that the board is drained and
refilled as a whole every two rounds rather than refilled one court at a time. If periodic full-board
planning is really worth that much, it dwarfs anything discussed today. Three things changed at once
here, so this is a hypothesis and not a result; it needs its own clean test with only the drain varied.

### The largest result of the day is not a pass at all (2026-08-10)

Isolating the three harness changes, one variable at a time, 20 sessions each:

| configuration | repeat-3 | over-tolerance | cost |
|---|---|---|---|
| as before | 13.59% | 10.91% | 2.4826 |
| **drain only** | **3.08%** | **3.27%** | 1.5194 |
| uneven pacing only | 13.59% | 10.91% | 2.4826 |
| all three | 3.08% | 3.27% | 1.5194 |

The entire improvement comes from the drain. Uneven court pacing contributes exactly nothing — my model
of it was a no-op and should not be credited with anything.

**Draining means emptying the board and refilling it in one request every two rounds, instead of
refilling each court as it frees up.** Repeat-3 falls from 13.6% to 3.1% and over-tolerance from 10.9%
to 3.3%. That is more than a fourfold reduction in the thing hosts complain about most, and it needs no
engine change whatsoever — the engine is the same, it is only being *asked* differently.

This confirms with numbers a hypothesis recorded much earlier: that repeats are structural to
rolling-lane refill, where each request sees only a small idle pool, and that only round-level planning
helps. What the measurement adds is that it does not require a solver — asking for the whole board
periodically is enough.

**The cost is real and this harness does not measure it.** Draining means courts sit idle while the
slowest match finishes. The 4x quality gain is bought with waiting, and how much waiting depends on how
uneven real match durations are. A host who hates empty courts may refuse this trade outright; a host
who hates rematches may take it happily. That makes it a product decision, and one worth putting in
front of them with both numbers, not an optimisation to apply quietly.

Next step if it is pursued: measure the idle-court cost from production match durations, so the trade
can be stated as "x% fewer rematches for y seconds of average court idle time" rather than as a
one-sided quality win.

### The cost of draining, and a cheaper idea that could not be tested (2026-08-10)

Draining buys its 4x cut in repeat-3 with idle courts, so the trade needs both numbers. Measured over
323 real rounds, taking each round's slowest match minus its fastest:

| wait for the last court | rounds | share |
|---|---|---|
| under 1 minute | 165 | **51%** |
| 1 to 3 minutes | 64 | 20% |
| 3 to 10 minutes | 42 | 13% |
| **over 10 minutes** | **52** | **16%** |

median 0.9 min · p75 4.3 min · p90 **16.2 min**

The mean of 5.9 minutes is misleading; half of all rounds would wait under a minute. The problem is
entirely in the tail — one round in six has a straggler past ten minutes, and with six courts that is
over fifty court-minutes standing empty. So a blanket drain is the wrong shape: it should batch when
courts finish together and give up waiting when one match runs long.

**The cheaper idea, untested.** If most of the gain comes simply from asking about several courts at
once, it could be had for free by batching whichever courts happen to be idle together, waiting for
nobody. Measuring that returned numbers identical to per-court refill at every batch size — and that
result is void. Instrumenting the harness shows `idle` is 1 on 217 occasions and 0 on 31, never more:
the replay loop completes one court and refills it immediately, so simultaneous idleness never arises
and the batching branch never ran. Identical numbers here mean untested, not ineffective.

Testing it needs match durations in the harness so courts can finish close together or far apart. The
production distribution above is exactly the input for that, and it is the next thing to build.

**Fourth time today** that harness silence was nearly read as a fact about the engine. The pattern is
consistent enough to state as a rule: before concluding that something has no effect, confirm the code
path executed at all.

### RETRACTION: the idle-cost numbers are built on unusable data (2026-08-10)

The wait distribution above — median 0.9 minutes, p90 16.2, 51% of rounds under a minute — is
**withdrawn**. It was computed from matches whose duration fell between 1 and 90 minutes, and that
filter discards most of the data:

| completed matches | 4912 |
|---|---|
| duration **under 1 minute** | **3407 (69%)** |
| over 90 minutes | 51 |
| median duration, unfiltered | **0.4 minutes (24 seconds)** |

No pickleball match lasts 24 seconds. `started_at` and `ended_at` are not recording how long a match
took; the likeliest reading is that both are stamped when the host enters the score, so they sit close
together regardless of play. Whatever they mean, it is not duration.

So the 323 rounds sampled are the 31% that survived a filter designed around an assumption the data does
not support — a biased subset reported as if it described reality. The filter was chosen to remove
outliers and instead removed the majority.

**Two consequences.** The idle-court cost of draining is currently **unmeasurable**, so the trade behind
the 4x repeat-3 improvement cannot be stated, and the drain proposal cannot be evaluated as a trade at
all. And adding match durations to the harness, which was the next planned step, cannot be done from
this data.

Measuring it needs a different source: either a client-side timestamp for when play actually starts, or
observing a live session directly. Until then the drain result stands only as "quality improves a lot if
you are willing to wait", with the waiting unquantified.

## Two bugs found in the data itself (2026-08-10)

Looking for match durations turned up two defects that need no new session to see.

### 1. `started_at` is stamped at row creation, not at play

Median gap between `created_at` and `started_at` across 4912 completed matches: **0.0 seconds**. The
field records when the suggestion was persisted, not when anyone started playing.

`buildWaitRescueOptions` (`forced-tradeoff.ts:170-171`) sorts the "wait for court X" choices by
`started_at`, earliest first, on the reasoning that the court running longest will free up soonest. With
the field meaning creation order, the host is being pointed at the court that was *suggested* first,
which is unrelated to which will finish first. The feature is not broken in a way anyone would notice —
it just gives advice with no information behind it.

### 2. Live matches never completed, in sessions still marked playing

197 rows sit at `status='live'`, and 62 of them are in 16 sessions whose status is still `playing`,
median age 6.5 days. Every one locks four players as busy for as long as it sits there.

| session | stuck live | players locked | completed in session |
|---|---|---|---|
| `58181280` | 2 | 8 | 47 |
| `f43a9338` | 4 | 16 | 19 |
| `a1cef762` | 6 | **24** | **0** |
| `bbf721bd` | 5 | 20 | 15 |
| `1db29119` | 5 | 20 | 24 |

These are the same sessions this work has been debugging all along. `58181280` is the one TASK.md
records as "asked for 2 courts, 21 players free, returned 0" — and it has 8 players locked by two rows
that never completed. `a1cef762` has 24 locked and not a single completed match.

To the engine a player in a live row is busy, so a row that never completes makes them busy forever.
That is a mechanism inside the "empty court while players are free" class, and it was sitting in the
data the whole time.

A previous backfill moved 114 stuck sessions to `finished`. These 16 are newer, the most recent two days
old, so the cause is still producing cases and only the symptom was cleared.

**What is not established:** whether these sessions are abandoned — a host closing the app mid-session
would leave exactly this trace — or genuinely broken for someone still using them. That distinction
decides whether this is data hygiene or an active fault, and it is the one thing here that needs a
human answer rather than a query.
