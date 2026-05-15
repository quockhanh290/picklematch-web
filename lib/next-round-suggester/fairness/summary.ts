import type { Match, PlayerSessionState, RoundRecord, SessionState } from '../types'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { detectFairnessIssues, type FairnessWarning } from './detector.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeGenderPrefSatisfaction, computeOpponentDiversity, computePartnerDiversity, computeRestFairness, computeSessionFairness, type SessionFairnessScore } from './metrics.ts'

export type SessionSummary = {
  session_id: string
  total_rounds: number
  total_players: number
  duration_minutes: number
  fairness_score: SessionFairnessScore
  fairness_evolution: { round: number; score: number }[]
  overall_pref_satisfaction_rate: number
  highlights: {
    most_balanced_round: number
    most_unique_partners_player: { player_id: string; count: number }
    flagged_issues: FairnessWarning[]
  }
  per_player: {
    player_id: string
    matches_played: number
    unique_partners: number
    unique_opponents: number
    max_consecutive_rest: number
    pvna_change?: number
  }[]
}

export function buildSessionSummary(state: SessionState): SessionSummary {
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const gender = computeGenderPrefSatisfaction(state)
  const uniquePartnersByPlayer = new Map(
    partner.per_player.map((player) => [player.player_id, player.unique_count]),
  )
  const uniqueOpponentsByPlayer = new Map(
    opponent.per_player.map((player) => [player.player_id, player.unique_count]),
  )
  const restByPlayer = new Map(
    rest.per_player.map((player) => [player.player_id, player.max_consecutive_rest]),
  )

  return {
    session_id: state.session_id,
    total_rounds: state.rounds.length,
    total_players: state.players.size,
    duration_minutes: computeDurationMinutes(state.rounds),
    fairness_score: computeSessionFairness(state),
    fairness_evolution: computeFairnessEvolution(state),
    overall_pref_satisfaction_rate: gender.satisfaction_rate,
    highlights: {
      most_balanced_round: getMostBalancedRound(state),
      most_unique_partners_player: getMostUniquePartners(partner.per_player),
      flagged_issues: detectFairnessIssues(state),
    },
    per_player: sortedPlayers(state).map((player) => ({
      player_id: player.player_id,
      matches_played: player.matches_played,
      unique_partners: uniquePartnersByPlayer.get(player.player_id) ?? 0,
      unique_opponents: uniqueOpponentsByPlayer.get(player.player_id) ?? 0,
      max_consecutive_rest: restByPlayer.get(player.player_id) ?? player.consecutive_rest,
    })),
  }
}

function computeFairnessEvolution(state: SessionState): { round: number; score: number }[] {
  const sortedRounds = state.rounds
    .filter((round) => round.status === 'completed' || round.status === 'active')
    .sort((a, b) => a.round_no - b.round_no)
  const snapshotPlayers = new Map<string, PlayerSessionState>()
  const snapshotRounds: RoundRecord[] = []
  const evolution: { round: number; score: number }[] = []

  for (const round of sortedRounds) {
    ensureRoundPlayers(snapshotPlayers, state, round)
    applyRoundToSnapshot(snapshotPlayers, round)
    snapshotRounds.push(round)

    const snapshotState: SessionState = {
      ...state,
      current_round: round.round_no + 1,
      players: clonePlayers(snapshotPlayers),
      rounds: [...snapshotRounds],
    }

    evolution.push({
      round: round.round_no,
      score: computeSessionFairness(snapshotState).total,
    })
  }

  return evolution
}

function getMostBalancedRound(state: SessionState): number {
  const evolution = computeFairnessEvolution(state)
  if (evolution.length === 0) return 0

  return evolution.reduce((best, current) => (current.score > best.score ? current : best)).round
}

function getMostUniquePartners(
  perPlayer: Array<{ player_id: string; unique_count: number }>,
): { player_id: string; count: number } {
  if (perPlayer.length === 0) return { player_id: '', count: 0 }

  const best = perPlayer.reduce((winner, player) => {
    if (player.unique_count !== winner.unique_count) {
      return player.unique_count > winner.unique_count ? player : winner
    }
    return player.player_id.localeCompare(winner.player_id) < 0 ? player : winner
  })

  return {
    player_id: best.player_id,
    count: best.unique_count,
  }
}

function computeDurationMinutes(rounds: RoundRecord[]): number {
  const times = rounds
    .flatMap((round) => [round.started_at, round.ended_at])
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime())

  if (times.length < 2) return 0
  return Math.round((Math.max(...times) - Math.min(...times)) / 60000)
}

function sortedPlayers(state: SessionState): PlayerSessionState[] {
  return [...state.players.values()].sort((a, b) => a.player_id.localeCompare(b.player_id))
}

function ensureRoundPlayers(
  snapshotPlayers: Map<string, PlayerSessionState>,
  sourceState: SessionState,
  round: RoundRecord,
) {
  const roundPlayerIds = new Set([
    ...round.matches.flatMap((match) => [...match.team_a, ...match.team_b]),
    ...round.resting,
  ])

  for (const playerId of roundPlayerIds) {
    if (snapshotPlayers.has(playerId)) continue

    const sourcePlayer = sourceState.players.get(playerId)
    if (!sourcePlayer) continue

    snapshotPlayers.set(playerId, {
      ...sourcePlayer,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: false,
      checked_out_at: null,
    })
  }
}

function applyRoundToSnapshot(players: Map<string, PlayerSessionState>, round: RoundRecord) {
  const playedIds = new Set(round.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
  const restingIds = new Set(round.resting)

  for (const playerId of playedIds) {
    const player = players.get(playerId)
    if (!player) continue

    player.matches_played += 1
    player.last_played_round = round.round_no
    player.consecutive_play += 1
    player.consecutive_rest = 0
  }

  for (const playerId of restingIds) {
    const player = players.get(playerId)
    if (!player || playedIds.has(playerId)) continue

    player.consecutive_rest += 1
    player.consecutive_play = 0
  }

  for (const match of round.matches) {
    incrementPair(players, match.team_a[0], match.team_a[1], 'partner_counts')
    incrementPair(players, match.team_b[0], match.team_b[1], 'partner_counts')
    incrementOpponentPairs(players, match)
  }
}

function incrementOpponentPairs(players: Map<string, PlayerSessionState>, match: Match) {
  for (const playerA of match.team_a) {
    for (const playerB of match.team_b) {
      incrementPair(players, playerA, playerB, 'opponent_counts')
    }
  }
}

function incrementPair(
  players: Map<string, PlayerSessionState>,
  playerA: string,
  playerB: string,
  field: 'partner_counts' | 'opponent_counts',
) {
  const a = players.get(playerA)
  const b = players.get(playerB)
  if (!a || !b) return

  a[field].set(playerB, (a[field].get(playerB) ?? 0) + 1)
  b[field].set(playerA, (b[field].get(playerA) ?? 0) + 1)
}

function clonePlayers(players: Map<string, PlayerSessionState>): Map<string, PlayerSessionState> {
  return new Map(
    [...players].map(([playerId, player]) => [
      playerId,
      {
        ...player,
        partner_counts: new Map(player.partner_counts),
        opponent_counts: new Map(player.opponent_counts),
      },
    ]),
  )
}
