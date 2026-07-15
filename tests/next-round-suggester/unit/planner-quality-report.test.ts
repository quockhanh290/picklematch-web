import { buildSessionQualityReport } from '@/lib/next-round-suggester/planner/quality-report'

describe('Phase 5B session quality report', () => {
  const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5']
  const pvna = new Map([
    ['p1', 3],
    ['p2', 3.2],
    ['p3', 3.1],
    ['p4', 3.3],
    ['p5', 4.8],
  ])

  it('measures board, rest, repeat, warning, and per-player quality', () => {
    const first = { team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] } as const
    const report = buildSessionQualityReport({
      player_ids: playerIds,
      pvna_by_player: pvna,
      pvna_tolerance: 0.5,
      rounds: [
        { eligible_player_ids: playerIds, matches: [first] },
        {
          eligible_player_ids: playerIds,
          matches: [{
            ...first,
            warnings: ['REPEAT_CAP_RELAXED'],
            tradeoffs: [{ over_by: 1 }],
          }],
        },
      ],
    })
    expect(report.summary).toMatchObject({
      rounds: 2,
      matches: 2,
      hard_violations: 0,
      match_count_spread: 2,
      max_consecutive_rest: 2,
      avoidable_rest_violations: 1,
      partner_repeats: 2,
      opponent_repeats: 4,
      relaxation_warning_count: 1,
      max_relaxation_severity: 1,
    })
    expect(report.players.find(player => player.player_id === 'p5')).toMatchObject({
      matches: 0,
      rests: 2,
      max_rest_streak: 2,
    })
    expect(report.players.find(player => player.player_id === 'p1')).toMatchObject({
      partner_diversity: 1,
      opponent_diversity: 2,
      partner_repeat_exposure: 1,
      opponent_repeat_exposure: 2,
      warning_match_exposure: 1,
    })
  })

  it('does not count an unavailable round as rest', () => {
    const report = buildSessionQualityReport({
      player_ids: playerIds,
      pvna_by_player: pvna,
      pvna_tolerance: 0.5,
      rounds: [{
        eligible_player_ids: ['p1', 'p2', 'p3', 'p4'],
        matches: [{ team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] }],
      }],
    })
    expect(report.players.find(player => player.player_id === 'p5')?.rests).toBe(0)
  })

  it('surfaces duplicate and ineligible selections as hard violations', () => {
    const report = buildSessionQualityReport({
      player_ids: playerIds,
      pvna_by_player: pvna,
      pvna_tolerance: 0.5,
      rounds: [{
        eligible_player_ids: ['p1', 'p2', 'p3', 'p4'],
        matches: [{ team_a: ['p1', 'p1'], team_b: ['p3', 'p5'] }],
      }],
    })
    expect(report.summary.hard_violations).toBeGreaterThan(0)
  })
})
