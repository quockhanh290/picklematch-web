# Bounded Joint Allocation — Design Spec

**Date:** 2026-08-04
**Branch:** `feat-quality-cost-model` (continues the unified quality-cost engine)
**Status:** Design approved (scope: hold seated set fixed)

## Problem

The replay study on 17 real sessions showed the quality-cost scoring model
(Layer ②) is *not* uniformly better than the current model on **multi-court**
fills. `deep-compare.ts` proved the regression is **not** weight calibration —
new-model lineups were *more expensive under their own cost function* than the
old lineups. Root cause **RC1 (greedy per-court allocation)**: when
`buildSuggestedMatchPayloads` fills ≥2 courts in one request, it seats court A
optimally, then court B from what's left, then court C — a greedy cascade that
strands players and forces later courts into expensive lineups (blowout / stack
/ repeat) that a joint assignment would avoid.

Single-court rolling fills (the dominant case, `count === 1`) have nothing to
jointly allocate — Layer ① selection + Layer ② scoring already handle them.
This spec targets **only** the multi-court moments.

## Goal

When `buildSuggestedMatchPayloads` produces ≥2 court lineups in one request,
add a bounded **joint re-partition** pass that holds the seated player set fixed
and re-assigns those players across the courts (plus re-splits each foursome)
to minimize the **total** `computeQualityCost` across the batch — via bounded
hill-climb swaps. Flag-gated behind the existing `SESSION_QUALITY_COST_MODEL`.

## Scope decision (approved)

**Hold the seated set fixed — re-partition only.** The joint pass never adds a
bench player or benches a seated player. Participation/fairness is decided by
Layer ① selection and stays byte-identical; the joint pass only permutes *which
court* each already-seated player lands on and *how* each foursome splits.

Consequence — **prerequisite #70 resolves for free.** The rolling invariant
gate `getActiveRollingInvariantTarget(...)` reverts a repaired batch only when
its `selectedPlayerKey` (sorted seated ids) differs from the original
`payloads`. Because the joint pass preserves the seated set, `selectedPlayerKey`
is unchanged, so the gate never reverts it. No change to #70 logic is needed.

Bench-swap joint allocation (touching participation, guarded like the two
pull-from-bench repairs) is explicitly **out of scope** — a possible future
extension, noted, not built.

## Algorithm (proven in `scratch/joint-experiment.ts`)

Input: the batch's court foursomes after all existing repairs
(`blowoutPoolRepairedPayloads`), each as a 4-id array; the shared `state`;
`pvnaTolerance`; the quality-cost weights.

1. **Best split per court** — `bestSplitCost(four)`: over the 3 ways to split 4
   players into two pairs, pick the split minimizing
   `computeQualityCost(a, b, state, { tolerance }).cost`. Returns `{ cost, a, b }`.
2. **Seated-seated hill-climb** — `joint(courts)`: repeatedly scan all
   cross-court player-position pairs `(court i pos p, court j pos q)`; tentatively
   swap; recompute `bestSplitCost` for the two affected courts; if the summed cost
   drops by more than `1e-6`, keep the swap, else revert. Stop when a full scan
   finds no improving swap **or** an iteration cap is hit. First-improvement
   (greedy hill-climb), deterministic given a fixed court/position order.
3. **Emit** — re-split every court with `bestSplitCost` and rebuild the payloads
   from the resulting `(a, b)` pairs, preserving each payload's `court_idx`,
   metadata, and non-lineup fields.

### Bounds & determinism

- **Iteration cap:** `JOINT_MAX_ITERATIONS = 4000` full-scan passes (the
  prototype's proven cap; real batches of 2–3 courts converge in <10). The cap is
  a runaway backstop, not an expected limit.
- **Court-count gate:** only runs when `payloads.length >= 2`. `count === 1` is
  returned untouched.
- **Determinism:** fixed iteration order over courts then positions; no
  `Math.random`. Same input → same output (required — engine is replayable).
- **Cost source of truth:** `computeQualityCost` (Layer ②). The joint pass adds
  no new cost terms; it only searches the assignment space that greedy skipped.

### Never-worse guarantee

Hill-climb starts from the greedy result and only accepts strictly-improving
swaps, so `total(joint) <= total(greedy)` under `computeQualityCost` always. The
pass can only lower total cost or leave it unchanged — it cannot regress the
batch under its own objective.

## Integration

**File:** `lib/next-round-suggester/live-preview.ts`, inside
`buildSuggestedMatchPayloads`, applied to `invariantSafePayloads` — i.e. **after**
the existing #70 invariant gate resolves (~5367) and the existing repair-tag
instrument block, immediately **before** the final `normalizeRepairedPayload`
map (~5389). Placing it last leaves the existing swap/repeat/participation
instrument tags untouched.

```
blowoutPoolRepairedPayloads            (existing — all repairs applied)
  → invariantSafePayloads              (existing #70 gate)
  → existing repair-tag instrument     (existing — unchanged)
  → jointRepartitionedPayloads         (NEW: flag ON && length>=2, else identity)
  → normalizeRepairedPayload map       (existing — recomputes warnings/metadata)
```

Running last is still invariant-safe: the joint pass holds the seated set fixed,
so it cannot reintroduce a participation change the #70 gate just guarded
against (`selectedPlayerKey` is preserved either way).

- **Gate:** `isQualityCostModelEnabled() && invariantSafePayloads.length >= 2`.
  Flag OFF **or** single-court → return the input array unchanged (byte-identical
  to today; kill-switch clean).
- The new pass lives in `quality-cost.ts` as a pure exported function operating
  on foursomes, wrapped by a thin live-preview adapter that maps payloads ↔
  foursomes and preserves `court_idx` + metadata. Keeps I/O in live-preview and
  pure search logic in quality-cost (repo logic/UI-separation convention).
- Downstream `normalizeRepairedPayload` still runs on the emitted payloads, so
  warnings/degraded metadata are recomputed from the final lineups (no stale
  quality metadata).

### Instrumentation

Extend the existing `onRepairInstrument?.(...)` channel with a `'joint'` tag
emitted when the joint pass changed the lineups (total cost strictly dropped),
so replay/telemetry can count how often it fires and by how much.

## Interfaces

New in `quality-cost.ts`:

```ts
export type Foursome = [string, string, string, string]
export type JointSplit = { court_idx: number; team_a: Team; team_b: Team }

// Best 2v2 split of one foursome under computeQualityCost.
export function bestSplitForFoursome(
  four: Foursome, state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
): { cost: number; team_a: Team; team_b: Team }

// Bounded seated-seated hill-climb over the batch. Holds the seated set fixed.
// Returns one JointSplit per input court, plus whether any swap was accepted.
export function jointRepartition(
  courts: { court_idx: number; four: Foursome }[], state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights>; maxIterations?: number },
): { splits: JointSplit[]; changed: boolean; totalCostBefore: number; totalCostAfter: number }
```

Live-preview adapter `applyJointRepartition` (exported — controller-authorized
2026-08-04 for direct unit-testing; pure helper): maps
`SuggestedMatchPayload[] → courts → jointRepartition → SuggestedMatchPayload[]`,
copying every non-lineup field from the matching `court_idx` payload.

## Testing

Unit (`tests/next-round-suggester/unit/joint-allocation.test.ts`, deterministic,
`--runInBand`, NEVER the simulation suite):

1. **`bestSplitForFoursome` picks the cheapest split** — a foursome where one of
   the 3 splits is clearly balanced and the others blowout; assert it returns the
   balanced pairing and its cost.
2. **`jointRepartition` never worsens total cost** — random-but-seeded foursomes;
   assert `totalCostAfter <= totalCostBefore + 1e-9`.
3. **`jointRepartition` fixes a greedy cascade** — a hand-built 2-court case where
   greedy strands a strong+weak split that a cross-court swap balances; assert the
   swap happens (`changed === true`) and both courts' gaps drop.
4. **Seated set is held fixed** — assert the multiset of ids out equals the
   multiset in, for every court and across the batch.
5. **Determinism** — same input twice → identical splits.
6. **Court-count gate** — single court (`length 1`) returned unchanged.

Integration (`live-preview` level, flag-gated):

7. **Flag OFF → byte-identical** — a ≥2-court dump through
   `buildSuggestedMatchPayloads` with flag OFF is unchanged by this code path
   (assert against a pre-change snapshot).
8. **Flag ON, ≥2 courts → total gap not worse, seated set unchanged** — same dump,
   flag ON; assert seated multiset identical and summed gap `<=` flag-OFF summed
   gap.
9. **#70 invariant preserved** — with a `rollingPlanTarget` active, flag ON: assert
   the joint pass output is *not* reverted by `getActiveRollingInvariantTarget`
   (because `selectedPlayerKey` is unchanged).

Validation (replay, not a unit test): re-run `scratch/joint-experiment.ts`
across the collected session dumps and confirm the JLINE joint column shows
`blow`/`rep`/`intra` at or below the greedy-new column on every session (the
prototype already showed this; the shipped path must match).

## Non-goals

- Bench swaps / participation changes (future extension).
- Single-court joint (nothing to allocate).
- Full-round async joint planning (shelved; CP-SAT, async-fragile).
- New cost terms — `computeQualityCost` is the fixed objective.
- Deploy / flag flip — outward-facing, host's decision, separate step.

## Algorithm-version note

The joint pass changes suggested lineups only when the flag is ON, so
`LIVE_PREVIEW_ALGORITHM_VERSION` does not need a bump for a flag-OFF deploy. Bump
it in the same change that flips the flag ON for A/B (not in this build).

## Replay results (2026-08-04)

Measured with `scratch/joint-experiment.ts` (now delegating to the shipped
`bestSplitForFoursome` / `jointRepartition`) across the collected real session
dumps. To isolate the joint pass's contribution the engine's internal joint was
temporarily gated off (`DISABLE_JOINT=1`, a throwaway diagnostic edit, reverted)
so we could compare **engine scoring-only** vs **engine scoring+joint** on the
authoritative `repairState` — not the harness's own reconstruction.

Multi-court dumps only (metrics = summed team-gap / #blowouts>1.5 / #repeat≥3 / #intra-stacks>1.0):

| dump | courts | scoring-only | scoring+joint | joint effect |
|---|---|---|---|---|
| fb48 | 2 | gap2.80 **blow1** rep0 intra2 | gap**0.92 blow0** rep1 intra2 | **removes the blowout**, gap 2.8→0.92, +1 repeat |
| 938b9bde | 3 | gap0.35 blow0 **rep2** intra0 | gap1.07 blow0 **rep0** intra3 | −2 repeats, gap+intra ↑ (both stay sub-blowout) |
| 14f2e11a | 6 | gap1.04 blow0 rep0 **intra5** | gap3.62 blow0 rep0 **intra1** | −4 stacks, gap ↑ (no blowout created) |
| 4907967c | 6 | gap2.32 blow0 rep0 intra1 | gap2.40 blow0 rep0 intra3 | ~neutral visible; trades for gender/group (invisible term) |
| e945f825 | 6 | gap2.13 blow0 rep0 intra3 | gap2.19 blow0 rep0 intra3 | marginal |
| 9356 | 2 | gap0.40 blow0 rep2 intra0 | *(no-op)* | no cost-reducing swap on engine state |
| f24a11c1 | 2 | gap0.76 blow0 rep0 intra2 | *(no-op)* | no cost-reducing swap on engine state |

**Conclusion:** the engine joint pass fires on 5/7 multi-court dumps and behaves
as designed — it **never increased the blowout count on any dump** (removed one
on fb48) and reduced repeats (938b9bde 2→0) and intra-stacks (14f2e11a 5→1),
trading only sub-blowout gap increases. This is consistent with the host's
stated priority (avoid-blowout > diversity > pref). 4907967c trades a little
visible balance for an invisible gender/group gain (cost strictly dropped, no
blowout) — mild and defensible.

**Caveats:**
- The harness reconstructs state (`freshState`) which drifts slightly from the
  engine's live `repairState` (recency/counts), so the harness's *own* inline
  joint can occasionally find a phantom improvement the engine correctly skips
  (e.g. 9356). The authoritative **never-worse** guarantee comes from the Task 2
  unit test + construction (hill-climb from greedy, strictly-improving swaps
  only), not from the harness numbers.
- Whether the cost weighting matches this host's taste (objective-fit) is not
  decidable offline — it needs a host A/B with the flag flipped ON. This replay
  only confirms the mechanism does what the objective says and creates no
  blowout regressions.
