import type { PlayerSessionState, SessionLiveMatchRow, SessionState } from '@/lib/next-round-suggester/types'

type SuggestedLiveMatchRow = SessionLiveMatchRow & {
  preview_source?: 'edge_committed' | 'session_plan' | 'edge_partial' | 'local_fallback' | 'manual_available_pool'
  preview_request_key?: string
  preview_request_serial?: number
  preview_live_state_version?: number | null
  preview_countable_match_count?: number | null
  preview_max_sequence_no?: number | null
  warnings?: string[]
  tradeoffs?: import('@/lib/next-round-suggester/types').SuggestionTradeoff[]
  approval_required?: boolean
  configured_pvna_tolerance?: number
  effective_pvna_tolerance?: number
  fairness_reasons?: string[]
  fairness_reason_details?: string[]
  tradeoff_choices?: import('@/lib/next-round-suggester/types').SuggestionTradeoffChoice[]
  recommended_tradeoff_choice?: import('@/lib/next-round-suggester/types').SuggestionTradeoffChoiceId
  live_availability_context?: {
    locked_player_count: number
    live_court_count: number
    locked_beam_quality?: number
    available_pool_quality?: number
  }
  locked_player_ids?: string[]
  available_pool_only?: boolean
}

export const getSuggestedMatchSignature = (match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>) => [
  ...match.team_a.map(String).sort(),
  ...match.team_b.map(String).sort(),
].join('|')

export function getSuggestedMatchPvnaGap(match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>, state: SessionState) {
  const getTeamPvna = (team: readonly string[]) => team.reduce(
    (sum, playerId) => sum + (state.players.get(String(playerId))?.pvna ?? 0),
    0,
  )
  return Math.abs(getTeamPvna(match.team_a) - getTeamPvna(match.team_b))
}

export function applyPairIncrement(
  players: Map<string, PlayerSessionState>,
  playerAId: string,
  playerBId: string,
  type: 'partner' | 'opponent',
): void {
  const playerA = players.get(playerAId)
  const playerB = players.get(playerBId)
  if (playerA) {
    const partnerCounts = new Map(playerA.partner_counts)
    const opponentCounts = new Map(playerA.opponent_counts)
    const counts = type === 'partner' ? partnerCounts : opponentCounts
    counts.set(playerBId, (counts.get(playerBId) ?? 0) + 1)
    players.set(playerAId, { ...playerA, partner_counts: partnerCounts, opponent_counts: opponentCounts })
  }
  if (playerB) {
    const partnerCounts = new Map(playerB.partner_counts)
    const opponentCounts = new Map(playerB.opponent_counts)
    const counts = type === 'partner' ? partnerCounts : opponentCounts
    counts.set(playerAId, (counts.get(playerAId) ?? 0) + 1)
    players.set(playerBId, { ...playerB, partner_counts: partnerCounts, opponent_counts: opponentCounts })
  }
}

export function swapPlayersInSuggestedMatch(match: SuggestedLiveMatchRow, fromId: string, toId: string): SuggestedLiveMatchRow {
  const replaceInTeam = (team: string[]) => team.map(playerId => {
    if (playerId === fromId) return toId
    if (playerId === toId) return fromId
    return playerId
  }) as [string, string]

  const teamA = replaceInTeam(match.team_a)
  const teamB = replaceInTeam(match.team_b)
  const toWasResting = (match.resting ?? []).includes(toId)
  const restingBase = toWasResting
    ? [...(match.resting ?? []).filter(playerId => playerId !== toId), fromId]
    : (match.resting ?? [])
  const playingAfter = new Set([...teamA, ...teamB])
  const resting = [...new Set(restingBase)].filter(playerId => !playingAfter.has(playerId))

  return {
    ...match,
    team_a: teamA,
    team_b: teamB,
    resting,
  }
}
