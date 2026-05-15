// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { FairnessWarning } from './detector.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { DiversityMetrics, GenderPrefMetrics, MatchCountMetrics, RestFairnessMetrics, SessionFairnessScore } from './metrics.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionSummary } from './summary.ts'

export type FullFairnessMetrics = {
  match_count: MatchCountMetrics
  partner_diversity: DiversityMetrics
  opponent_diversity: DiversityMetrics
  rest: RestFairnessMetrics
  gender_prefs: GenderPrefMetrics
}

export type HostGenderPrefMetrics = Pick<
  GenderPrefMetrics,
  'total_pref_opportunities' | 'satisfied_count' | 'satisfaction_rate'
>

export type HostFairnessMetrics = Omit<FullFairnessMetrics, 'gender_prefs'> & {
  gender_prefs: HostGenderPrefMetrics
}

export type HostSessionSummary = SessionSummary

export function sanitizeMetricsForHost(metrics: FullFairnessMetrics): HostFairnessMetrics {
  return {
    match_count: metrics.match_count,
    partner_diversity: metrics.partner_diversity,
    opponent_diversity: metrics.opponent_diversity,
    rest: metrics.rest,
    gender_prefs: {
      total_pref_opportunities: metrics.gender_prefs.total_pref_opportunities,
      satisfied_count: metrics.gender_prefs.satisfied_count,
      satisfaction_rate: metrics.gender_prefs.satisfaction_rate,
    },
  }
}

export function sanitizeWarningsForHost(warnings: FairnessWarning[]): FairnessWarning[] {
  return warnings.map((warning) => {
    if (
      warning.type !== 'gender_pref_unsatisfied' &&
      warning.type !== 'gender_pref_impossible'
    ) {
      return warning
    }

    const count = warning.affected_players.length
    return {
      ...warning,
      affected_players: [],
      message:
        warning.type === 'gender_pref_impossible'
          ? `${count} preference khong the dap ung hoan toan.`
          : `${count} preference chua duoc dap ung tot.`,
    }
  })
}

export function sanitizeSummaryForHost(summary: SessionSummary): HostSessionSummary {
  return {
    ...summary,
    highlights: {
      ...summary.highlights,
      flagged_issues: sanitizeWarningsForHost(summary.highlights.flagged_issues),
    },
  }
}

export type HostFairnessResponse = {
  fairness_score: SessionFairnessScore
  warnings: FairnessWarning[]
  metrics: HostFairnessMetrics
}
