// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionPlanMatch } from './session-plan.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { validatePlannedBoard, type PlannedMatchViolation } from './validation.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionLiveMatchRow, SessionState } from '../types.ts'

export type PlanAdvisoryStatus = 'usable' | 'repair_required' | 'fallback'

export type PlanAdvisoryReason =
  | 'plan_missing'
  | 'roster_changed'
  | 'config_changed'
  | 'history_diverged'
  | 'planning_version_changed'
  | 'frontier_changed'
  | 'manual_lineup_changed'
  | 'manual_team_repartition'
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
  historyMatches?: boolean
  planningVersionMatches?: boolean
  frontierMatches?: boolean
  activeManualMutationKind?: string | null
}): PlannedMatchAdvisory {
  const identityReasons: PlanAdvisoryReason[] = []
  if (options.rosterIdentityMatches === false) identityReasons.push('roster_changed')
  if (options.configIdentityMatches === false) identityReasons.push('config_changed')
  if (options.historyMatches === false) identityReasons.push('history_diverged')
  if (options.frontierMatches === false) identityReasons.push('frontier_changed')
  if (options.activeManualMutationKind === 'manual_team_repartition') {
    identityReasons.push('manual_team_repartition')
  } else if (options.activeManualMutationKind) {
    identityReasons.push('manual_lineup_changed')
  } else if (options.planningVersionMatches === false) {
    identityReasons.push('planning_version_changed')
  }
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

export function plannedBoardEqualsLiveBoard(
  planned: ReadonlyArray<Pick<SessionPlanMatch, 'team_a' | 'team_b'>>,
  live: ReadonlyArray<Pick<SessionPlanMatch, 'team_a' | 'team_b'>>,
) {
  if (planned.length !== live.length) return false
  const boardKey = (matches: ReadonlyArray<Pick<SessionPlanMatch, 'team_a' | 'team_b'>>) => matches
    .map(match => [canonicalTeam(match.team_a), canonicalTeam(match.team_b)].sort().join('::'))
    .sort()
  const plannedKeys = boardKey(planned)
  const liveKeys = boardKey(live)
  return plannedKeys.every((key, index) => key === liveKeys[index])
}

export function plannedProgressMatches(options: {
  rows: readonly SessionLiveMatchRow[]
  baselineCommitments?: ReadonlyArray<{
    id?: unknown
    team_a?: unknown
    team_b?: unknown
  }>
  startingRound: number
  planVersionId: string
  plannedByRound: ReadonlyMap<number, ReadonlyArray<SessionPlanMatch>>
  allowRollingPlanRounds?: boolean
}) {
  const rowsById = new Map(options.rows.map(row => [row.id, row]))
  for (const baseline of options.baselineCommitments ?? []) {
    const id = typeof baseline.id === 'string' ? baseline.id : null
    const row = id ? rowsById.get(id) : null
    if (!row || row.status === 'cancelled') return false
    if (!Array.isArray(baseline.team_a) || !Array.isArray(baseline.team_b)) return false
    if (!plannedMatchEqualsLiveMatch({
      team_a: baseline.team_a as [string, string],
      team_b: baseline.team_b as [string, string],
    }, row)) return false
  }

  const baselineIds = new Set((options.baselineCommitments ?? [])
    .map(commitment => commitment.id)
    .filter((id): id is string => typeof id === 'string'))
  const usedByRound = new Map<number, Set<number>>()
  const progressRows = options.rows.filter(row => (
    (row.status === 'live' || row.status === 'completed')
    && !baselineIds.has(row.id)
    && Number(row.round_no) + 1 > options.startingRound
  ))

  for (const row of progressRows) {
    const liveRoundNo = Number(row.round_no) + 1
    const metadataPlanRoundNo = Number(row.suggestion_metadata?.planned_round_no)
    const plannedRoundNo = options.allowRollingPlanRounds
      ? metadataPlanRoundNo
      : liveRoundNo
    if (row.suggestion_metadata?.plan_version_id !== options.planVersionId) return false
    if (!Number.isFinite(plannedRoundNo)) return false
    if (!options.allowRollingPlanRounds && metadataPlanRoundNo !== liveRoundNo) return false
    const planned = options.plannedByRound.get(plannedRoundNo) ?? []
    const used = usedByRound.get(plannedRoundNo) ?? new Set<number>()
    const matchIndex = planned.findIndex((match, index) => (
      !used.has(index) && plannedMatchEqualsLiveMatch(match, row)
    ))
    if (matchIndex < 0) return false
    used.add(matchIndex)
    usedByRound.set(plannedRoundNo, used)
  }
  return true
}
