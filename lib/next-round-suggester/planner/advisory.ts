import type { SessionPlanMatch } from './session-plan'
import { validatePlannedBoard, type PlannedMatchViolation } from './validation'
import type { SessionState } from '../types'

export type PlanAdvisoryStatus = 'usable' | 'repair_required' | 'fallback'

export type PlanAdvisoryReason =
  | 'plan_missing'
  | 'roster_changed'
  | 'config_changed'
  | PlannedMatchViolation['reason']

export type PlannedMatchAdvisory = {
  status: PlanAdvisoryStatus
  reasons: PlanAdvisoryReason[]
  violations: PlannedMatchViolation[]
}

const STRUCTURAL_REASONS = new Set<PlannedMatchViolation['reason']>([
  'invalid_team_size',
  'duplicate_player',
  'missing_player',
])

function uniqueReasons(reasons: PlanAdvisoryReason[]) {
  return [...new Set(reasons)]
}

export function resolvePlannedMatchAdvisory(options: {
  plannedMatch?: SessionPlanMatch | null
  state: SessionState
  busyIds?: ReadonlySet<string>
  reservedIds?: ReadonlySet<string>
  rosterIdentityMatches?: boolean
  configIdentityMatches?: boolean
}): PlannedMatchAdvisory {
  const identityReasons: PlanAdvisoryReason[] = []
  if (options.rosterIdentityMatches === false) identityReasons.push('roster_changed')
  if (options.configIdentityMatches === false) identityReasons.push('config_changed')
  if (identityReasons.length > 0) {
    return { status: 'fallback', reasons: identityReasons, violations: [] }
  }
  if (!options.plannedMatch) {
    return { status: 'fallback', reasons: ['plan_missing'], violations: [] }
  }

  const validation = validatePlannedBoard({
    matches: [options.plannedMatch],
    players: options.state.players,
    busyIds: options.busyIds,
    reservedIds: options.reservedIds,
  })
  if (validation.valid) return { status: 'usable', reasons: [], violations: [] }

  const reasons = uniqueReasons(validation.violations.map(violation => violation.reason))
  const structural = validation.violations.some(violation => STRUCTURAL_REASONS.has(violation.reason))
  return {
    status: structural ? 'fallback' : 'repair_required',
    reasons,
    violations: validation.violations,
  }
}

function canonicalTeam(team: readonly string[]) {
  return [...team].sort().join('|')
}

export function plannedMatchEqualsLiveMatch(
  planned: SessionPlanMatch | null | undefined,
  live: Pick<SessionPlanMatch, 'team_a' | 'team_b'> | null | undefined,
) {
  if (!planned || !live) return false
  const plannedTeams = [canonicalTeam(planned.team_a), canonicalTeam(planned.team_b)].sort()
  const liveTeams = [canonicalTeam(live.team_a), canonicalTeam(live.team_b)].sort()
  return plannedTeams[0] === liveTeams[0] && plannedTeams[1] === liveTeams[1]
}
