# Last-Court Blowout — Owed-Outlier Defer + Host-Decide Design

**Date:** 2026-08-07
**Branch:** feat-quality-cost-model
**Status:** approved (brainstorm) → ready for planning

## Problem

On the **last open court of a rolling round**, an owed (required) skill-outlier is forced into a
blowout even when a balanced foursome from the remaining players exists. Real repro — session
`bbf721bd` Sân 2 (court 1), Round 3:

- Seated `[Bùi Long(2.0), Võ Kiên(4.5)] v [Hoàng Anh(4.5), Phan Thu(4.4)]` — gap 2.43, `degraded=blowout`.
- Eligible pool for court 1 = 6: Bùi Long(2.0) + five strong (4.4–4.9). A balanced foursome of the five
  strong (resting Bùi Long) exists at gap ~0.05, `computeQualityCost` 0.36 vs the seated 15.99.
- Bùi Long is `required_for_court` (owed), `consecutive_rest = 0`.

### Verified root cause

1. **Board construction** spreads the roster's 5 weak players (~2.0–2.5) across courts; by the LAST court,
   Bùi Long's near-level peers are all busy on the 5 live courts, leaving court 1 with one weak + five strong.
2. `selectRequiredIdsForCourt` (live-preview.ts:1718) **bails when `remainingCourtsInRound <= 1`** — it
   skips the skill-cohesion logic and forces the first owed players, so the weak outlier is forced.
3. `deferLowViabilityRequiredIdsForCourt` (live-preview.ts:1764) **also bails when `remainingCourtsInRound <= 1`**
   — no deferral on the last court.
4. `repairPayloadBatchBlowoutFromPool` (live-preview.ts:2779) can't fix it: swapping Bùi Long out requires
   `hasNearLevelPeer(outgoing, remainingBench)` (line 2822), and his peers are busy (bench is two strong
   players) → the guard "never strand a lone outlier on the bench" blocks the swap.

The determinism fix (ALGO 53) is NOT implicated — it correctly seats the min-cost lineup **given** the
forced-required set; here that set forces the outlier.

## Goal

Stop forcing an owed skill-outlier into a last-court blowout when a balanced foursome exists — WITHOUT
breaking fairness/rotation invariants — using two branches keyed on the outlier's `consecutive_rest`:

- **Branch A (`consecutive_rest = 0`): auto-defer.** The outlier rests this court (plays next fill); the
  court seats the balanced four. Safe: the player never rests two consecutive rounds because of the defer.
- **Branch B (`consecutive_rest > 0`): host decides.** The engine seats the lineup and surfaces a
  host-decision panel (like the repeat-3 panel) — ② play the outlier now (accept the imbalance) / ③ keep
  resting the outlier (balanced four play) — **with a clear explanation of why it's imbalanced**. The
  engine does NOT auto-rest a player who has already rested, so it can never starve them silently.

## Precondition (both branches)

Apply the defer/host-decide only when the outlier has a **near-level peer in the ACTIVE roster** (checked-in,
not opted-rest, INCLUDING players currently busy on live courts) within `pvna_tolerance`, excluding
themselves. A genuinely unique-weak player (no peer anywhere) would blow out in every match regardless, so
deferring/prompting is pointless — seat them and only attach the explanation.

Define `hasNearLevelPeerInActiveRoster(outlierId, state, tolerance)`: any active player p (p ≠ outlier,
`checked_out_at === null`, `!opted_rest`) with `|effectivePvna(p) − effectivePvna(outlier)| ≤ tolerance`.
Note this differs from the repair's `hasNearLevelPeer`, which only inspects the current bench.

## Design

### Branch A — auto-defer at the last court (engine seating)

In `deferLowViabilityRequiredIdsForCourt`, relax the `remainingCourtsInRound <= 1` early return: when it IS
the last court, still defer a required outlier IF ALL of:
- the required set's PVNA spread `> tolerance` (a blowout is being forced), and
- the outlier (the required player furthest from the cohesive cluster) has `consecutive_rest === 0`, and
- `hasNearLevelPeerInActiveRoster(outlier, ...)` is true, and
- deferring still leaves enough required players to fill the court's minimum (never drop the court below a
  fillable four; never defer so many that the court can't seat).

Deferred outliers are dropped to FLEXIBLE by the existing `buildLiveTierOverrides` path (as today for the
non-last-court case), so pairing seats the balanced four and the outlier rests this court. `selectRequiredIdsForCourt`'s
last-court bail is adjusted consistently so it does not re-add the deferred outlier.

**Determinism:** the outlier is chosen by the existing fairness order + PVNA distance (no wall-clock/random).

### Branch B — host-decide for a rest>0 outlier (metadata + panel)

When the seated last-court lineup is `degraded=blowout` AND contains a required outlier with
`consecutive_rest > 0` AND `hasNearLevelPeerInActiveRoster` AND a balanced alternative (the four that
excludes the outlier) exists, attach a host-decision to the payload (extending the existing
`forced_tradeoff` delivery + panel):

- ② "Chịu lệch" = the seated lineup (outlier plays; blowout).
- ③ "Cho nghỉ tiếp" = the balanced foursome that rests the outlier (`findMinCostFoursome` over the eligible
  pool excluding the outlier).
- A **blowout explanation** string: names the outlier, their skill vs the available cluster, that their
  near-level peers are currently busy, and how many rounds they've rested — so the host understands the
  tradeoff (play them lopsided now vs rest them again).

Reuse the `forced_tradeoff` transport (jsonb `suggestion_metadata` sync) and the client 3-way panel
(`buildForcedDecision`), adding blowout-variant labels/explanation. The engine does NOT change the seated
lineup for Branch B — it only adds the decision metadata (the host acts).

### Trigger interaction

- `degraded=repeat`/`both` → existing repeat forced_tradeoff (unchanged).
- `degraded=blowout` + rest>0 required outlier + peer + balanced-alt → new blowout host-decision.
- `degraded=blowout` + rest=0 outlier + peer → Branch A already prevented the blowout (no panel needed).
- `degraded=blowout` + no peer (unique-weak) → seat + explanation only, no panel.

## Invariants preserved (must not break)

1. **Court fill:** every open court still seats four; defer never drops a court below a fillable four.
2. **Consecutive-rest cap:** Branch A defers only `consecutive_rest === 0` players (never two-in-a-row via
   defer); Branch B never auto-rests a rested player — the host decides, so no silent cap violation.
3. **No starvation:** a player who already rested (rest>0) is never auto-deferred again; the host is shown
   the reason and chooses.
4. **Determinism:** all new selection/attachment logic is wall-clock/random-free (consistent with ALGO 53).
5. **No regression of ALGO 37 / ALGO 48:** the non-last-court cohesion logic and the blowout repair are
   unchanged; Branch A only adds a guarded path to the previously-bailing last-court case.

## Testing

1. **Branch A unit:** last court, required outlier rest=0 with an active-roster peer + a balanced four →
   the outlier is deferred, the court seats the balanced four (no blowout).
2. **Branch A guard:** outlier rest=0 but NO active peer → NOT deferred (seated, unavoidable blowout).
3. **Branch A fill floor:** deferring would drop the court below four → NOT deferred.
4. **Branch B unit:** last court, required outlier rest>0 with peer + balanced alt → seated lineup unchanged
   (blowout) AND host-decision metadata attached with ②seated/③balanced-rest + a non-empty explanation.
5. **Branch B no-peer:** rest>0 outlier, no peer → seated, NO panel, explanation only.
6. **Determinism:** same state twice → identical seating + identical metadata.
7. **Regression:** existing selectRequiredIdsForCourt / deferLowViability / blowout-repair / forced-tradeoff
   tests unchanged; `npm run sim` sanity + fairness pass (engine-core change).
8. **Real-data check:** replay session `bbf721bd` court 1 → Branch A defers Bùi Long (rest=0) → balanced.

## Out of scope

- Rebalancing board construction so weak players are paired earlier (a larger, separate effort).
- Multi-court simultaneous blowout host-decisions (this targets the rolling single/last court).

## Files (anticipated; finalized in plan)

- `lib/next-round-suggester/live-preview.ts` — `deferLowViabilityRequiredIdsForCourt` +
  `selectRequiredIdsForCourt` (Branch A); the forced_tradeoff trigger block (~5242) for the blowout
  host-decision (Branch B); a `hasNearLevelPeerInActiveRoster` helper; blowout explanation builder;
  bump `LIVE_PREVIEW_ALGORITHM_VERSION` (53 → 54).
- `features/host/session-detail/next-round-v2/forced-decision.ts` + `ScreenComponents.tsx` — blowout-variant
  labels + explanation in the 3-way panel.
- `tests/next-round-suggester/` — Branch A/B unit + determinism; sim sanity.
