# Unified Quality-Cost Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `scoreMatch`'s mis-scaled weighted sum + 5 hard gates with one social-optimal quality-cost function (hinge balance, escalating recency-weighted repeat, team-aware rematch, mild intra, low gender pref, capped group reward, avoid-partner hard / avoid-opponent heavy-soft), behind a flag, and re-anchor the 3-tier host options to it.

**Architecture:** A new pure module `lib/next-round-suggester/quality-cost.ts` computes the cost of a candidate `(teamA, teamB)` from `SessionState`. `scoreMatch` delegates to it when `SESSION_QUALITY_COST_MODEL` is on, keeping only avoid-partner + structural as hard invariants. Repeat scoring becomes team-aware (a re-split of the same four is not an exact rematch). The existing tradeoff-choice and wait-rescue machinery is re-pointed at the new cost. Fairness/selection is unchanged.

**Tech Stack:** TypeScript (strict), Deno-compatible `.ts` imports for edge bundling, Jest (`--runInBand` for suggester suites), `seedrandom` sim harness.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-04-unified-quality-cost-model-design.md` (source of truth for shapes/priorities).
- `supabase/functions/` is excluded from main tsconfig; every cross-module import inside `lib/next-round-suggester/` MUST use the `// @ts-ignore` + `./x.ts` extension pattern already in `score.ts` (Deno edge bundling).
- Priority when constraints conflict: **participation > balance > variety > gender/group pref** — expressed as magnitude tradeoffs, never rigid tiers.
- The 5 intent-check scenarios (spec §8) are the behavioral contract; they MUST pass for any weight set.
- Only **avoid-partner** and **structural** (4 distinct players, valid 2v2) are hard invariants. Every other former gate is a soft cost region.
- Weight MAGNITUDES are calibration outputs (Task 6); this plan fixes SHAPES and relative ordering. Illustrative starting values are given inline.
- Run suggester Jest suites with `--runInBand` (parallel runs flake under machine load).
- Ship behind env flag `SESSION_QUALITY_COST_MODEL` (default OFF); bump `LIVE_PREVIEW_ALGORITHM_VERSION` only when enabling.

---

### Task 1: Pure quality-cost function

**Files:**
- Create: `lib/next-round-suggester/quality-cost.ts`
- Test: `tests/next-round-suggester/unit/quality-cost.test.ts`

**Interfaces:**
- Consumes: `getEffectivePvna` from `./state.ts`; `SessionState`, `Team`, `PlayerSessionState` from `./types.ts`; `getRecentRepeatCost`-style recency is re-implemented locally (see Step 3).
- Produces:
  ```ts
  export type QualityCostResult = { cost: number; gap: number; maxProjectedMeeting: number }
  export function computeQualityCost(
    teamA: Team, teamB: Team, state: SessionState,
    opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
  ): QualityCostResult
  export const DEFAULT_QUALITY_COST_WEIGHTS: QualityCostWeights
  export type QualityCostWeights = {
    balanceTie: number; balanceOver: number; intraTie: number; intraOver: number;
    repeat2: number; repeat3: number; repeatStep: number; opponentFactor: number;
    genderPartner: number; genderOpponent: number; groupReward: number; groupCap: number; avoidOpponent: number;
  }
  ```

- [ ] **Step 1: Write the failing intent-check test**

```ts
// tests/next-round-suggester/unit/quality-cost.test.ts
import { computeQualityCost } from '../../../lib/next-round-suggester/quality-cost'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setPartnerRepeats, setOpponentRepeats } from '../helpers/factories'

// Build a 6-player state with given pvnas; history set per test.
function stateOf(pv: Record<string, number>): SessionState {
  return createState({ players: Object.entries(pv).map(([id, p]) => createPlayer(id, { pvna: p })), courts: 6, pvnaTolerance: 0.5 })
}
const cost = (s: SessionState, a: [string, string], b: [string, string]) =>
  computeQualityCost(a, b, s, { tolerance: 0.5 }).cost

describe('computeQualityCost — intent scenarios', () => {
  it('1) prefers fresh gap-0.4 over a balanced 2nd-opponent-repeat', () => {
    const s = stateOf({ A: 3.0, B: 3.0, C: 3.2, D: 3.2, E: 3.0, F: 3.4 })
    // X: fresh, gap 0.4  |  Y: balanced gap 0, but A–E already opposed once
    setOpponentRepeats(s.players.get('A')!, s.players.get('E')!, 1)
    const X = cost(s, ['A', 'B'], ['C', 'D'])            // fresh, gap 0.4
    const Y = cost(s, ['A', 'F'], ['C', 'D'])            // A opp C? ... construct so Y repeats + gap 0
    expect(X).toBeLessThan(Y)
  })

  it('3) prefers a 2nd-opponent-repeat over a fresh BLOWOUT (gap 2.0)', () => {
    const s = stateOf({ A: 2.5, B: 2.5, C: 3.5, D: 3.5, E: 3.0, F: 3.0 })
    setOpponentRepeats(s.players.get('E')!, s.players.get('C')!, 1)
    const blowout = cost(s, ['A', 'B'], ['C', 'D'])      // fresh gap 2.0
    const repeat = cost(s, ['E', 'F'], ['C', 'D'])       // gap ~0.5, one prior opponent
    expect(repeat).toBeLessThan(blowout)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/next-round-suggester/unit/quality-cost.test.ts --runInBand`
Expected: FAIL — `computeQualityCost` is not defined.

- [ ] **Step 3: Implement the cost function (validated shapes from the spike)**

```ts
// lib/next-round-suggester/quality-cost.ts
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState, SessionState, Team } from './types.ts'
// @ts-ignore
import { getEffectivePvna } from './state.ts'
// @ts-ignore
import { getAvoidPenalty, AVOID_PARTNER_PENALTY } from './avoid.ts'
// @ts-ignore
import { RECENT_REPEAT_PENALTY_WINDOW } from './score.ts'

export type QualityCostWeights = {
  balanceTie: number; balanceOver: number; intraTie: number; intraOver: number;
  repeat2: number; repeat3: number; repeatStep: number; opponentFactor: number;
  genderPartner: number; genderOpponent: number; groupReward: number; groupCap: number; avoidOpponent: number;
}
// Illustrative starting values — Task 6 calibrates magnitudes; shapes are fixed.
export const DEFAULT_QUALITY_COST_WEIGHTS: QualityCostWeights = {
  balanceTie: 0.1, balanceOver: 1.3, intraTie: 0.1, intraOver: 1.0,
  repeat2: 0.8, repeat3: 2.5, repeatStep: 2.0, opponentFactor: 0.7,
  genderPartner: 0.4, genderOpponent: 0.2, groupReward: 0.3, groupCap: 0.6, avoidOpponent: 4.0,
}
const HARD_INTRA = 1.0

export type QualityCostResult = { cost: number; gap: number; maxProjectedMeeting: number }

const sameGroup = (x: PlayerSessionState, y: PlayerSessionState) =>
  x.group_id != null && x.group_id === y.group_id

// Escalating meeting curve: projected meeting m (1 = fresh). m>=4 grows linearly.
function meetCurve(m: number, w: QualityCostWeights) {
  if (m <= 1) return 0
  if (m === 2) return w.repeat2
  if (m === 3) return w.repeat3
  return w.repeat3 + w.repeatStep * (m - 3)
}

// Recency-weighted prior meeting count within the window (recent meetings count more).
// Reuses the same window as score.ts; a meeting last round ~= 1.0, older decays.
function recentMeetings(state: SessionState, xId: string, yId: string, kind: 'partner' | 'opp'): number {
  const roundNo = state.current_round
  let weighted = 0
  for (const round of state.rounds) {
    if (round.status !== 'completed') continue
    const d = roundNo - round.round_no
    if (d <= 0 || d > RECENT_REPEAT_PENALTY_WINDOW) continue
    const decay = d <= 1 ? 1 : d === 2 ? 0.65 : 0.35
    for (const m of round.matches) {
      const pairs = kind === 'partner'
        ? [[m.team_a[0], m.team_a[1]], [m.team_b[0], m.team_b[1]]]
        : m.team_a.flatMap(a => m.team_b.map(b => [a, b]))
      if (pairs.some(([p, q]) => (p === xId && q === yId) || (p === yId && q === xId))) weighted += decay
    }
  }
  return weighted
}

export function computeQualityCost(
  teamA: Team, teamB: Team, state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
): QualityCostResult {
  const w = { ...DEFAULT_QUALITY_COST_WEIGHTS, ...(opts.weights ?? {}) }
  const P = (id: string) => state.players.get(id)!
  const pv = (id: string) => getEffectivePvna(P(id))
  const [a0, a1] = teamA, [b0, b1] = teamB

  const gap = Math.abs(pv(a0) + pv(a1) - pv(b0) - pv(b1))
  const iA = Math.abs(pv(a0) - pv(a1)), iB = Math.abs(pv(b0) - pv(b1))
  const over = Math.max(0, gap - opts.tolerance)
  const oIA = Math.max(0, iA - HARD_INTRA), oIB = Math.max(0, iB - HARD_INTRA)
  let cost = w.balanceTie * gap + w.balanceOver * over * over
    + w.intraTie * (iA + iB) + w.intraOver * (oIA * oIA + oIB * oIB)

  let maxMeeting = 1
  const addRepeat = (xId: string, yId: string, kind: 'partner' | 'opp', factor: number) => {
    if (sameGroup(P(xId), P(yId))) return
    const allTime = kind === 'partner'
      ? (P(xId).partner_counts.get(yId) ?? 0)
      : (P(xId).opponent_counts.get(yId) ?? 0)
    const projected = allTime + 1
    maxMeeting = Math.max(maxMeeting, projected)
    // recency multiplier: recent meetings weigh full, older ones fade (min 0.4 so a repeat is never free)
    const recency = allTime === 0 ? 1 : Math.max(0.4, recentMeetings(state, xId, yId, kind) / allTime || 0.4)
    cost += factor * meetCurve(projected, w) * recency
  }
  addRepeat(a0, a1, 'partner', 1); addRepeat(b0, b1, 'partner', 1)
  for (const x of teamA) for (const y of teamB) addRepeat(x, y, 'opp', w.opponentFactor)

  // gender pref (soft, lowest tier)
  cost += genderPref(teamA, teamB, state) // implement mirroring score.ts genderPenalty but with w.genderPartner/Opponent

  // group reward (mild, capped below balance)
  const groupPairs = (sameGroup(P(a0), P(a1)) ? 1 : 0) + (sameGroup(P(b0), P(b1)) ? 1 : 0)
  cost -= Math.min(w.groupCap, w.groupReward * groupPairs)

  // avoid-opponent (heavy soft); avoid-partner is a hard invariant handled by the caller (scoreMatch)
  const avoidOpp = [[a0, b0], [a0, b1], [a1, b0], [a1, b1]]
    .filter(([x, y]) => getAvoidPenalty(P(x), P(y), 'opponent') > 0).length
  cost += w.avoidOpponent * avoidOpp

  return { cost, gap, maxProjectedMeeting: maxMeeting }
}

function genderPref(_teamA: Team, _teamB: Team, _state: SessionState): number {
  // Port score.ts genderPenalty logic here, weighted by w.genderPartner / w.genderOpponent (low).
  return 0 // replaced in Step 3b with the ported implementation + its own unit test
}
```

- [ ] **Step 3b: Port `genderPref` from `score.ts:genderPenalty` and add its unit test** (partner-pref violation + opponent-pref violation, low weights). Keep it a separate testable function.

- [ ] **Step 4: Run intent + gender tests to verify pass**

Run: `npx jest tests/next-round-suggester/unit/quality-cost.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/quality-cost.ts tests/next-round-suggester/unit/quality-cost.test.ts
git commit -m "feat(suggester): pure quality-cost function (hinge balance + escalating repeat)"
```

---

### Task 2: Team-aware rematch (Decision 1)

**Files:**
- Modify: `lib/next-round-suggester/score.ts:102-104` (`getMatchGroupKey`), `:177-179` (exact4 trigger in `getRecentRepeatCost`), `:237-241` (`hasRecentGroupRematch`)
- Test: `tests/next-round-suggester/unit/score.test.ts` (add cases)

**Interfaces:**
- Consumes: existing `getRecentRepeatCost` structure.
- Produces: exact-rematch now means SAME partnerships, not same four players.

- [ ] **Step 1: Write failing test** — a re-split `{A,C}v{B,D}` of a prior `{A,B}v{C,D}` must NOT trigger `exact4` / must NOT be blocked by `hasRecentGroupRematch`; a true rematch `{A,B}v{C,D}` still does.
- [ ] **Step 2: Run — expect FAIL** (`exact4 > 0` on the re-split under current code).
- [ ] **Step 3: Implement** — replace the `playerOverlap === 4 || getMatchGroupKey(...) === matchGroupKey` condition (`score.ts:177`) with `partnerHits === 2` (both partnerships identical); make `hasRecentGroupRematch` (`:238`) require identical partnerships (compare partner-pair keys) instead of `getMatchGroupKey`. Remove now-unused `getMatchGroupKey` if no other callers (grep first).
- [ ] **Step 4: Run — expect PASS**, then the full `score.test.ts`.
- [ ] **Step 5: Commit** `fix(suggester): exact-rematch is team-aware — re-split of same four is fresh`

---

### Task 3: Delegate `scoreMatch` to quality-cost behind a flag

**Files:**
- Modify: `lib/next-round-suggester/score.ts:547-667` (`scoreMatch`)
- Create: `lib/next-round-suggester/quality-cost-flag.ts` (reads `SESSION_QUALITY_COST_MODEL`; Deno + Node safe)
- Test: `tests/next-round-suggester/unit/score.test.ts`

**Interfaces:**
- Consumes: `computeQualityCost` (Task 1).
- Produces: with flag ON, `scoreMatch` returns `{ score: computeQualityCost(...).cost, stats }` after enforcing ONLY the two hard invariants; with flag OFF, unchanged behavior.

- [ ] **Step 1: Write failing test** — with the flag forced on (inject via the flag module's test hook), a bimodal foursome whose only balanced split exceeds the OLD tolerance gate returns a FINITE score (not `INFINITY`), and a lower cost than the same-cluster blowout split.
- [ ] **Step 2: Run — expect FAIL** (current `scoreMatch` returns `INFINITY` on the over-tolerance split).
- [ ] **Step 3: Implement** — at the top of `scoreMatch`, after the structural check (`:567-569`) and the avoid-partner hard block (move it up), if the flag is on: `return { score: computeQualityCost(teamA, teamB, state, { tolerance, weights }).cost, stats }`. Keep the `allow*` option paths working for the OFF branch. Do NOT run the tolerance/intra/recent-group/repeat-overflow INFINITY gates when the flag is on.
- [ ] **Step 4: Run — expect PASS**; then full suggester unit suite `--runInBand` with flag OFF (must be unchanged: 264/264).
- [ ] **Step 5: Commit** `feat(suggester): scoreMatch delegates to quality-cost behind SESSION_QUALITY_COST_MODEL`

---

### Task 4: Alternative detection (host tier 2) — generalise the tradeoff toggle

**Files:**
- Modify: the `buildOverThresholdRepeatTradeoff` site (grep `buildOverThresholdRepeatTradeoff` in `lib/next-round-suggester/live-preview.ts`)
- Test: `tests/next-round-suggester/unit/live-preview.test.ts`

**Interfaces:**
- Consumes: `computeQualityCost` (for the two candidates' costs + gap + maxProjectedMeeting).
- Produces: a tradeoff choice is offered whenever a second candidate is within `ALT_BAND` cost of the best AND trades the balance↔freshness axis in the other direction (one fresher-higher-gap, the other more-balanced-repeating).

- [ ] **Step 1: Write failing test** — best = fresh gap 0.9, alt = balanced repeat-2; both within band → a tradeoff choice with both is produced. (Currently only fires for repeat≥3.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the generalised detector (band + opposite-axis check) reusing the existing `tradeoff_choices` payload shape.
- [ ] **Step 4: Run — expect PASS** + host-live characterization suite `--runInBand`.
- [ ] **Step 5: Commit** `feat(suggester): host tradeoff toggle generalised to balance↔freshness`

---

### Task 5: Wait-rescue "bad" re-anchored to quality-cost (host tier 3)

**Files:**
- Modify: `computeMatchDegradedRescue` + `findRescueCourts` in `lib/next-round-suggester/live-preview.ts`
- Test: `tests/host-live/characterization/wait-rescue-banner.test.tsx` + a unit test

**Interfaces:**
- Consumes: `computeQualityCost` (degraded = best-achievable cost dominated by a heavy region).
- Produces: `degraded_reason` computed from cost regions (`gap` over `BLOWOUT_DEGRADE_GAP_FLOOR` → 'blowout'; `maxProjectedMeeting >= 3` → 'repeat'); rescue offered only when freeing a court yields a strictly-lower non-degraded cost.

- [ ] **Step 1: Write failing test** — a court whose best cost is blowout-dominated is flagged 'blowout' and offers rescue only when a live-court completion clears it.
- [ ] **Step 2–4:** implement + run (unit + host-live `--runInBand`).
- [ ] **Step 5: Commit** `feat(suggester): wait-rescue degraded/rescue re-anchored to quality-cost`

---

### Task 6: Calibrate weights (sim A/B) + acceptance gate

**Files:**
- Promote `scratch/sim-cost-model.ts` → `scripts/diagnostics/quality-cost-sim.ts` (import the REAL `computeQualityCost`, not the spike copy)
- Modify: `DEFAULT_QUALITY_COST_WEIGHTS` in `quality-cost.ts` with tuned values

**Interfaces:** none new — this task tunes magnitudes only.

- [ ] **Step 1:** Wire the diagnostic to call `computeQualityCost` + the real `scoreMatch` (flag off) over uniform/tight/bimodal/skewed, 300 seeds; print avgGap, blowout%, repeat3/session, restSpread, uniqPartners for both.
- [ ] **Step 2:** Adjust weights until acceptance criteria hold: blowout% drops sharply on every distribution; restSpread + uniqPartners not worse than current; all 5 intent-checks (`scratch/intent-check.ts`, promote to a unit test) still pass.
- [ ] **Step 3:** Record the final numbers + the before/after table in the diagnostic's header comment.
- [ ] **Step 4:** Run `npx jest tests/next-round-suggester tests/host-live --runInBand` with flag ON — expect green.
- [ ] **Step 5: Commit** `chore(suggester): calibrate quality-cost weights (A/B sim)`

---

### Task 7: Full-suite gate + flagged rollout

- [ ] **Step 1:** `npm run typecheck:guard` (no new errors) + `deno check supabase/functions/session-live-matches-suggest/index.ts`.
- [ ] **Step 2:** Full suite flag OFF then flag ON, both `--runInBand`, both green.
- [ ] **Step 3:** Bump `LIVE_PREVIEW_ALGORITHM_VERSION`; deploy edge with `SESSION_QUALITY_COST_MODEL` OFF in prod first (dark), then flip ON for A/B and watch `debug_dumps` (blowout / repeat / stuck rates).
- [ ] **Step 4:** Update `TASK.md` + memory; open the follow-up spec stub for retiring the redundant `pair.ts` relaxation stages + the ~16 post-pass repairs the cost model subsumes.
- [ ] **Step 5: Commit** `feat(suggester): enable quality-cost model behind flag + ALGO bump`

---

## Self-Review

- **Spec coverage:** §4 cost function → Task 1; §4.3 Decision 1 → Task 2; §4.7 soft gates → Task 3; §5.2 alternative → Task 4; §5.3 wait-rescue → Task 5; §6 calibration + §8 intent-checks → Tasks 1/6; §7 rollout + follow-up → Task 7. Group reward / avoid-opponent / gender → Task 1. Fatigue/fairness explicitly out of scope (selection layer, done in ALGO 49–50).
- **Placeholder note:** `genderPref` in Task 1 Step 3 is a deliberate stub filled in Step 3b (its own test) — flagged, not left open. Exact weight magnitudes are Task 6 outputs (the plan fixes shapes, per Global Constraints).
- **Type consistency:** `computeQualityCost` / `QualityCostResult` / `QualityCostWeights` / `DEFAULT_QUALITY_COST_WEIGHTS` used consistently across Tasks 1, 3, 4, 5, 6.

## Risks

- `scoreMatch` is central: every change is gated behind the flag OFF path staying byte-identical, verified by the flag-OFF suite each task.
- Softening gates could seat an ugly match in a truly impossible pool → surfaced to the host via Task 5, not hidden.
- Final numbers are A/B-derived (Task 6); merging before calibration passes is prohibited.
