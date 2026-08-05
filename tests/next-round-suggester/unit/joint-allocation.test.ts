import { bestSplitForFoursome, type Foursome } from '../../../lib/next-round-suggester/quality-cost'
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
