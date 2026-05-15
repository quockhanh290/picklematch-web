import { createMatch, createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'
import {
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
} from '../../../lib/next-round-suggester/fairness/metrics'

describe('Match Count Metrics', () => {
  it('returns range 0 when all players have equal matches', () => {
    const state = createState({
      players: [
        createPlayer('p1', { matches_played: 2 }),
        createPlayer('p2', { matches_played: 2 }),
      ],
    })

    expect(computeMatchCountMetrics(state).range).toBe(0)
  })

  it('returns range > 0 when imbalanced', () => {
    const state = createState({
      players: [
        createPlayer('p1', { matches_played: 4 }),
        createPlayer('p2', { matches_played: 1 }),
      ],
    })

    expect(computeMatchCountMetrics(state).range).toBe(3)
  })

  it('handles empty session', () => {
    const metrics = computeMatchCountMetrics(createState({ players: [] }))

    expect(metrics.min).toBe(0)
    expect(metrics.max).toBe(0)
    expect(metrics.avg).toBe(0)
  })

  it('handles players with 0 matches', () => {
    const metrics = computeMatchCountMetrics(createState({ players: [createPlayer('p1')] }))

    expect(metrics.per_player[0].matches_played).toBe(0)
  })
})

describe('Partner Diversity', () => {
  it('returns ratio 1.0 when all partners are unique', () => {
    const p1 = createPlayer('p1', { matches_played: 2 })
    p1.partner_counts.set('p2', 1)
    p1.partner_counts.set('p3', 1)

    const metrics = computePartnerDiversity(
      createState({ players: [p1, createPlayer('p2'), createPlayer('p3')] }),
    )

    expect(metrics.per_player.find((player) => player.player_id === 'p1')?.diversity_ratio).toBe(1)
  })

  it('returns lower ratio with repeats', () => {
    const p1 = createPlayer('p1', { matches_played: 3 })
    p1.partner_counts.set('p2', 3)

    const metrics = computePartnerDiversity(createState({ players: [p1, createPlayer('p2')] }))

    expect(metrics.per_player.find((player) => player.player_id === 'p1')?.diversity_ratio).toBeLessThan(1)
    expect(metrics.repeat_pairs).toEqual([{ player_a: 'p1', player_b: 'p2', count: 3 }])
  })

  it('handles single-match players', () => {
    const p1 = createPlayer('p1', { matches_played: 1 })
    p1.partner_counts.set('p2', 1)

    expect(
      computePartnerDiversity(createState({ players: [p1, createPlayer('p2')] })).per_player[0]
        .diversity_ratio,
    ).toBe(1)
  })
})

describe('Opponent Diversity', () => {
  it('tracks unique opponents and repeat opponent pairs', () => {
    const p1 = createPlayer('p1', { matches_played: 2 })
    p1.opponent_counts.set('p2', 2)
    p1.opponent_counts.set('p3', 1)

    const metrics = computeOpponentDiversity(
      createState({ players: [p1, createPlayer('p2'), createPlayer('p3')] }),
    )

    expect(metrics.per_player.find((player) => player.player_id === 'p1')?.unique_opponents).toBe(2)
    expect(metrics.repeat_pairs).toEqual([{ player_a: 'p1', player_b: 'p2', count: 2 }])
  })
})

describe('Rest Fairness', () => {
  it('counts rest segments and max consecutive rest from rounds', () => {
    const state = createState({
      players: [createPlayer('p1'), createPlayer('p2'), createPlayer('p3'), createPlayer('p4')],
    })
    state.rounds = [
      makeRound(0, ['p1']),
      makeRound(1, ['p1']),
      makeRound(2, []),
      makeRound(3, ['p1']),
    ]

    const p1 = computeRestFairness(state).per_player.find((player) => player.player_id === 'p1')

    expect(p1?.total_rests).toBe(3)
    expect(p1?.max_consecutive_rest).toBe(2)
    expect(p1?.rest_segments).toBe(2)
  })
})

describe('Session Fairness Score', () => {
  it('returns 100 for a perfectly fair session', () => {
    const p1 = createPlayer('p1', { matches_played: 1 })
    const p2 = createPlayer('p2', { matches_played: 1 })
    const p3 = createPlayer('p3', { matches_played: 1 })
    const p4 = createPlayer('p4', { matches_played: 1 })
    setPartnerRepeats(p1, p2, 1)
    setPartnerRepeats(p3, p4, 1)
    setOpponentRepeats(p1, p3, 1)
    setOpponentRepeats(p1, p4, 1)
    setOpponentRepeats(p2, p3, 1)
    setOpponentRepeats(p2, p4, 1)

    expect(computeSessionFairness(createState({ players: [p1, p2, p3, p4] })).total).toBe(100)
  })

  it('penalizes match count imbalance', () => {
    const fair = computeSessionFairness(
      withCompletedRounds(createState({ players: [createPlayer('p1', { matches_played: 2 }), createPlayer('p2', { matches_played: 2 })] }), 3),
    ).breakdown.match_count
    const unfair = computeSessionFairness(
      withCompletedRounds(createState({ players: [createPlayer('p1', { matches_played: 5 }), createPlayer('p2', { matches_played: 1 })] }), 3),
    ).breakdown.match_count

    expect(unfair).toBeLessThan(fair)
  })

  it('does not penalize range 1 when match slots cannot be evenly distributed yet', () => {
    const players = Array.from({ length: 9 }, (_, index) =>
      createPlayer(`p${index + 1}`, { matches_played: index < 6 ? 3 : 2 }),
    )
    const state = withCompletedRounds(createState({ players, courts: 2 }), 3)

    expect(computeMatchCountMetrics(state).range).toBe(1)
    expect(computeSessionFairness(state).breakdown.match_count).toBe(25)
  })

  it('penalizes match count range beyond normal one-match spread', () => {
    const players = [
      createPlayer('p1', { matches_played: 4 }),
      createPlayer('p2', { matches_played: 4 }),
      createPlayer('p3', { matches_played: 2 }),
      createPlayer('p4', { matches_played: 2 }),
    ]
    const state = withCompletedRounds(createState({ players, courts: 1 }), 3)

    expect(computeMatchCountMetrics(state).range).toBe(2)
    expect(computeSessionFairness(state).breakdown.match_count).toBe(5)
  })

  it('penalizes partner repeats', () => {
    const p1 = createPlayer('p1', { matches_played: 3 })
    const p2 = createPlayer('p2', { matches_played: 3 })
    setPartnerRepeats(p1, p2, 3)

    expect(computeSessionFairness(withCompletedRounds(createState({ players: [p1, p2] }), 3)).breakdown.partner_diversity).toBeLessThan(20)
  })

  it('penalizes rest violations heavily', () => {
    const state = createState({ players: [createPlayer('p1'), createPlayer('p2')] })
    state.rounds = [makeRound(0, ['p1']), makeRound(1, ['p1'])]

    expect(computeSessionFairness(state).breakdown.rest).toBe(10)
  })

  it('does not over-penalize warm-up rounds', () => {
    const state = createState({
      players: [
        createPlayer('p1', { matches_played: 1, gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { matches_played: 1, gender: 'M' }),
        createPlayer('p3', { matches_played: 1, gender: 'F' }),
        createPlayer('p4', { matches_played: 1, gender: 'F' }),
        createPlayer('p5', { matches_played: 0, gender: 'F' }),
      ],
    })
    state.rounds = [makeRound(0, ['p5'])]

    expect(computeSessionFairness(state).total).toBe(100)
  })
})

function makeRound(roundNo: number, resting: string[]) {
  return {
    session_id: 'session-test',
    round_no: roundNo,
    status: 'completed' as const,
    matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    resting,
    started_at: new Date(`2026-05-14T12:${String(roundNo).padStart(2, '0')}:00.000Z`),
    ended_at: new Date(`2026-05-14T12:${String(roundNo + 1).padStart(2, '0')}:00.000Z`),
  }
}

function withCompletedRounds<T extends ReturnType<typeof createState>>(state: T, count: number): T {
  state.rounds = Array.from({ length: count }, (_, index) => makeRound(index, []))
  return state
}
