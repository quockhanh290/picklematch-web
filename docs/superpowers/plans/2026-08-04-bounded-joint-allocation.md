# Bounded Joint Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `buildSuggestedMatchPayloads` fills ≥2 courts in one request, re-partition the fixed seated set across those courts to minimize total `computeQualityCost` — fixing the greedy-cascade (RC1) multi-court regression.

**Architecture:** Pure search in `quality-cost.ts` (`bestSplitForFoursome`, `jointRepartition` — bounded seated-seated hill-climb, never-worse under the cost objective). A thin adapter in `live-preview.ts` maps payloads ↔ foursomes, gated behind `SESSION_QUALITY_COST_MODEL` and `length >= 2`, applied last (after the #70 invariant gate, before `normalizeRepairedPayload`). Holds the seated set fixed → participation/fairness and #70 unchanged.

**Tech Stack:** TypeScript (strict), Jest (`--runInBand`, deterministic unit subset only), existing `lib/next-round-suggester/` engine.

## Global Constraints

- **Never run the simulation suite** (`tests/next-round-suggester/simulation`) — it hangs indefinitely. Run only the specific new/touched test files with `--runInBand`.
- **Determinism:** no `Math.random`, no `Date.now`. Fixed iteration order (courts, then positions). Same input → identical output. The engine is replay-critical.
- **Flag OFF = byte-identical:** with `SESSION_QUALITY_COST_MODEL` off (or a single court), every code path added here must return the input unchanged. Kill-switch must be clean.
- **Seated set held fixed:** the joint pass never adds a bench player or removes a seated one. The multiset of ids out equals the multiset in, per court and across the batch.
- **Never-worse objective:** hill-climb starts from the greedy result and accepts only strictly-improving swaps → `totalCostAfter <= totalCostBefore` always.
- **Cost source of truth:** `computeQualityCost` (Layer ②). Add no new cost terms.
- **Logic/UI separation:** pure search logic in `quality-cost.ts`; payload↔foursome I/O in `live-preview.ts`.
- **Imports:** files under `lib/next-round-suggester/` use the `.ts` extension on local imports (Deno edge bundling), matching the existing `// @ts-ignore` pattern in `quality-cost.ts`.
- Do **not** bump `LIVE_PREVIEW_ALGORITHM_VERSION` in this plan (reserved for the flag-flip A/B change).

---

### Task 1: `bestSplitForFoursome` — cheapest 2v2 split of a foursome

**Files:**
- Modify: `lib/next-round-suggester/quality-cost.ts` (append exports)
- Test: `tests/next-round-suggester/unit/joint-allocation.test.ts` (create)

**Interfaces:**
- Consumes: `computeQualityCost(teamA, teamB, state, { tolerance, weights? })`, `QualityCostWeights`, `Team`, `SessionState` (all already in `quality-cost.ts` / `types.ts`).
- Produces:
  - `export type Foursome = [string, string, string, string]`
  - `export function bestSplitForFoursome(four: Foursome, state: SessionState, opts: { tolerance: number; weights?: Partial<QualityCostWeights> }): { cost: number; team_a: Team; team_b: Team }` — returns the split (of the 3 possible 2v2 partitions) with minimum `computeQualityCost.cost`. Ties resolve to the earliest in fixed `SPLIT_INDICES` order `[[0,1],[2,3]] < [[0,2],[1,3]] < [[0,3],[1,2]]`.

- [ ] **Step 1: Write the failing test**

Append to a new file `tests/next-round-suggester/unit/joint-allocation.test.ts`:

```ts
import { bestSplitForFoursome, type Foursome } from '../../../lib/next-round-suggester/quality-cost'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

function stateFor(pvnaById: Record<string, number>): SessionState {
  const players = Object.entries(pvnaById).map(([id, pvna]) => createPlayer(id, { pvna }))
  return createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 0 })
}

describe('bestSplitForFoursome', () => {
  it('picks the balanced 2v2 split over the two blowout splits', () => {
    // Skills 2.0, 2.1, 3.0, 3.1. Balanced split = {2.0,3.0} vs {2.1,3.1} (gap 0.2).
    // The other splits pair the two lows vs the two highs (gap ~2.0) — blowouts.
    const state = stateFor({ p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 })
    const four: Foursome = ['p0', 'p1', 'p2', 'p3']
    const best = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    const ids = [...best.team_a, ...best.team_b].sort()
    expect(ids).toEqual(['p0', 'p1', 'p2', 'p3'])
    const sum = (t: string[]) => t.reduce((s, id) => s + pvnaById[id], 0)
    const pvnaById: Record<string, number> = { p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 }
    expect(Math.abs(sum(best.team_a) - sum(best.team_b))).toBeLessThan(0.5)
  })

  it('is deterministic — same input twice yields identical teams', () => {
    const state = stateFor({ p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 })
    const four: Foursome = ['p0', 'p1', 'p2', 'p3']
    const a = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    const b = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    expect(a.team_a).toEqual(b.team_a)
    expect(a.team_b).toEqual(b.team_b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation.test.ts --runInBand`
Expected: FAIL — `bestSplitForFoursome is not a function` / no export.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/next-round-suggester/quality-cost.ts` (after `computeQualityCost`):

```ts
export type Foursome = [string, string, string, string]

// The 3 distinct ways to split 4 players into two pairs. Fixed order = deterministic tie-break.
const SPLIT_INDICES: readonly [readonly [number, number], readonly [number, number]][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

export function bestSplitForFoursome(
  four: Foursome, state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
): { cost: number; team_a: Team; team_b: Team } {
  let best: { cost: number; team_a: Team; team_b: Team } | null = null
  for (const [sa, sb] of SPLIT_INDICES) {
    const team_a: Team = [four[sa[0]], four[sa[1]]]
    const team_b: Team = [four[sb[0]], four[sb[1]]]
    const { cost } = computeQualityCost(team_a, team_b, state, opts)
    if (best === null || cost < best.cost) best = { cost, team_a, team_b }
  }
  return best!
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation.test.ts --runInBand`
Expected: PASS (both `bestSplitForFoursome` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/quality-cost.ts tests/next-round-suggester/unit/joint-allocation.test.ts
git commit -m "feat(joint-alloc): bestSplitForFoursome — cheapest 2v2 split under quality-cost"
```

---

### Task 2: `jointRepartition` — bounded seated-seated hill-climb

**Files:**
- Modify: `lib/next-round-suggester/quality-cost.ts` (append exports)
- Test: `tests/next-round-suggester/unit/joint-allocation.test.ts` (extend)

**Interfaces:**
- Consumes: `bestSplitForFoursome`, `Foursome` (Task 1), `computeQualityCost`, `Team`, `SessionState`.
- Produces:
  - `export type JointSplit = { court_idx: number; team_a: Team; team_b: Team }`
  - `export const JOINT_MAX_ITERATIONS = 4000`
  - `export function jointRepartition(courts: { court_idx: number; four: Foursome }[], state: SessionState, opts: { tolerance: number; weights?: Partial<QualityCostWeights>; maxIterations?: number }): { splits: JointSplit[]; changed: boolean; totalCostBefore: number; totalCostAfter: number }` — holds the seated set fixed; hill-climbs cross-court seated-seated swaps until no improving swap or `maxIterations` full scans; returns one `JointSplit` per input court (same order & `court_idx`), `changed` iff total cost strictly dropped.

- [ ] **Step 1: Write the failing tests**

Append to `tests/next-round-suggester/unit/joint-allocation.test.ts`:

```ts
import { jointRepartition } from '../../../lib/next-round-suggester/quality-cost'

describe('jointRepartition', () => {
  it('fixes a greedy cascade: cross-court swap balances two blowout courts', () => {
    // Court A holds the two strongest + court B the two weakest => each court is an intra/blowout mess.
    // A single cross-court swap yields two near-balanced courts.
    const state = stateFor({ s0: 4.0, s1: 3.9, w0: 2.0, w1: 2.1, m0: 3.0, m1: 3.0, m2: 3.0, m3: 3.0 })
    const courts = [
      { court_idx: 0, four: ['s0', 's1', 'w0', 'w1'] as Foursome }, // strong+weak stacked
      { court_idx: 1, four: ['m0', 'm1', 'm2', 'm3'] as Foursome },
    ]
    const before = jointRepartition(courts, state, { tolerance: 0.5 }).totalCostBefore
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(res.changed).toBe(true)
    expect(res.totalCostAfter).toBeLessThan(before)
  })

  it('never worsens total cost (starts from greedy, accepts only improvements)', () => {
    const state = stateFor({ a: 2.3, b: 3.7, c: 2.9, d: 3.1, e: 2.0, f: 4.0, g: 3.3, h: 2.6 })
    const courts = [
      { court_idx: 0, four: ['a', 'b', 'c', 'd'] as Foursome },
      { court_idx: 1, four: ['e', 'f', 'g', 'h'] as Foursome },
    ]
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(res.totalCostAfter).toBeLessThanOrEqual(res.totalCostBefore + 1e-9)
  })

  it('holds the seated set fixed (multiset of ids unchanged, per court and overall)', () => {
    const state = stateFor({ a: 2.3, b: 3.7, c: 2.9, d: 3.1, e: 2.0, f: 4.0, g: 3.3, h: 2.6 })
    const courts = [
      { court_idx: 0, four: ['a', 'b', 'c', 'd'] as Foursome },
      { court_idx: 1, four: ['e', 'f', 'g', 'h'] as Foursome },
    ]
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    const outAll = res.splits.flatMap(s => [...s.team_a, ...s.team_b]).sort()
    expect(outAll).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    for (const s of res.splits) expect([...s.team_a, ...s.team_b].length).toBe(4)
  })

  it('is deterministic — identical splits on repeat', () => {
    const state = stateFor({ a: 2.3, b: 3.7, c: 2.9, d: 3.1, e: 2.0, f: 4.0, g: 3.3, h: 2.6 })
    const courts = [
      { court_idx: 0, four: ['a', 'b', 'c', 'd'] as Foursome },
      { court_idx: 1, four: ['e', 'f', 'g', 'h'] as Foursome },
    ]
    const a = jointRepartition(courts, state, { tolerance: 0.5 })
    const b = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(a.splits).toEqual(b.splits)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation.test.ts --runInBand`
Expected: FAIL — `jointRepartition is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/next-round-suggester/quality-cost.ts`:

```ts
export type JointSplit = { court_idx: number; team_a: Team; team_b: Team }
export const JOINT_MAX_ITERATIONS = 4000

export function jointRepartition(
  courts: { court_idx: number; four: Foursome }[], state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights>; maxIterations?: number },
): { splits: JointSplit[]; changed: boolean; totalCostBefore: number; totalCostAfter: number } {
  const maxIterations = opts.maxIterations ?? JOINT_MAX_ITERATIONS
  const work = courts.map(c => [...c.four] as string[])
  const split = work.map(four => bestSplitForFoursome(four as Foursome, state, opts))
  const totalCostBefore = split.reduce((sum, c) => sum + c.cost, 0)
  let total = totalCostBefore
  let improved = true
  let iters = 0
  while (improved && iters < maxIterations) {
    improved = false
    iters += 1
    for (let ci = 0; ci < work.length && !improved; ci += 1) {
      for (let cj = ci + 1; cj < work.length && !improved; cj += 1) {
        for (let pi = 0; pi < 4 && !improved; pi += 1) {
          for (let pj = 0; pj < 4 && !improved; pj += 1) {
            const tmp = work[ci][pi]; work[ci][pi] = work[cj][pj]; work[cj][pj] = tmp
            const nci = bestSplitForFoursome(work[ci] as Foursome, state, opts)
            const ncj = bestSplitForFoursome(work[cj] as Foursome, state, opts)
            const delta = (nci.cost + ncj.cost) - (split[ci].cost + split[cj].cost)
            if (delta < -1e-6) {
              split[ci] = nci; split[cj] = ncj; total += delta; improved = true
            } else {
              const undo = work[ci][pi]; work[ci][pi] = work[cj][pj]; work[cj][pj] = undo
            }
          }
        }
      }
    }
  }
  const splits: JointSplit[] = courts.map((c, i) => ({
    court_idx: c.court_idx, team_a: split[i].team_a, team_b: split[i].team_b,
  }))
  return { splits, changed: total < totalCostBefore - 1e-9, totalCostAfter: total }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation.test.ts --runInBand`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/quality-cost.ts tests/next-round-suggester/unit/joint-allocation.test.ts
git commit -m "feat(joint-alloc): jointRepartition — bounded seated-fixed hill-climb (never-worse)"
```

---

### Task 3: Integrate joint pass into `buildSuggestedMatchPayloads`

**Files:**
- Modify: `lib/next-round-suggester/live-preview.ts` (imports + new adapter + one call site near line ~5389)
- Test: `tests/next-round-suggester/unit/joint-allocation-integration.test.ts` (create)

**Interfaces:**
- Consumes: `jointRepartition`, `Foursome`, `JointSplit` (Task 2); `isQualityCostModelEnabled` (from `quality-cost-flag.ts`); existing `SuggestedMatchPayload`, `normalizeRepairedPayload`, `getActiveRollingInvariantTarget`, `onRepairInstrument`.
- Produces: internal `applyJointRepartition(payloads, state, pvnaTolerance, onRepairInstrument?)`; no new public export from live-preview.

- [ ] **Step 1: Add imports**

In `lib/next-round-suggester/live-preview.ts`, extend the existing `quality-cost.ts` import to include the joint symbols (keep the `// @ts-ignore` + `.ts` extension pattern already used for that import), and ensure `isQualityCostModelEnabled` from `./quality-cost-flag.ts` is imported (it is already used elsewhere in this file — reuse the existing import; add only if absent):

```ts
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { jointRepartition, type Foursome } from './quality-cost.ts'
```

If a `computeQualityCost` import from `./quality-cost.ts` already exists, add `jointRepartition` and `Foursome` to that same statement instead of duplicating it.

- [ ] **Step 2: Write the failing integration test**

Create `tests/next-round-suggester/unit/joint-allocation-integration.test.ts`. Model it on `live-preview-blowout-pool-repair.test.ts` (same directory) for the `buildSuggestedMatchPayloads` call shape, state factory, and live-row setup. Construct a **≥2-court** rolling refill whose greedy fill strands a cross-court blowout the joint pass can fix. Assert three things:

```ts
// (paraphrased — mirror the existing blowout-pool-repair test's imports/harness)
import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
// ...build a state + liveRows that yield >=2 target courts...

afterEach(() => __setQualityCostModelOverrideForTests(null))

it('flag OFF: byte-identical to the pre-joint result', () => {
  __setQualityCostModelOverrideForTests(false)
  const payloads = buildSuggestedMatchPayloads(/* >=2 court args */)
  // snapshot the seated ids + per-court lineups; this is the baseline behaviour
  expect(payloads.map(p => [p.court_idx, p.team_a, p.team_b])).toMatchSnapshot()
})

it('flag ON, >=2 courts: seated set unchanged and total gap not worse than flag OFF', () => {
  __setQualityCostModelOverrideForTests(false)
  const off = buildSuggestedMatchPayloads(/* same args */)
  __setQualityCostModelOverrideForTests(true)
  const on = buildSuggestedMatchPayloads(/* same args */)
  const seated = (ps: any[]) => ps.flatMap(p => [...p.team_a, ...p.team_b]).sort()
  expect(seated(on)).toEqual(seated(off))
  const gap = (ps: any[]) => ps.reduce((s, p) => s + payloadGap(p), 0) // sum |sumA - sumB|
  expect(gap(on)).toBeLessThanOrEqual(gap(off) + 1e-9)
})

it('flag ON with an active rollingPlanTarget: seated set still unchanged (#70 preserved)', () => {
  __setQualityCostModelOverrideForTests(true)
  const on = buildSuggestedMatchPayloads(/* same args + options.rollingPlanTarget set */)
  const off = (() => { __setQualityCostModelOverrideForTests(false); return buildSuggestedMatchPayloads(/* same */) })()
  const seated = (ps: any[]) => ps.flatMap(p => [...p.team_a, ...p.team_b]).sort()
  expect(seated(on)).toEqual(seated(off)) // joint holds participation fixed under the invariant gate
})
```

Implementer: write `payloadGap` as a small local helper summing `|sum(team_a pvna) - sum(team_b pvna)|` using the same `state.players` pvna the test built. Use a concrete seeded scenario (fixed pvna values, no randomness). If a robust ≥2-court greedy-cascade fixture proves hard to hand-build, reuse a real dump under `scratch`/`tmp` via the `compare-60d0.ts` harness pattern to source `state` + `liveRows`, but keep the assertions above.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation-integration.test.ts --runInBand`
Expected: FAIL — flag ON currently equals flag OFF (no joint pass yet), so the "gap not worse / seated unchanged" assertions that depend on the new path either trivially pass or the snapshot is unestablished. Confirm the test meaningfully exercises the new path: before implementing, the flag-ON result must be identical to flag-OFF (proving the joint pass is absent); after implementing, flag-ON must diverge on the cascade fixture while keeping the seated set. If the fixture can't show divergence, strengthen it until flag-ON changes a lineup.

- [ ] **Step 4: Add the adapter + call site**

In `lib/next-round-suggester/live-preview.ts`, add the adapter (near the other repair helpers, e.g. after `repairPayloadBatchBlowoutFromPool`):

```ts
// Bounded joint re-partition (flag-gated). Holds the seated set fixed; re-assigns those players across
// the >=2 courts in this batch + re-splits each foursome to minimise total quality-cost. Never-worse
// under computeQualityCost. Single-court or flag-off => identity (kill-switch clean).
function applyJointRepartition(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
  onRepairInstrument?: (tag: string) => void,
): SuggestedMatchPayload[] {
  if (!isQualityCostModelEnabled() || payloads.length < 2) return payloads
  const courts = payloads.map(pl => ({
    court_idx: pl.court_idx,
    four: [pl.team_a[0], pl.team_a[1], pl.team_b[0], pl.team_b[1]] as Foursome,
  }))
  const { splits, changed } = jointRepartition(courts, state, { tolerance: pvnaTolerance })
  if (!changed) return payloads
  onRepairInstrument?.('joint')
  const byCourt = new Map(splits.map(s => [s.court_idx, s]))
  return payloads.map(pl => {
    const s = byCourt.get(pl.court_idx)
    return s ? { ...pl, team_a: s.team_a, team_b: s.team_b } : pl
  })
}
```

Then change the final return of `buildSuggestedMatchPayloads` (currently `return invariantSafePayloads.map(payload => normalizeRepairedPayload(...))` at ~5389) to run the joint pass first:

```ts
const jointRepartitionedPayloads = applyJointRepartition(
  invariantSafePayloads, repairState, pvnaTolerance, onRepairInstrument,
)
return jointRepartitionedPayloads.map(payload => normalizeRepairedPayload(
  payload,
  repairState,
  pvnaTolerance,
  { clearTradeoffChoices: false },
))
```

Confirm the `onRepairInstrument` symbol in scope at the return matches the one the existing repair-tag block uses (`onRepairInstrument?.('swap')` etc.); reuse it verbatim.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation-integration.test.ts --runInBand`
Expected: PASS (flag-OFF byte-identical; flag-ON seated-unchanged + gap not worse; #70 preserved).

- [ ] **Step 6: Run the touched-file regression subset**

Run: `npx jest tests/next-round-suggester/unit/live-preview-blowout-pool-repair.test.ts tests/next-round-suggester/unit/live-preview-severe-repeat-pool-repair.test.ts tests/next-round-suggester/unit/live-preview-required-selection-band.test.ts tests/next-round-suggester/unit/rolling-invariants.test.ts tests/next-round-suggester/unit/quality-cost.test.ts tests/next-round-suggester/unit/score-quality-flag.test.ts --runInBand`
Expected: PASS (flag-OFF paths unchanged — the joint pass is inert when the flag is off).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck:guard`
Expected: no new type errors vs baseline.

- [ ] **Step 8: Commit**

```bash
git add lib/next-round-suggester/live-preview.ts tests/next-round-suggester/unit/joint-allocation-integration.test.ts
git commit -m "feat(joint-alloc): flag-gated joint re-partition in buildSuggestedMatchPayloads"
```

---

### Task 4: Replay validation (no production code — verification + record)

**Files:**
- Use: `scratch/joint-experiment.ts` (existing prototype; already imports the shipped `computeQualityCost`)
- Modify (if needed): `scratch/joint-experiment.ts` to call the shipped `jointRepartition` instead of its inline `joint()` copy, so the validation measures the exact shipped search.
- Doc: append a short results table to `docs/superpowers/specs/2026-08-04-bounded-joint-allocation-design.md` under a new "## Replay results" heading.

**Interfaces:**
- Consumes: shipped `jointRepartition` (Task 2); existing session dumps under `tmp/dump-*` used by the compare harnesses.

- [ ] **Step 1: Point the prototype at the shipped search**

Replace the inline `joint(courts)` / `bestSplitCost` in `scratch/joint-experiment.ts` with calls to the shipped `jointRepartition` / `bestSplitForFoursome` (same signatures per the spec). Keep the JLINE metric output (`gap blow rep intra` for old / greedy-new / joint-new).

- [ ] **Step 2: Run replay across available dumps**

Run (for each collected dump dir, e.g.): `for d in tmp/dump-*; do npx tsx scratch/joint-experiment.ts "$d"; done`
Expected: the joint column's `blow` / `rep` / `intra` counts are `<=` the greedy-new column on **every** session (never-worse must hold empirically too; total gap of the joint column `<=` greedy-new).

- [ ] **Step 3: Record results**

Append the JLINE table (session, court-count, old / greedy-new / joint-new metrics) to the design spec under "## Replay results", with a one-line conclusion (e.g. "joint pass reduced multi-court blowouts on N/M sessions, never regressed"). If any session shows the joint column worse than greedy-new, STOP — that violates the never-worse guarantee and indicates a bug in Task 2; do not proceed.

- [ ] **Step 4: Commit**

```bash
git add scratch/joint-experiment.ts docs/superpowers/specs/2026-08-04-bounded-joint-allocation-design.md
git commit -m "test(joint-alloc): replay validation across session dumps + record results"
```

---

## Self-Review

**Spec coverage:** Task 1 = `bestSplitForFoursome` (spec Algorithm step 1). Task 2 = `jointRepartition` hill-climb + never-worse + seated-fixed + determinism + iteration cap (Algorithm steps 2-3, Bounds). Task 3 = live-preview integration, flag+count gate, instrument `'joint'`, #70 preservation, normalize (Integration, Instrumentation). Task 4 = replay validation (Testing §Validation). All 9 spec tests are covered: unit 1-6 across Tasks 1-2; integration 7-9 in Task 3; validation in Task 4.

**Placeholder scan:** all code steps carry concrete code. Task 3's integration test uses a paraphrased harness (deliberate — it mirrors the existing `live-preview-blowout-pool-repair.test.ts` shape, which the implementer must read); the assertions themselves are concrete.

**Type consistency:** `Foursome`, `JointSplit`, `bestSplitForFoursome`, `jointRepartition`, `JOINT_MAX_ITERATIONS` used identically across tasks. `computeQualityCost` opts shape `{ tolerance, weights? }` matches the existing signature. `Team = [string, string]` from `types.ts`.
