import { createMatch, createPlayer, createState } from '../helpers/factories'
import { computeGenderPrefSatisfaction, computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics'
import { sanitizeMetricsForHost } from '../../../lib/next-round-suggester/fairness/sanitize'

describe('Gender Pref Satisfaction', () => {
  it('returns perfect satisfaction when no preferences are set', () => {
    const state = createState({
      players: [
        createPlayer('p1', { gender: 'M' }),
        createPlayer('p2', { gender: 'F' }),
        createPlayer('p3', { gender: 'M' }),
        createPlayer('p4', { gender: 'F' }),
      ],
    })
    state.rounds = [round()]

    const metrics = computeGenderPrefSatisfaction(state)

    expect(metrics.total_pref_opportunities).toBe(0)
    expect(metrics.satisfaction_rate).toBe(1)
  })

  it('returns proportional satisfaction rate', () => {
    const state = createState({
      players: [
        createPlayer('p1', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { gender: 'M' }),
        createPlayer('p3', { gender: 'F' }),
        createPlayer('p4', { gender: 'F' }),
      ],
    })
    state.rounds = [round()]

    const metrics = computeGenderPrefSatisfaction(state)

    expect(metrics.total_pref_opportunities).toBe(1)
    expect(metrics.satisfied_count).toBe(0)
    expect(metrics.satisfaction_rate).toBe(0)
  })

  it('handles unsatisfiable preferences gracefully', () => {
    const state = createState({
      players: [
        createPlayer('p1', { gender: 'F', partner_gender_pref: 'F' }),
        createPlayer('p2', { gender: 'F', partner_gender_pref: 'F' }),
        createPlayer('p3', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p4', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p5', { gender: 'M', partner_gender_pref: 'F' }),
      ],
    })

    expect(computeGenderPrefSatisfaction(state).unsatisfiable).toHaveLength(5)
  })

  it('tracks an impossible round opportunity outside the satisfaction denominator', () => {
    const state = createState({
      players: [
        createPlayer('p1', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { gender: 'M' }),
        createPlayer('p3', { gender: 'M' }),
        createPlayer('p4', { gender: 'M' }),
      ],
    })
    state.rounds = [round()]

    const metrics = computeGenderPrefSatisfaction(state)

    expect(metrics.total_pref_opportunities).toBe(0)
    expect(metrics.satisfied_count).toBe(0)
    expect(metrics.unsatisfiable_opportunity_count).toBe(1)
    expect(metrics.satisfaction_rate).toBe(1)
  })

  it('scores only opportunities that were satisfiable in that round roster', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { gender: 'F', checked_out_at: new Date('2026-05-14T12:30:00.000Z') }),
        createPlayer('p3', { gender: 'M', partner_gender_pref: 'M' }),
        createPlayer('p4', { gender: 'M' }),
        createPlayer('p5', { gender: 'F', checked_out_at: new Date('2026-05-14T12:30:00.000Z') }),
        createPlayer('p6', { gender: 'M' }),
      ],
    })
    state.rounds = [0, 1, 2].map(roundNo => ({
      ...round(),
      round_no: roundNo,
      matches: [createMatch(['p1', 'p2'], ['p3', 'p5'])],
      resting: ['p4', 'p6'],
    }))

    const metrics = computeGenderPrefSatisfaction(state)

    expect(metrics.total_pref_opportunities).toBe(6)
    expect(metrics.satisfied_count).toBe(3)
    expect(metrics.satisfaction_rate).toBe(0.5)
    expect(metrics.unsatisfiable_opportunity_count).toBe(0)
    expect(metrics.unsatisfiable.map(item => item.player_id)).toContain('p1')
    expect(computeSessionFairness(state).breakdown.gender_prefs).toBe(10)
  })

  it('keeps per-player preference details out of host aggregate metrics', () => {
    const gender = computeGenderPrefSatisfaction(
      createState({
        players: [createPlayer('p1', { partner_gender_pref: 'F' }), createPlayer('p2')],
      }),
    )
    const metrics = sanitizeMetricsForHost({
      match_count: { min: 0, max: 0, avg: 0, std: 0, range: 0, per_player: [] },
      partner_diversity: {
        avg_unique_partners: 0,
        avg_diversity_ratio: 0,
        per_player: [],
        repeat_pairs: [],
      },
      opponent_diversity: {
        avg_unique_partners: 0,
        avg_unique_opponents: 0,
        avg_diversity_ratio: 0,
        per_player: [],
        repeat_pairs: [],
      },
      rest: { per_player: [], violations: [] },
      gender_prefs: gender,
    })

    expect(Object.keys(metrics.gender_prefs)).not.toContain('per_player')
  })
})

function round() {
  return {
    session_id: 'session-test',
    round_no: 0,
    status: 'completed' as const,
    matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    resting: [],
    started_at: new Date('2026-05-14T12:00:00.000Z'),
    ended_at: new Date('2026-05-14T12:10:00.000Z'),
  }
}
