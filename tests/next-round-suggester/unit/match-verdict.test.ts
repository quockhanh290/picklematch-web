import { computeMatchVerdict } from '../../../lib/next-round-suggester/verdict'
import type { Team } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('computeMatchVerdict', () => {
  it('flags PVNA over tolerance using the engine effective PVNA source', () => {
    const teamA: Team = ['a0', 'a1']
    const teamB: Team = ['b0', 'b1']
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a0', { pvna: 3.0, effective_pvna: 4.0 }),
        createPlayer('a1', { pvna: 3.0, effective_pvna: 3.0 }),
        createPlayer('b0', { pvna: 3.0, effective_pvna: 3.0 }),
        createPlayer('b1', { pvna: 3.0, effective_pvna: 3.0 }),
      ],
    })

    expect(computeMatchVerdict(teamA, teamB, state, 0.5)).toMatchObject({
      pvnaVerdict: 'over_tolerance',
      reasons: expect.arrayContaining(['pvna_over_tolerance']),
    })
  })

  it('keeps PVNA within tolerance when the engine effective PVNA balances raw player PVNA', () => {
    const teamA: Team = ['a0', 'a1']
    const teamB: Team = ['b0', 'b1']
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a0', { pvna: 4.0, effective_pvna: 3.0 }),
        createPlayer('a1', { pvna: 3.0, effective_pvna: 3.0 }),
        createPlayer('b0', { pvna: 3.0, effective_pvna: 3.0 }),
        createPlayer('b1', { pvna: 3.0, effective_pvna: 3.0 }),
      ],
    })

    expect(computeMatchVerdict(teamA, teamB, state, 0.5)).toMatchObject({
      pvnaVerdict: 'within_tolerance',
      reasons: expect.not.arrayContaining(['pvna_over_tolerance']),
    })
  })

  it('flags repeat overflow from projected engine repeat caps', () => {
    const teamA: Team = ['a0', 'a1']
    const teamB: Team = ['b0', 'b1']
    const players = [
      createPlayer('a0'),
      createPlayer('a1'),
      createPlayer('b0'),
      createPlayer('b1'),
    ]
    setOpponentRepeats(players[0], players[2], 2)
    const state = createState({ players })

    expect(computeMatchVerdict(teamA, teamB, state, 0.5)).toMatchObject({
      repeatVerdict: 'over_cap',
      reasons: expect.arrayContaining(['repeat_over_cap']),
    })
  })

  it('does not flag same-group partner repeat overflow when the engine cap exempts it', () => {
    const teamA: Team = ['a0', 'a1']
    const teamB: Team = ['b0', 'b1']
    const players = [
      createPlayer('a0', { group_id: 'g1' }),
      createPlayer('a1', { group_id: 'g1' }),
      createPlayer('b0'),
      createPlayer('b1'),
    ]
    setPartnerRepeats(players[0], players[1], 2)
    const state = createState({ players })

    expect(computeMatchVerdict(teamA, teamB, state, 0.5)).toMatchObject({
      repeatVerdict: 'within_cap',
      reasons: expect.not.arrayContaining(['repeat_over_cap']),
    })
  })

  it('flags intra-team gap over the hard engine cap using effective PVNA', () => {
    const teamA: Team = ['a0', 'a1']
    const teamB: Team = ['b0', 'b1']
    const state = createState({
      players: [
        createPlayer('a0', { pvna: 3.0, effective_pvna: 4.2 }),
        createPlayer('a1', { pvna: 3.0, effective_pvna: 3.0 }),
        createPlayer('b0', { pvna: 3.0, effective_pvna: 3.0 }),
        createPlayer('b1', { pvna: 3.0, effective_pvna: 3.0 }),
      ],
    })

    expect(computeMatchVerdict(teamA, teamB, state, 0.5)).toMatchObject({
      intraVerdict: 'over_cap',
      reasons: expect.arrayContaining(['intra_over_cap']),
    })
  })
})
