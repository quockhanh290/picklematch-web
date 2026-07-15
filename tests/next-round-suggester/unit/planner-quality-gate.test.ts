import {
  compareSessionQuality,
  type SessionQualityReport,
} from '@/lib/next-round-suggester/planner/quality-gate'

function report(overrides: Partial<SessionQualityReport> = {}): SessionQualityReport {
  return {
    hard_violations: 0,
    operation_errors: 0,
    avoidable_incomplete_boards: 0,
    avoidable_rest_violations: 0,
    match_count_spread: 1,
    feasible_match_count_spread: 1,
    max_consecutive_rest: 1,
    mathematical_rest_bound: 1,
    team_gap_over_1: 2,
    intra_gap_over_2: 1,
    partner_repeats: 4,
    player_quality_debt_max: 0.8,
    player_quality_debt_p95: 0.4,
    team_gap_over_0_5: 6,
    intra_gap_over_1: 5,
    opponent_repeat_overflow: 2,
    opponent_repeats: 20,
    avg_team_gap: 0.4,
    max_team_gap: 1.2,
    avg_intra_gap: 0.8,
    max_intra_gap: 2.1,
    ...overrides,
  }
}

describe('Phase 5B session quality gate', () => {
  it('rejects an operation regression even when board quality improves', () => {
    const result = compareSessionQuality(report(), report({
      operation_errors: 1,
      team_gap_over_1: 0,
    }))
    expect(result.passed).toBe(false)
    expect(result.decisive_metric).toBe('operation_errors')
  })

  it('rejects avoidable fairness violations', () => {
    expect(compareSessionQuality(report(), report({ match_count_spread: 2 })).passed).toBe(false)
    expect(compareSessionQuality(report(), report({ max_consecutive_rest: 2 })).passed).toBe(false)
  })

  it('accepts a lower-priority regression when a higher objective improves', () => {
    const result = compareSessionQuality(report(), report({
      team_gap_over_1: 1,
      opponent_repeats: 25,
    }))
    expect(result.passed).toBe(true)
    expect(result.decisive_metric).toBe('team_gap_over_1')
    expect(result.deltas.find(item => item.metric === 'opponent_repeats')?.delta).toBe(5)
  })

  it('rejects the first lexicographic quality regression', () => {
    const result = compareSessionQuality(report(), report({
      team_gap_over_1: 2,
      intra_gap_over_2: 2,
      partner_repeats: 0,
    }))
    expect(result.passed).toBe(false)
    expect(result.decisive_metric).toBe('intra_gap_over_2')
  })

  it('passes identical reports without inventing a decisive metric', () => {
    const result = compareSessionQuality(report(), report())
    expect(result.passed).toBe(true)
    expect(result.decisive_metric).toBeNull()
  })
})
