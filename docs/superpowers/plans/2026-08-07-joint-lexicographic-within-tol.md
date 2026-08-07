# Joint Repartition Lexicographic Within-Tol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `applyJointRepartition` from pushing courts past gap-tolerance to satisfy gender preferences, by giving the joint pass a lexicographic `(over-tol count, cost)` objective.

**Architecture:** Two edits confined to `lib/next-round-suggester/quality-cost.ts`. `bestSplitForFoursome` selects a within-tolerance split over any lower-cost over-tolerance split; `jointRepartition`'s swap acceptance never increases the number of over-tolerance courts. `computeQualityCost` is untouched, so every other caller (score.ts flag-ON path, findMinCostFoursome) is unaffected.

**Tech Stack:** TypeScript, Jest (`jest-expo`, run with `--runInBand`), tsx for scratch repros, Deno for the edge bundle (`deno check`).

## Global Constraints

- Edits limited to `lib/next-round-suggester/quality-cost.ts` (logic) + `lib/next-round-suggester/live-preview.ts` (ALGO version constant only) + `tests/next-round-suggester/unit/quality-cost.test.ts` (new tests).
- The over-tolerance threshold is `gap > tolerance`, with `tolerance = 0.5` in every test. Do not change the threshold semantics.
- `computeQualityCost` MUST NOT change (host chose the joint-only fix, not a hard tolerance in the cost function).
- Preserve determinism: `SPLIT_INDICES` order and the swap-loop order are fixed; no `Date.now()`/`Math.random()`.
- Do NOT regress ALGO 53 (`findMinCostFoursome` deterministic single-court) or ALGO 54 (blowout-defer). Neither calls `bestSplitForFoursome`/`jointRepartition`.
- Flag-OFF path stays byte-identical: `applyJointRepartition` already early-returns when `isQualityCostModelEnabled(state)` is false.
- Run Jest with `npx jest <file> --runInBand` (never the full `tests/next-round-suggester` run — its simulation suite hangs on this machine).
- `npm run sim` **sanity + fairness** is the correctness gate. Its **perf-targets FAIL on this dev machine (pre-existing, ~4× slow); that is NOT a regression** — do not block on it.

---

### Task 1: `bestSplitForFoursome` — within-tol-first split selection

**Files:**
- Modify: `lib/next-round-suggester/quality-cost.ts:159-177` (`bestSplitForFoursome`)
- Test: `tests/next-round-suggester/unit/quality-cost.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `computeQualityCost(teamA, teamB, state, { tolerance }) -> { cost, gap, maxProjectedMeeting }` (unchanged), `getAvoidPenalty`, `AVOID_PARTNER_PENALTY`, `SPLIT_INDICES` (all already in the file).
- Produces: `bestSplitForFoursome(four, state, opts) -> { cost: number; gap: number; overTol: boolean; team_a: Team; team_b: Team }` — return type gains `gap` and `overTol`. Task 2 consumes `overTol` and `gap`.

- [ ] **Step 1: Write the failing test**

Append to `tests/next-round-suggester/unit/quality-cost.test.ts`. Add the import at the top of the file (alongside the existing `computeQualityCost` import):

```typescript
import { bestSplitForFoursome, jointRepartition } from '../../../lib/next-round-suggester/quality-cost'
import { getEffectivePvna } from '../../../lib/next-round-suggester/state'
```

Then append this block:

```typescript
describe('bestSplitForFoursome — within-tol-first (joint lexicographic)', () => {
  // Two low equal-PVNA females who both want a female partner, plus two high equal-PVNA males.
  // The only gender-clean split (females paired together) is a blowout (gap 1.0); the balanced
  // splits (gap 0) each break both gender prefs. Under raw cost the blowout is cheaper (its over²
  // penalty is small) — the fix must still refuse to cross the tolerance for a gender bonus.
  const gapOfTeams = (state: SessionState, a: Team, b: Team) =>
    Math.abs(getEffectivePvna(state.players.get(a[0])!) + getEffectivePvna(state.players.get(a[1])!)
      - getEffectivePvna(state.players.get(b[0])!) - getEffectivePvna(state.players.get(b[1])!))

  it('prefers a within-tol split over a cheaper over-tol gender-satisfying split', () => {
    const players = [
      createPlayer('x0', { pvna: 2.0, gender: 'F', partner_gender_pref: 'F' }),
      createPlayer('x1', { pvna: 2.0, gender: 'F', partner_gender_pref: 'F' }),
      createPlayer('x2', { pvna: 2.5, gender: 'M' }),
      createPlayer('x3', { pvna: 2.5, gender: 'M' }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    const best = bestSplitForFoursome(['x0', 'x1', 'x2', 'x3'], state, { tolerance: 0.5 })
    expect(gapOfTeams(state, best.team_a, best.team_b)).toBeLessThanOrEqual(0.5)
    expect(best.overTol).toBe(false)
    expect(best.gap).toBeLessThanOrEqual(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/next-round-suggester/unit/quality-cost.test.ts -t "within-tol split" --runInBand`
Expected: FAIL — pre-fix `bestSplitForFoursome` returns the gap-1.0 blowout split (min cost), so `gap` is `1.0` and `best.overTol` is `undefined`/`true`.

- [ ] **Step 3: Implement within-tol-first selection**

Replace `bestSplitForFoursome` (currently lines 159-177) with:

```typescript
export function bestSplitForFoursome(
  four: Foursome, state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
): { cost: number; gap: number; overTol: boolean; team_a: Team; team_b: Team } {
  const P = (id: string) => state.players.get(id)!
  let best: { cost: number; gap: number; overTol: boolean; team_a: Team; team_b: Team } | null = null
  for (const [sa, sb] of SPLIT_INDICES) {
    const team_a: Team = [four[sa[0]], four[sa[1]]]
    const team_b: Team = [four[sb[0]], four[sb[1]]]
    // Hard block: avoid pairs as partners — mirrors scoreMatch's feasibility floor (score.ts) so
    // bestSplitForFoursome/jointRepartition inherit the same hard invariant as the greedy path.
    const isInfeasible =
      getAvoidPenalty(P(team_a[0]), P(team_a[1]), 'partner') === AVOID_PARTNER_PENALTY ||
      getAvoidPenalty(P(team_b[0]), P(team_b[1]), 'partner') === AVOID_PARTNER_PENALTY
    const qc = computeQualityCost(team_a, team_b, state, opts)
    const cost = isInfeasible ? Infinity : qc.cost
    // Infeasible splits rank as "worst" on BOTH keys so a feasible split always wins.
    const overTol = isInfeasible ? true : qc.gap > opts.tolerance
    // Lexicographic within-tol-first: prefer a within-tolerance split; among splits with the same
    // over-tolerance status, prefer lower cost. Gender/repeat (soft costs) may only break ties WITHIN
    // the tolerance band — they can never make an over-tol split win over a within-tol one.
    const better = best === null
      || (overTol !== best.overTol ? (!overTol && best.overTol) : cost < best.cost)
    if (better) best = { cost, gap: qc.gap, overTol, team_a, team_b }
  }
  return best!
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/next-round-suggester/unit/quality-cost.test.ts -t "within-tol split" --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/quality-cost.ts tests/next-round-suggester/unit/quality-cost.test.ts
git commit -m "feat(suggester): bestSplitForFoursome within-tol-first (lexicographic over-tol,cost)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `jointRepartition` — swap acceptance never increases over-tol count

**Files:**
- Modify: `lib/next-round-suggester/quality-cost.ts:182-218` (`jointRepartition`)
- Test: `tests/next-round-suggester/unit/quality-cost.test.ts` (append two tests)

**Interfaces:**
- Consumes: `bestSplitForFoursome(...) -> { cost, gap, overTol, team_a, team_b }` (from Task 1).
- Produces: `jointRepartition(courts, state, opts) -> { splits: JointSplit[]; changed: boolean; totalCostBefore: number; totalCostAfter: number }` — signature unchanged; behavior now lexicographic.

- [ ] **Step 1: Write the failing regression test (a1ce fixture) + the preservation guard**

Append to `tests/next-round-suggester/unit/quality-cost.test.ts`:

```typescript
describe('jointRepartition — never introduces over-tol (a1ce regression)', () => {
  // Reconstructed from session a1cef762 round-1 clean greedy seed (scratch/dump-a1ce-fixture.ts).
  // Pre-fix jointRepartition pushes 2 courts over tol (gaps 0.65 / 0.67) to satisfy gender prefs.
  const PLAYERS: Array<{ id: string; pvna: number; gender: 'M' | 'F'; pp: any; op: any }> = [
    { id: 'p1', pvna: 2.31, gender: 'F', pp: 'M', op: 'any' }, { id: 'p2', pvna: 2.88, gender: 'F', pp: 'F', op: 'M' },
    { id: 'p4', pvna: 4.06, gender: 'M', pp: 'any', op: 'any' }, { id: 'p5', pvna: 3.47, gender: 'F', pp: 'any', op: 'M' },
    { id: 'p6', pvna: 3.84, gender: 'M', pp: 'M', op: 'any' }, { id: 'p7', pvna: 2.59, gender: 'F', pp: 'M', op: 'any' },
    { id: 'p8', pvna: 3.03, gender: 'M', pp: 'M', op: 'F' }, { id: 'p9', pvna: 2.03, gender: 'F', pp: 'any', op: 'any' },
    { id: 'p10', pvna: 2.64, gender: 'F', pp: 'any', op: 'any' }, { id: 'p11', pvna: 4.47, gender: 'F', pp: 'any', op: 'any' },
    { id: 'p12', pvna: 2.34, gender: 'M', pp: 'F', op: 'F' }, { id: 'p13', pvna: 4.6, gender: 'F', pp: 'any', op: 'any' },
    { id: 'p14', pvna: 2.97, gender: 'F', pp: 'any', op: 'any' }, { id: 'p15', pvna: 3.85, gender: 'M', pp: 'any', op: 'any' },
    { id: 'p18', pvna: 4.51, gender: 'F', pp: 'any', op: 'F' }, { id: 'p20', pvna: 2.08, gender: 'M', pp: 'M', op: 'F' },
    { id: 'p22', pvna: 3.63, gender: 'M', pp: 'M', op: 'F' }, { id: 'p23', pvna: 2.31, gender: 'M', pp: 'any', op: 'any' },
    { id: 'p25', pvna: 2.96, gender: 'F', pp: 'any', op: 'any' }, { id: 'p27', pvna: 3.54, gender: 'M', pp: 'any', op: 'F' },
    { id: 'p28', pvna: 2.66, gender: 'M', pp: 'M', op: 'any' }, { id: 'p29', pvna: 4.69, gender: 'M', pp: 'any', op: 'any' },
    { id: 'p30', pvna: 2.0, gender: 'M', pp: 'any', op: 'F' }, { id: 'p31', pvna: 2.35, gender: 'F', pp: 'M', op: 'any' },
  ]
  const SEED: string[][] = [
    ['p30', 'p12', 'p9', 'p31'], ['p23', 'p1', 'p20', 'p7'], ['p15', 'p6', 'p22', 'p4'],
    ['p5', 'p14', 'p8', 'p27'], ['p13', 'p11', 'p18', 'p29'], ['p2', 'p10', 'p25', 'p28'],
  ]
  const buildState = () => {
    const players = PLAYERS.map(p => createPlayer(p.id, {
      pvna: p.pvna, gender: p.gender, partner_gender_pref: p.pp, opponent_gender_pref: p.op,
    }))
    return createState({ players, courts: 6, pvnaTolerance: 0.5 })
  }
  const gapOf = (state: SessionState, s: { team_a: Team; team_b: Team }) =>
    Math.abs(getEffectivePvna(state.players.get(s.team_a[0])!) + getEffectivePvna(state.players.get(s.team_a[1])!)
      - getEffectivePvna(state.players.get(s.team_b[0])!) - getEffectivePvna(state.players.get(s.team_b[1])!))

  it('leaves zero courts over tolerance', () => {
    const state = buildState()
    const courts = SEED.map((four, i) => ({ court_idx: i, four: four as [string, string, string, string] }))
    const { splits } = jointRepartition(courts, state, { tolerance: 0.5 })
    const over = splits.filter(s => gapOf(state, s) > 0.5).length
    expect(over).toBe(0)
  })
})

describe('jointRepartition — still optimizes within tolerance (preservation)', () => {
  it('applies a within-tol cross-court swap that removes an unavoidable in-court opponent repeat', () => {
    // Two courts, all PVNA 3.0 (every arrangement is gap 0 -> always within tol). a0 has met BOTH
    // a2 and a3 as opponents, so whichever partner a0 takes, one opponent is a repeat. Swapping a
    // repeated opponent out to the fresh court B removes it — a within-tol improvement joint must keep.
    const players = [
      createPlayer('a0', { pvna: 3.0 }), createPlayer('a1', { pvna: 3.0 }),
      createPlayer('a2', { pvna: 3.0 }), createPlayer('a3', { pvna: 3.0 }),
      createPlayer('b0', { pvna: 3.0 }), createPlayer('b1', { pvna: 3.0 }),
      createPlayer('b2', { pvna: 3.0 }), createPlayer('b3', { pvna: 3.0 }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    setOpponentRepeats(state.players.get('a0')!, state.players.get('a2')!, 2)
    setOpponentRepeats(state.players.get('a0')!, state.players.get('a3')!, 2)
    const courts = [
      { court_idx: 0, four: ['a0', 'a1', 'a2', 'a3'] as [string, string, string, string] },
      { court_idx: 1, four: ['b0', 'b1', 'b2', 'b3'] as [string, string, string, string] },
    ]
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(res.changed).toBe(true)
    expect(res.totalCostAfter).toBeLessThan(res.totalCostBefore)
  })
})
```

- [ ] **Step 2: Run tests to verify the regression test fails**

Run: `npx jest tests/next-round-suggester/unit/quality-cost.test.ts -t "jointRepartition" --runInBand`
Expected: the "leaves zero courts over tolerance" test FAILS (`over` is `2`). The preservation test PASSES already (guards against over-correcting; it must keep passing after the fix).

- [ ] **Step 3: Implement lexicographic swap acceptance**

Replace `jointRepartition` (currently lines 182-218) with:

```typescript
export function jointRepartition(
  courts: { court_idx: number; four: Foursome }[], state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights>; maxIterations?: number },
): { splits: JointSplit[]; changed: boolean; totalCostBefore: number; totalCostAfter: number } {
  const maxIterations = opts.maxIterations ?? JOINT_MAX_ITERATIONS
  const work = courts.map(c => [...c.four] as string[])
  const split = work.map(four => bestSplitForFoursome(four as Foursome, state, opts))
  const overCount = (items: typeof split) => items.reduce((n, s) => n + (s.overTol ? 1 : 0), 0)
  const totalCostBefore = split.reduce((sum, c) => sum + c.cost, 0)
  const overBefore = overCount(split)
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
            // Lexicographic (over-tol count, cost) on the two courts touched by this swap: never
            // accept a swap that increases how many of them exceed gap-tolerance; within an equal
            // over-tol count, accept only a strict cost reduction. A swap can never raise the local
            // over count, so the global over count never rises above the (clean) seed.
            const oldOver = (split[ci].overTol ? 1 : 0) + (split[cj].overTol ? 1 : 0)
            const newOver = (nci.overTol ? 1 : 0) + (ncj.overTol ? 1 : 0)
            const oldCost = split[ci].cost + split[cj].cost
            const newCost = nci.cost + ncj.cost
            const accept = newOver < oldOver || (newOver === oldOver && newCost < oldCost - 1e-6)
            if (accept) {
              split[ci] = nci; split[cj] = ncj; total += newCost - oldCost; improved = true
            } else {
              const undo = work[ci][pi]; work[ci][pi] = work[cj][pj]; work[cj][pj] = undo
            }
          }
        }
      }
    }
  }
  const overAfter = overCount(split)
  const splits: JointSplit[] = courts.map((c, i) => ({
    court_idx: c.court_idx, team_a: split[i].team_a, team_b: split[i].team_b,
  }))
  const changed = overAfter < overBefore
    || (overAfter === overBefore && total < totalCostBefore - 1e-9)
  return { splits, changed, totalCostBefore, totalCostAfter: total }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx jest tests/next-round-suggester/unit/quality-cost.test.ts --runInBand`
Expected: PASS — all tests in the file green (a1ce over-count 0, preservation still changes, the 5 existing intent scenarios unaffected because `computeQualityCost` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/quality-cost.ts tests/next-round-suggester/unit/quality-cost.test.ts
git commit -m "feat(suggester): jointRepartition never increases over-tol count (gender stays a within-tol tie-break)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ALGO version bump + full verification

**Files:**
- Modify: `lib/next-round-suggester/live-preview.ts` (the `LIVE_PREVIEW_ALGORITHM_VERSION` constant — currently 54)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LIVE_PREVIEW_ALGORITHM_VERSION = 55`.

- [ ] **Step 1: Bump the algorithm version**

Find the line `export const LIVE_PREVIEW_ALGORITHM_VERSION = 54` (grep it) in `lib/next-round-suggester/live-preview.ts` and change `54` to `55`.

Run: `grep -n "LIVE_PREVIEW_ALGORITHM_VERSION = " lib/next-round-suggester/live-preview.ts`
Expected: shows `= 55`.

- [ ] **Step 2: Faithful prod-path repro (flag-ON joint enabled now clean)**

Run: `npx tsx scratch/diag-a1ce-prodpath.ts`
Expected: the "PROD PATH flag-ON (joint enabled)" run now shows **0 OVER-tol** (previously 2), matching the joint-disabled run. Flag-OFF still 0.

- [ ] **Step 3: Flag-OFF byte-identical + flag-ON joint integration suite**

Run: `npx jest tests/next-round-suggester/unit/joint-allocation-integration.test.ts tests/next-round-suggester/unit/live-preview.test.ts --runInBand`
Expected: PASS. If the joint-allocation snapshot changed for a flag-ON multi-court case, inspect the diff: gaps must not exceed tolerance where the seed was within tol; update the snapshot only if the new lineups are within-tol (run `npx jest tests/next-round-suggester/unit/joint-allocation-integration.test.ts -u --runInBand` after confirming).

- [ ] **Step 4: Deno edge bundle check**

Run: `deno check supabase/functions/session-live-matches-suggest/index.ts`
Expected: no errors.

- [ ] **Step 5: Correctness gate — sim sanity + fairness (FOREGROUND, do not background)**

Run: `npm run sim`
Expected: **sanity + fairness PASS.** Perf-targets FAIL is pre-existing (slow dev machine) and is NOT a regression — do not block on it. If any sanity/fairness assertion fails, STOP and report (that would be a real regression).

- [ ] **Step 6: Commit**

```bash
git add lib/next-round-suggester/live-preview.ts
git commit -m "chore(suggester): bump LIVE_PREVIEW_ALGORITHM_VERSION 54 -> 55 (joint within-tol-first)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Spec "Change 1 — bestSplitForFoursome" → Task 1. ✓
- Spec "Change 2 — jointRepartition swap acceptance" → Task 2. ✓
- Spec "`changed` accounts for over-count" → Task 2 Step 3 (`changed = overAfter < overBefore || ...`). ✓
- Spec "Invariants preserved (blowout reduction / within-tol tie-break)" → Task 2 preservation test. ✓
- Spec "ALGO bump 54→55" → Task 3 Step 1. ✓
- Spec "Testing: unit + regression repro + sim + flag-OFF byte-identical" → Task 1/2 unit, Task 3 repro/suite/sim. ✓
- Spec "Blast radius confined to quality-cost.ts" → sole callers verified; Task 3 checks integration + deno. ✓

**Placeholder scan:** No TBD/TODO; every code step has runnable code. ✓

**Type consistency:** `bestSplitForFoursome` returns `{ cost, gap, overTol, team_a, team_b }` in Task 1; Task 2 consumes `.overTol`/`.cost` from that exact shape. `jointRepartition` return shape unchanged. `createPlayer`/`createState`/`setOpponentRepeats`/`getEffectivePvna` signatures match the existing test file + factories. ✓
