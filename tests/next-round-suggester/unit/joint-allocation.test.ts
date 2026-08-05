import { bestSplitForFoursome, jointRepartition, type Foursome } from '../../../lib/next-round-suggester/quality-cost'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

function stateFor(pvnaById: Record<string, number>): SessionState {
  const players = Object.entries(pvnaById).map(([id, pvna]) => createPlayer(id, { pvna }))
  return createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 0 })
}

describe('bestSplitForFoursome', () => {
  it('picks the balanced 2v2 split over the two blowout splits', () => {
    // Skills 2.0, 2.1, 3.0, 3.1. Balanced split = {2.0,3.0} vs {2.1,3.1} (gap 0.2).
    // The other splits pair the two lows vs the two highs (gap ~2.0) — blowouts.
    const state = stateFor({ p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 })
    const four: Foursome = ['p0', 'p1', 'p2', 'p3']
    const best = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    const ids = [...best.team_a, ...best.team_b].sort()
    expect(ids).toEqual(['p0', 'p1', 'p2', 'p3'])
    const pvnaById: Record<string, number> = { p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 }
    const sum = (t: string[]) => t.reduce((s, id) => s + pvnaById[id], 0)
    expect(Math.abs(sum(best.team_a) - sum(best.team_b))).toBeLessThan(0.5)
  })

  it('is deterministic — same input twice yields identical teams', () => {
    const state = stateFor({ p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 })
    const four: Foursome = ['p0', 'p1', 'p2', 'p3']
    const a = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    const b = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    expect(a.team_a).toEqual(b.team_a)
    expect(a.team_b).toEqual(b.team_b)
  })
})

describe('jointRepartition', () => {
  it('fixes a greedy cascade: cross-court swap balances two blowout courts', () => {
    // Court A holds the two strongest + court B the two weakest => each court is an intra/blowout mess.
    // A single cross-court swap yields two near-balanced courts.
    const state = stateFor({ s0: 4.0, s1: 3.9, w0: 2.0, w1: 2.1, m0: 3.0, m1: 3.0, m2: 3.0, m3: 3.0 })
    const courts = [
      { court_idx: 0, four: ['s0', 's1', 'w0', 'w1'] as Foursome }, // strong+weak stacked
      { court_idx: 1, four: ['m0', 'm1', 'm2', 'm3'] as Foursome },
    ]
    const before = jointRepartition(courts, state, { tolerance: 0.5 }).totalCostBefore
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(res.changed).toBe(true)
    expect(res.totalCostAfter).toBeLessThan(before)
  })

  it('never worsens total cost (starts from greedy, accepts only improvements)', () => {
    const state = stateFor({ a: 2.3, b: 3.7, c: 2.9, d: 3.1, e: 2.0, f: 4.0, g: 3.3, h: 2.6 })
    const courts = [
      { court_idx: 0, four: ['a', 'b', 'c', 'd'] as Foursome },
      { court_idx: 1, four: ['e', 'f', 'g', 'h'] as Foursome },
    ]
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(res.totalCostAfter).toBeLessThanOrEqual(res.totalCostBefore + 1e-9)
  })

  it('holds the seated set fixed (multiset of ids unchanged, per court and overall)', () => {
    const state = stateFor({ a: 2.3, b: 3.7, c: 2.9, d: 3.1, e: 2.0, f: 4.0, g: 3.3, h: 2.6 })
    const courts = [
      { court_idx: 0, four: ['a', 'b', 'c', 'd'] as Foursome },
      { court_idx: 1, four: ['e', 'f', 'g', 'h'] as Foursome },
    ]
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    const outAll = res.splits.flatMap(s => [...s.team_a, ...s.team_b]).sort()
    expect(outAll).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    for (const s of res.splits) expect([...s.team_a, ...s.team_b].length).toBe(4)
  })

  it('is deterministic — identical splits on repeat', () => {
    const state = stateFor({ a: 2.3, b: 3.7, c: 2.9, d: 3.1, e: 2.0, f: 4.0, g: 3.3, h: 2.6 })
    const courts = [
      { court_idx: 0, four: ['a', 'b', 'c', 'd'] as Foursome },
      { court_idx: 1, four: ['e', 'f', 'g', 'h'] as Foursome },
    ]
    const a = jointRepartition(courts, state, { tolerance: 0.5 })
    const b = jointRepartition(courts, state, { tolerance: 0.5 })
    expect(a.splits).toEqual(b.splits)
  })
})
