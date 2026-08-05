import { buildTradeoffEndpoints } from '../../../lib/next-round-suggester/forced-tradeoff'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'

function stateWith(pvnaById: Record<string, number>, currentRound = 0): SessionState {
  const players = Object.entries(pvnaById).map(([id, pvna]) => createPlayer(id, { pvna }))
  return createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound })
}

function splitKey(lu: { team_a: readonly string[]; team_b: readonly string[] }): string {
  return JSON.stringify([[...lu.team_a].sort(), [...lu.team_b].sort()].sort())
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
    // Pool of 4 where: both "balanced-gap" splits (lo+hi vs lo+hi) pair a lo/hi as partners who have
    // already partnered twice → pairing them again is a 3rd meeting. The only split that avoids all
    // repeats is lows-vs-highs, which is a gap-3.2 blowout.
    // Every lo/hi cross-pair has partner_counts=2: whichever split makes two of them partners forces
    // a 3rd meeting; the lows-vs-highs split keeps those pairs as fresh opponents instead.
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.6, hi2: 3.7 }, 3)
    const lo1 = state.players.get('lo1')!
    const lo2 = state.players.get('lo2')!
    const hi1 = state.players.get('hi1')!
    const hi2 = state.players.get('hi2')!
    setPartnerRepeats(lo1, hi1, 2)
    setPartnerRepeats(lo1, hi2, 2)
    setPartnerRepeats(lo2, hi1, 2)
    setPartnerRepeats(lo2, hi2, 2)
    const res = buildTradeoffEndpoints(['lo1', 'lo2', 'hi1', 'hi2'], state, 0.5)
    expect(res.isForced).toBe(true)
    if (res.isForced) {
      // acceptRepeat = most balanced (gap small), tolerates the 3rd meeting
      expect(res.acceptRepeat.gap).toBeLessThanOrEqual(res.acceptImbalance.gap)
      // acceptImbalance = freshest (lowest maxMeeting), tolerates the gap
      expect(res.acceptImbalance.maxMeeting).toBeLessThanOrEqual(res.acceptRepeat.maxMeeting)
      // they genuinely differ (a real tradeoff): same 4 players, different SPLIT — compare the split
      expect(splitKey(res.acceptRepeat)).not.toEqual(splitKey(res.acceptImbalance))
    }
  })

  it('never pairs two avoid-partners in either endpoint', () => {
    const state = stateWith({ a: 2.0, b: 2.1, c: 3.6, d: 3.7 }, 3)
    // make a & b an avoid-partner pair via the real mechanism read by avoid.ts:isAvoidPair (avoid_ids on the player)
    const A = state.players.get('a')!
    const B = state.players.get('b')!
    A.avoid_ids = new Set(['b'])
    B.avoid_ids = new Set(['a'])
    const res = buildTradeoffEndpoints(['a', 'b', 'c', 'd'], state, 0.5)
    const pairsAvoid = (t: string[]) =>
      t.length === 2 && ((t[0] === 'a' && t[1] === 'b') || (t[0] === 'b' && t[1] === 'a'))
    const check = (lu?: { team_a: string[]; team_b: string[] }) => {
      if (lu) {
        expect(pairsAvoid(lu.team_a)).toBe(false)
        expect(pairsAvoid(lu.team_b)).toBe(false)
      }
    }
    if (res.isForced) {
      check(res.acceptRepeat)
      check(res.acceptImbalance)
    } else if (res.clean) {
      check(res.clean)
    }
  })

  it('pool smaller than 4 → not forced, clean null (caller falls back)', () => {
    const state = stateWith({ a: 3.0, b: 3.0, c: 3.0 })
    expect(buildTradeoffEndpoints(['a', 'b', 'c'], state, 0.5)).toEqual({ isForced: false, clean: null })
  })
})
