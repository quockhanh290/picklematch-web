import type { SessionState, Team } from './types'
import { computeQualityCost } from './quality-cost'
import { getEffectivePvna, getMatchPvnaGap } from './state'
import {
  INTRA_TEAM_PVNA_GAP_LIMIT,
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  getProjectedRepeatSummary,
} from './score'

export type MatchPvnaVerdict = 'within_tolerance' | 'over_tolerance'
export type MatchRepeatVerdict = 'within_cap' | 'over_cap'
export type MatchIntraVerdict = 'within_preferred' | 'over_preferred' | 'over_cap'
export type MatchVerdictReason =
  | 'pvna_over_tolerance'
  | 'repeat_over_cap'
  | 'intra_over_preferred'
  | 'intra_over_cap'

export type MatchVerdict = {
  pvnaVerdict: MatchPvnaVerdict
  repeatVerdict: MatchRepeatVerdict
  intraVerdict: MatchIntraVerdict
  reasons: MatchVerdictReason[]
}

export function computeMatchVerdict(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  tolerance: number,
): MatchVerdict {
  const quality = hasAllPlayers(teamA, teamB, state)
    ? computeQualityCost(teamA, teamB, state, { tolerance })
    : null
  const pvnaGap = getMatchPvnaGap(teamA, teamB, state)
  const repeat = getProjectedRepeatSummary(teamA, teamB, state)
  const maxIntraGap = Math.max(getTeamGap(teamA, state), getTeamGap(teamB, state))

  // One measurement, not the larger of two. computeQualityCost's gap and getMatchPvnaGap are the same
  // arithmetic over the same ratings, so taking a max would only paper over a disagreement between them
  // — and hiding that disagreement is the thing this module exists to stop. The cost model's own number
  // is used when every player is present; otherwise the shared helper, which reports a missing player as
  // contributing nothing.
  const gap = quality?.gap ?? pvnaGap
  const pvnaVerdict: MatchPvnaVerdict = gap > tolerance ? 'over_tolerance' : 'within_tolerance'
  const repeatVerdict: MatchRepeatVerdict =
    repeat.pair_over_by > 0 || repeat.player_over_by > 0
      ? 'over_cap'
      : 'within_cap'
  const intraVerdict: MatchIntraVerdict =
    maxIntraGap > INTRA_TEAM_PVNA_GAP_LIMIT
      ? 'over_cap'
      : maxIntraGap > PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT
        ? 'over_preferred'
        : 'within_preferred'
  const reasons: MatchVerdictReason[] = []

  if (pvnaVerdict === 'over_tolerance') reasons.push('pvna_over_tolerance')
  if (repeatVerdict === 'over_cap') reasons.push('repeat_over_cap')
  if (intraVerdict === 'over_cap') reasons.push('intra_over_cap')
  else if (intraVerdict === 'over_preferred') reasons.push('intra_over_preferred')

  return { pvnaVerdict, repeatVerdict, intraVerdict, reasons }
}

function hasAllPlayers(teamA: Team, teamB: Team, state: SessionState): boolean {
  return [...teamA, ...teamB].every(playerId => state.players.has(playerId))
}

function getTeamGap(team: Team, state: SessionState): number {
  const [firstId, secondId] = team
  const first = state.players.get(firstId)
  const second = state.players.get(secondId)
  if (!first || !second) return 0
  return Math.abs(getEffectivePvna(first) - getEffectivePvna(second))
}
