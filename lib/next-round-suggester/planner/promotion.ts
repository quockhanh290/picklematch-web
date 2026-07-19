// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna } from '../state.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { SessionState, Team } from '../types.ts'

export type PlanPromotionRound = {
  round_no: number
  resting_ids: string[]
  matches: Array<{ team_a: Team; team_b: Team }>
}

export function buildPlanPromotionPayloads(options: {
  round: PlanPromotionRound
  state: SessionState
  courtCount: number
  pvnaTolerance: number
  planJobId: string
  planVersionId: string
}) {
  if (options.round.matches.length !== options.courtCount) return []
  const selectedIds = options.round.matches.flatMap(match => [...match.team_a, ...match.team_b])
  if (new Set(selectedIds).size !== selectedIds.length) return []

  const pvna = (playerId: string) => {
    const player = options.state.players.get(playerId)
    return player ? getEffectivePvna(player) : 0
  }
  return options.round.matches.map((match, matchIndex) => {
    const teamGap = Math.abs(
      pvna(match.team_a[0]) + pvna(match.team_a[1])
      - pvna(match.team_b[0]) - pvna(match.team_b[1]),
    )
    const overBy = Math.max(0, teamGap - options.pvnaTolerance)
    return {
      court_idx: matchIndex,
      team_a: match.team_a,
      team_b: match.team_b,
      resting: options.round.resting_ids,
      round_no: Math.max(0, options.round.round_no - 1),
      warnings: overBy > 0 ? ['PVNA_TOLERANCE_RELAXED'] : [],
      tradeoffs: overBy > 0
        ? [{ type: 'pvna_tolerance_relaxed', severity: overBy, over_by: overBy }]
        : [],
      approval_required: overBy > 0,
      configured_pvna_tolerance: options.pvnaTolerance,
      effective_pvna_tolerance: Math.max(options.pvnaTolerance, teamGap),
      fairness_reasons: [],
      fairness_reason_details: [],
      preview_source: 'session_plan',
      plan_job_id: options.planJobId,
      plan_version_id: options.planVersionId,
      planned_round_no: options.round.round_no,
      planned_match_idx: matchIndex,
    }
  })
}
