import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector'
import { buildSessionSummary } from '../../../lib/next-round-suggester/fairness/summary'
import { createPlayer, createState, simulateSession } from '../helpers/factories'

describe('Full session fairness flow', () => {
  it('8 players 2 courts 5 rounds ends with score > 85', () => {
    const result = simulateSession({ players: 8, courts: 2, rounds: 5 })
    const summary = buildSessionSummary(result.state)

    expect(summary.fairness_score.total).toBeGreaterThan(85)
  })

  it('9 players 2 courts handles odd rotation fairly', () => {
    const result = simulateSession({ players: 9, courts: 2, rounds: 8 })
    const summary = buildSessionSummary(result.state)

    expect(summary.fairness_score.total).toBeGreaterThan(80)
    expect(summary.per_player.every((player) => player.max_consecutive_rest <= 1)).toBe(true)
  })

  it('corrector recommends changes when long-session fairness is poor', () => {
    const state = createState({
      currentRound: 4,
      players: [
        createPlayer('p1', { matches_played: 4 }),
        createPlayer('p2', { matches_played: 0 }),
        createPlayer('p3', { matches_played: 4 }),
        createPlayer('p4', { matches_played: 4 }),
      ],
    })
    const adjustment = correctForFairness(state)

    expect(adjustment.applied_for_warnings.length).toBeGreaterThan(0)
  })
})
