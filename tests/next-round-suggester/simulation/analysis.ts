import type { WarningType } from '../../../lib/next-round-suggester/fairness/detector'
import type { SessionFairnessScore } from '../../../lib/next-round-suggester/fairness/metrics'
import { runSimulation, type SimulationConfig, type SimulationResult } from './runner'

export type AggregatedResult = {
  scenario_name: string
  n_seeds: number
  fairness_score: {
    median: number
    mean: number
    std: number
    min: number
    max: number
    p25: number
    p75: number
  }
  per_dimension_avg: SessionFairnessScore['breakdown']
  performance: {
    avg_suggest_ms: number
    p95_suggest_ms: number
    max_suggest_ms: number
    avg_post_processing_ms: number
    p95_post_processing_ms: number
    max_post_processing_ms: number
    avg_suggest_units: number
    max_suggest_units: number
    budget_exhausted_rounds: number
  }
  engine_behavior: {
    avg_adjustments_per_session: number
    sessions_with_violations: number
    most_common_warnings: { type: WarningType; count: number }[]
  }
}

export type ComparisonResult = {
  scenario_name: string
  with_corrector: AggregatedResult
  without_corrector: AggregatedResult
  improvement: {
    fairness_delta: number
    rest_violations_delta: number
    range_delta: number
    significant: boolean
  }
}

export async function runMultiSeed(
  config: Omit<SimulationConfig, 'seed'>,
  nSeeds: number,
): Promise<AggregatedResult> {
  const results: SimulationResult[] = []

  for (let seed = 0; seed < nSeeds; seed += 1) {
    results.push(await runSimulation({ ...config, seed }))
  }

  return aggregate(results, config.scenario_name ?? '')
}

export async function compareCorrector(
  scenario: Omit<SimulationConfig, 'seed' | 'use_corrector'>,
  nSeeds: number,
): Promise<ComparisonResult> {
  const without = await runMultiSeed({ ...scenario, use_corrector: false }, nSeeds)
  const withCorrector = await runMultiSeed({ ...scenario, use_corrector: true }, nSeeds)
  const fairnessDelta = withCorrector.fairness_score.median - without.fairness_score.median

  return {
    scenario_name: scenario.scenario_name ?? '',
    with_corrector: withCorrector,
    without_corrector: without,
    improvement: {
      fairness_delta: fairnessDelta,
      rest_violations_delta:
        without.engine_behavior.sessions_with_violations -
        withCorrector.engine_behavior.sessions_with_violations,
      range_delta:
        withCorrector.per_dimension_avg.match_count - without.per_dimension_avg.match_count,
      significant: Math.abs(fairnessDelta) > 2,
    },
  }
}

export function aggregate(results: SimulationResult[], scenarioName: string): AggregatedResult {
  const scores = results.map((result) => result.fairness_score.total).sort((a, b) => a - b)

  return {
    scenario_name: scenarioName,
    n_seeds: results.length,
    fairness_score: {
      median: percentile(scores, 0.5),
      mean: average(scores),
      std: standardDeviation(scores),
      min: scores[0] ?? 0,
      max: scores[scores.length - 1] ?? 0,
      p25: percentile(scores, 0.25),
      p75: percentile(scores, 0.75),
    },
    per_dimension_avg: averageBreakdowns(results),
    performance: aggregatePerformance(results),
    engine_behavior: aggregateEngineBehavior(results),
  }
}

function averageBreakdowns(results: SimulationResult[]): SessionFairnessScore['breakdown'] {
  return {
    match_count: average(results.map((result) => result.fairness_score.breakdown.match_count)),
    partner_diversity: average(results.map((result) => result.fairness_score.breakdown.partner_diversity)),
    opponent_diversity: average(results.map((result) => result.fairness_score.breakdown.opponent_diversity)),
    rest: average(results.map((result) => result.fairness_score.breakdown.rest)),
    gender_prefs: average(results.map((result) => result.fairness_score.breakdown.gender_prefs)),
  }
}

function aggregatePerformance(results: SimulationResult[]): AggregatedResult['performance'] {
  const avgTimes = results.map((result) => result.avg_suggest_time_ms).sort((a, b) => a - b)
  const avgPostTimes = results.map((result) => result.avg_post_processing_ms).sort((a, b) => a - b)

  return {
    avg_suggest_ms: average(avgTimes),
    p95_suggest_ms: percentile(avgTimes, 0.95),
    max_suggest_ms: Math.max(0, ...results.map((result) => result.max_suggest_time_ms)),
    avg_post_processing_ms: average(avgPostTimes),
    p95_post_processing_ms: percentile(avgPostTimes, 0.95),
    max_post_processing_ms: Math.max(0, ...results.map((result) => result.max_post_processing_ms)),
    avg_suggest_units: average(results.map((result) => result.avg_suggest_units)),
    max_suggest_units: Math.max(0, ...results.map((result) => result.max_suggest_units)),
    budget_exhausted_rounds: results.reduce((sum, result) => sum + result.budget_exhausted_rounds, 0),
  }
}

function aggregateEngineBehavior(results: SimulationResult[]): AggregatedResult['engine_behavior'] {
  const warningCounts = new Map<WarningType, number>()

  for (const result of results) {
    for (const warning of result.warnings_raised) {
      warningCounts.set(warning.type, (warningCounts.get(warning.type) ?? 0) + warning.count)
    }
  }

  return {
    avg_adjustments_per_session: average(results.map((result) => result.adjustments_applied.length)),
    sessions_with_violations: results.filter((result) => result.invariant_violations.length > 0).length,
    most_common_warnings: [...warningCounts]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return a.type.localeCompare(b.type)
      })
      .slice(0, 5),
  }
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * p))
  return sortedValues[index]
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}
