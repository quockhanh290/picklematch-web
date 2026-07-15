export type SessionQualityReport = {
  hard_violations: number
  operation_errors: number
  avoidable_incomplete_boards: number
  avoidable_rest_violations: number
  match_count_spread: number
  feasible_match_count_spread: number
  max_consecutive_rest: number
  mathematical_rest_bound: number
  team_gap_over_1: number
  intra_gap_over_2: number
  partner_repeats: number
  player_quality_debt_max: number
  player_quality_debt_p95: number
  team_gap_over_0_5: number
  intra_gap_over_1: number
  opponent_repeat_overflow: number
  opponent_repeats: number
  avg_team_gap: number
  max_team_gap: number
  avg_intra_gap: number
  max_intra_gap: number
}

export type SessionQualityMetric = keyof SessionQualityReport

export type SessionQualityDelta = {
  metric: SessionQualityMetric
  live_only: number
  hybrid: number
  delta: number
}

export type SessionQualityGateResult = {
  passed: boolean
  decisive_metric: SessionQualityMetric | null
  regressions: SessionQualityDelta[]
  improvements: SessionQualityDelta[]
  deltas: SessionQualityDelta[]
}

const HARD_METRICS: SessionQualityMetric[] = [
  'hard_violations',
  'operation_errors',
  'avoidable_incomplete_boards',
  'avoidable_rest_violations',
]

const OBJECTIVE_ORDER: SessionQualityMetric[] = [
  'team_gap_over_1',
  'intra_gap_over_2',
  'partner_repeats',
  'player_quality_debt_max',
  'opponent_repeat_overflow',
  'team_gap_over_0_5',
  'intra_gap_over_1',
  'opponent_repeats',
  'player_quality_debt_p95',
  'avg_team_gap',
  'max_team_gap',
  'avg_intra_gap',
  'max_intra_gap',
]

function delta(metric: SessionQualityMetric, liveOnly: SessionQualityReport, hybrid: SessionQualityReport) {
  return {
    metric,
    live_only: liveOnly[metric],
    hybrid: hybrid[metric],
    delta: hybrid[metric] - liveOnly[metric],
  }
}

export function compareSessionQuality(
  liveOnly: SessionQualityReport,
  hybrid: SessionQualityReport,
): SessionQualityGateResult {
  const metrics = [...new Set<SessionQualityMetric>([
    ...HARD_METRICS,
    'match_count_spread',
    'max_consecutive_rest',
    ...OBJECTIVE_ORDER,
  ])]
  const deltas = metrics.map(metric => delta(metric, liveOnly, hybrid))
  const regressions: SessionQualityDelta[] = []

  for (const metric of HARD_METRICS) {
    const item = delta(metric, liveOnly, hybrid)
    if (item.hybrid > 0 || item.delta > 0) regressions.push(item)
  }
  if (hybrid.match_count_spread > hybrid.feasible_match_count_spread) {
    regressions.push(delta('match_count_spread', liveOnly, hybrid))
  }
  if (hybrid.max_consecutive_rest > hybrid.mathematical_rest_bound) {
    regressions.push(delta('max_consecutive_rest', liveOnly, hybrid))
  }
  if (regressions.length > 0) {
    return {
      passed: false,
      decisive_metric: regressions[0].metric,
      regressions,
      improvements: deltas.filter(item => item.delta < 0),
      deltas,
    }
  }

  let decisiveMetric: SessionQualityMetric | null = null
  for (const metric of OBJECTIVE_ORDER) {
    const item = delta(metric, liveOnly, hybrid)
    if (item.delta === 0) continue
    decisiveMetric = metric
    if (item.delta > 0) regressions.push(item)
    break
  }

  return {
    passed: regressions.length === 0,
    decisive_metric: decisiveMetric,
    regressions,
    improvements: deltas.filter(item => item.delta < 0),
    deltas,
  }
}
