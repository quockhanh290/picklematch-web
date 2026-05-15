import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState } from '../helpers/factories'
import { groupedScenario } from '../helpers/scenarios'

describe('group handling scenarios', () => {
  it('prioritizes grouped players to play in the same round', () => {
    const result = suggestNextRound(groupedScenario())
    const playing = new Set(result.alternatives[0].matches.flatMap((match) => [...match.team_a, ...match.team_b]))

    expect(playing.has('p01')).toBe(true)
    expect(playing.has('p02')).toBe(true)
  })

  it('does not force grouped players to the same team', () => {
    const state = createState({
      players: [
        createPlayer('p1', { group_id: 'g1', pvna: 2.9 }),
        createPlayer('p2', { group_id: 'g1', pvna: 4.5 }),
        createPlayer('p3', { pvna: 2.9 }),
        createPlayer('p4', { pvna: 4.5 }),
      ],
    })
    const match = suggestNextRound(state).alternatives[0].matches[0]

    expect(match.team_a.includes('p1') && match.team_a.includes('p2')).toBe(false)
    expect(match.team_b.includes('p1') && match.team_b.includes('p2')).toBe(false)
  })

  it('handles multiple groups in one session', () => {
    const result = suggestNextRound(groupedScenario())

    expect(result.alternatives[0].matches).toHaveLength(2)
    expect(result.alternatives[0].stats.group_bonus).toBeGreaterThan(0)
  })
})
