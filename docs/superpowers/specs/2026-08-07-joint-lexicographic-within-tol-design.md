# Joint repartition — lexicographic within-tol-first

Date: 2026-08-07
Branch: `feat-quality-cost-model`
Status: Design approved, pending spec review → writing-plans

## Problem

Session `a1cef762` round-1 (24 players / 6 courts, quality-cost flag ON): the persisted board
seated **2 courts over gap-tolerance** (gaps 0.65 and 0.67, tol 0.5) even though an all-within-tol
partition exists. Host: "sao mới vòng 1 đã 2 sân vượt gap". Directive: **"gender chỉ là bonus —
không được đẩy sân qua gap-tol"**.

## Root cause (reproduced 4 ways, scratch/diag-a1ce-{disentangle,prodpath,genderlever}.ts)

The prod full-board round-1 path is `buildSuggestedMatchPayloads` (live-preview.ts:4118): a greedy
per-court fill loop (`suggestNextMatch`) followed by `applyJointRepartition` (live-preview.ts:5623,
**flag-ON only**).

The greedy per-court fill produces a **clean** all-within-tol board. `applyJointRepartition`
**introduces** the 2 over-tol courts:

| Run | Over-tol |
|---|---|
| flag-OFF | 0 |
| flag-ON, joint disabled | 0 (gaps 0.04–0.13) |
| flag-ON, joint enabled | **2 (0.65, 0.67)** = prod board |

**Mechanism** (quality-cost.ts:115-117): `over = max(0, gap − tol)`;
`cost = balanceTie·gap + balanceOver·over² + …`. `balanceOver` is applied to **`over²`
(quadratic)**, so crossing tolerance by a little is nearly free: gap 0.65 → over 0.15 → ×1.6 =
**0.036**. Gender preference is **linear 0.4 per partner violation**. `jointRepartition`, a
never-worse total-cost minimizer, trades a near-free gap overage to eliminate gender violations.
Round-1 has no repeat history, so the only cost difference between partitions is balance vs gender.

Confirmed gender is the lever: `jointRepartition` with `genderPartner=genderOpponent=0` produces
**0 over-tol** (all gaps ≤ 0.21) from the same seed; with default weights it produces 2 over-tol.
Total quality-cost of the joint board (1.290) is genuinely lower than the clean board (2.792) under
the current objective — `jointRepartition` optimizes correctly; the **objective** treats tolerance as
free to cross. This is the specific "fragmentation": the joint pass is a raw cost-minimizer with no
within-tol-first structure, unlike `suggestNextRound` and the greedy per-court fill (both of which
stay clean), so only it exploits the near-zero over-tol penalty.

## Approach (host-selected: joint lexicographic within-tol-first)

Add a lexicographic ordering `(overTolCount, cost)` to the joint pass only. Prefer minimizing the
number of courts over gap-tolerance first, then cost. **`computeQualityCost` is unchanged** (no
impact on any other caller). Rejected alternatives: making tolerance a hard step in
`computeQualityCost` (touches every caller); full consolidation onto global partition (larger, and
unnecessary since greedy + joint-disabled already produces clean boards).

`overTol(split)` is defined as `computeQualityCost(...).gap > tolerance` (the same 0.5 threshold used
everywhere today; unchanged).

### Change 1 — `bestSplitForFoursome` (quality-cost.ts:159)

Currently selects the split of a fixed foursome with minimum `cost`. Change to select the minimum of
`(isOverTol, cost)` lexicographically: prefer a within-tol split; among splits with the same over-tol
status, minimum cost. Keep the existing avoid-partner hard block (`Infinity`; an infeasible split is
never chosen unless all three are infeasible). Return `gap` alongside `{ cost, team_a, team_b }` so
`jointRepartition` can compare over-counts without recomputing.

### Change 2 — `jointRepartition` swap acceptance (quality-cost.ts:193-213)

The hill-climb currently accepts a swap of two courts when
`delta = (nci.cost + ncj.cost) − (split[ci].cost + split[cj].cost) < −1e-6`. Change to lexicographic
on the two involved courts:

```
oldOver = over(split[ci]) + over(split[cj])   // 0, 1, or 2
newOver = over(nci) + over(ncj)
oldCost = split[ci].cost + split[cj].cost
newCost = nci.cost + ncj.cost
accept  = newOver < oldOver
       || (newOver === oldOver && newCost < oldCost − 1e-6)
```

Because a swap never increases the local over-count, the global over-count (a sum over courts) never
increases from the seed. The seed (`work.map(bestSplitForFoursome)`) is within-tol whenever the input
foursomes are within-tol-splittable — which the greedy board always is — so the joint pass can no
longer introduce an over-tol court.

`changed` is returned true when the output pairing differs from the input: over-count strictly
decreased, or over-count equal and total cost strictly decreased. (From a clean seed this reduces to
the existing cost-decrease condition, so flag-ON round-1 behavior converges to the joint-disabled
board.)

## Invariants preserved

- **Blowout reduction (joint's shipped benefit):** a swap that brings a court from over-tol to
  within-tol reduces over-count → accepted. A swap between two still-over-tol courts that lowers the
  overage reduces cost at equal over-count → accepted (fb48 gap 2.80→0.92 still fires).
- **Within-tol repeat/gender tie-break (joint's shipped benefit):** at over-count 0, any cost-reducing
  swap is still accepted (938b9bde repeat 2→0, 14f2e11a intra 5→1 preserved).
- **Only the bug is removed:** a within→over swap that merely satisfies gender now increases over-count
  → rejected.
- **Determinism (ALGO 53):** comparison, `SPLIT_INDICES` order, and swap-loop order are all fixed.
- **Flag-OFF byte-identical:** `applyJointRepartition` early-returns when the flag is off; only
  allowlisted sessions are affected.
- **No regression to ALGO 53/54:** `findMinCostFoursome` and the blowout-defer path do not call
  `bestSplitForFoursome`/`jointRepartition` (verified: sole callers are within quality-cost.ts and
  `applyJointRepartition`).

## Blast radius

`bestSplitForFoursome` — sole caller is `jointRepartition`. `jointRepartition` — sole caller is
`applyJointRepartition` (live-preview.ts:2908), itself gated behind `isQualityCostModelEnabled`. All
edits are confined to `lib/next-round-suggester/quality-cost.ts`. Bump
`LIVE_PREVIEW_ALGORITHM_VERSION` 54 → 55 (output changes for flag-ON multi-court).

## Testing

Unit (`tests/next-round-suggester/unit/quality-cost.test.ts`):
- `bestSplitForFoursome` prefers a within-tol split over a lower-cost over-tol split (gender-vs-gap
  foursome fixture).
- `jointRepartition` never increases over-tol count from a clean seed (a1ce-style fixture: 6 courts,
  clean greedy seed with gender prefs → still 0 over-tol).
- `jointRepartition` still reduces over-tol count when a swap brings a court within tol.
- `jointRepartition` still reduces within-tol cost (repeat/gender tie-break) at over-count 0.

Regression:
- `scratch/diag-a1ce-prodpath.ts` — flag-ON joint-enabled now 0 over-tol (matches joint-disabled).
- `npm run sim` **sanity + fairness** (correctness gate). Perf-targets fail on this dev machine
  (pre-existing, ~4× slow machine) — not a regression gate.
- Flag-OFF byte-identical via existing joint-allocation-integration tests.

## Files touched

- `lib/next-round-suggester/quality-cost.ts` (both changes)
- `lib/next-round-suggester/live-preview.ts` (ALGO version bump only)
- `tests/next-round-suggester/unit/quality-cost.test.ts` (new tests)
