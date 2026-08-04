import { scoreMatch, getMatchGroupKey, withRecentGroupRematchKeys } from '../../../lib/next-round-suggester/score'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import type { Match, SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

describe('scoreMatch — SESSION_QUALITY_COST_MODEL flag', () => {
  afterEach(() => {
    __setQualityCostModelOverrideForTests(null)
  })

  describe('flag ON', () => {
    beforeEach(() => {
      __setQualityCostModelOverrideForTests(true)
    })

    it('returns a finite score for an over-tolerance balanced split, lower than the same-cluster blowout split', () => {
      // Bimodal foursome: L1/L2 low, H1/H2 high. Neither split is within the 0.5 tolerance, but the
      // cross split (L1+H1 vs L2+H2, gap 1.0) is far better balanced than the same-cluster split
      // (L1+L2 vs H1+H2, gap 2.2). Under the OLD model both are hard-gated to Infinity (gap > tolerance).
      const players = [
        createPlayer('L1', { pvna: 2.3 }),
        createPlayer('L2', { pvna: 2.7 }),
        createPlayer('H1', { pvna: 3.3 }),
        createPlayer('H2', { pvna: 3.9 }),
      ]
      const state = createState({ players, pvnaTolerance: 0.5 })

      const balanced = scoreMatch(['L1', 'H1'], ['L2', 'H2'], state)
      const blowout = scoreMatch(['L1', 'L2'], ['H1', 'H2'], state)

      expect(Number.isFinite(balanced.score)).toBe(true)
      expect(Number.isFinite(blowout.score)).toBe(true)
      expect(balanced.score).toBeLessThan(blowout.score)
    })

    it('fills stats.gender_pref_penalty (not left at the 0 placeholder) for a lineup with a gender-pref violation', () => {
      const players = [
        createPlayer('p1', { pvna: 3.0, gender: 'F', partner_gender_pref: 'F' }),
        createPlayer('p2', { pvna: 3.0, gender: 'M' }),
        createPlayer('p3', { pvna: 3.0, gender: 'F' }),
        createPlayer('p4', { pvna: 3.0, gender: 'M' }),
      ]
      const state = createState({ players, pvnaTolerance: 10 })

      const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state)

      expect(result.stats.gender_pref_penalty).toBeGreaterThan(0)
    })

    it('does not block a re-split of a recently-played foursome, even when the caller injects player-set-based recent-group-rematch keys', () => {
      // A re-split ({p1,p3} v {p2,p4}) of a prior {p1,p2} v {p3,p4} match is a fresh lineup (Decision 1,
      // Task 2). But production callers (pair.ts / live-preview.ts) pre-inject "recent group rematch"
      // keys keyed only by the 4-player set (getMatchGroupKey), not by partnership — so even after the
      // Task 2 fix, the injected-keys path in hasRecentGroupRematch still blocks the re-split unless the
      // gate stops running entirely (flag ON).
      const players = [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.0 }),
        createPlayer('p3', { pvna: 3.0 }),
        createPlayer('p4', { pvna: 3.0 }),
      ]
      const previousMatch: Match = { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] }
      const baseState: SessionState = {
        ...createState({ players, currentRound: 1, pvnaTolerance: 10 }),
        rounds: [{
          session_id: 'session-test',
          round_no: 0,
          status: 'completed',
          matches: [previousMatch],
          resting: [],
          started_at: null,
          ended_at: null,
        }],
      }
      const injectedKeys = new Set([getMatchGroupKey(previousMatch.team_a, previousMatch.team_b)])
      const state = withRecentGroupRematchKeys(baseState, injectedKeys)

      const resplit = scoreMatch(['p1', 'p3'], ['p2', 'p4'], state)

      expect(Number.isFinite(resplit.score)).toBe(true)
    })
  })

  describe('flag OFF (default / unchanged)', () => {
    it('still returns Infinity for the over-tolerance split (unchanged behaviour)', () => {
      const players = [
        createPlayer('L1', { pvna: 2.3 }),
        createPlayer('L2', { pvna: 2.7 }),
        createPlayer('H1', { pvna: 3.3 }),
        createPlayer('H2', { pvna: 3.9 }),
      ]
      const state = createState({ players, pvnaTolerance: 0.5 })

      expect(scoreMatch(['L1', 'H1'], ['L2', 'H2'], state).score).toBe(Infinity)
    })

    it('still blocks a re-split via injected player-set-based recent-group-rematch keys', () => {
      const players = [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.0 }),
        createPlayer('p3', { pvna: 3.0 }),
        createPlayer('p4', { pvna: 3.0 }),
      ]
      const previousMatch: Match = { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] }
      const baseState: SessionState = {
        ...createState({ players, currentRound: 1, pvnaTolerance: 10 }),
        rounds: [{
          session_id: 'session-test',
          round_no: 0,
          status: 'completed',
          matches: [previousMatch],
          resting: [],
          started_at: null,
          ended_at: null,
        }],
      }
      const injectedKeys = new Set([getMatchGroupKey(previousMatch.team_a, previousMatch.team_b)])
      const state = withRecentGroupRematchKeys(baseState, injectedKeys)

      expect(scoreMatch(['p1', 'p3'], ['p2', 'p4'], state).score).toBe(Infinity)
    })
  })
})
