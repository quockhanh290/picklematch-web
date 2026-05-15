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

const INTRA_TEAM_PVNA_GAP_LIMIT = 1.5

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
  return players.reduce((sum, player) => sum + (player?.pvna ?? 3.0), 0) / 2
}

function getTeamGap(team: Team, state: SessionState): number | null {
  const first = state.players.get(team[0])
  const second = state.players.get(team[1])
  if (!first || !second) return null
  return Math.abs(first.pvna - second.pvna)
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

function getGroupedPartnerCount(teamA: Team, teamB: Team, state: SessionState): number {
  return getGroupedTeamPairCount(teamA, state) + getGroupedTeamPairCount(teamB, state)
}

function getGroupedTeamPairCount(team: Team, state: SessionState): number {
  let count = 0

  for (let i = 0; i < team.length; i += 1) {
    for (let j = i + 1; j < team.length; j += 1) {
      const groupA = state.players.get(team[i])?.group_id
      const groupB = state.players.get(team[j])?.group_id
      if (groupA && groupA === groupB) count += 1
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
  options: { tolerance?: number; weights?: ScoringWeights } = {},
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

  const teamAGap = getTeamGap(teamA, state)
  const teamBGap = getTeamGap(teamB, state)
  if (
    teamAGap === null ||
    teamBGap === null ||
    teamAGap > INTRA_TEAM_PVNA_GAP_LIMIT ||
    teamBGap > INTRA_TEAM_PVNA_GAP_LIMIT
  ) {
    return INFINITY_SCORE
  }

  const pvnaDiff = Math.abs(teamAPvna - teamBPvna)
  const tolerance = options.tolerance ?? state.config.pvna_tolerance
  if (pvnaDiff > tolerance) return INFINITY_SCORE

  const weights = options.weights ?? state.config.weights
  const stats = emptyStats(pvnaDiff)
  stats.partner_repeats = getPartnerRepeats(teamA, state) + getPartnerRepeats(teamB, state)
  stats.opponent_repeats = getOpponentRepeats(teamA, teamB, state)
  stats.group_bonus = getGroupedPartnerCount(teamA, teamB, state)
  stats.gender_pref_penalty = genderPenalty(teamA, teamB, state, weights)

  const score =
    (pvnaDiff / 0.5) * weights.pvna +
    stats.partner_repeats * weights.partner_repeat +
    stats.opponent_repeats * weights.opponent_repeat -
    stats.group_bonus * weights.group_bonus +
    stats.gender_pref_penalty

  return {
    score,
    stats,
  }
}
