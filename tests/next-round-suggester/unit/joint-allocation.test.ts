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

  it('never pairs avoid-partners as teammates even when that split minimizes quality cost', () => {
    // Skills 2.0, 2.1, 3.0, 3.1: the min-cost split (0.22) pairs {p0,p2} vs {p1,p3}.
    // p0/p2 are configured as an avoid-partner pair — that split must be treated as infeasible,
    // even though it beats the runner-up split {p0,p3} vs {p1,p2} (cost 0.24) on quality cost alone.
    const state = stateFor({ p0: 2.0, p1: 2.1, p2: 3.0, p3: 3.1 })
    state.players.get('p0')!.avoid_ids = new Set(['p2'])
    state.players.get('p2')!.avoid_ids = new Set(['p0'])
    const four: Foursome = ['p0', 'p1', 'p2', 'p3']
    const best = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    const teamHasBoth = (team: readonly string[]) => team.includes('p0') && team.includes('p2')
    expect(teamHasBoth(best.team_a) || teamHasBoth(best.team_b)).toBe(false)
    const ids = [...best.team_a, ...best.team_b].sort()
    expect(ids).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('still returns a valid split when every split pairs some avoid-couple (degenerate case)', () => {
    // 4 players, both possible non-blowout partner pairings ({p0,p1}&{p2,p3} and {p0,p2}&{p1,p3})
    // include an avoid-couple, so every split has some avoid-partner violation. Must not throw/return null.
    const state = stateFor({ p0: 2.0, p1: 2.1, p2: 2.0, p3: 2.1 })
    state.players.get('p0')!.avoid_ids = new Set(['p1'])
    state.players.get('p1')!.avoid_ids = new Set(['p0'])
    state.players.get('p0')!.avoid_ids!.add('p2')
    state.players.get('p2')!.avoid_ids = new Set(['p0'])
    state.players.get('p0')!.avoid_ids!.add('p3')
    state.players.get('p3')!.avoid_ids = new Set(['p0'])
    const four: Foursome = ['p0', 'p1', 'p2', 'p3']
    expect(() => bestSplitForFoursome(four, state, { tolerance: 0.5 })).not.toThrow()
    const best = bestSplitForFoursome(four, state, { tolerance: 0.5 })
    const ids = [...best.team_a, ...best.team_b].sort()
    expect(ids).toEqual(['p0', 'p1', 'p2', 'p3'])
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

  it('never places an avoid-couple as teammates, even via a cross-court swap that would minimize cost', () => {
    // Same greedy-cascade setup as the first test above: without the avoid constraint, the optimal
    // cross-court repartition pairs m0 and w1 as teammates (verified against the unconstrained result).
    // Marking m0/w1 as an avoid-partner pair must steer the search away from that pairing entirely.
    const state = stateFor({ s0: 4.0, s1: 3.9, w0: 2.0, w1: 2.1, m0: 3.0, m1: 3.0, m2: 3.0, m3: 3.0 })
    state.players.get('m0')!.avoid_ids = new Set(['w1'])
    state.players.get('w1')!.avoid_ids = new Set(['m0'])
    const courts = [
      { court_idx: 0, four: ['s0', 's1', 'w0', 'w1'] as Foursome },
      { court_idx: 1, four: ['m0', 'm1', 'm2', 'm3'] as Foursome },
    ]
    const res = jointRepartition(courts, state, { tolerance: 0.5 })
    const teamHasBoth = (team: readonly string[]) => team.includes('m0') && team.includes('w1')
    for (const s of res.splits) {
      expect(teamHasBoth(s.team_a) || teamHasBoth(s.team_b)).toBe(false)
    }
    const outAll = res.splits.flatMap(s => [...s.team_a, ...s.team_b]).sort()
    expect(outAll).toEqual(['m0', 'm1', 'm2', 'm3', 's0', 's1', 'w0', 'w1'])
  })
})
