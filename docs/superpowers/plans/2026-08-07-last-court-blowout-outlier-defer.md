# Last-Court Blowout Outlier — Defer + Host-Decide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop forcing an owed skill-outlier into a last-court blowout when a balanced foursome exists — via two branches keyed on the outlier's `consecutive_rest`: rest=0 auto-defers (engine seats the balanced four), rest>0 surfaces a host-decision panel (play-outlier vs keep-resting) with a clear explanation — without breaking fill / rest-cap / fairness / determinism invariants.

**Architecture:** A new pure `hasNearLevelPeerInActiveRoster` gate. Branch A relaxes the `remainingCourtsInRound <= 1` bail in `deferLowViabilityRequiredIdsForCourt` (+ `selectRequiredIdsForCourt`) to defer a rest=0 peer-backed outlier. Branch B extends the existing `forced_tradeoff` trigger to fire on `degraded=blowout` for a rest>0 peer-backed outlier, attaching `{kind:'blowout', acceptRepeat: seated, acceptImbalance: balanced-rest, explanation}`; the client 3-way panel renders blowout-variant labels + explanation.

**Tech Stack:** TypeScript (Deno-compatible engine `.ts` imports), Jest, Expo/React Native client.

## Global Constraints

- Engine change alters match output → after Tasks 1–2, run `npm run sim` sanity + fairness; do NOT skip.
- NEVER run the full `tests/next-round-suggester` suite (simulation hangs) — run named files with `--runInBand`.
- Determinism: all new logic must be wall-clock/`Math.random`-free.
- Invariants (must not break): (1) every open court still seats four; (2) Branch A defers ONLY `consecutive_rest === 0` players (never two-in-a-row via defer); (3) rest>0 players are never auto-deferred (host decides) — no silent starvation; (4) no regression of the non-last-court cohesion logic (ALGO 37) or `repairPayloadBatchBlowoutFromPool` (ALGO 48).
- `hasNearLevelPeerInActiveRoster(outlierId, state, tolerance)`: any active player p (p ≠ outlier, `checked_out_at === null`, `!opted_rest`) with `|getEffectivePvna(p) − getEffectivePvna(outlier)| ≤ tolerance`. Includes players currently busy on live courts (differs from the repair's bench-only `hasNearLevelPeer`).
- Bump `LIVE_PREVIEW_ALGORITHM_VERSION` 53 → 54 before deploy.
- `typecheck:guard`: only NEW errors in `lib/`/`features/`/`tests/` are blockers; pre-existing `scratch/`+`tmp/` noise is not.

---

### Task 1: Branch A — auto-defer a rest=0 peer-backed outlier at the last court

**Files:**
- Modify: `lib/next-round-suggester/live-preview.ts` (`hasNearLevelPeerInActiveRoster` new; `deferLowViabilityRequiredIdsForCourt` ~1749; `selectRequiredIdsForCourt` ~1711)
- Test: `tests/next-round-suggester/unit/last-court-outlier-defer.test.ts`

**Interfaces:**
- Produces: `export function hasNearLevelPeerInActiveRoster(outlierId: string, state: SessionState, tolerance: number): boolean`
- `deferLowViabilityRequiredIdsForCourt` keeps its signature; new behavior only on the last court.

**Context (verified):** `deferLowViabilityRequiredIdsForCourt` currently returns early at line 1764 `if (requiredForThisCourt.length === 0 || remainingCourtsInRound <= 1) return requiredForThisCourt`. It already computes `spread` (line 1775) and an `activePool`/`hasNearLevelPeer` (bench-restricted). `selectRequiredIdsForCourt` line 1718 bails `if (remainingCourtsInRound <= 1 || availableRequiredIds.length <= count) return availableRequiredIds.slice(0, count)`. `availableRequiredIds` is fairness-ordered (consecutive_rest desc, matches_played asc). The outlier to defer is the required player whose PVNA is furthest from the cohesive cluster.

- [ ] **Step 1: Write failing tests**

```ts
// tests/next-round-suggester/unit/last-court-outlier-defer.test.ts
import { deferLowViabilityRequiredIdsForCourt, hasNearLevelPeerInActiveRoster } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionState } from '../../../lib/next-round-suggester/types'

// one weak owed outlier (rest=0) + strong required peers on the LAST court, plus a busy weak peer elsewhere
function lastCourtState(outlierRest = 0): { state: SessionState; required: string[]; outlier: string } {
  const players = [
    createPlayer('weak', { pvna: 2.0, consecutive_rest: outlierRest, matches_played: 1 }),
    createPlayer('s1', { pvna: 4.5, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s2', { pvna: 4.4, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s3', { pvna: 4.6, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s4', { pvna: 4.5, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('weakBusy', { pvna: 2.1, consecutive_rest: 0, matches_played: 1 }), // near-level peer, busy
  ]
  const state = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 3 })
  // mark weakBusy busy (on a live court) — still active roster, not opted_rest/checked_out
  return { state, required: ['weak', 's1', 's2', 's3', 's4'], outlier: 'weak' }
}

describe('hasNearLevelPeerInActiveRoster', () => {
  it('true when an active peer within tolerance exists (even if busy)', () => {
    const { state } = lastCourtState()
    expect(hasNearLevelPeerInActiveRoster('weak', state, 0.5)).toBe(true)
  })
  it('false when the outlier is uniquely weak', () => {
    const players = [
      createPlayer('lone', { pvna: 2.0 }), createPlayer('a', { pvna: 4.5 }),
      createPlayer('b', { pvna: 4.4 }), createPlayer('c', { pvna: 4.6 }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    expect(hasNearLevelPeerInActiveRoster('lone', state, 0.5)).toBe(false)
  })
})

describe('deferLowViabilityRequiredIdsForCourt — last court', () => {
  it('defers a rest=0 peer-backed outlier on the last court (was previously forced)', () => {
    const { state, required, outlier } = lastCourtState(0)
    const out = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: [...required], availableRequiredIds: [...required],
      busyIds: new Set(['weakBusy']), remainingCourtsInRound: 1, minimumRequiredCount: 0, state,
    })
    expect(out).not.toContain(outlier)          // deferred → rests this court
    expect(out.length).toBeGreaterThanOrEqual(3) // still enough to fill four (with a pool player)
  })
  it('does NOT defer a rest>0 outlier (Branch B handles that, not auto-rest)', () => {
    const { state, required, outlier } = lastCourtState(1)
    const out = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: [...required], availableRequiredIds: [...required],
      busyIds: new Set(['weakBusy']), remainingCourtsInRound: 1, minimumRequiredCount: 0, state,
    })
    expect(out).toContain(outlier)
  })
  it('does NOT defer when the outlier has no active peer (unavoidable blowout)', () => {
    const players = [
      createPlayer('lone', { pvna: 2.0, consecutive_rest: 0, matches_played: 1 }),
      createPlayer('a', { pvna: 4.5 }), createPlayer('b', { pvna: 4.4 }),
      createPlayer('c', { pvna: 4.6 }), createPlayer('d', { pvna: 4.5 }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 3 })
    const req = ['lone', 'a', 'b', 'c', 'd']
    const out = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: [...req], availableRequiredIds: [...req],
      busyIds: new Set(), remainingCourtsInRound: 1, minimumRequiredCount: 0, state,
    })
    expect(out).toContain('lone')
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx jest tests/next-round-suggester/unit/last-court-outlier-defer.test.ts --runInBand`. Expected: FAIL (`hasNearLevelPeerInActiveRoster` not exported; defer still forces the outlier on the last court).

- [ ] **Step 3: Add `hasNearLevelPeerInActiveRoster`** (near the other helpers in live-preview.ts):

```ts
export function hasNearLevelPeerInActiveRoster(outlierId: string, state: SessionState, tolerance: number): boolean {
  const outlier = state.players.get(outlierId)
  if (!outlier) return false
  const outPv = getEffectivePvna(outlier)
  for (const p of state.players.values()) {
    if (p.player_id === outlierId) continue
    if (p.checked_out_at !== null || p.opted_rest) continue
    if (Math.abs(getEffectivePvna(p) - outPv) <= tolerance) return true
  }
  return false
}
```

- [ ] **Step 4: Relax the last-court bail in `deferLowViabilityRequiredIdsForCourt`.** Replace the early return at line 1764 so that on the last court it still evaluates a defer, but ONLY for a rest=0 peer-backed outlier that is a genuine skill-outlier of the required set:

```ts
// was: if (requiredForThisCourt.length === 0 || remainingCourtsInRound <= 1) return requiredForThisCourt
if (requiredForThisCourt.length === 0) return requiredForThisCourt
const tolerance = state.config.pvna_tolerance
if (remainingCourtsInRound <= 1) {
  // Last court: the anti-blowout cohesion pass was skipped, so a lone weak owed player can be forced into
  // a blowout. Defer that ONE outlier ONLY when it is safe and useful: it has rested 0 rounds (so deferring
  // never causes a 2nd consecutive rest), it has a near-level peer somewhere in the active roster (so a
  // future rolling fill can seat it balanced — never strand a truly unique-weak player), and dropping it
  // still leaves ≥3 required so the court fills four from a near-level pool player. rest>0 outliers are NOT
  // auto-deferred here — Branch B surfaces a host decision instead.
  const pvnaOf = (id: string) => { const pl = state.players.get(id); return pl ? getEffectivePvna(pl) : 0 }
  const reqPv = requiredForThisCourt.map(pvnaOf)
  const spread = reqPv.length === 0 ? 0 : Math.max(...reqPv) - Math.min(...reqPv)
  if (spread <= tolerance) return requiredForThisCourt
  // outlier = required player whose pvna is furthest from the median of the required set (deterministic)
  const sorted = [...reqPv].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const outlierId = [...requiredForThisCourt].sort((a, b) =>
    Math.abs(pvnaOf(b) - median) - Math.abs(pvnaOf(a) - median) || a.localeCompare(b))[0]
  const outlier = state.players.get(outlierId)
  const canDefer = !!outlier && outlier.consecutive_rest === 0
    && hasNearLevelPeerInActiveRoster(outlierId, state, tolerance)
    && requiredForThisCourt.length - 1 >= Math.max(0, minimumRequiredCount)
    && requiredForThisCourt.length - 1 >= 3
  return canDefer ? requiredForThisCourt.filter(id => id !== outlierId) : requiredForThisCourt
}
```

Then keep the EXISTING non-last-court body (the original lines 1768–1795) unchanged below this block. (The original `const tolerance` at old line 1768 now duplicates — remove the inner re-declaration so `tolerance` is declared once at the top.)

- [ ] **Step 5: Make `selectRequiredIdsForCourt` consistent** — its own last-court bail (line 1718) returns `availableRequiredIds.slice(0, count)` and can re-introduce the outlier upstream of the defer. Since `deferLowViabilityRequiredIdsForCourt` runs AFTER `selectRequiredIdsForCourt` in the caller (live-preview.ts:4404→4410) and filters the outlier out, no change to `selectRequiredIdsForCourt` is required for correctness — verify by test that the caller's post-defer `requiredForThisCourt` excludes the outlier. If a test shows the outlier surviving, apply the same rest=0/peer guard to `selectRequiredIdsForCourt`'s bail. (Document the decision in the report.)

- [ ] **Step 6: Run tests, verify pass** — `npx jest tests/next-round-suggester/unit/last-court-outlier-defer.test.ts --runInBand`. Expected: all pass.

- [ ] **Step 7: Sim sanity** — `npm run sim` (sanity + targets). Expected: no fairness regression, no new stalls. Capture the summary in the report. If fairness (rest distribution) regresses, the guard is too aggressive — narrow it.

- [ ] **Step 8: Commit** — `git add lib/next-round-suggester/live-preview.ts tests/next-round-suggester/unit/last-court-outlier-defer.test.ts && git commit -m "fix(live-board): defer a rest=0 peer-backed owed outlier on the last court instead of forcing a blowout"`

---

### Task 2: Branch B — host-decide metadata for a rest>0 outlier (degraded=blowout)

**Files:**
- Modify: `lib/next-round-suggester/live-preview.ts` (`forced_tradeoff` type ~369; the forced-tradeoff trigger block ~5215–5305; `LIVE_PREVIEW_ALGORITHM_VERSION`)
- Modify: `features/host/session-detail/next-round-v2/preview.ts` (`forced_tradeoff` client type ~72)
- Test: `tests/next-round-suggester/unit/blowout-host-decide.test.ts`

**Interfaces:**
- `forced_tradeoff` gains `kind?: 'repeat' | 'blowout'` (default 'repeat' when absent) and `explanation?: string`. Structure otherwise unchanged: `acceptRepeat` = the seated lineup (② default), `acceptImbalance` = the alternative (③).
- For blowout: `acceptRepeat` = seated blowout (② "Chịu lệch" — outlier plays), `acceptImbalance` = the balanced foursome that rests the outlier (③ "Cho nghỉ tiếp"), via `findMinCostFoursome(poolExcludingOutlier, requiredMinusOutlier, state, tolerance)`.

- [ ] **Step 1: Write failing test**

```ts
// tests/next-round-suggester/unit/blowout-host-decide.test.ts
import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionLiveMatchRow, SessionState } from '../../../lib/next-round-suggester/types'

// build a single open court whose only owed-required lineup is a blowout (weak outlier rest=1 + strong),
// with a balanced strong foursome available if the outlier rests, and a busy near-level peer.
function blowoutDecideState(): { state: SessionState; liveMatchRows: SessionLiveMatchRow[] } {
  // ... construct: outlier weak rest=1 forced-required on the last open court; 4+ strong idle; a busy weak peer.
  // (Implementer: mirror last-court-outlier-defer's fixture but with outlier consecutive_rest=1 and enough
  //  idle strong players that findMinCostFoursome-without-outlier yields a balanced four.)
}

describe('blowout host-decide (Branch B)', () => {
  it('rest>0 outlier + peer + balanced alt → seated blowout unchanged + forced_tradeoff kind=blowout attached', () => {
    __setQualityCostModelOverrideForTests(true)
    const { state, liveMatchRows } = blowoutDecideState()
    const payloads = buildSuggestedMatchPayloads({
      count: 1, sessionId: 's', courtCount: 6, state,
      rows: { liveMatchRows, liveStateVersion: null }, completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] }, fairnessWarnings: [],
      playersById: new Map() as any, pvnaTolerance: 0.5, options: { blowoutRescue: true },
    } as any)
    const forced = payloads.find(p => p.forced_tradeoff?.kind === 'blowout')
    expect(forced).toBeDefined()
    expect(forced!.degraded_reason).toBe('blowout')
    // ② = seated blowout, ③ = balanced-rest alternative (different lineup)
    expect(forced!.forced_tradeoff!.acceptRepeat).not.toEqual(forced!.forced_tradeoff!.acceptImbalance)
    expect(typeof forced!.forced_tradeoff!.explanation).toBe('string')
    expect(forced!.forced_tradeoff!.explanation!.length).toBeGreaterThan(0)
    __setQualityCostModelOverrideForTests(null)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx jest tests/next-round-suggester/unit/blowout-host-decide.test.ts --runInBand`. Expected: FAIL (no blowout forced_tradeoff yet).

- [ ] **Step 3: Extend the `forced_tradeoff` type** (live-preview.ts ~369 and preview.ts ~72):

```ts
forced_tradeoff?: {
  kind?: 'repeat' | 'blowout'
  explanation?: string
  acceptRepeat: { team_a: Team; team_b: Team }
  acceptImbalance: { team_a: Team; team_b: Team }
}
```

- [ ] **Step 4: Extend the trigger block** (~5242, alongside the existing repeat trigger). After the existing repeat path, add a blowout path:

```ts
// Blowout host-decide (Branch B): the seated last-court lineup is a forced blowout containing an owed
// outlier who has ALREADY rested (rest>0, so Branch A did not auto-defer). Offer the host ② play them now
// (seated) vs ③ rest them again (a balanced four), with an explanation — never auto-rest a rested player.
if (!forcedTradeoff && degradedReason === 'blowout') {
  const seatedIds = [...match.team_a, ...match.team_b]
  const pvOf = (id: string) => { const pl = suggestionStateForCourt.players.get(id); return pl ? getEffectivePvna(pl) : 0 }
  // outlier = a seated, required, rest>0 player whose PVNA is furthest from the mean of the OTHER three
  // seated players (the cluster it blows out); deterministic id tie-break.
  const distFromCluster = (id: string) => {
    const others = seatedIds.filter(x => x !== id).map(pvOf)
    const mean = others.reduce((s, v) => s + v, 0) / (others.length || 1)
    return Math.abs(pvOf(id) - mean)
  }
  const outlierId = seatedIds
    .filter(id => (requiredForThisCourtIds?.has(id) ?? false))
    .filter(id => { const pl = suggestionStateForCourt.players.get(id); return !!pl && pl.consecutive_rest > 0 })
    .sort((a, b) => distFromCluster(b) - distFromCluster(a) || a.localeCompare(b))[0]
  if (outlierId && hasNearLevelPeerInActiveRoster(outlierId, suggestionStateForCourt, configuredPvnaTolerance)) {
    const poolWithoutOutlier = forcedTradeoffPoolIds.filter(id => id !== outlierId)
    const balanced = buildFreshestLineup(poolWithoutOutlier, suggestionStateForCourt, configuredPvnaTolerance)
      // NOTE: prefer findMinCostFoursome (min balance cost) here, not freshest — see interfaces.
    if (balanced /* && meaningfully more balanced than seated */) {
      forcedTradeoff = {
        kind: 'blowout',
        explanation: buildBlowoutExplanation(outlierId, match, suggestionStateForCourt, playersById),
        acceptRepeat: { team_a: match.team_a, team_b: match.team_b },
        acceptImbalance: { team_a: balanced.team_a, team_b: balanced.team_b },
      }
    }
  }
}
```

Implementer: use `findMinCostFoursome(poolWithoutOutlier, new Set(requiredMinusOutlier), state, tol)` (from Task-0 forced-tradeoff.ts, already exists) for ③ — it already respects avoid-pairs and picks the min-balance-cost four. Gate on the balanced alt's gap being within tolerance (a real balanced option) AND strictly better than the seated gap. `requiredForThisCourtIds` is in scope in `buildSuggestedMatchPayloads` (live-preview.ts:4423); confirm it's threaded to this block or recompute the required set. Add a small `buildBlowoutExplanation(outlierId, match, state, playersById)` returning e.g. `"{name} ({pvna}) yếu hơn nhóm đang rảnh (~{clusterPvna}); bạn cùng trình đang bận; đã nghỉ {rest} vòng."`. Ensure the whole block is inside the existing `try` (fail-soft) and does not run for `kind` already set by the repeat path.

- [ ] **Step 5: Bump algorithm version** — `LIVE_PREVIEW_ALGORITHM_VERSION` 53 → 54.

- [ ] **Step 6: Run tests, verify pass** — the blowout-host-decide test + the existing forced-tradeoff tests: `npx jest tests/next-round-suggester/unit/blowout-host-decide.test.ts tests/next-round-suggester/unit/forced-tradeoff.test.ts tests/next-round-suggester/unit/forced-tradeoff-integration.test.ts --runInBand`. Expected: all pass (repeat path unchanged).

- [ ] **Step 7: Sim sanity** — `npm run sim`. Blowout metadata is additive (doesn't change seating) so seating metrics must be unchanged vs Task 1; capture summary.

- [ ] **Step 8: Commit** — `git add lib/next-round-suggester/live-preview.ts features/host/session-detail/next-round-v2/preview.ts tests/next-round-suggester/unit/blowout-host-decide.test.ts && git commit -m "feat(live-board): blowout host-decide metadata (kind=blowout) for a rest>0 owed outlier + explanation; ALGO 54"`

---

### Task 3: Client — blowout variant of the 3-way panel

**Files:**
- Modify: `features/host/session-detail/next-round-v2/forced-decision.ts` (`buildForcedDecision`)
- Modify: `features/host/session-detail/next-round-v2/components/ScreenComponents.tsx` (panel labels/explanation)
- Test: `tests/host-live/` (a new characterization test for the blowout panel)

**Interfaces:**
- Consumes: `match.forced_tradeoff.kind` (`'repeat'` default | `'blowout'`) and `match.forced_tradeoff.explanation`.
- Produces: no new exports; `buildForcedDecision` returns the same `{ forcedLineup, cards, startMatch }` shape with kind-aware labels.

- [ ] **Step 1: Write failing test** — a characterization test rendering `SuggestedLiveMatchCard` with a `forced_tradeoff.kind === 'blowout'` row; assert the panel shows the blowout labels (② "Chịu lệch" / ③ "Cho nghỉ tiếp") and the explanation text, NOT the repeat labels. (Mirror the existing `tests/host-live/characterization/*forced*` or `wait-rescue-*` tests for setup.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Make `buildForcedDecision` kind-aware** — branch labels/copy on `forced.kind`:
  - `kind === 'blowout'`: ② label "Chịu lệch" (play the outlier — the seated `acceptRepeat` lineup), ③ label "Cho nghỉ tiếp" (rest the outlier — the balanced `acceptImbalance` lineup); render `forced.explanation` under "Vì sao lệch".
  - default (`repeat`): existing labels (② "Chịu lặp" / ③ "Chịu lệch") unchanged.
  Keep the `acceptRepeat`=② / `acceptImbalance`=③ mapping (same as repeat) so `selection` handling and Start routing are unchanged.

- [ ] **Step 4: Wire the explanation + labels in `ScreenComponents.tsx`** — render `forced_tradeoff.explanation` in the panel body; use the kind-aware labels from `buildForcedDecision`. Do not add supabase/business logic to the component (logic stays in `forced-decision.ts`).

- [ ] **Step 5: Run tests, verify pass** — the new characterization test + the existing forced/wait-rescue characterization tests unchanged.

- [ ] **Step 6: Typecheck + lint** — `npm run typecheck:guard` (only new errors are blockers) and `npm run lint:errors` on touched files.

- [ ] **Step 7: Commit** — `git add features/host/session-detail/next-round-v2/forced-decision.ts features/host/session-detail/next-round-v2/components/ScreenComponents.tsx tests/host-live/ && git commit -m "feat(host-live): blowout variant of the 3-way decision panel (Chịu lệch / Cho nghỉ tiếp) + explanation"`

---

## Post-plan (human-gated)

- Deploy edge (v233) + client rebuild — outward-facing, requires explicit user go.
- Host QA on `bbf721bd`: rest=0 last-court outlier → balanced (no blowout); a rest>0 outlier → 3-way blowout panel with explanation.
- Migration note: `forced_tradeoff` persists via existing `suggestion_metadata` sync (no schema change — `kind`/`explanation` ride the jsonb).
