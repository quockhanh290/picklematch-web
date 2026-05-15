import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState, simulateRound } from '../helpers/factories'
import { lateJoinScenario } from '../helpers/scenarios'

describe('late join scenarios', () => {
  it('late joiner becomes eligible next round', () => {
    const state = lateJoinScenario()
    const suggestion = suggestNextRound(state).alternatives[0]
    const playing = suggestion.matches.flatMap((match) => [...match.team_a, ...match.team_b])

    expect(playing).toContain('p09')
  })

  it('late joiner is prioritized over players with more matches', () => {
    const players = [
      createPlayer('p1', { matches_played: 3 }),
      createPlayer('p2', { matches_played: 3 }),
      createPlayer('p3', { matches_played: 3 }),
      createPlayer('p4', { matches_played: 3 }),
      createPlayer('p5', { matches_played: 3 }),
      createPlayer('p6', { matches_played: 3 }),
      createPlayer('p7', { matches_played: 3 }),
      createPlayer('p8', { matches_played: 3 }),
      createPlayer('p9', { matches_played: 0 }),
    ]
    let state = createState({ players, courts: 2 })
    state = simulateRound(state, [
      { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 1, team_a: ['p5', 'p6'], team_b: ['p7', 'p8'] },
    ])
    state.players.set('p9', createPlayer('p9', { matches_played: 0 }))

    const playing = suggestNextRound(state).alternatives[0].matches.flatMap((match) => [
      ...match.team_a,
      ...match.team_b,
    ])

    expect(playing).toContain('p9')
  })
})
