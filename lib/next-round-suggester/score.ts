import type {
  GenderPreference,
  MatchScore,
  MatchStats,
  PlayerSessionState,
  ScoringWeights,
  SessionState,
  Team,
} from './types'

const INFINITY_SCORE: MatchScore = {
  score: Infinity,
  stats: {
    pvna_diff: Infinity,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
  },
}

export const INTRA_TEAM_PVNA_GAP_LIMIT = 1.5
export const MAX_PROJECTED_PARTNER_PAIR_COUNT = 2
export const MAX_PROJECTED_OPPONENT_PAIR_COUNT = 2
export const MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER = 2
export const MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER = 2

function emptyStats(pvnaDiff = 0): MatchStats {
  return {
    pvna_diff: pvnaDiff,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
  }
}

function getPvna(team: Team, state: SessionState): number | null {
  const players = team.map((playerId) => state.players.get(playerId))
  if (players.some((player) => !player)) return null
  return players.reduce((sum, player) => sum + (player?.pvna ?? 3.0), 0)
}

function getTeamGap(team: Team, state: SessionState): number | null {
  const first = state.players.get(team[0])
  const second = state.players.get(team[1])
  if (!first || !second) return null
  return Math.abs(first.pvna - second.pvna)
}

export function hasIntraTeamGapOverflow(teamA: Team, teamB: Team, state: SessionState): boolean {
  const teamAGap = getTeamGap(teamA, state)
  const teamBGap = getTeamGap(teamB, state)
  return (
    teamAGap === null ||
    teamBGap === null ||
    teamAGap > INTRA_TEAM_PVNA_GAP_LIMIT ||
    teamBGap > INTRA_TEAM_PVNA_GAP_LIMIT
  )
}

function getPartnerRepeats(team: Team, state: SessionState): number {
  return state.players.get(team[0])?.partner_counts.get(team[1]) ?? 0
}

function getOpponentRepeats(teamA: Team, teamB: Team, state: SessionState): number {
  let total = 0

  for (const playerA of teamA) {
    for (const playerB of teamB) {
      total += state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0
    }
  }

  return total
}

export type ProjectedRepeatSummary = {
  max_partner_pair_count: number
  max_opponent_pair_count: number
  max_repeated_partners_per_player: number
  max_repeated_opponents_per_player: number
  pair_over_by: number
  player_over_by: number
  affected_pairs: number
  affected_players: number
}

function repeatedRelationCount(counts: Map<string, number>) {
  return [...counts.values()].filter((count) => count >= 2).length
}

function cloneCountsForPlayer(
  playerId: string,
  state: SessionState,
  field: 'partner_counts' | 'opponent_counts',
) {
  return new Map(state.players.get(playerId)?.[field] ?? [])
}

export function getProjectedRepeatSummary(teamA: Team, teamB: Team, state: SessionState): ProjectedRepeatSummary {
  let maxPartnerPairCount = 0
  let maxOpponentPairCount = 0
  let pairOverBy = 0
  let affectedPairs = 0
  const playerIds = [...teamA, ...teamB]
  const projectedPartnerCounts = new Map(playerIds.map((playerId) => [
    playerId,
    cloneCountsForPlayer(playerId, state, 'partner_counts'),
  ]))
  const projectedOpponentCounts = new Map(playerIds.map((playerId) => [
    playerId,
    cloneCountsForPlayer(playerId, state, 'opponent_counts'),
  ]))

  const incrementPair = (
    playerA: string,
    playerB: string,
    countsByPlayer: Map<string, Map<string, number>>,
  ) => {
    const countsA = countsByPlayer.get(playerA)
    const countsB = countsByPlayer.get(playerB)
    const nextCount = (countsA?.get(playerB) ?? 0) + 1
    if (countsA) countsA.set(playerB, nextCount)
    if (countsB) countsB.set(playerA, nextCount)
    return nextCount
  }

  const partnerPairs: Array<[string, string]> = [
    [teamA[0], teamA[1]],
    [teamB[0], teamB[1]],
  ]
  for (const [playerA, playerB] of partnerPairs) {
    const projectedCount = incrementPair(playerA, playerB, projectedPartnerCounts)
    maxPartnerPairCount = Math.max(maxPartnerPairCount, projectedCount)
    const overBy = Math.max(0, projectedCount - MAX_PROJECTED_PARTNER_PAIR_COUNT)
    if (overBy > 0) {
      pairOverBy += overBy
      affectedPairs += 1
    }
  }

  for (const playerA of teamA) {
    for (const playerB of teamB) {
      const projectedCount = incrementPair(playerA, playerB, projectedOpponentCounts)
      maxOpponentPairCount = Math.max(maxOpponentPairCount, projectedCount)
      const overBy = Math.max(0, projectedCount - MAX_PROJECTED_OPPONENT_PAIR_COUNT)
      if (overBy > 0) {
        pairOverBy += overBy
        affectedPairs += 1
      }
    }
  }

  let maxRepeatedPartnersPerPlayer = 0
  let maxRepeatedOpponentsPerPlayer = 0
  let playerOverBy = 0
  let affectedPlayers = 0

  for (const playerId of playerIds) {
    const repeatedPartners = repeatedRelationCount(projectedPartnerCounts.get(playerId) ?? new Map())
    const repeatedOpponents = repeatedRelationCount(projectedOpponentCounts.get(playerId) ?? new Map())
    maxRepeatedPartnersPerPlayer = Math.max(maxRepeatedPartnersPerPlayer, repeatedPartners)
    maxRepeatedOpponentsPerPlayer = Math.max(maxRepeatedOpponentsPerPlayer, repeatedOpponents)

    const partnerOverBy = Math.max(0, repeatedPartners - MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER)
    const opponentOverBy = Math.max(0, repeatedOpponents - MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER)
    const totalPlayerOverBy = partnerOverBy + opponentOverBy
    if (totalPlayerOverBy > 0) {
      playerOverBy += totalPlayerOverBy
      affectedPlayers += 1
    }
  }

  return {
    max_partner_pair_count: maxPartnerPairCount,
    max_opponent_pair_count: maxOpponentPairCount,
    max_repeated_partners_per_player: maxRepeatedPartnersPerPlayer,
    max_repeated_opponents_per_player: maxRepeatedOpponentsPerPlayer,
    pair_over_by: pairOverBy,
    player_over_by: playerOverBy,
    affected_pairs: affectedPairs,
    affected_players: affectedPlayers,
  }
}

export function hasRepeatOverflow(teamA: Team, teamB: Team, state: SessionState): boolean {
  const summary = getProjectedRepeatSummary(teamA, teamB, state)
  return summary.pair_over_by > 0 || summary.player_over_by > 0
}

function getGroupedPartnerCount(teamA: Team, teamB: Team, state: SessionState): number {
  return getGroupedTeamPairCount(teamA, state) + getGroupedTeamPairCount(teamB, state)
}

function getGroupedTeamPairCount(team: Team, state: SessionState): number {
  let count = 0

  for (let i = 0; i < team.length; i += 1) {
    for (let j = i + 1; j < team.length; j += 1) {
      const playerA = state.players.get(team[i])
      const playerB = state.players.get(team[j])
      if (
        playerA?.group_id &&
        playerA.group_id === playerB?.group_id &&
        Math.abs(playerA.pvna - playerB.pvna) <= INTRA_TEAM_PVNA_GAP_LIMIT
      ) {
        count += 1
      }
    }
  }

  return count
}

function prefMatchesGender(pref: GenderPreference, player: PlayerSessionState | undefined): boolean {
  if (pref === 'any') return true
  if (!player?.gender) return true
  return player.gender === pref
}

function getPartnerGenderPenalty(
  player: PlayerSessionState,
  partner: PlayerSessionState | undefined,
  weights: ScoringWeights,
): number {
  if (prefMatchesGender(player.partner_gender_pref, partner)) return 0

  const sameGroup = Boolean(player.group_id && player.group_id === partner?.group_id)
  return sameGroup ? weights.partner_gender_pref * 0.5 : weights.partner_gender_pref
}

export function genderPenalty(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  weights: ScoringWeights = state.config.weights,
): number {
  const players = new Map<string, { partnerId: string; opponentIds: string[] }>([
    [teamA[0], { partnerId: teamA[1], opponentIds: teamB }],
    [teamA[1], { partnerId: teamA[0], opponentIds: teamB }],
    [teamB[0], { partnerId: teamB[1], opponentIds: teamA }],
    [teamB[1], { partnerId: teamB[0], opponentIds: teamA }],
  ])
  let penalty = 0

  for (const [playerId, relations] of players) {
    const player = state.players.get(playerId)
    if (!player) continue

    const partner = state.players.get(relations.partnerId)
    penalty += getPartnerGenderPenalty(player, partner, weights)

    if (player.opponent_gender_pref !== 'any') {
      for (const opponentId of relations.opponentIds) {
        const opponent = state.players.get(opponentId)
        if (!prefMatchesGender(player.opponent_gender_pref, opponent)) {
          penalty += weights.opponent_gender_pref
        }
      }
    }
  }

  return penalty
}

export function scoreMatch(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  options: {
    tolerance?: number
    weights?: ScoringWeights
    allowRepeatOverflow?: boolean
    allowIntraTeamGapOverflow?: boolean
  } = {},
): MatchScore {
  const allPlayers = [...teamA, ...teamB]
  const uniquePlayers = new Set(allPlayers)

  if (teamA.length !== 2 || teamB.length !== 2 || uniquePlayers.size !== 4) {
    return INFINITY_SCORE
  }

  if (allPlayers.some((playerId) => !state.players.has(playerId))) {
    return INFINITY_SCORE
  }

  const teamAPvna = getPvna(teamA, state)
  const teamBPvna = getPvna(teamB, state)
  if (teamAPvna === null || teamBPvna === null) return INFINITY_SCORE

  if (!options.allowIntraTeamGapOverflow && hasIntraTeamGapOverflow(teamA, teamB, state)) {
    return INFINITY_SCORE
  }

  const pvnaDiff = Math.abs(teamAPvna - teamBPvna)
  const tolerance = options.tolerance ?? state.config.pvna_tolerance
  if (pvnaDiff > tolerance) return INFINITY_SCORE
  if (!options.allowRepeatOverflow && hasRepeatOverflow(teamA, teamB, state)) {
    return INFINITY_SCORE
  }

  const weights = options.weights ?? state.config.weights
  const stats = emptyStats(pvnaDiff)
  stats.partner_repeats = getPartnerRepeats(teamA, state) + getPartnerRepeats(teamB, state)
  stats.opponent_repeats = getOpponentRepeats(teamA, teamB, state)
  stats.group_bonus = getGroupedPartnerCount(teamA, teamB, state)
  stats.gender_pref_penalty = genderPenalty(teamA, teamB, state, weights)

  const score =
    pvnaDiff * weights.pvna +
    stats.partner_repeats * weights.partner_repeat +
    stats.opponent_repeats * weights.opponent_repeat -
    stats.group_bonus * weights.group_bonus +
    stats.gender_pref_penalty

  return {
    score,
    stats,
  }
}
