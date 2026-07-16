// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { resolvePlannedMatchAdvisory, type PlanAdvisoryReason, type PlanAdvisoryStatus } from './advisory.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { validatePlannedBoard } from './validation.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionPlanMatch } from './session-plan.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionLiveMatchRow, SessionState } from '../types.ts'

export type PlannedCourtCandidate = {
  court_idx: number
  live_round_no: number
  planned_round_no: number
  match: SessionPlanMatch | null
}

export type PlannedCourtConsumptionDecision = PlannedCourtCandidate & {
  planned_match_idx?: number | null
  status: PlanAdvisoryStatus
  reasons: PlanAdvisoryReason[]
}

export type PlannedRoundPoolCandidate = Omit<PlannedCourtCandidate, 'match'> & {
  matches: SessionPlanMatch[]
}

export type AssignedPlannedCourt = PlannedCourtCandidate & {
  match: SessionPlanMatch
  planned_match_idx: number
}

export function shouldExpandPlanAdoption(options: {
  planVersionId: string | null
  targetCourtIdxs: readonly number[]
  openCourtIdxs: readonly number[]
  rows: readonly Pick<SessionLiveMatchRow, 'status' | 'court_idx' | 'suggestion_metadata'>[]
}) {
  if (!options.planVersionId || options.targetCourtIdxs.length >= options.openCourtIdxs.length) return false
  const openCourts = new Set(options.openCourtIdxs)
  return options.rows.some(row => (
    row.status === 'suggested'
    && openCourts.has(Number(row.court_idx))
    && row.suggestion_metadata?.plan_version_id !== options.planVersionId
  ))
}

export function selectConsumablePlannedRoundPool(options: {
  candidates: PlannedRoundPoolCandidate[]
  consumedMatchIndexesByRound?: ReadonlyMap<number, ReadonlySet<number>>
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
  const accepted: AssignedPlannedCourt[] = []
  const decisions: PlannedCourtConsumptionDecision[] = []
  const reserved = new Set(options.reservedIds ?? [])
  const usedByRound = new Map<number, Set<number>>()
  options.consumedMatchIndexesByRound?.forEach((indexes, roundNo) => {
    usedByRound.set(roundNo, new Set(indexes))
  })

  for (const candidate of [...options.candidates].sort((left, right) => left.court_idx - right.court_idx)) {
    const used = usedByRound.get(candidate.planned_round_no) ?? new Set<number>()
    const indexes = candidate.matches
      .map((_, index) => index)
      .filter(index => !used.has(index))
      .sort((left, right) => (
        Number(right === candidate.court_idx) - Number(left === candidate.court_idx)
        || left - right
      ))
    const evaluated = indexes.map(index => ({
      index,
      match: candidate.matches[index],
      advisory: resolvePlannedMatchAdvisory({
        plannedMatch: candidate.matches[index],
        state: options.state,
        busyIds: options.busyIds,
        reservedIds: reserved,
        rosterIdentityMatches: options.rosterIdentityMatches ?? options.identityMatches,
        configIdentityMatches: options.configIdentityMatches ?? options.identityMatches,
        historyMatches: options.historyMatches ?? options.identityMatches,
        planningVersionMatches: options.planningVersionMatches ?? options.identityMatches,
        frontierMatches: options.frontierMatches ?? options.identityMatches,
        activeManualMutationKind: options.activeManualMutationKind,
      }),
    }))
    const selected = evaluated.find(item => item.advisory.status === 'usable')
    if (selected) {
      accepted.push({
        court_idx: candidate.court_idx,
        live_round_no: candidate.live_round_no,
        planned_round_no: candidate.planned_round_no,
        match: selected.match,
        planned_match_idx: selected.index,
      })
      used.add(selected.index)
      usedByRound.set(candidate.planned_round_no, used)
      selected.match.team_a.forEach(playerId => reserved.add(playerId))
      selected.match.team_b.forEach(playerId => reserved.add(playerId))
      decisions.push({
        court_idx: candidate.court_idx,
        live_round_no: candidate.live_round_no,
        planned_round_no: candidate.planned_round_no,
        match: selected.match,
        planned_match_idx: selected.index,
        status: 'usable',
        reasons: [],
      })
      continue
    }

    const representative = evaluated.find(item => item.index === candidate.court_idx)
      ?? evaluated.find(item => item.advisory.status === 'repair_required')
      ?? evaluated[0]
    const advisory = representative?.advisory ?? resolvePlannedMatchAdvisory({
      plannedMatch: null,
      state: options.state,
      rosterIdentityMatches: options.rosterIdentityMatches ?? options.identityMatches,
      configIdentityMatches: options.configIdentityMatches ?? options.identityMatches,
      historyMatches: options.historyMatches ?? options.identityMatches,
      planningVersionMatches: options.planningVersionMatches ?? options.identityMatches,
      frontierMatches: options.frontierMatches ?? options.identityMatches,
      activeManualMutationKind: options.activeManualMutationKind,
    })
    decisions.push({
      court_idx: candidate.court_idx,
      live_round_no: candidate.live_round_no,
      planned_round_no: candidate.planned_round_no,
      match: representative?.match ?? null,
      planned_match_idx: representative?.index ?? null,
      status: advisory.status,
      reasons: advisory.reasons,
    })
  }

  const validation = validatePlannedBoard({
    matches: accepted.map(candidate => candidate.match),
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
