import { computeMatchDegradedRescue } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'
import type { SessionState } from '../../../lib/next-round-suggester/types'

// Task 5: with SESSION_QUALITY_COST_MODEL ON, "degraded" is read off the same cost regions
// computeQualityCost already scores matches by (Task 1), instead of the standalone
// gap/getProjectedRepeatSummary heuristics. Scenarios below are hand-built so the real engine
// (suggestNextMatch, invoked inside findRescueCourts) produces a deterministic, verified-by-run
// outcome -- same style as live-preview-rescue-failsoft.test.ts's real-engine scenarios.

afterEach(() => {
  __setQualityCostModelOverrideForTests(null)
})

// Court 0 is LIVE with 4 low-pvna players. Court 1 (under test) is seated as a genuine blowout:
// two ~2.0 players vs two ~5.0 players (gap 6.0, far past BLOWOUT_DEGRADE_GAP_FLOOR). No other
// player exists in the pool, so freeing court 0 only lets it re-fill itself with the same 4 -- the
// degraded lane has nothing new to draw on, so rescue must NOT be offered.
function buildNoRescueScenario(): {
  state: SessionState
  liveCourtIdxs: Set<number>
  liveCourtPlayers: Map<number, string[]>
  busyIds: Set<string>
} {
  const L = ['L1', 'L2', 'L3', 'L4'].map((id) => createPlayer(id, { pvna: 2.0 }))
  const X = ['X1', 'X2'].map((id) => createPlayer(id, { pvna: 2.0 }))
  const Y = ['Y1', 'Y2'].map((id) => createPlayer(id, { pvna: 5.0 }))
  const state = createState({ players: [...L, ...X, ...Y], courts: 2, pvnaTolerance: 0.5 })
  return {
    state,
    liveCourtIdxs: new Set([0]),
    liveCourtPlayers: new Map([[0, ['L1', 'L2', 'L3', 'L4']]]),
    busyIds: new Set(['L1', 'L2', 'L3', 'L4']),
  }
}

// Same blowout seat, but two EXTRA bench players (F1, F2, ~2.0, alphabetically ahead of the live
// court's L1-L4) sit free. The real engine's refill for court 0 claims F1, F2, L1, L2 for itself,
// leaving L3, L4 unclaimed -- which lets court 1's rescue search re-pair X1, X2 with the freed
// L3, L4 into a gap-0 lineup. Verified by running the real engine (scratch probe), not hand-derived.
function buildRescueClearsScenario(): {
  state: SessionState
  liveCourtIdxs: Set<number>
  liveCourtPlayers: Map<number, string[]>
  busyIds: Set<string>
} {
  const L = ['L1', 'L2', 'L3', 'L4'].map((id) => createPlayer(id, { pvna: 2.0 }))
  const F = ['F1', 'F2'].map((id) => createPlayer(id, { pvna: 2.0 }))
  const X = ['X1', 'X2'].map((id) => createPlayer(id, { pvna: 2.0 }))
  const Y = ['Y1', 'Y2'].map((id) => createPlayer(id, { pvna: 5.0 }))
  const state = createState({ players: [...L, ...F, ...X, ...Y], courts: 2, pvnaTolerance: 0.5 })
  return {
    state,
    liveCourtIdxs: new Set([0]),
    liveCourtPlayers: new Map([[0, ['L1', 'L2', 'L3', 'L4']]]),
    busyIds: new Set(['L1', 'L2', 'L3', 'L4']),
  }
}

function buildBalancedFreshState(): SessionState {
  const players = ['X1', 'X2', 'Y1', 'Y2'].map((id) => createPlayer(id, { pvna: 3.0 }))
  return createState({ players, courts: 1, pvnaTolerance: 0.5 })
}

// X1/X2 are partners in the SAME group with 2 prior meetings (a 3rd meeting if seated again).
// Legacy getProjectedRepeatSummary counts this pair regardless of group. computeQualityCost's
// addRepeat explicitly skips same-group pairs (a family/group replaying isn't the "degraded"
// repeat the wait-rescue feature targets) -- so under the cost model this seat is NOT degraded.
function buildSameGroupRepeatState(): SessionState {
  const x1 = createPlayer('X1', { pvna: 3.0, group_id: 'g1' })
  const x2 = createPlayer('X2', { pvna: 3.0, group_id: 'g1' })
  setPartnerRepeats(x1, x2, 2)
  const y1 = createPlayer('Y1', { pvna: 3.0 })
  const y2 = createPlayer('Y2', { pvna: 3.0 })
  return createState({ players: [x1, x2, y1, y2], courts: 1, pvnaTolerance: 0.5 })
}

describe('computeMatchDegradedRescue — quality-cost re-anchor (flag-gated)', () => {
  describe('flag ON', () => {
    beforeEach(() => __setQualityCostModelOverrideForTests(true))

    it('flags a blowout-dominated seat as degraded=blowout but does NOT offer rescue when freeing the live court cannot clear it', () => {
      const scene = buildNoRescueScenario()
      const result = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 1,
        state: scene.state,
        liveCourtIdxs: scene.liveCourtIdxs,
        liveCourtPlayers: scene.liveCourtPlayers,
        busyIds: scene.busyIds,
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      expect(result.degradedReason).toBe('blowout')
      expect(result.rescueCourtIdxs).toEqual([])
    })

    it('offers rescue when freeing the live court DOES clear the blowout cost', () => {
      const scene = buildRescueClearsScenario()
      const result = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 1,
        state: scene.state,
        liveCourtIdxs: scene.liveCourtIdxs,
        liveCourtPlayers: scene.liveCourtPlayers,
        busyIds: scene.busyIds,
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      expect(result.degradedReason).toBe('blowout')
      expect(result.rescueCourtIdxs).toEqual([0])
    })

    it('marks rescue search truncated when the budget is exhausted before checking a viable rescue court', () => {
      const scene = buildRescueClearsScenario()
      const fullBudget = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 1,
        state: scene.state,
        liveCourtIdxs: scene.liveCourtIdxs,
        liveCourtPlayers: scene.liveCourtPlayers,
        busyIds: scene.busyIds,
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      const exhaustedBudget = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 1,
        state: scene.state,
        liveCourtIdxs: scene.liveCourtIdxs,
        liveCourtPlayers: scene.liveCourtPlayers,
        busyIds: scene.busyIds,
        pvnaTolerance: 0.5,
        budgetMs: 0,
        nowMsFn: () => performance.now(),
      })

      expect(fullBudget.rescueCourtIdxs).toEqual([0])
      expect(exhaustedBudget.degradedReason).toBe('blowout')
      expect(exhaustedBudget.rescueCourtIdxs).toEqual([])
      expect((exhaustedBudget as any).rescueSearchTruncated).toBe(true)
    })

    it('a within-cost-region seat (balanced, fresh) is not degraded', () => {
      const state = buildBalancedFreshState()
      const result = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 0,
        state,
        liveCourtIdxs: new Set(),
        liveCourtPlayers: new Map(),
        busyIds: new Set(),
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      expect(result.degradedReason).toBeUndefined()
      expect(result.rescueCourtIdxs).toEqual([])
    })

    it('re-anchors repeat detection to quality-cost maxProjectedMeeting: a same-group 3rd meeting is NOT flagged', () => {
      const state = buildSameGroupRepeatState()
      const result = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 0,
        state,
        liveCourtIdxs: new Set(),
        liveCourtPlayers: new Map(),
        busyIds: new Set(),
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      expect(result.degradedReason).toBeUndefined()
    })
  })

  describe('flag OFF (byte-identical to legacy)', () => {
    beforeEach(() => __setQualityCostModelOverrideForTests(false))

    it('keeps legacy blowout detection + rescue-court search', () => {
      const scene = buildRescueClearsScenario()
      const result = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 1,
        state: scene.state,
        liveCourtIdxs: scene.liveCourtIdxs,
        liveCourtPlayers: scene.liveCourtPlayers,
        busyIds: scene.busyIds,
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      expect(result.degradedReason).toBe('blowout')
      expect(result.rescueCourtIdxs).toEqual([0])
    })

    it('keeps legacy repeat detection for a same-group 3rd meeting (still flagged, unlike the flag-ON re-anchored result)', () => {
      const state = buildSameGroupRepeatState()
      const result = computeMatchDegradedRescue({
        teamA: ['X1', 'X2'],
        teamB: ['Y1', 'Y2'],
        courtIdx: 0,
        state,
        liveCourtIdxs: new Set(),
        liveCourtPlayers: new Map(),
        busyIds: new Set(),
        pvnaTolerance: 0.5,
        budgetMs: 2000,
        nowMsFn: () => performance.now(),
      })
      expect(result.degradedReason).toBe('repeat')
    })
  })
})
