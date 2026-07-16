// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { buildProjectedStateAfterLiveMatch } from '../live-preview.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { Match, SessionLiveMatchRow, SessionState } from '../types.ts'

export type PlanningCommitment = SessionLiveMatchRow

function canonicalTeam(team: readonly string[]) {
  return [...team].sort().join('|')
}

function canonicalLineup(match: Pick<Match, 'team_a' | 'team_b'>) {
  return [canonicalTeam(match.team_a), canonicalTeam(match.team_b)].sort().join('::')
}

function commitmentRound(match: Pick<SessionLiveMatchRow, 'round_no' | 'sequence_no'>) {
  return Number.isFinite(Number(match.round_no)) ? Number(match.round_no) : Number(match.sequence_no)
}

function planningCurrentRound(state: SessionState, rows: readonly SessionLiveMatchRow[]) {
  return rows.reduce((currentRound, row) => (
    Math.max(currentRound, commitmentRound(row) + 1)
  ), state.current_round)
}

function historyKeys(state: SessionState) {
  return new Set(state.rounds.flatMap(round => round.matches.map(match => (
    `${round.round_no}|${canonicalLineup(match)}`
  ))))
}

export function getPlanningCommitments(rows: readonly SessionLiveMatchRow[]) {
  return rows
    .filter(row => row.status === 'live' || (
      row.status === 'suggested' && row.suggestion_metadata?.manual_override === true
    ))
    .slice()
    .sort((left, right) => (
      commitmentRound(left) - commitmentRound(right)
      || Number(left.court_idx ?? -1) - Number(right.court_idx ?? -1)
      || left.id.localeCompare(right.id)
    ))
}

export function buildPlanningFrontierIdentity(
  state: SessionState,
  commitments: readonly PlanningCommitment[],
) {
  const matches = new Map<string, {
    round_no: number
    lineup: string
  }>()
  state.rounds.forEach(round => round.matches.forEach(match => {
      const key = `${round.round_no}|${canonicalLineup(match)}`
      matches.set(key, { round_no: round.round_no, lineup: canonicalLineup(match) })
    }))
  commitments.forEach(match => {
    const roundNo = commitmentRound(match)
    const key = `${roundNo}|${canonicalLineup(match)}`
    matches.set(key, { round_no: roundNo, lineup: canonicalLineup(match) })
  })
  return {
    current_round: planningCurrentRound(state, commitments),
    matches: [...matches.values()].sort((left, right) => (
      left.round_no - right.round_no || left.lineup.localeCompare(right.lineup)
    )),
  }
}

export function buildPlanningFrontier(
  state: SessionState,
  rows: readonly SessionLiveMatchRow[],
) {
  const commitments = getPlanningCommitments(rows)
  const liveCommitments = commitments.filter(commitment => commitment.status === 'live')
  const pendingManualSuggestions = commitments.filter(commitment => commitment.status === 'suggested')
  const existing = historyKeys(state)
  const completedProgress = rows.filter(row => {
    if (row.status !== 'completed') return false
    const key = `${commitmentRound(row)}|${canonicalLineup(row)}`
    return !existing.has(key)
  })
  let projectedState = state
  for (const commitment of liveCommitments) {
    const roundNo = commitmentRound(commitment)
    const key = `${roundNo}|${canonicalLineup(commitment)}`
    if (existing.has(key)) continue
    projectedState = buildProjectedStateAfterLiveMatch(projectedState, commitment, roundNo)
    existing.add(key)
  }
  projectedState = {
    ...projectedState,
    current_round: planningCurrentRound(projectedState, [
      ...completedProgress,
      ...commitments,
    ]),
  }
  return {
    state: projectedState,
    commitments,
    pending_manual_suggestions: pendingManualSuggestions,
    busy_ids: [...new Set(commitments
      .filter(match => match.status === 'live')
      .flatMap(match => [...match.team_a, ...match.team_b]))].sort(),
    identity: buildPlanningFrontierIdentity(state, [
      ...completedProgress,
      ...commitments,
    ]),
  }
}
