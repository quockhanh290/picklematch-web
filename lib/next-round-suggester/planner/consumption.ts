// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { resolvePlannedMatchAdvisory, type PlanAdvisoryReason, type PlanAdvisoryStatus } from './advisory.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { validatePlannedBoard } from './validation.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionPlanMatch } from './session-plan.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState } from '../types.ts'

export type PlannedCourtCandidate = {
  court_idx: number
  live_round_no: number
  planned_round_no: number
  match: SessionPlanMatch | null
}

export type PlannedCourtConsumptionDecision = PlannedCourtCandidate & {
  status: PlanAdvisoryStatus
  reasons: PlanAdvisoryReason[]
}

export function selectConsumablePlannedCourts(options: {
  candidates: PlannedCourtCandidate[]
  state: SessionState
  busyIds?: ReadonlySet<string>
  reservedIds?: ReadonlySet<string>
  identityMatches?: boolean
  rosterIdentityMatches?: boolean
  configIdentityMatches?: boolean
  historyMatches?: boolean
  planningVersionMatches?: boolean
  frontierMatches?: boolean
  activeManualMutationKind?: string | null
}) {
  const accepted: PlannedCourtCandidate[] = []
  const decisions: PlannedCourtConsumptionDecision[] = []
  const reserved = new Set(options.reservedIds ?? [])

  for (const candidate of [...options.candidates].sort((left, right) => left.court_idx - right.court_idx)) {
    const advisory = resolvePlannedMatchAdvisory({
      plannedMatch: candidate.match,
      state: options.state,
      busyIds: options.busyIds,
      reservedIds: reserved,
      rosterIdentityMatches: options.rosterIdentityMatches ?? options.identityMatches,
      configIdentityMatches: options.configIdentityMatches ?? options.identityMatches,
      historyMatches: options.historyMatches ?? options.identityMatches,
      planningVersionMatches: options.planningVersionMatches ?? options.identityMatches,
      frontierMatches: options.frontierMatches ?? options.identityMatches,
      activeManualMutationKind: options.activeManualMutationKind,
    })
    decisions.push({ ...candidate, status: advisory.status, reasons: advisory.reasons })
    if (advisory.status !== 'usable' || !candidate.match) continue
    accepted.push(candidate)
    candidate.match.team_a.forEach(playerId => reserved.add(playerId))
    candidate.match.team_b.forEach(playerId => reserved.add(playerId))
  }

  const validation = validatePlannedBoard({
    matches: accepted.flatMap(candidate => candidate.match ? [candidate.match] : []),
    players: options.state.players,
    busyIds: options.busyIds,
    reservedIds: options.reservedIds,
  })
  return {
    accepted: validation.valid ? accepted : [],
    decisions: validation.valid
      ? decisions
      : decisions.map(decision => ({
          ...decision,
          status: 'fallback' as const,
          reasons: [...new Set<PlanAdvisoryReason>([...decision.reasons, 'duplicate_player'])],
        })),
    reserved_player_ids: validation.valid ? reserved : new Set(options.reservedIds ?? []),
    validation,
  }
}
