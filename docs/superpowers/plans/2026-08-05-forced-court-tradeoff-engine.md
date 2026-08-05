# Forced-Court Tradeoff — Plan 1: Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure engine logic that, for a court being filled, detects when no clean lineup exists and produces the two Pareto endpoints (① accept-repeat, ③ accept-imbalance) plus a simulation-verified wait-rescue list — the data the host's 3-way decision needs.

**Architecture:** New pure module `lib/next-round-suggester/forced-tradeoff.ts` (no React, no I/O) exporting `buildTradeoffEndpoints` + `simulateWaitWouldClean`, built on the existing `computeQualityCost` / `getProjectedRepeatSummary` / `getAvoidPenalty` / `getEffectivePvna`. Wired into `buildSuggestedMatchPayloads` behind the `SESSION_QUALITY_COST_MODEL` flag. Plans 2 (delivery/persist) and 3 (client UI) consume this output.

**Tech Stack:** TypeScript (strict), Jest (`--runInBand`, deterministic unit subset only), existing `lib/next-round-suggester/` engine.

## Global Constraints

- **Never run the simulation suite** (`tests/next-round-suggester/simulation`) — hangs. Run only the specific new/touched files with `--runInBand`.
- **Determinism:** no `Math.random`/`Date.now`; fixed enumeration order over the pool; same input → identical output. Ties broken deterministically (lower player-id order, then split order).
- **Flag OFF = byte-identical:** all new behavior gated behind `isQualityCostModelEnabled(state)`; flag OFF returns today's payloads unchanged.
- **Hard invariants respected:** a candidate lineup pairing two avoid-partners (`getAvoidPenalty(x,y,'partner') === AVOID_PARTNER_PENALTY`) is never emitted. The eligible pool passed in already encodes rest/owed/checked-out eligibility; the endpoint builder does not re-derive it.
- **"Clean" = within tolerance AND repeat-free:** `gap <= tolerance` AND `maxMeeting < 3`. `gap = |sumA - sumB|` over effective pvna; `maxMeeting = max(getProjectedRepeatSummary.max_partner_pair_count, .max_opponent_pair_count)`.
- **Local imports** inside `lib/next-round-suggester/` use the `.ts` extension with `// @ts-ignore` (Deno bundling), matching sibling files.
- Do **not** bump `LIVE_PREVIEW_ALGORITHM_VERSION` in this plan (reserved for the flag-flip).

---

### Task 1: `buildTradeoffEndpoints` — bad-court detection + two Pareto endpoints

**Files:**
- Create: `lib/next-round-suggester/forced-tradeoff.ts`
- Test: `tests/next-round-suggester/unit/forced-tradeoff.test.ts` (create)

**Interfaces:**
- Consumes: `computeQualityCost`, `bestSplitForFoursome`, `Foursome` (`./quality-cost.ts`); `getProjectedRepeatSummary` (`./score.ts`); `getEffectivePvna` (`./state.ts`); `getAvoidPenalty`, `AVOID_PARTNER_PENALTY` (`./avoid.ts`); `Team`, `SessionState` (`./types.ts`).
- Produces:
  ```ts
  export type TradeoffLineup = { team_a: Team; team_b: Team; gap: number; maxMeeting: number }
  export type ForcedTradeoff =
    | { isForced: false; clean: TradeoffLineup }
    | { isForced: true; acceptRepeat: TradeoffLineup; acceptImbalance: TradeoffLineup }
    | { isForced: false; clean: null }   // pool too small (<4) — caller falls back to existing path
  export function buildTradeoffEndpoints(
    poolIds: string[], state: SessionState, tolerance: number,
  ): ForcedTradeoff
  ```
  - Enumerates every 4-subset of `poolIds` × its 3 splits into `(gap, maxMeeting)` candidate lineups, skipping any split that pairs two avoid-partners.
  - A candidate is **clean** iff `gap <= tolerance && maxMeeting < 3`.
  - If any clean candidate exists → `{ isForced: false, clean: <the min-cost clean one by computeQualityCost> }`.
  - Else → `{ isForced: true, acceptRepeat, acceptImbalance }` where
    `acceptRepeat` = min by `(gap, maxMeeting)` lexicographic (ties → min computeQualityCost, then split/id order);
    `acceptImbalance` = min by `(maxMeeting, gap)` lexicographic (same tie-break).
  - `poolIds.length < 4` → `{ isForced: false, clean: null }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/next-round-suggester/unit/forced-tradeoff.test.ts`:

```ts
import { buildTradeoffEndpoints } from '../../../lib/next-round-suggester/forced-tradeoff'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setOpponentRepeats } from '../helpers/factories'

function stateWith(pvnaById: Record<string, number>, currentRound = 0): SessionState {
  const players = Object.entries(pvnaById).map(([id, pvna]) => createPlayer(id, { pvna }))
  return createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound })
}

describe('buildTradeoffEndpoints', () => {
  it('returns a clean lineup (not forced) when one exists in the pool', () => {
    // 4 balanced fresh players → a clean split exists.
    const state = stateWith({ a: 3.0, b: 3.0, c: 3.1, d: 3.1 })
    const res = buildTradeoffEndpoints(['a', 'b', 'c', 'd'], state, 0.5)
    expect(res.isForced).toBe(false)
    if (res.isForced === false && res.clean) {
      expect(res.clean.gap).toBeLessThanOrEqual(0.5)
      expect(res.clean.maxMeeting).toBeLessThan(3)
    }
  })

  it('is forced when every lineup either repeats or is imbalanced; endpoints are the two Pareto extremes', () => {
    // Pool of 4 where: the only balanced split forces a 3rd meeting, and the only fresh split is imbalanced.
    // 2 lows + 2 highs; the balanced-total split (low+high vs low+high) recreates a recorded 3rd meeting,
    // the fresh split (lows vs highs) is a gap-1.5 blowout.
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.6, hi2: 3.7 }, 3)
    // record lo1&hi1 and lo2&hi2 as opponents twice already → pairing them again = 3rd meeting
    setOpponentRepeats(state.players.get('lo1')!, state.players.get('hi1')!, 2)
    setOpponentRepeats(state.players.get('lo2')!, state.players.get('hi2')!, 2)
    const res = buildTradeoffEndpoints(['lo1', 'lo2', 'hi1', 'hi2'], state, 0.5)
    expect(res.isForced).toBe(true)
    if (res.isForced) {
      // acceptRepeat = most balanced (gap small), tolerates the 3rd meeting
      expect(res.acceptRepeat.gap).toBeLessThanOrEqual(res.acceptImbalance.gap)
      // acceptImbalance = freshest (lowest maxMeeting), tolerates the gap
      expect(res.acceptImbalance.maxMeeting).toBeLessThanOrEqual(res.acceptRepeat.maxMeeting)
      // they genuinely differ (a real tradeoff)
      expect([...res.acceptRepeat.team_a, ...res.acceptRepeat.team_b].sort())
        .not.toEqual([...res.acceptImbalance.team_a, ...res.acceptImbalance.team_b].sort() )
        // NOTE: same 4 players, different SPLIT — compare the split, not the id set:
    }
  })

  it('never pairs two avoid-partners in either endpoint', () => {
    const state = stateWith({ a: 2.0, b: 2.1, c: 3.6, d: 3.7 }, 3)
    // make a & b an avoid-partner pair via the factory's avoid mechanism
    const A = state.players.get('a')!; const B = state.players.get('b')!
    ;(A as any).avoid_partner_ids = new Set(['b']); (B as any).avoid_partner_ids = new Set(['a'])
    state.config.avoid_pairs = [{ player_a_id: 'a', player_b_id: 'b', mode: 'partner' } as any]
    const res = buildTradeoffEndpoints(['a', 'b', 'c', 'd'], state, 0.5)
    const pairsAvoid = (t: string[]) => t.length === 2 && ((t[0] === 'a' && t[1] === 'b') || (t[0] === 'b' && t[1] === 'a'))
    const check = (lu?: { team_a: string[]; team_b: string[] }) => { if (lu) { expect(pairsAvoid(lu.team_a)).toBe(false); expect(pairsAvoid(lu.team_b)).toBe(false) } }
    if (res.isForced) { check(res.acceptRepeat); check(res.acceptImbalance) } else if (res.clean) check(res.clean)
  })

  it('pool smaller than 4 → not forced, clean null (caller falls back)', () => {
    const state = stateWith({ a: 3.0, b: 3.0, c: 3.0 })
    expect(buildTradeoffEndpoints(['a', 'b', 'c'], state, 0.5)).toEqual({ isForced: false, clean: null })
  })
})
```

Implementer note: verify how the repo's factories express avoid-pairs (`tests/next-round-suggester/helpers/factories.ts` + `lib/next-round-suggester/avoid.ts:getAvoidPenalty`); adjust the avoid-setup in test 3 to the real mechanism (the assertion — no avoid-partners teamed — is what matters). For the "endpoints differ" assertion in test 2, compare the SPLIT (which players are teammates), not the id set (the 4 ids are the same); use a partner-pair key like `[team_a.sort().join()]` per lineup.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff.test.ts --runInBand`
Expected: FAIL — `buildTradeoffEndpoints is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/next-round-suggester/forced-tradeoff.ts`:

```ts
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState, Team } from './types.ts'
// @ts-ignore
import { getEffectivePvna } from './state.ts'
// @ts-ignore
import { getProjectedRepeatSummary } from './score.ts'
// @ts-ignore
import { computeQualityCost } from './quality-cost.ts'
// @ts-ignore
import { getAvoidPenalty, AVOID_PARTNER_PENALTY } from './avoid.ts'

export type TradeoffLineup = { team_a: Team; team_b: Team; gap: number; maxMeeting: number }
export type ForcedTradeoff =
  | { isForced: false; clean: TradeoffLineup | null }
  | { isForced: true; acceptRepeat: TradeoffLineup; acceptImbalance: TradeoffLineup }

const SPLITS: readonly [readonly [number, number], readonly [number, number]][] = [
  [[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]],
]

function candidateLineups(four: string[], state: SessionState): TradeoffLineup[] {
  const pv = (id: string) => getEffectivePvna(state.players.get(id)!)
  const P = (id: string) => state.players.get(id)!
  const out: TradeoffLineup[] = []
  for (const [sa, sb] of SPLITS) {
    const team_a: Team = [four[sa[0]], four[sa[1]]]
    const team_b: Team = [four[sb[0]], four[sb[1]]]
    if (getAvoidPenalty(P(team_a[0]), P(team_a[1]), 'partner') === AVOID_PARTNER_PENALTY) continue
    if (getAvoidPenalty(P(team_b[0]), P(team_b[1]), 'partner') === AVOID_PARTNER_PENALTY) continue
    const gap = Math.abs(pv(team_a[0]) + pv(team_a[1]) - pv(team_b[0]) - pv(team_b[1]))
    const rep = getProjectedRepeatSummary(team_a, team_b, state)
    const maxMeeting = Math.max(rep.max_partner_pair_count, rep.max_opponent_pair_count)
    out.push({ team_a, team_b, gap, maxMeeting })
  }
  return out
}

export function buildTradeoffEndpoints(
  poolIds: string[], state: SessionState, tolerance: number,
): ForcedTradeoff {
  if (poolIds.length < 4) return { isForced: false, clean: null }
  const cost = (lu: TradeoffLineup) => computeQualityCost(lu.team_a, lu.team_b, state, { tolerance }).cost
  const all: TradeoffLineup[] = []
  const ids = poolIds
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      for (let k = j + 1; k < ids.length; k += 1)
        for (let l = k + 1; l < ids.length; l += 1)
          all.push(...candidateLineups([ids[i], ids[j], ids[k], ids[l]], state))
  if (all.length === 0) return { isForced: false, clean: null }
  const clean = all.filter(lu => lu.gap <= tolerance && lu.maxMeeting < 3)
  if (clean.length > 0) {
    const best = clean.reduce((m, lu) => (cost(lu) < cost(m) ? lu : m))
    return { isForced: false, clean: best }
  }
  // lexicographic pickers with computeQualityCost tie-break
  const lexMin = (primary: (lu: TradeoffLineup) => number, secondary: (lu: TradeoffLineup) => number) =>
    all.reduce((m, lu) => {
      if (primary(lu) !== primary(m)) return primary(lu) < primary(m) ? lu : m
      if (secondary(lu) !== secondary(m)) return secondary(lu) < secondary(m) ? lu : m
      return cost(lu) < cost(m) ? lu : m
    })
  const acceptRepeat = lexMin(lu => lu.gap, lu => lu.maxMeeting)
  const acceptImbalance = lexMin(lu => lu.maxMeeting, lu => lu.gap)
  return { isForced: true, acceptRepeat, acceptImbalance }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff.test.ts --runInBand`
Expected: PASS (all 4 tests). Fix the test-3 avoid setup to the real factory mechanism if needed.

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/forced-tradeoff.ts tests/next-round-suggester/unit/forced-tradeoff.test.ts
git commit -m "feat(forced-tradeoff): buildTradeoffEndpoints — clean check + 2 Pareto endpoints"
```

---

### Task 2: `simulateWaitWouldClean` — verified wait-rescue

**Files:**
- Modify: `lib/next-round-suggester/forced-tradeoff.ts` (append)
- Test: `tests/next-round-suggester/unit/forced-tradeoff.test.ts` (extend)

**Interfaces:**
- Consumes: `buildTradeoffEndpoints` (Task 1).
- Produces:
  ```ts
  export type WaitRescueOption = { court_idx: number; started_at: string | null }
  // For each live court, add its 4 players to the pool and test whether a CLEAN lineup for the target
  // court becomes possible. Returns the courts that would, sorted longest-running first (earliest
  // started_at → likeliest to finish soonest). Empty when no single court's completion yields a clean fill.
  export function simulateWaitWouldClean(
    poolIds: string[],
    liveCourts: { court_idx: number; player_ids: string[]; started_at: string | null }[],
    state: SessionState, tolerance: number,
  ): WaitRescueOption[]
  ```

- [ ] **Step 1: Write the failing tests**

Append to `forced-tradeoff.test.ts`:

```ts
import { simulateWaitWouldClean } from '../../../lib/next-round-suggester/forced-tradeoff'

describe('simulateWaitWouldClean', () => {
  it('offers a court whose players, when returned, enable a clean fill', () => {
    // pool of 4 that is forced (2 lows + 2 highs, imbalanced-or-repeat). A live court holds 2 mids that,
    // added to the pool, allow a clean balanced fresh split.
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8, mid1: 2.9, mid2: 3.0, x1: 4.0, x2: 4.0 }, 3)
    setOpponentRepeats(state.players.get('lo1')!, state.players.get('hi1')!, 2)
    setOpponentRepeats(state.players.get('lo2')!, state.players.get('hi2')!, 2)
    const pool = ['lo1', 'lo2', 'hi1', 'hi2']
    const live = [
      { court_idx: 3, player_ids: ['mid1', 'mid2', 'x1', 'x2'], started_at: '2026-08-05T07:00:00Z' },
    ]
    const res = simulateWaitWouldClean(pool, live, state, 0.5)
    expect(res.map(r => r.court_idx)).toContain(3)
  })

  it('offers nothing when no single court completion yields a clean fill', () => {
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8, a: 2.0, b: 2.0, c: 2.0, d: 2.0 }, 3)
    setOpponentRepeats(state.players.get('lo1')!, state.players.get('hi1')!, 2)
    setOpponentRepeats(state.players.get('lo2')!, state.players.get('hi2')!, 2)
    // the live court is all lows → adding them can't balance the highs, still forced
    const live = [{ court_idx: 3, player_ids: ['a', 'b', 'c', 'd'], started_at: '2026-08-05T07:00:00Z' }]
    expect(simulateWaitWouldClean(['lo1', 'lo2', 'hi1', 'hi2'], live, state, 0.5)).toEqual([])
  })

  it('sorts qualifying courts longest-running first (earliest started_at)', () => {
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8, m1: 3.0, m2: 3.0, m3: 3.0, m4: 3.0, n1: 3.0, n2: 3.0, n3: 3.0, n4: 3.0 }, 3)
    setOpponentRepeats(state.players.get('lo1')!, state.players.get('hi1')!, 2)
    setOpponentRepeats(state.players.get('lo2')!, state.players.get('hi2')!, 2)
    const live = [
      { court_idx: 1, player_ids: ['m1', 'm2', 'm3', 'm4'], started_at: '2026-08-05T07:10:00Z' },
      { court_idx: 2, player_ids: ['n1', 'n2', 'n3', 'n4'], started_at: '2026-08-05T07:00:00Z' }, // earlier
    ]
    const res = simulateWaitWouldClean(['lo1', 'lo2', 'hi1', 'hi2'], live, state, 0.5)
    if (res.length === 2) expect(res[0].court_idx).toBe(2) // earliest started_at first
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff.test.ts --runInBand`
Expected: FAIL — `simulateWaitWouldClean is not a function`.

- [ ] **Step 3: Implement**

Append to `forced-tradeoff.ts`:

```ts
export type WaitRescueOption = { court_idx: number; started_at: string | null }

export function simulateWaitWouldClean(
  poolIds: string[],
  liveCourts: { court_idx: number; player_ids: string[]; started_at: string | null }[],
  state: SessionState, tolerance: number,
): WaitRescueOption[] {
  const poolSet = new Set(poolIds)
  const qualifying: WaitRescueOption[] = []
  for (const court of liveCourts) {
    const enlarged = [...poolIds, ...court.player_ids.filter(id => !poolSet.has(id))]
    const res = buildTradeoffEndpoints(enlarged, state, tolerance)
    if (res.isForced === false && res.clean) qualifying.push({ court_idx: court.court_idx, started_at: court.started_at })
  }
  return qualifying.sort((a, b) => {
    const ta = a.started_at ? Date.parse(a.started_at) : Infinity
    const tb = b.started_at ? Date.parse(b.started_at) : Infinity
    return ta - tb || a.court_idx - b.court_idx
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff.test.ts --runInBand`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/forced-tradeoff.ts tests/next-round-suggester/unit/forced-tradeoff.test.ts
git commit -m "feat(forced-tradeoff): simulateWaitWouldClean — verified wait-rescue"
```

---

### Task 3: Integrate into `buildSuggestedMatchPayloads` (flag-gated)

**Files:**
- Modify: `lib/next-round-suggester/live-preview.ts`
- Test: `tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts` (create)

**Interfaces:**
- Consumes: `buildTradeoffEndpoints`, `simulateWaitWouldClean`, `ForcedTradeoff`, `WaitRescueOption` (Tasks 1-2); `isQualityCostModelEnabled` (flag).
- Produces: two new optional fields on `SuggestedMatchPayload` — `forced_tradeoff?: { acceptRepeat: {team_a,team_b}; acceptImbalance: {team_a,team_b} }` and `wait_rescue_options?: WaitRescueOption[]` — populated (flag ON) only for a court whose primary suggestion is a forced bad court. Add both to the `SuggestedLiveMatchRow`/`SuggestedMatchPayload` type declarations near the existing `degraded_reason`/`rescue_court_idxs` fields.

- [ ] **Step 1: Add the payload fields**

In `lib/next-round-suggester/live-preview.ts`, extend the `SuggestedMatchPayload` type (the `Pick<...>` at ~line 375 and the underlying `SuggestedLiveMatchRow` field list) with:
```ts
  forced_tradeoff?: { acceptRepeat: { team_a: Team; team_b: Team }; acceptImbalance: { team_a: Team; team_b: Team } }
  wait_rescue_options?: { court_idx: number; started_at: string | null }[]
```
Add the import (mirroring the sibling `.ts` + `// @ts-ignore` pattern):
```ts
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { buildTradeoffEndpoints, simulateWaitWouldClean } from './forced-tradeoff.ts'
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts`, modeled on `repro-tradeoff-gap.ts` / the existing `buildSuggestedMatchPayloads` unit harness (`cap2-recovery.test.ts` for the call shape). Build a bad single-court refill (a tight pool that forces repeat-or-imbalance) and assert:
```ts
// flag ON: the forced bad court carries forced_tradeoff with two distinct endpoints
it('flag ON: a forced bad court emits forced_tradeoff with accept-repeat + accept-imbalance', () => {
  __setQualityCostModelOverrideForTests(true)
  const payloads = buildSuggestedMatchPayloads(/* bad single-court args */)
  const p = payloads[0]
  expect(p.forced_tradeoff).toBeDefined()
  expect(p.forced_tradeoff!.acceptRepeat).not.toEqual(p.forced_tradeoff!.acceptImbalance)
})
it('flag OFF: no forced_tradeoff / wait_rescue_options attached (byte-identical)', () => {
  __setQualityCostModelOverrideForTests(false)
  const payloads = buildSuggestedMatchPayloads(/* same args */)
  expect(payloads[0].forced_tradeoff).toBeUndefined()
  expect(payloads[0].wait_rescue_options).toBeUndefined()
})
it('a clean court emits no forced_tradeoff', () => { /* balanced fresh pool → undefined */ })
afterEach(() => __setQualityCostModelOverrideForTests(null))
```
Implementer: derive the eligible pool + live courts for the calls from the same `state`/`liveRows` the harness builds; if a robust forced single-court fixture is hard to hand-build, source `state`+`liveRows` from a canary dump (`tmp/dump-ae50…`, round 5 `[2]` which is forced repeat) via the `repro-tradeoff-gap.ts` loader pattern, keeping the assertions above.

- [ ] **Step 3: Run to verify fail**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts --runInBand`
Expected: FAIL — `forced_tradeoff` undefined under flag ON (not wired yet).

- [ ] **Step 4: Wire it in `buildSuggestedMatchPayloads`**

At the point each court's payload is pushed (live-preview.ts ~5207, where `finalGuardedAlternative`/`tradeoffChoices` are known), when `isQualityCostModelEnabled(state)`:
- Build the court's eligible pool ids (the same eligible set the per-court search used — reuse the existing `eligible`/`checkedInIds` minus busy, that the loop already computes; if not in scope, compute `[...state.players.values()].filter(idle-eligible)` matching the search's pool).
- `const tradeoff = buildTradeoffEndpoints(poolIds, suggestionStateForCourt, configuredPvnaTolerance)`.
- If `tradeoff.isForced`, set on the payload:
  ```ts
  forced_tradeoff: {
    acceptRepeat: { team_a: tradeoff.acceptRepeat.team_a, team_b: tradeoff.acceptRepeat.team_b },
    acceptImbalance: { team_a: tradeoff.acceptImbalance.team_a, team_b: tradeoff.acceptImbalance.team_b },
  },
  wait_rescue_options: simulateWaitWouldClean(poolIds, liveCourtsForSim, suggestionStateForCourt, configuredPvnaTolerance),
  ```
  where `liveCourtsForSim` = the currently-live courts with their player ids + `started_at` (from `liveMatchRows` / `occupiedCourtIdxs` already in scope). The **displayed** lineup stays whatever the engine chose (default policy already prefers accept-repeat); Plan 3 renders the toggle. When `!tradeoff.isForced`, leave both fields undefined.
- Guard the whole block behind the flag so flag-OFF payloads are unchanged.

- [ ] **Step 5: Run to verify pass**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 6: Regression subset + typecheck**

Run: `npx jest tests/next-round-suggester/unit/forced-tradeoff.test.ts tests/next-round-suggester/unit/live-preview.test.ts tests/next-round-suggester/unit/score-quality-flag.test.ts tests/next-round-suggester/unit/joint-allocation-integration.test.ts --runInBand`
Then: `npm run typecheck:guard`
Expected: PASS; no new lib type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/next-round-suggester/live-preview.ts tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts
git commit -m "feat(forced-tradeoff): attach forced_tradeoff + wait_rescue_options to bad-court payloads (flag-gated)"
```

---

## Self-Review

**Spec coverage:** Task 1 = bad-court detection + 2 Pareto endpoints (spec §Definitions ①/③). Task 2 = simulation-verified wait (spec §Definitions "Chờ Sân Y"). Task 3 = flag-gated integration onto payloads (spec §Architecture layer 1). Plans 2 (delivery/persist) + 3 (client UI) consume `forced_tradeoff` + `wait_rescue_options`. Default policy (accept-repeat shown) is unchanged — the engine's existing pick stays displayed; endpoints are advisory data.

**Placeholder scan:** Task 3's integration test + the eligible-pool sourcing are described against the existing harness (deliberate — mirrors `cap2-recovery.test.ts` / `repro-tradeoff-gap.ts`); the assertions and the wiring code are concrete. No TBD/TODO.

**Type consistency:** `TradeoffLineup`, `ForcedTradeoff`, `WaitRescueOption`, `buildTradeoffEndpoints`, `simulateWaitWouldClean` used identically across tasks. `Team`/`Foursome` from existing modules. `computeQualityCost` opts `{ tolerance }` matches its signature.
