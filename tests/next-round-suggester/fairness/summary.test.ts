import { buildSessionSummary } from '../../../lib/next-round-suggester/fairness/summary'
import { computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics'
import { createMatch, createPlayer, createState, simulateSession } from '../helpers/factories'

describe('Session Summary', () => {
  it('builds end-of-session summary with score and per-player stats', () => {
    const result = simulateSession({ players: 8, courts: 2, rounds: 5 })
    const summary = buildSessionSummary(result.state)

    expect(summary.session_id).toBe(result.state.session_id)
    expect(summary.total_rounds).toBe(5)
    expect(summary.per_player).toHaveLength(8)
    expect(summary.fairness_score.total).toBe(computeSessionFairness(result.state).total)
  })

  it('includes aggregate gender preference satisfaction without per-player preference details', () => {
    const result = simulateSession({
      players: 8,
      courts: 2,
      rounds: 3,
      genderMode: 'mixedPrefs',
    })
    const summary = buildSessionSummary(result.state)

    expect(summary.overall_pref_satisfaction_rate).toBeGreaterThanOrEqual(0)
    expect(Object.keys(summary.per_player[0])).not.toContain('partner_gender_pref')
  })

  it('handles empty legacy sessions gracefully', () => {
    const summary = buildSessionSummary(createState({ players: [] }))

    expect(summary.total_players).toBe(0)
    expect(summary.duration_minutes).toBe(0)
    expect(summary.fairness_score.total).toBeGreaterThanOrEqual(0)
  })

  it('computes fairness evolution from replayed round state instead of returning placeholder 100s', () => {
    const state = createState({
      players: [
        createPlayer('p1'),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })
    state.rounds = [
      round(0),
      round(1),
      round(2),
    ]

    const evolution = buildSessionSummary(state).fairness_evolution

    expect(evolution).toHaveLength(3)
    expect(evolution.some((point) => point.score < 100)).toBe(true)
  })
})

function round(roundNo: number) {
  return {
    session_id: 'session-test',
    round_no: roundNo,
    status: 'completed' as const,
    matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    resting: [],
    started_at: new Date(`2026-05-14T12:${String(roundNo).padStart(2, '0')}:00.000Z`),
    ended_at: new Date(`2026-05-14T12:${String(roundNo + 1).padStart(2, '0')}:00.000Z`),
  }
}
