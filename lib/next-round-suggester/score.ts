import type { MatchScore, MatchStats, ScoringWeights, SessionState, Team } from './types'

const INFINITY_SCORE: MatchScore = {
  score: Infinity,
  stats: {
    elo_diff: Infinity,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
  },
}

function emptyStats(eloDiff = 0): MatchStats {
  return {
    elo_diff: eloDiff,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
  }
}

function getElo(team: Team, state: SessionState): number | null {
  const players = team.map((playerId) => state.players.get(playerId))
  if (players.some((player) => !player)) return null
  return players.reduce((sum, player) => sum + (player?.elo ?? 1000), 0) / 2
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

function getGroupedPairCount(players: string[], state: SessionState): number {
  let count = 0

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const groupA = state.players.get(players[i])?.group_id
      const groupB = state.players.get(players[j])?.group_id
      if (groupA && groupA === groupB) count += 1
    }
  }

  return count
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

  const teamAElo = getElo(teamA, state)
  const teamBElo = getElo(teamB, state)
  if (teamAElo === null || teamBElo === null) return INFINITY_SCORE

  const eloDiff = Math.abs(teamAElo - teamBElo)
  const tolerance = options.tolerance ?? state.config.elo_tolerance
  if (eloDiff > tolerance) return INFINITY_SCORE

  const weights = options.weights ?? state.config.weights
  const stats = emptyStats(eloDiff)
  stats.partner_repeats = getPartnerRepeats(teamA, state) + getPartnerRepeats(teamB, state)
  stats.opponent_repeats = getOpponentRepeats(teamA, teamB, state)
  stats.group_bonus = getGroupedPairCount(allPlayers, state)

  const score =
    (eloDiff / 50) * weights.elo +
    stats.partner_repeats * weights.partner_repeat +
    stats.opponent_repeats * weights.opponent_repeat -
    stats.group_bonus * weights.group_bonus

  return {
    score,
    stats,
  }
}
