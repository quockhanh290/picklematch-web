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
