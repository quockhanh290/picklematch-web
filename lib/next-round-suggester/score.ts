import type {
  GenderPreference,
  MatchScore,
  MatchStats,
  PlayerSessionState,
  ScoringWeights,
  SessionState,
  Team,
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
} from './types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getEffectivePvna } from './state.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getAvoidPenalty, AVOID_PARTNER_PENALTY } from './avoid.ts'

const INFINITY_SCORE: MatchScore = {
  score: Infinity,
  stats: {
    pvna_diff: Infinity,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
    consecutive_play_penalty: 0,
  },
}

export const PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT = 0.75
export const INTRA_TEAM_PVNA_GAP_LIMIT = 1.0
// Soft penalty for intra-team gap across the full range [0, 1.0].
// At W=0.15, an intra improvement of 0.33 per team outweighs a pvna_diff increase of 0.05.
// pvna still dominates for large differences (e.g. pvna=0.4 beats intra_gain=0.7).
const INTRA_GAP_SOFT_WEIGHT = 0.15
// When allowIntraTeamGapOverflow=true, each unit of gap excess over INTRA_TEAM_PVNA_GAP_LIMIT
// costs this many score points. W=1 makes the crossover fair: intra excess beats pvna_diff when
// total excess < pvna_diff, i.e. Stage 6 (cross-split, ~balanced pvna) beats Stage 5.5
// (same-cluster, valid intra but high pvna_diff) when cluster_gap < 2.0.
const INTRA_OVERFLOW_WEIGHT = 1
export const MAX_PROJECTED_PARTNER_PAIR_COUNT = 2
export const MAX_PROJECTED_OPPONENT_PAIR_COUNT = 2
export const MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER = 2
export const MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER = 2
export const RECENT_GROUP_REMATCH_BLOCK_ROUNDS = 2
export const RECENT_GROUP_NEAR_REMATCH_MIN_OVERLAP = 3

export function getRematchBlockRounds(N: number): number {
  return N <= 10 ? 1 : 2
}

export function getNearRematchMinOverlap(N: number): number {
  return N <= 8 ? 4 : 3
}
export const RECENT_REPEAT_PENALTY_WINDOW = 3
export const RECENT_PARTNER_REPEAT_WEIGHT = 28
export const RECENT_OPPONENT_REPEAT_WEIGHT = 4
export const RECENT_INTRA_GROUP_PARTNER_REPEAT_WEIGHT = 0
export const RECENT_INTRA_GROUP_OPPONENT_REPEAT_WEIGHT = 1
export const RECENT_OVERLAP_2_WEIGHT = 1.5
export const RECENT_OVERLAP_3_WEIGHT = 80
export const RECENT_EXACT_REMATCH_WEIGHT = 80
const RECENT_GROUP_REMATCH_KEYS_FIELD = '__recent_group_rematch_keys'

function emptyStats(pvnaDiff = 0): MatchStats {
  return {
    pvna_diff: pvnaDiff,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
    consecutive_play_penalty: 0,
  }
}

function getConsecutivePlayPenalty(allPlayers: string[], state: SessionState, weight: number, mustRestAt = 2): number {
  let penalty = 0
  for (const playerId of allPlayers) {
    const consecutive = state.players.get(playerId)?.consecutive_play ?? 0
    if (consecutive >= mustRestAt) {
      // Quadratic penalty: (consecutive-1)^2 × weight per player
      // consecutive=2 → 1×weight, consecutive=3 → 4×weight, consecutive=4 → 9×weight
      penalty += Math.pow(consecutive - 1, 2) * weight
    }
  }
  return penalty
}

function getPvna(team: Team, state: SessionState): number | null {
  const players = team.map((playerId) => state.players.get(playerId))
  if (players.some((player) => !player)) return null
  return players.reduce((sum, player) => sum + (player?.pvna ?? 3.0), 0)
}

export function getMatchGroupKey(teamA: Team, teamB: Team) {
  return [...teamA, ...teamB].sort().join(':')
}

export function getMatchNearRematchKeys(teamA: Team, teamB: Team) {
  const ids = [...teamA, ...teamB].sort()
  const keys: string[] = []
  for (let omitted = 0; omitted < ids.length; omitted += 1) {
    keys.push(`near:${ids.filter((_, index) => index !== omitted).join(':')}`)
  }
  return keys
}

function pairKey(playerA: string, playerB: string) {
  return playerA < playerB ? `${playerA}:${playerB}` : `${playerB}:${playerA}`
}

function recentRepeatDecay(distance: number) {
  if (distance <= 1) return 1
  if (distance === 2) return 0.65
  return 0.35
}

export type RecentRepeatCost = {
  total: number
  partner: number
  opponent: number
  overlap2: number
  overlap3: number
  exact4: number
}

export function getRecentRepeatCost(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  roundNo = state.current_round,
): RecentRepeatCost {
  const cost: RecentRepeatCost = {
    total: 0,
    partner: 0,
    opponent: 0,
    overlap2: 0,
    overlap3: 0,
    exact4: 0,
  }
  const partnerPairs = [pairKey(teamA[0], teamA[1]), pairKey(teamB[0], teamB[1])]
  const opponentPairs = teamA.flatMap(playerA => teamB.map(playerB => pairKey(playerA, playerB)))
  const matchGroupKey = getMatchGroupKey(teamA, teamB)

  for (const round of state.rounds) {
    const distance = roundNo - round.round_no
    if (
      round.status !== 'completed' ||
      distance <= 0 ||
      distance > RECENT_REPEAT_PENALTY_WINDOW
    ) {
      continue
    }

    const weight = recentRepeatDecay(distance)
    for (const match of round.matches) {
      const previousPartnerPairs = [
        pairKey(match.team_a[0], match.team_a[1]),
        pairKey(match.team_b[0], match.team_b[1]),
      ]
      const previousOpponentPairs = match.team_a.flatMap(playerA => match.team_b.map(playerB => pairKey(playerA, playerB)))
      const partnerHits = partnerPairs.filter(key => previousPartnerPairs.includes(key)).length
      const opponentHits = opponentPairs.filter(key => previousOpponentPairs.includes(key)).length
      const playerOverlap = getPlayerOverlap(teamA, teamB, match.team_a, match.team_b)

      cost.partner += partnerHits * weight
      cost.opponent += opponentHits * weight
      if (playerOverlap === 2) cost.overlap2 += weight
      if (playerOverlap === 3) cost.overlap3 += weight
      if (playerOverlap === 4 || getMatchGroupKey(match.team_a, match.team_b) === matchGroupKey) {
        cost.exact4 += weight
      }
    }
  }

  cost.total =
    cost.partner * RECENT_PARTNER_REPEAT_WEIGHT +
    cost.opponent * RECENT_OPPONENT_REPEAT_WEIGHT +
    cost.overlap2 * RECENT_OVERLAP_2_WEIGHT +
    cost.overlap3 * RECENT_OVERLAP_3_WEIGHT +
    cost.exact4 * RECENT_EXACT_REMATCH_WEIGHT
  return cost
}

function getInjectedRecentGroupRematchKeys(state: SessionState): Set<string> | null {
  const keys = (state as unknown as Record<string, unknown>)[RECENT_GROUP_REMATCH_KEYS_FIELD]
  return keys instanceof Set ? keys as Set<string> : null
}

export function getRecentGroupRematchKeys(state: SessionState): Set<string> {
  const keys = getInjectedRecentGroupRematchKeys(state)
  return keys ? new Set(keys) : new Set()
}

export function getRecentGroupRematchKeySignature(state: SessionState): string {
  const keys = getInjectedRecentGroupRematchKeys(state)
  return keys ? [...keys].sort().join('|') : ''
}

export function withRecentGroupRematchKeys(state: SessionState, keys: Set<string>): SessionState {
  return Object.assign({ ...state }, { [RECENT_GROUP_REMATCH_KEYS_FIELD]: keys })
}

function getPlayerOverlap(teamA: Team, teamB: Team, otherTeamA: Team, otherTeamB: Team) {
  const otherIds = new Set([...otherTeamA, ...otherTeamB])
  return [...teamA, ...teamB].filter(playerId => otherIds.has(playerId)).length
}

export function hasRecentGroupRematch(teamA: Team, teamB: Team, state: SessionState): boolean {
  const matchGroupKey = getMatchGroupKey(teamA, teamB)
  const injectedKeys = getInjectedRecentGroupRematchKeys(state)
  if (injectedKeys) {
    if (injectedKeys.has(matchGroupKey)) return true
    return getMatchNearRematchKeys(teamA, teamB).some(key => injectedKeys.has(key))
  }

  const currentRoundNo = state.current_round
  const activeN = [...state.players.values()].filter(p => p.checked_out_at === null).length
  const blockRounds = getRematchBlockRounds(activeN)
  const nearOverlap = getNearRematchMinOverlap(activeN)
  for (const round of state.rounds) {
    if (
      round.status !== 'completed' ||
      currentRoundNo <= round.round_no ||
      currentRoundNo > round.round_no + blockRounds
    ) {
      continue
    }

    for (const match of round.matches) {
      if (getMatchGroupKey(match.team_a, match.team_b) === matchGroupKey) return true
      if (getPlayerOverlap(teamA, teamB, match.team_a, match.team_b) >= nearOverlap) {
        return true
      }
    }
  }

  return false
}

function getTeamGap(team: Team, state: SessionState): number | null {
  const first = state.players.get(team[0])
  const second = state.players.get(team[1])
  if (!first || !second) return null
  return Math.abs(getEffectivePvna(first) - getEffectivePvna(second))
}

export function hasIntraTeamGapOverflow(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  limit = INTRA_TEAM_PVNA_GAP_LIMIT,
): boolean {
  const teamAGap = getTeamGap(teamA, state)
  const teamBGap = getTeamGap(teamB, state)
  return (
    teamAGap === null ||
    teamBGap === null ||
    teamAGap > limit ||
    teamBGap > limit
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

function areSameGroup(
  a: { group_id: string | null } | undefined,
  b: { group_id: string | null } | undefined,
): boolean {
  return !!a?.group_id && a.group_id === b?.group_id
}

export function getProjectedRepeatSummary(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  caps?: { partnerCap?: number; opponentCap?: number },
): ProjectedRepeatSummary {
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
    const pA = state.players.get(playerA)
    const pB = state.players.get(playerB)
    const partnerThreshold = areSameGroup(pA, pB) ? Infinity : (caps?.partnerCap ?? MAX_PROJECTED_PARTNER_PAIR_COUNT)
    const overBy = Math.max(0, projectedCount - partnerThreshold)
    if (overBy > 0) {
      pairOverBy += overBy
      affectedPairs += 1
    }
  }

  for (const playerA of teamA) {
    for (const playerB of teamB) {
      const projectedCount = incrementPair(playerA, playerB, projectedOpponentCounts)
      maxOpponentPairCount = Math.max(maxOpponentPairCount, projectedCount)
      const overBy = Math.max(0, projectedCount - (caps?.opponentCap ?? MAX_PROJECTED_OPPONENT_PAIR_COUNT))
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

export function hasRepeatOverflow(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  caps?: { partnerCap?: number; opponentCap?: number },
): boolean {
  const summary = getProjectedRepeatSummary(teamA, teamB, state, caps)
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
        Math.abs(getEffectivePvna(playerA) - getEffectivePvna(playerB)) <= INTRA_TEAM_PVNA_GAP_LIMIT
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

function computeGroupAwarePartnerPenalty(team: Team, state: SessionState, defaultWeight: number): number {
  const [idA, idB] = team
  const count = state.players.get(idA)?.partner_counts.get(idB) ?? 0
  if (count === 0) return 0
  const pA = state.players.get(idA)
  const pB = state.players.get(idB)
  const weight = areSameGroup(pA, pB) ? RECENT_INTRA_GROUP_PARTNER_REPEAT_WEIGHT : defaultWeight
  return count * weight
}

function computeGroupAwareOpponentPenalty(
  teamA: Team,
  teamB: Team,
  state: SessionState,
  defaultWeight: number,
): number {
  let total = 0
  for (const idA of teamA) {
    for (const idB of teamB) {
      const count = state.players.get(idA)?.opponent_counts.get(idB) ?? 0
      if (count === 0) continue
      const pA = state.players.get(idA)
      const pB = state.players.get(idB)
      const weight = areSameGroup(pA, pB) ? RECENT_INTRA_GROUP_OPPONENT_REPEAT_WEIGHT : defaultWeight
      total += count * weight
    }
  }
  return total
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
    allowRecentGroupRematch?: boolean
    intraTeamGapLimit?: number
    mustRestAt?: number
    partnerRepeatCap?: number
    opponentRepeatCap?: number
  } = {},
): MatchScore {
  const allPlayers = [...teamA, ...teamB]
  const uniquePlayers = new Set(allPlayers)

  if (teamA.length !== 2 || teamB.length !== 2 || uniquePlayers.size !== 4) {
    return INFINITY_SCORE
  }

  const teamA0 = state.players.get(teamA[0])
  const teamA1 = state.players.get(teamA[1])
  const teamB0 = state.players.get(teamB[0])
  const teamB1 = state.players.get(teamB[1])
  if (!teamA0 || !teamA1 || !teamB0 || !teamB1) return INFINITY_SCORE

  const teamAIntraGap = Math.abs(getEffectivePvna(teamA0) - getEffectivePvna(teamA1))
  const teamBIntraGap = Math.abs(getEffectivePvna(teamB0) - getEffectivePvna(teamB1))

  if (!options.allowIntraTeamGapOverflow) {
    const intraTeamGapLimit = options.intraTeamGapLimit ?? PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT
    if (teamAIntraGap > intraTeamGapLimit || teamBIntraGap > intraTeamGapLimit) {
      return INFINITY_SCORE
    }
  }

  const intraOverflowPenalty = options.allowIntraTeamGapOverflow
    ? (
        Math.max(0, teamAIntraGap - INTRA_TEAM_PVNA_GAP_LIMIT) +
        Math.max(0, teamBIntraGap - INTRA_TEAM_PVNA_GAP_LIMIT)
      ) * INTRA_OVERFLOW_WEIGHT
    : 0

  const teamAPvna = getEffectivePvna(teamA0) + getEffectivePvna(teamA1)
  const teamBPvna = getEffectivePvna(teamB0) + getEffectivePvna(teamB1)
  const pvnaDiff = Math.abs(teamAPvna - teamBPvna)
  const tolerance = options.tolerance ?? state.config.pvna_tolerance
  if (pvnaDiff > tolerance) return INFINITY_SCORE

  if (!options.allowRecentGroupRematch && hasRecentGroupRematch(teamA, teamB, state)) {
    return INFINITY_SCORE
  }

  const repeatCaps = (options.partnerRepeatCap != null || options.opponentRepeatCap != null)
    ? { partnerCap: options.partnerRepeatCap, opponentCap: options.opponentRepeatCap }
    : undefined
  if (!options.allowRepeatOverflow && hasRepeatOverflow(teamA, teamB, state, repeatCaps)) {
    return INFINITY_SCORE
  }

  // Hard block: avoid pairs as partners
  if (
    getAvoidPenalty(teamA0, teamA1, 'partner') === AVOID_PARTNER_PENALTY ||
    getAvoidPenalty(teamB0, teamB1, 'partner') === AVOID_PARTNER_PENALTY
  ) {
    return INFINITY_SCORE
  }

  const weights = options.weights ?? state.config.weights
  const stats = emptyStats(pvnaDiff)
  stats.partner_repeats = getPartnerRepeats(teamA, state) + getPartnerRepeats(teamB, state)
  stats.opponent_repeats = getOpponentRepeats(teamA, teamB, state)
  stats.group_bonus = getGroupedPartnerCount(teamA, teamB, state)
  stats.gender_pref_penalty = genderPenalty(teamA, teamB, state, weights)
  stats.consecutive_play_penalty = getConsecutivePlayPenalty([...teamA, ...teamB], state, weights.consecutive_play ?? 4, options.mustRestAt)
  const recentRepeatCost = getRecentRepeatCost(teamA, teamB, state)

  // Group-aware partner repeat penalty: intra-group pairs use weight=0 (they want to play together)
  const partnerRepeatScore =
    computeGroupAwarePartnerPenalty(teamA, state, weights.partner_repeat) +
    computeGroupAwarePartnerPenalty(teamB, state, weights.partner_repeat)

  // Group-aware opponent repeat penalty: intra-group opponents use a lower weight
  const opponentRepeatScore = computeGroupAwareOpponentPenalty(teamA, teamB, state, weights.opponent_repeat)

  // Soft penalty: avoid pairs as opponents (300 per direction)
  const avoidOpponentPenalty =
    getAvoidPenalty(teamA0, teamB0, 'opponent') +
    getAvoidPenalty(teamA0, teamB1, 'opponent') +
    getAvoidPenalty(teamA1, teamB0, 'opponent') +
    getAvoidPenalty(teamA1, teamB1, 'opponent')

  const intraGapSoftPenalty = (teamAIntraGap + teamBIntraGap) * INTRA_GAP_SOFT_WEIGHT

  const score =
    pvnaDiff * weights.pvna +
    partnerRepeatScore +
    opponentRepeatScore -
    stats.group_bonus * weights.group_bonus +
    stats.gender_pref_penalty +
    stats.consecutive_play_penalty +
    recentRepeatCost.total +
    avoidOpponentPenalty +
    intraGapSoftPenalty +
    intraOverflowPenalty

  return {
    score,
    stats,
  }
}
