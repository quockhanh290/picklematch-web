# Single-Court Deterministic Lineup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make single-court (`suggestNextMatch`) suggestion deterministic — the same state always yields the same optimal lineup, never seating a repeat-3 when a cleaner lineup exists at equal fairness — by replacing the wall-clock-gated exhaustive fallback with a cheap, bounded, deterministic quality-cost scan.

**Architecture:** Add a pure cheap-scan helper that enumerates C(n,4)×3 lineups (respecting the fairness hard-filter `requiredPlayerIds` and avoid-pairs) and returns the min-`computeQualityCost` foursome — with NO `makeAlternative` and NO `Date.now()`. Wire it into `suggestNextMatchExhaustiveFallback` for eligible pools ≤ 20, and stop skipping that fallback under budget pressure for single-court. Materialize the winner with one `makeAlternative` call to preserve pairing/warning semantics.

**Tech Stack:** TypeScript (Deno-compatible engine module, `.ts` import extensions), Jest.

## Global Constraints

- Engine files under `lib/next-round-suggester/` are bundled for Deno edge; use local `.ts` import extensions and keep `@ts-ignore` import style already present in `forced-tradeoff.ts`.
- Fairness is a HARD filter: `requiredPlayerIds` (consecutive_rest ≥ 1, late-arrival ≥ 2, MUST_PLAY tier, forced_required, ranked-capped at 4) must appear in every candidate lineup. Optimize repeat/balance only within the remaining freedom.
- Scope is single-court only (`suggestNextMatch`, which sets `config.courts = 1`). Do NOT touch the multi-court `suggestNextRound` strategy loop.
- Pool cap: apply the deterministic scan only when `eligiblePlayers.length ≤ 20`; larger pools keep the current behavior unchanged.
- Determinism: the scan path must contain no `Date.now()`/`Math.random()`/wall-clock dependence.
- Never run the full `tests/next-round-suggester` suite (simulation hangs). Run specific files with `--runInBand`.
- Bump `LIVE_PREVIEW_ALGORITHM_VERSION` in `live-preview.ts` before deploy (currently 52 → 53).

---

### Task 1: Pure cheap-scan helper `findMinCostFoursome`

**Files:**
- Modify: `lib/next-round-suggester/forced-tradeoff.ts`
- Test: `tests/next-round-suggester/unit/find-min-cost-foursome.test.ts`

**Interfaces:**
- Consumes: `computeQualityCost` (already imported in forced-tradeoff.ts), `candidateLineups` (private there), `SessionState`.
- Produces: `export function findMinCostFoursome(poolIds: string[], requiredIds: Set<string>, state: SessionState, tolerance: number): { ids: [string,string,string,string]; team_a: Team; team_b: Team; cost: number; maxMeeting: number } | null`
  - Returns null when `poolIds.length < 4` or `poolIds.length > FORCED_TRADEOFF_MAX_POOL` (28) or no subset contains all `requiredIds`.
  - Enumerates every 4-subset of `poolIds` that contains all `requiredIds`; for each, evaluates its 3 splits via `candidateLineups`; scores each split with `computeQualityCost(...).cost`; returns the global lexicographic minimum `(cost, then maxMeeting, then gap, then joined-id string for a total order)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/next-round-suggester/unit/find-min-cost-foursome.test.ts
import { findMinCostFoursome } from '../../../lib/next-round-suggester/forced-tradeoff'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'
import type { SessionState } from '../../../lib/next-round-suggester/types'

function poolState(pvnaById: Record<string, number>, currentRound = 4): SessionState {
  const players = Object.entries(pvnaById).map(([id, pvna]) => createPlayer(id, { pvna, matches_played: 3 }))
  return createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound })
}

describe('findMinCostFoursome', () => {
  it('prefers a clean foursome over a balanced repeat at equal fairness', () => {
    // 5 uniform-skill players; a1-b1 and a2-b2 are partner-saturated so the "obvious" balanced split
    // repeats, but swapping in the 5th (fresh) player yields a clean lineup at the same skill balance.
    const state = poolState({ a1: 3.0, b1: 3.0, a2: 3.0, b2: 3.0, c: 3.0 })
    setPartnerRepeats(state.players.get('a1')!, state.players.get('b1')!, 2)
    setPartnerRepeats(state.players.get('a2')!, state.players.get('b2')!, 2)
    setPartnerRepeats(state.players.get('a1')!, state.players.get('a2')!, 2)
    setPartnerRepeats(state.players.get('b1')!, state.players.get('b2')!, 2)
    const res = findMinCostFoursome(['a1', 'b1', 'a2', 'b2', 'c'], new Set(), state, 0.5)
    expect(res).not.toBeNull()
    expect(res!.maxMeeting).toBeLessThan(3)
  })

  it('keeps every required player in the chosen foursome (fairness hard-filter)', () => {
    const state = poolState({ r1: 4.5, r2: 4.6, x: 2.0, y: 2.1, z: 2.2 })
    const res = findMinCostFoursome(['r1', 'r2', 'x', 'y', 'z'], new Set(['r1', 'r2']), state, 0.5)
    expect(res).not.toBeNull()
    expect(res!.ids).toEqual(expect.arrayContaining(['r1', 'r2']))
  })

  it('returns null below 4 or above the pool cap', () => {
    const small = poolState({ a: 3, b: 3, c: 3 })
    expect(findMinCostFoursome(['a', 'b', 'c'], new Set(), small, 0.5)).toBeNull()
    const big = poolState(Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['p' + i, 3.0])))
    expect(findMinCostFoursome(Array.from({ length: 30 }, (_, i) => 'p' + i), new Set(), big, 0.5)).toBeNull()
  })

  it('is deterministic across repeated calls', () => {
    const state = poolState({ a: 2.5, b: 3.5, c: 2.6, d: 3.4, e: 3.0, f: 3.0 })
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const first = findMinCostFoursome(ids, new Set(), state, 0.5)
    for (let i = 0; i < 5; i++) {
      expect(findMinCostFoursome(ids, new Set(), state, 0.5)).toEqual(first)
    }
  })
})
```

- [ ] **Step 2: Run it, verify it fails** — `npx jest tests/next-round-suggester/unit/find-min-cost-foursome.test.ts --runInBand`. Expected: FAIL (`findMinCostFoursome is not a function`).

- [ ] **Step 3: Implement `findMinCostFoursome` in `forced-tradeoff.ts`** (append after `buildFreshestLineup`):

```ts
export type MinCostFoursome = {
  ids: [string, string, string, string]
  team_a: Team; team_b: Team
  cost: number; maxMeeting: number; gap: number
}

// Deterministic total order over candidate lineups: cost → maxMeeting → gap → joined-id string.
// The id-string final tie-break guarantees a single winner with zero dependence on iteration or
// insertion order (so the result never varies between runs on identical state).
function foursomeLessThan(a: MinCostFoursome, b: MinCostFoursome): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost
  if (a.maxMeeting !== b.maxMeeting) return a.maxMeeting < b.maxMeeting
  if (a.gap !== b.gap) return a.gap < b.gap
  return a.ids.join(',') < b.ids.join(',')
}

// The min-quality-cost foursome over the pool, respecting a fairness hard-filter (requiredIds must all
// be in the chosen four) and avoid-pairs (via candidateLineups, which drops avoid-partner splits).
// Pure — no Date.now/Math.random, no makeAlternative. Returns null for pool < 4, pool >
// FORCED_TRADEOFF_MAX_POOL, or when no subset contains every required id.
export function findMinCostFoursome(
  poolIds: string[], requiredIds: Set<string>, state: SessionState, tolerance: number,
): MinCostFoursome | null {
  if (poolIds.length < 4 || poolIds.length > FORCED_TRADEOFF_MAX_POOL) return null
  const required = [...requiredIds]
  const ids = poolIds
  let best: MinCostFoursome | null = null
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      for (let k = j + 1; k < ids.length; k += 1)
        for (let l = k + 1; l < ids.length; l += 1) {
          const four: [string, string, string, string] = [ids[i], ids[j], ids[k], ids[l]]
          if (required.length > 0 && !required.every(id => four.includes(id))) continue
          for (const lu of candidateLineups(four, state)) {
            const cost = computeQualityCost(lu.team_a, lu.team_b, state, { tolerance }).cost
            const cand: MinCostFoursome = {
              ids: four, team_a: lu.team_a, team_b: lu.team_b, cost, maxMeeting: lu.maxMeeting, gap: lu.gap,
            }
            if (best === null || foursomeLessThan(cand, best)) best = cand
          }
        }
  return best
}
```

`candidateLineups`, `FORCED_TRADEOFF_MAX_POOL`, `computeQualityCost`, and `Team` are already in scope in `forced-tradeoff.ts`. `candidateLineups` returns `{ team_a, team_b, gap, maxMeeting }` per split.

- [ ] **Step 4: Run the tests, verify pass** — `npx jest tests/next-round-suggester/unit/find-min-cost-foursome.test.ts --runInBand`. Expected: 4 passed.

- [ ] **Step 5: Commit** — `git add lib/next-round-suggester/forced-tradeoff.ts tests/next-round-suggester/unit/find-min-cost-foursome.test.ts && git commit -m "feat(engine): findMinCostFoursome — deterministic min-quality-cost single-court lineup"`

---

### Task 2: Deterministic single-court correction in `suggestNextMatch`

**Files:**
- Modify: `lib/next-round-suggester/suggest.ts` (`suggestNextMatch` ~863-961; `suggestNextMatchExhaustiveFallback` ~1024+)
- Modify: `lib/next-round-suggester/live-preview.ts` (bump `LIVE_PREVIEW_ALGORITHM_VERSION` 52 → 53)
- Test: `tests/next-round-suggester/unit/single-court-deterministic.test.ts`

**Interfaces:**
- Consumes: `findMinCostFoursome` (Task 1), `makeAlternative`, `sortSingleMatchAlternatives`, the existing `requiredPlayerIds` derivation inside `suggestNextMatchExhaustiveFallback`.
- Produces: no new exports; behavior change only.

**Integration decisions (from spec):**
1. **Stop skipping the fallback under budget pressure for single-court.** At `suggest.ts:936` the guard `if (remainingRuntimeMs !== undefined && remainingRuntimeMs <= 100) return mappedResult` currently drops the fallback on slow/cold requests. Change it so a single match always runs the fallback when `shouldCheckFallback` (the whole point — the fallback is now cheap/bounded). Keep passing a budget only as a safety net for the > 20 legacy path.
2. **Inside `suggestNextMatchExhaustiveFallback`, add a deterministic fast path** for `eligiblePlayers.length ≤ 20`: after `requiredPlayerIds` is finalized (post the > 4 ranked-cap at line ~1082), call `findMinCostFoursome(eligibleIds, requiredPlayerIds, state, tolerance)`. If it returns a foursome, `makeAlternative` on those 4 players (allowRelaxedTolerance/allowRepeatOverflow = true so a genuinely forced pool still materializes), push it as the sole candidate, and skip the timed `getAllCombinations` stage loop entirely. For `> 20`, run the existing loop unchanged.

- [ ] **Step 1: Write the failing repro test**

```ts
// tests/next-round-suggester/unit/single-court-deterministic.test.ts
import { suggestNextMatch } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'
import type { SessionState } from '../../../lib/next-round-suggester/types'

// A single-court pool where the greedy/fairness top pairs a partner-saturated foursome (a repeat-3),
// while a clean foursome exists using the 5th player at equal fairness (all uniform rest/matches).
function flakyState(): SessionState {
  const players = [
    createPlayer('vk', { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('hu', { pvna: 4.7, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('pt', { pvna: 4.4, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('dt', { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('vl', { pvna: 2.8, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('pd', { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
  ]
  const s = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 4 })
  // saturate the "balanced" foursome so its every split is a 3rd opponent meeting
  for (const [x, y] of [['vk', 'pt'], ['vk', 'dt'], ['hu', 'pt'], ['hu', 'dt'], ['vk', 'hu'], ['pt', 'dt']]) {
    const px = s.players.get(x)!, py = s.players.get(y)!
    px.opponent_counts.set(y, 3); py.opponent_counts.set(x, 3)
  }
  return s
}

describe('single-court deterministic lineup', () => {
  it('seats a clean lineup even when the request budget is near-zero (fix for the timeout flakiness)', () => {
    const state = flakyState()
    const res = suggestNextMatch(state, { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const m = res.alternatives[0].matches[0]
    const meet = (a: string, b: string) => (state.players.get(a)!.opponent_counts.get(b) ?? 0) + 1
    const maxMeet = Math.max(
      ...m.team_a.flatMap(a => m.team_b.map(b => meet(a, b))),
    )
    expect(maxMeet).toBeLessThan(3) // clean, not the repeat-3 the greedy path would seat under timeout
  })

  it('is deterministic under different simulated budgets', () => {
    const key = (r: ReturnType<typeof suggestNextMatch>) => {
      const m = r.alternatives[0].matches[0]
      return [[...m.team_a].sort(), [...m.team_b].sort()].sort().join('|')
    }
    const a = suggestNextMatch(flakyState(), { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const b = suggestNextMatch(flakyState(), { court_idx: 5, max_alternatives: 1, max_runtime_ms: 100000 })
    expect(key(a)).toEqual(key(b))
  })

  it('keeps a rested-required player in the lineup (fairness hard-filter preserved)', () => {
    const state = flakyState()
    state.players.get('hu')!.consecutive_rest = 2 // hu must play now
    const res = suggestNextMatch(state, { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const ids = [...res.alternatives[0].matches[0].team_a, ...res.alternatives[0].matches[0].team_b]
    expect(ids).toContain('hu')
  })
})
```

- [ ] **Step 2: Run it, verify the repro fails** — `npx jest tests/next-round-suggester/unit/single-court-deterministic.test.ts --runInBand`. Expected: the first test FAILS (seats the repeat-3 under `max_runtime_ms: 1` today).

- [ ] **Step 3: Fix the skip gate in `suggestNextMatch`** — replace the early-return at `suggest.ts:936`:

```ts
// BEFORE:
//   const remainingRuntimeMs = options.max_runtime_ms === undefined
//     ? undefined
//     : options.max_runtime_ms - (Date.now() - startedAt)
//   if (remainingRuntimeMs !== undefined && remainingRuntimeMs <= 100) return mappedResult
// AFTER: always run the fallback (it is bounded & deterministic for small pools now). Keep a budget
// value only for the legacy > 20 path's internal timeout.
const remainingRuntimeMs = options.max_runtime_ms === undefined
  ? undefined
  : Math.max(0, options.max_runtime_ms - (Date.now() - startedAt))
```

- [ ] **Step 4: Add the deterministic fast path in `suggestNextMatchExhaustiveFallback`** — immediately after the `requiredPlayerIds.size > 4` ranked-cap block (`suggest.ts:~1082`), before the timed stage loop:

```ts
// Deterministic fast path for realistic single-court pools: pick the min-quality-cost foursome by a
// cheap exhaustive scan (no wall-clock, no per-combo makeAlternative), then materialize it once. This
// removes the timing-dependent truncation that let a repeat-3 slip through when a clean lineup exists.
if (eligiblePlayers.length >= 4 && eligiblePlayers.length <= 20) {
  const tolerance = state.config.pvna_tolerance ?? 0.5
  const eligibleIds = eligiblePlayers.map((p) => p.player_id)
  const best = findMinCostFoursome(eligibleIds, requiredPlayerIds, state, tolerance)
  if (best) {
    const selected = best.ids.map((id) => state.players.get(id)!).filter(Boolean)
    const alternative = makeAlternative(
      selected, eligiblePlayers, state, warnings, undefined, partitioningCache, true, true, false,
      options.preview_seed, thresholds,
    )
    if (alternative) {
      return {
        alternatives: [{
          ...alternative,
          matches: alternative.matches.slice(0, 1).map((match) => ({ ...match, court_idx })),
        }],
        warnings,
        should_end: false,
      }
    }
  }
  // best === null (over cap handled by the > 20 branch; < 4 impossible here) or unmaterializable:
  // fall through to the legacy timed loop.
}
```

Import `findMinCostFoursome` at the top of `suggest.ts` from `./forced-tradeoff.ts` (match the existing `@ts-ignore` local-`.ts` import style). Confirm `thresholds`, `warnings`, `partitioningCache`, `court_idx`, `options.preview_seed` are in scope at that point (they are — defined earlier in the function).

- [ ] **Step 5: Run the repro + determinism + fairness tests, verify pass** — `npx jest tests/next-round-suggester/unit/single-court-deterministic.test.ts --runInBand`. Expected: 3 passed.

- [ ] **Step 6: Bump the algorithm version** — in `lib/next-round-suggester/live-preview.ts` change `export const LIVE_PREVIEW_ALGORITHM_VERSION = 52` to `= 53`.

- [ ] **Step 7: Regression — run the affected engine unit/scenario tests** (NOT the full suite):

```bash
npx jest tests/next-round-suggester/unit/forced-tradeoff.test.ts tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts tests/next-round-suggester/unit/find-min-cost-foursome.test.ts tests/next-round-suggester/unit/single-court-deterministic.test.ts --runInBand
```
Expected: all pass. If any pre-existing single-court scenario test changed its seated lineup, inspect: a change to a strictly-lower-cost lineup at equal fairness is the intended improvement (update the assertion with a comment); a change that drops a required player or raises cost is a regression to fix.

- [ ] **Step 8: Typecheck + deno check** — `npm run typecheck:guard` (only new errors in `lib/`/`tests/` are blockers; pre-existing `scratch/`+`tmp/` noise is not) and `cd supabase/functions && deno check session-live-matches-suggest/index.ts`.

- [ ] **Step 9: Commit** — `git add lib/next-round-suggester/suggest.ts lib/next-round-suggester/live-preview.ts tests/next-round-suggester/unit/single-court-deterministic.test.ts && git commit -m "fix(engine): deterministic single-court lineup — cheap quality-cost scan replaces timeout-flaky fallback"`

---

## Post-plan (not tasks — human-gated)

- Deploy edge (v230) — outward-facing, requires explicit user go.
- Host QA on canary 1db29119: re-suggest Sân 6 repeatedly → same lineup every time; no spurious wait-rescue/forced panel when a clean lineup exists.
- Follow-up (parked): multi-court determinism (out of scope here); consider retiring the legacy timed combo loop once single-court is proven.
