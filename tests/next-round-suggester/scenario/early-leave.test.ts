import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState, simulateRound } from '../helpers/factories'
import { earlyLeaveScenario } from '../helpers/scenarios'

describe('early leave scenarios', () => {
  it('checked-out player is excluded from suggestions', () => {
    const state = earlyLeaveScenario()
    const playing = suggestNextRound(state).alternatives[0].matches.flatMap((match) => [
      ...match.team_a,
      ...match.team_b,
    ])

    expect(playing).not.toContain('p03')
  })

  it('checking out mid-session does not break next round', () => {
    let state = createState({
      courts: 2,
      players: Array.from({ length: 8 }, (_, index) => createPlayer(`p${index + 1}`)),
    })
    state = simulateRound(state, [
      { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 1, team_a: ['p5', 'p6'], team_b: ['p7', 'p8'] },
    ])
    const leaving = state.players.get('p4')
    if (leaving) leaving.checked_out_at = new Date('2026-05-14T12:30:00.000Z')

    const result = suggestNextRound(state)
    const playing = result.alternatives[0].matches.flatMap((match) => [...match.team_a, ...match.team_b])

    expect(result.should_end).toBe(false)
    expect(playing).not.toContain('p4')
  })
})
