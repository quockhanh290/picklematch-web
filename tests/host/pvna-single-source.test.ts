import { getEffectivePvna, getMatchPvnaGap, getTeamPvnaTotal } from '../../lib/next-round-suggester/state'
import { createPlayer, createState } from '../next-round-suggester/helpers/factories'

// The engine ranks and gates on getEffectivePvna — effective_pvna when the session has one, pvna
// otherwise. The client carried two copies of this arithmetic that both read raw pvna, and that did not
// even agree with each other on what a missing player contributes (3.0 in one, 0 in the other).
//
// Not merely display drift: the client's gap decides things. It is compared against pvnaTolerance at
// useLiveBoard.ts:1045 and preview-consistency.ts:209, so the client could call a match over tolerance
// that the engine had seated as within it, from the same board.
//
// One function, in lib, for both. These tests pin what it must agree with.
describe('one PVNA measurement, shared with the engine', () => {
  // effective_pvna deliberately far from pvna, so reading the wrong field cannot pass by luck.
  const state = createState({
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a1', { pvna: 3, effective_pvna: 5 } as never),
      createPlayer('a2', { pvna: 3, effective_pvna: 5 } as never),
      createPlayer('b1', { pvna: 3, effective_pvna: 2 } as never),
      createPlayer('b2', { pvna: 3, effective_pvna: 2 } as never),
    ],
  })

  const engineTotal = (team: string[]) =>
    team.reduce((sum, id) => sum + getEffectivePvna(state.players.get(id)!), 0)

  it('totals a team with the effective rating, not the raw one', () => {
    expect(getTeamPvnaTotal(['a1', 'a2'], state)).toBe(engineTotal(['a1', 'a2']))
    expect(getTeamPvnaTotal(['a1', 'a2'], state)).not.toBe(6)
  })

  it('reports the gap the engine gates on', () => {
    expect(getMatchPvnaGap(['a1', 'a2'], ['b1', 'b2'], state))
      .toBe(Math.abs(engineTotal(['a1', 'a2']) - engineTotal(['b1', 'b2'])))
  })

  it('contributes nothing for a player the client state has not caught up to', () => {
    // The two old copies disagreed here — one invented an average player at 3.0. Inventing a rating is
    // worse than under-reporting: it produces a plausible number for a player nobody can see.
    expect(getTeamPvnaTotal(['a1', 'not-in-state'], state)).toBe(getEffectivePvna(state.players.get('a1')!))
  })
})
