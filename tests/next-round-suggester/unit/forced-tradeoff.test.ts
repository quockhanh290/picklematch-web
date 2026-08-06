import { buildTradeoffEndpoints, buildFreshestLineup, simulateWaitWouldClean } from '../../../lib/next-round-suggester/forced-tradeoff'
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

describe('simulateWaitWouldClean', () => {
  it('offers a court whose players, when returned, enable a clean fill', () => {
    // pool of 4 that is forced: every lo×hi cross-pair is partner-saturated (2 prior meetings), so
    // both balanced (lo+hi vs lo+hi) splits are 3rd-meeting repeats — only the lo-vs-hi blowout is fresh.
    // A live court holds fresh mid/x players that, added to the pool, allow a clean balanced fresh split
    // among themselves (mid+x vs mid+x, gap ~0.1, no history).
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8, mid1: 2.9, mid2: 3.0, x1: 4.0, x2: 4.0 }, 3)
    const lo1 = state.players.get('lo1')!
    const lo2 = state.players.get('lo2')!
    const hi1 = state.players.get('hi1')!
    const hi2 = state.players.get('hi2')!
    setPartnerRepeats(lo1, hi1, 2)
    setPartnerRepeats(lo1, hi2, 2)
    setPartnerRepeats(lo2, hi1, 2)
    setPartnerRepeats(lo2, hi2, 2)
    const pool = ['lo1', 'lo2', 'hi1', 'hi2']
    expect(buildTradeoffEndpoints(pool, state, 0.5).isForced).toBe(true)
    const live = [
      { court_idx: 3, player_ids: ['mid1', 'mid2', 'x1', 'x2'], started_at: '2026-08-05T07:00:00Z' },
    ]
    const res = simulateWaitWouldClean(pool, live, state, 0.5)
    expect(res.map(r => r.court_idx)).toContain(3)
  })

  it('offers nothing when no single court completion yields a clean fill', () => {
    // Every pair among the 8 players (pool + live court) is partner-saturated (2 prior meetings), so
    // ANY team assembled from any two of them is a 3rd-meeting repeat — no split of any 4-subset of the
    // enlarged pool can ever be clean, regardless of skill balance. This is a genuinely-forced-even-
    // after-adding case, not just "adding fresh balanced players" (which would trivially go clean).
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8, a: 2.0, b: 2.05, c: 3.65, d: 3.75 }, 3)
    const ids = ['lo1', 'lo2', 'hi1', 'hi2', 'a', 'b', 'c', 'd']
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        setPartnerRepeats(state.players.get(ids[i])!, state.players.get(ids[j])!, 2)
      }
    }
    const pool = ['lo1', 'lo2', 'hi1', 'hi2']
    expect(buildTradeoffEndpoints(pool, state, 0.5).isForced).toBe(true)
    const live = [{ court_idx: 3, player_ids: ['a', 'b', 'c', 'd'], started_at: '2026-08-05T07:00:00Z' }]
    expect(simulateWaitWouldClean(pool, live, state, 0.5)).toEqual([])
  })

  it('sorts qualifying courts longest-running first (earliest started_at)', () => {
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8, m1: 3.0, m2: 3.0, m3: 3.0, m4: 3.0, n1: 3.0, n2: 3.0, n3: 3.0, n4: 3.0 }, 3)
    const lo1 = state.players.get('lo1')!
    const lo2 = state.players.get('lo2')!
    const hi1 = state.players.get('hi1')!
    const hi2 = state.players.get('hi2')!
    setPartnerRepeats(lo1, hi1, 2)
    setPartnerRepeats(lo1, hi2, 2)
    setPartnerRepeats(lo2, hi1, 2)
    setPartnerRepeats(lo2, hi2, 2)
    const pool = ['lo1', 'lo2', 'hi1', 'hi2']
    expect(buildTradeoffEndpoints(pool, state, 0.5).isForced).toBe(true)
    // both m1-m4 and n1-n4 are internally uniform-skill and fresh (each qualifies on its own), so
    // this genuinely exercises the sort rather than depending on only one court qualifying.
    const live = [
      { court_idx: 1, player_ids: ['m1', 'm2', 'm3', 'm4'], started_at: '2026-08-05T07:10:00Z' },
      { court_idx: 2, player_ids: ['n1', 'n2', 'n3', 'n4'], started_at: '2026-08-05T07:00:00Z' }, // earlier
    ]
    const res = simulateWaitWouldClean(pool, live, state, 0.5)
    expect(res.map(r => r.court_idx)).toEqual([2, 1])
  })
})

describe('buildFreshestLineup', () => {
  it('returns the min-repeat lineup (freshest), then min-gap on ties', () => {
    // 4 players where the only balanced split (lo1+hi1 vs lo2+hi2) is partner-saturated → a 3rd meeting,
    // while the fresh split (lo1+lo2 vs hi1+hi2) has no history. Freshest = the fresh split (meet 1).
    const state = stateWith({ lo1: 2.0, lo2: 2.1, hi1: 3.6, hi2: 3.7 }, 3)
    setPartnerRepeats(state.players.get('lo1')!, state.players.get('hi1')!, 2)
    setPartnerRepeats(state.players.get('lo1')!, state.players.get('hi2')!, 2)
    setPartnerRepeats(state.players.get('lo2')!, state.players.get('hi1')!, 2)
    setPartnerRepeats(state.players.get('lo2')!, state.players.get('hi2')!, 2)
    const fresh = buildFreshestLineup(['lo1', 'lo2', 'hi1', 'hi2'], state, 0.5)
    expect(fresh).not.toBeNull()
    expect(fresh!.maxMeeting).toBe(1)
    // the fresh split pairs the two lows together and the two highs together
    const teamSet = [[...fresh!.team_a].sort(), [...fresh!.team_b].sort()].map(t => t.join(','))
    expect(teamSet).toContain('lo1,lo2')
    expect(teamSet).toContain('hi1,hi2')
  })

  it('prefers a fresher lineup over a more-balanced repeat (min-repeat dominates min-gap)', () => {
    // A larger pool where a perfectly balanced split exists but repeats, and a fresh split is slightly
    // less balanced — buildFreshestLineup must pick the fresh one (repeat is the primary axis).
    const state = stateWith({ a: 3.0, b: 3.0, c: 3.0, d: 3.0, e: 2.6, f: 3.4 }, 3)
    // saturate a-b and c-d as partners so the a+b vs c+d split (gap 0) is a 3rd meeting
    setPartnerRepeats(state.players.get('a')!, state.players.get('b')!, 2)
    setPartnerRepeats(state.players.get('c')!, state.players.get('d')!, 2)
    const fresh = buildFreshestLineup(['a', 'b', 'c', 'd', 'e', 'f'], state, 0.5)
    expect(fresh!.maxMeeting).toBeLessThan(3)
  })

  it('returns null for a pool smaller than 4', () => {
    const state = stateWith({ a: 3.0, b: 3.0, c: 3.0 })
    expect(buildFreshestLineup(['a', 'b', 'c'], state, 0.5)).toBeNull()
  })
})
