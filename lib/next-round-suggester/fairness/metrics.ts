// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { Match, PlayerSessionState, SessionState, Team } from '../types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeRepeatPressure } from './pressure.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getBenchDepth, getSessionPhase } from '../state.ts'

export type MatchCountMetrics = {
  min: number
  max: number
  avg: number
  std: number
  range: number
  per_player: { player_id: string; matches_played: number }[]
}

export type DiversityMetrics = {
  avg_unique_partners: number
  avg_unique_opponents?: number
  avg_diversity_ratio: number
  per_player: {
    player_id: string
    unique_count: number
    diversity_ratio: number
    unique_partners?: number
    total_partnerships?: number
    unique_opponents?: number
    total_oppositions?: number
  }[]
  repeat_pairs: { player_a: string; player_b: string; count: number }[]
  cross_group_repeat_pairs?: { player_a: string; player_b: string; count: number }[]
  intra_group_repeat_pairs?: { player_a: string; player_b: string; count: number }[]
}

export type OpponentRepeatBurdenMetrics = {
  max_repeated_opponents: number
  avg_repeated_opponents: number
  per_player: {
    player_id: string
    repeated_opponents: number
    repeated_opponent_ids: string[]
  }[]
}

export type PartnerRepeatBurdenMetrics = {
  max_repeated_partners: number
  avg_repeated_partners: number
  per_player: {
    player_id: string
    repeated_partners: number
    repeated_partner_ids: string[]
  }[]
}

export type RestFairnessMetrics = {
  per_player: {
    player_id: string
    total_rests: number
    max_consecutive_rest: number
    rest_segments?: number
  }[]
  violations: { player_id: string; max_rest: number }[]
}

export type GenderPrefMetrics = {
  total_pref_opportunities: number
  satisfied_count: number
  satisfaction_rate: number
  unsatisfiable_opportunity_count: number
  per_player: {
    player_id: string
    partner_satisfaction_rate: number
    opponent_satisfaction_rate: number
  }[]
  unsatisfiable: { player_id: string; reason: string }[]
}

export type AvailabilityPressureLevel = 'low' | 'medium' | 'high' | 'extreme'

export type AvailabilityMetrics = {
  rounds_tracked: number
  avg_roster_size: number
  total_roster_changes: number
  avg_churn_ratio: number
  max_churn_ratio: number
  expected_match_delta_range: number
  churn_level: AvailabilityPressureLevel
  penalty_multiplier: number
  per_player: {
    player_id: string
    rounds_available: number
    expected_matches: number
    actual_matches: number
    delta_from_expected: number
  }[]
}

export type SessionFairnessScore = {
  total: number
  breakdown: {
    match_count: number
    partner_diversity: number
    opponent_diversity: number
    rest: number
    gender_prefs: number
  }
  grade: 'excellent' | 'good' | 'acceptable' | 'poor'
  group_satisfaction?: {
    total_groups: number
    groups_played_together_at_least_once: number
    rate: number
  }
}

export function computeMatchCountMetrics(state: SessionState): MatchCountMetrics {
  const eligiblePlayers = sortedPlayers(state).filter((player) => !player.opted_rest)
  const activePlayers = eligiblePlayers.filter((player) => player.checked_out_at === null)
  const scoredPlayers = activePlayers.length > 0 ? activePlayers : eligiblePlayers
  const perPlayer = scoredPlayers
    .map((player) => ({
      player_id: player.player_id,
      matches_played: player.matches_played,
    }))
  const values = perPlayer.map((player) => player.matches_played)
  const min = values.length === 0 ? 0 : Math.min(...values)
  const max = values.length === 0 ? 0 : Math.max(...values)

  return {
    min,
    max,
    avg: average(values),
    std: standardDeviation(values),
    range: max - min,
    per_player: perPlayer,
  }
}

export function computePartnerDiversity(state: SessionState): DiversityMetrics {
  const perPlayer = sortedPlayers(state).map((player) => {
    let intraGroupMatchCount = 0
    let crossGroupUniqueCount = 0
    let uniqueCount = 0
    let totalPartnerships = 0

    for (const [otherId] of player.partner_counts) {
      const count = getActiveRepeatCount(player, otherId, state, 'partner')
      if (count <= 0) continue
      uniqueCount += 1
      totalPartnerships += count
      const other = state.players.get(otherId)
      if (player.group_id && player.group_id === other?.group_id) {
        intraGroupMatchCount += count
      } else {
        crossGroupUniqueCount += 1
      }
    }

    const crossGroupMatchCount = player.matches_played - intraGroupMatchCount
    const crossGroupPoolSize = [...state.players.values()].filter(
      (other) =>
        other.player_id !== player.player_id &&
        other.checked_out_at === null &&
        !(player.group_id && player.group_id === other.group_id),
    ).length
    const actualRatio = crossGroupMatchCount <= 0 ? 1 : crossGroupUniqueCount / crossGroupMatchCount
    const achievable = computeAchievableRatio(crossGroupMatchCount, crossGroupPoolSize)
    const diversity_ratio = achievable === 0 ? 1 : Math.min(1, actualRatio / achievable)

    return {
      player_id: player.player_id,
      unique_count: uniqueCount,
      unique_partners: uniqueCount,
      total_partnerships: totalPartnerships,
      diversity_ratio,
    }
  })

  const splitPairs = collectSplitRepeatPairs(state, 'partner_counts')

  return {
    avg_unique_partners: average(perPlayer.map((player) => player.unique_count)),
    avg_diversity_ratio: average(perPlayer.map((player) => player.diversity_ratio)),
    per_player: perPlayer,
    repeat_pairs: splitPairs.cross_group,
    cross_group_repeat_pairs: splitPairs.cross_group,
    intra_group_repeat_pairs: splitPairs.intra_group,
  }
}

export function computeOpponentDiversity(state: SessionState): DiversityMetrics {
  const perPlayer = sortedPlayers(state).map((player) => {
    let intraGroupOpponentCount = 0
    let crossGroupUniqueCount = 0
    let uniqueCount = 0
    let totalOppositions = 0

    for (const [otherId] of player.opponent_counts) {
      const count = getActiveRepeatCount(player, otherId, state, 'opponent')
      if (count <= 0) continue
      uniqueCount += 1
      totalOppositions += count
      const other = state.players.get(otherId)
      if (player.group_id && player.group_id === other?.group_id) {
        intraGroupOpponentCount += count
      } else {
        crossGroupUniqueCount += 1
      }
    }

    const crossGroupExpectedOppositions = player.matches_played * 2 - intraGroupOpponentCount
    const crossGroupPoolSize = [...state.players.values()].filter(
      (other) =>
        other.player_id !== player.player_id &&
        other.checked_out_at === null &&
        !(player.group_id && player.group_id === other.group_id),
    ).length
    const actualRatio = crossGroupExpectedOppositions <= 0 ? 1 : crossGroupUniqueCount / crossGroupExpectedOppositions
    const achievable = computeAchievableRatio(crossGroupExpectedOppositions, crossGroupPoolSize)
    const diversity_ratio = achievable === 0 ? 1 : Math.min(1, actualRatio / achievable)

    return {
      player_id: player.player_id,
      unique_count: uniqueCount,
      unique_opponents: uniqueCount,
      total_oppositions: totalOppositions,
      diversity_ratio,
    }
  })
  const avgUnique = average(perPlayer.map((player) => player.unique_count))
  const splitPairs = collectSplitRepeatPairs(state, 'opponent_counts')

  return {
    avg_unique_partners: avgUnique,
    avg_unique_opponents: avgUnique,
    avg_diversity_ratio: average(perPlayer.map((player) => player.diversity_ratio)),
    per_player: perPlayer,
    repeat_pairs: splitPairs.cross_group,
    cross_group_repeat_pairs: splitPairs.cross_group,
    intra_group_repeat_pairs: splitPairs.intra_group,
  }
}

export function computeOpponentRepeatBurden(state: SessionState): OpponentRepeatBurdenMetrics {
  const perPlayer = sortedPlayers(state).map((player) => {
    const repeatedOpponentIds = [...player.opponent_counts.keys()]
      .filter((opponentId) => {
        const count = getActiveRepeatCount(player, opponentId, state, 'opponent')
        return isBurdenRepeat(player, state.players.get(opponentId), count, 'opponent')
      })
      .sort()

    return {
      player_id: player.player_id,
      repeated_opponents: repeatedOpponentIds.length,
      repeated_opponent_ids: repeatedOpponentIds,
    }
  })

  return {
    max_repeated_opponents: Math.max(0, ...perPlayer.map((player) => player.repeated_opponents)),
    avg_repeated_opponents: average(perPlayer.map((player) => player.repeated_opponents)),
    per_player: perPlayer,
  }
}

export function computePartnerRepeatBurden(state: SessionState): PartnerRepeatBurdenMetrics {
  const perPlayer = sortedPlayers(state).map((player) => {
    const repeatedPartnerIds = [...player.partner_counts.keys()]
      .filter((partnerId) => {
        const count = getActiveRepeatCount(player, partnerId, state, 'partner')
        return isBurdenRepeat(player, state.players.get(partnerId), count, 'partner')
      })
      .sort()

    return {
      player_id: player.player_id,
      repeated_partners: repeatedPartnerIds.length,
      repeated_partner_ids: repeatedPartnerIds,
    }
  })

  return {
    max_repeated_partners: Math.max(0, ...perPlayer.map((player) => player.repeated_partners)),
    avg_repeated_partners: average(perPlayer.map((player) => player.repeated_partners)),
    per_player: perPlayer,
  }
}

export function computeProjectedOpponentRepeatBurden(
  state: SessionState,
  matches: Match[],
): OpponentRepeatBurdenMetrics {
  const projected = new Map(
    sortedPlayers(state).map((player) => [
      player.player_id,
      new Map(player.opponent_counts),
    ]),
  )

  for (const match of matches) {
    for (const playerA of match.team_a) {
      for (const playerB of match.team_b) {
        const countsA = projected.get(playerA)
        const countsB = projected.get(playerB)
        if (countsA) countsA.set(playerB, (countsA.get(playerB) ?? 0) + 1)
        if (countsB) countsB.set(playerA, (countsB.get(playerA) ?? 0) + 1)
      }
    }
  }

  const perPlayer = [...projected.entries()]
    .map(([playerId, counts]) => {
      const repeatedOpponentIds = [...counts.entries()]
        .filter(([opponentId, count]) => isBurdenRepeat(state.players.get(playerId), state.players.get(opponentId), count, 'opponent'))
        .map(([opponentId]) => opponentId)
        .sort()

      return {
        player_id: playerId,
        repeated_opponents: repeatedOpponentIds.length,
        repeated_opponent_ids: repeatedOpponentIds,
      }
    })
    .sort((a, b) => a.player_id.localeCompare(b.player_id))

  return {
    max_repeated_opponents: Math.max(0, ...perPlayer.map((player) => player.repeated_opponents)),
    avg_repeated_opponents: average(perPlayer.map((player) => player.repeated_opponents)),
    per_player: perPlayer,
  }
}

export function computeProjectedPartnerRepeatBurden(
  state: SessionState,
  matches: Match[],
): PartnerRepeatBurdenMetrics {
  const projected = new Map(
    sortedPlayers(state).map((player) => [
      player.player_id,
      new Map(player.partner_counts),
    ]),
  )

  for (const match of matches) {
    for (const team of [match.team_a, match.team_b]) {
      const playerA = team[0]
      const playerB = team[1]
      const countsA = projected.get(playerA)
      const countsB = projected.get(playerB)
      if (countsA) countsA.set(playerB, (countsA.get(playerB) ?? 0) + 1)
      if (countsB) countsB.set(playerA, (countsB.get(playerA) ?? 0) + 1)
    }
  }

  const perPlayer = [...projected.entries()]
    .map(([playerId, counts]) => {
      const repeatedPartnerIds = [...counts.entries()]
        .filter(([partnerId, count]) => isBurdenRepeat(state.players.get(playerId), state.players.get(partnerId), count, 'partner'))
        .map(([partnerId]) => partnerId)
        .sort()

      return {
        player_id: playerId,
        repeated_partners: repeatedPartnerIds.length,
        repeated_partner_ids: repeatedPartnerIds,
      }
    })
    .sort((a, b) => a.player_id.localeCompare(b.player_id))

  return {
    max_repeated_partners: Math.max(0, ...perPlayer.map((player) => player.repeated_partners)),
    avg_repeated_partners: average(perPlayer.map((player) => player.repeated_partners)),
    per_player: perPlayer,
  }
}

function getActiveRepeatCount(
  player: PlayerSessionState,
  otherId: string,
  state: SessionState,
  type: 'partner' | 'opponent',
): number {
  const other = state.players.get(otherId)
  if (!other || other.checked_out_at !== null) return 0
  return type === 'partner'
    ? (player.partner_counts.get(otherId) ?? 0)
    : (player.opponent_counts.get(otherId) ?? 0)
}

function getEffectiveDiversityCredits(
  player: PlayerSessionState,
  state: SessionState,
  field: 'partner_counts' | 'opponent_counts',
): number {
  let credits = 0
  const type: 'partner' | 'opponent' = field === 'partner_counts' ? 'partner' : 'opponent'

  for (const [otherId] of player[field]) {
    const count = getActiveRepeatCount(player, otherId, state, type)
    if (count <= 0) continue
    const other = state.players.get(otherId)
    credits += getDiversityCredit(player, other, count)
  }

  return credits
}

function getDiversityCredit(
  player: PlayerSessionState,
  other: PlayerSessionState | undefined,
  count: number,
): number {
  if (count <= 0) return 0
  if (player.group_id && player.group_id === other?.group_id) {
    return Math.min(count, 2)
  }
  return 1
}

function isBurdenRepeat(
  player: PlayerSessionState | undefined,
  other: PlayerSessionState | undefined,
  count: number,
  type: 'partner' | 'opponent',
): boolean {
  if (count <= 1) return false
  const sameGroup = !!player?.group_id && player.group_id === other?.group_id
  if (type === 'partner' && sameGroup) return false
  if (sameGroup) return count > 4
  return count >= 2
}

export function computeRestFairness(state: SessionState): RestFairnessMetrics {
  const byPlayer = new Map(
    sortedPlayers(state).map((player) => [
      player.player_id,
      {
        player_id: player.player_id,
        total_rests: 0,
        max_consecutive_rest: 0,
        rest_segments: 0,
      },
    ]),
  )
  const currentRestRun = new Map([...byPlayer.keys()].map((playerId) => [playerId, 0]))

  for (const round of [...state.rounds].sort((a, b) => a.round_no - b.round_no)) {
    const roster = getRoundRoster(round)
    const resting = new Set(round.resting)
    // Only count rest-run increments from fully completed rounds.
    // Partial rounds (some courts still live) have an incomplete resting list:
    // players in live-but-not-finished courts appear as "resting" even though they're playing.
    const roundFullyCompleted = round.status === 'completed'

    for (const [playerId, metrics] of byPlayer) {
      if (!roster.has(playerId)) {
        currentRestRun.set(playerId, 0)
        continue
      }

      if (resting.has(playerId)) {
        if (roundFullyCompleted) {
          const nextRun = (currentRestRun.get(playerId) ?? 0) + 1
          currentRestRun.set(playerId, nextRun)
          metrics.total_rests += 1
          metrics.max_consecutive_rest = Math.max(metrics.max_consecutive_rest, nextRun)
          if (nextRun === 1) metrics.rest_segments += 1
        }
        // Partial round: don't increment — player may be live in a court not yet completed.
      } else {
        currentRestRun.set(playerId, 0)
      }
    }
  }

  // Extend the rest run by 1 when the current round is NOT yet in state.rounds (not started or
  // no match has completed yet) but players are already active in it (last_played_round updated).
  // Guard: skip when the active round is already tracked in state.rounds — in that case the main
  // loop above already processed it (or will once it completes).
  const activeRoundAlreadyTracked = state.rounds.some(r => r.round_no === state.current_round)
  const hasPlayersInCurrentRound = !activeRoundAlreadyTracked && [...state.players.values()].some(
    p => p.last_played_round >= state.current_round,
  )
  for (const [playerId, currentRun] of currentRestRun) {
    const metrics = byPlayer.get(playerId)
    const player = state.players.get(playerId)
    if (!metrics || !player) continue
    if (player.checked_out_at !== null || player.opted_rest) continue
    const extendedRun = hasPlayersInCurrentRound && currentRun > 0 && player.last_played_round < state.current_round
      ? currentRun + 1
      : currentRun
    metrics.max_consecutive_rest = Math.max(metrics.max_consecutive_rest, extendedRun)
  }

  const perPlayer = [...byPlayer.values()]

  return {
    per_player: perPlayer,
    violations: perPlayer
      .filter((player) => player.max_consecutive_rest > 1)
      .map((player) => ({ player_id: player.player_id, max_rest: player.max_consecutive_rest })),
  }
}

export function computeGenderPrefSatisfaction(state: SessionState): GenderPrefMetrics {
  let totalPrefOpportunities = 0
  let satisfiedCount = 0
  let unsatisfiableOpportunityCount = 0
  const perPlayerCounts = new Map<
    string,
    { partnerTotal: number; partnerSatisfied: number; opponentTotal: number; opponentSatisfied: number }
  >()

  for (const player of sortedPlayers(state)) {
    perPlayerCounts.set(player.player_id, {
      partnerTotal: 0,
      partnerSatisfied: 0,
      opponentTotal: 0,
      opponentSatisfied: 0,
    })
  }

  for (const round of state.rounds) {
    if (round.status !== 'completed' && round.status !== 'active') continue
    const roundRoster = getRoundRoster(round)
    const roundPlayers = [...roundRoster]
      .map(playerId => state.players.get(playerId))
      .filter((player): player is PlayerSessionState => player !== undefined)
    // Availability is historical per round; preference and gender use the current profile because
    // those fields are not snapshotted in RoundRecord.
    const unsatisfiableInRound = new Set(
      detectUnsatisfiableGenderPrefs(roundPlayers, false).map(item => item.player_id),
    )

    for (const match of round.matches) {
      const checks = getPreferenceChecks(match, state)

      for (const { player, target } of checks.partner) {
        if (player.partner_gender_pref === 'any' || !target?.gender) continue
        const counts = perPlayerCounts.get(player.player_id)
        if (!counts) continue
        if (unsatisfiableInRound.has(player.player_id)) {
          unsatisfiableOpportunityCount += 1
          continue
        }

        totalPrefOpportunities += 1
        counts.partnerTotal += 1
        if (target.gender === player.partner_gender_pref) {
          satisfiedCount += 1
          counts.partnerSatisfied += 1
        }
      }

      for (const { player, target } of checks.opponent) {
        if (player.opponent_gender_pref === 'any' || !target?.gender) continue
        const counts = perPlayerCounts.get(player.player_id)
        if (!counts) continue
        if (unsatisfiableInRound.has(player.player_id)) {
          unsatisfiableOpportunityCount += 1
          continue
        }

        totalPrefOpportunities += 1
        counts.opponentTotal += 1
        if (target.gender === player.opponent_gender_pref) {
          satisfiedCount += 1
          counts.opponentSatisfied += 1
        }
      }
    }
  }

  const unsatisfiable = detectUnsatisfiableGenderPrefs([...state.players.values()])

  return {
    total_pref_opportunities: totalPrefOpportunities,
    satisfied_count: satisfiedCount,
    satisfaction_rate: totalPrefOpportunities === 0 ? 1 : satisfiedCount / totalPrefOpportunities,
    unsatisfiable_opportunity_count: unsatisfiableOpportunityCount,
    per_player: [...perPlayerCounts]
      .map(([playerId, counts]) => ({
        player_id: playerId,
        partner_satisfaction_rate:
          counts.partnerTotal === 0 ? 1 : counts.partnerSatisfied / counts.partnerTotal,
        opponent_satisfaction_rate:
          counts.opponentTotal === 0 ? 1 : counts.opponentSatisfied / counts.opponentTotal,
      }))
      .sort((a, b) => a.player_id.localeCompare(b.player_id)),
    unsatisfiable,
  }
}

export function computeAvailabilityMetrics(state: SessionState): AvailabilityMetrics {
  const completedRounds = [...state.rounds]
    .filter((round) => round.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)
  const perPlayer = new Map(
    sortedPlayers(state).map((player) => [
      player.player_id,
      {
        player_id: player.player_id,
        rounds_available: 0,
        expected_matches: 0,
        actual_matches: player.matches_played,
        delta_from_expected: 0,
      },
    ]),
  )
  const rosterSizes: number[] = []
  const churnRatios: number[] = []
  let totalRosterChanges = 0
  let previousRoster: Set<string> | null = null

  for (const round of completedRounds) {
    const roster = getRoundRoster(round)
    rosterSizes.push(roster.size)

    if (previousRoster) {
      const changed = symmetricDifferenceSize(previousRoster, roster)
      totalRosterChanges += changed
      churnRatios.push(changed / Math.max(1, previousRoster.size, roster.size))
    }

    const slots = round.matches.length * 4
    const expectedShare = roster.size === 0 ? 0 : slots / roster.size
    for (const playerId of roster) {
      const row = perPlayer.get(playerId)
      if (!row) continue
      row.rounds_available += 1
      row.expected_matches += expectedShare
    }

    previousRoster = roster
  }

  const rows = [...perPlayer.values()].map((row) => ({
    ...row,
    expected_matches: round(row.expected_matches),
    delta_from_expected: round(row.actual_matches - row.expected_matches),
  }))
  const avgChurnRatio = average(churnRatios)
  const maxChurnRatio = Math.max(0, ...churnRatios)
  const deltaValues = rows.map((row) => row.delta_from_expected)
  const expectedMatchDeltaRange = deltaValues.length === 0
    ? 0
    : Math.max(...deltaValues) - Math.min(...deltaValues)
  const churnLevel = availabilityLevelFromChurn(avgChurnRatio, maxChurnRatio, totalRosterChanges, completedRounds.length)

  return {
    rounds_tracked: completedRounds.length,
    avg_roster_size: round(average(rosterSizes)),
    total_roster_changes: totalRosterChanges,
    avg_churn_ratio: round(avgChurnRatio),
    max_churn_ratio: round(maxChurnRatio),
    expected_match_delta_range: round(expectedMatchDeltaRange),
    churn_level: churnLevel,
    penalty_multiplier: AVAILABILITY_PENALTY_MULTIPLIER[churnLevel],
    per_player: rows.sort((a, b) => a.player_id.localeCompare(b.player_id)),
  }
}

export function computeSessionFairness(state: SessionState): SessionFairnessScore {
  const matchCount = computeMatchCountMetrics(state)
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const gender = computeGenderPrefSatisfaction(state)
  const repeatPressure = computeRepeatPressure(state)
  const availability = computeAvailabilityMetrics(state)
  const contextPenaltyMultiplier = repeatPressure.penalty_multiplier * availability.penalty_multiplier
  const completedRounds = countCompletedRounds(state)
  const phase = getSessionPhase(state, completedRounds)
  const isWarmup = phase === 'warmup'
  const benchDepth = getBenchDepth(state)
  const isClosing = phase === 'closing'
  const breakdown = {
    match_count: isWarmup
      ? 25
      : Math.max(
        computeContextAwareMatchCountScore(matchCount, availability.penalty_multiplier),
        computeAvailabilityMatchCountScore(availability),
      ) * (isClosing ? 30 / 25 : 1),
    partner_diversity: isWarmup ? 17 : computeContextAwareDiversityScore(partner, 17, contextPenaltyMultiplier),
    opponent_diversity: isWarmup ? 18 : computeContextAwareDiversityScore(opponent, 18, contextPenaltyMultiplier),
    rest: isWarmup ? 20 : computeRestScore(rest, benchDepth) * Math.max(0.6, availability.penalty_multiplier),
    gender_prefs: isWarmup ? 20 : computeGenderScore(gender),
  }
  const total =
    breakdown.match_count +
    breakdown.partner_diversity +
    breakdown.opponent_diversity +
    breakdown.rest +
    breakdown.gender_prefs

  return {
    total,
    breakdown,
    grade: gradeFromScore(total),
    group_satisfaction: computeGroupSatisfaction(state),
  }
}

function computeAchievableRatio(
  matchesPlayed: number,
  crossGroupPoolSize: number,
): number {
  if (matchesPlayed === 0) return 1
  return Math.min(1, crossGroupPoolSize / matchesPlayed)
}

function computeGroupSatisfaction(
  state: SessionState,
): { total_groups: number; groups_played_together_at_least_once: number; rate: number } {
  const groupMembers = new Map<string, string[]>()

  for (const player of state.players.values()) {
    if (!player.group_id) continue
    const members = groupMembers.get(player.group_id) ?? []
    members.push(player.player_id)
    groupMembers.set(player.group_id, members)
  }

  const validGroups = [...groupMembers.values()].filter((members) => members.length >= 2)
  let playedTogether = 0

  for (const members of validGroups) {
    const hasPlayed = members.some((memberId) => {
      const player = state.players.get(memberId)
      return members.some(
        (otherId) => otherId !== memberId && (player?.partner_counts.get(otherId) ?? 0) > 0,
      )
    })
    if (hasPlayed) playedTogether += 1
  }

  const totalGroups = validGroups.length

  return {
    total_groups: totalGroups,
    groups_played_together_at_least_once: playedTogether,
    rate: totalGroups === 0 ? 1 : playedTogether / totalGroups,
  }
}

function countCompletedRounds(state: SessionState): number {
  return state.rounds.filter((round) => round.status === 'completed').length
}

function computeMatchCountScore(metrics: MatchCountMetrics): number {
  const unavoidableRange = hasFractionalMatchDistribution(metrics) ? 1 : 0
  const excessRange = Math.max(0, metrics.range - unavoidableRange)
  return Math.max(0, 25 - excessRange * 10)
}

function computeContextAwareMatchCountScore(metrics: MatchCountMetrics, penaltyMultiplier: number): number {
  const rawScore = computeMatchCountScore(metrics)
  const rawPenalty = 25 - rawScore
  return Math.max(0, Math.min(25, Math.round(25 - rawPenalty * penaltyMultiplier)))
}

function computeAvailabilityMatchCountScore(metrics: AvailabilityMetrics): number {
  if (metrics.rounds_tracked === 0) return 25
  const excessRange = Math.max(0, metrics.expected_match_delta_range - 1)
  return Math.max(0, Math.min(25, Math.round(25 - excessRange * 10)))
}

function hasFractionalMatchDistribution(metrics: MatchCountMetrics): boolean {
  if (metrics.per_player.length === 0) return false
  return !Number.isInteger(metrics.avg)
}

function computeDiversityScore(metrics: DiversityMetrics, max: number): number {
  return Math.max(0, Math.min(max, Math.round(max * metrics.avg_diversity_ratio)))
}

function computeContextAwareDiversityScore(
  metrics: DiversityMetrics,
  max: number,
  penaltyMultiplier: number,
): number {
  const rawScore = computeDiversityScore(metrics, max)
  const rawPenalty = max - rawScore
  return Math.max(0, Math.min(max, Math.round(max - rawPenalty * penaltyMultiplier)))
}

function computeRestScore(metrics: RestFairnessMetrics, benchDepth: number): number {
  if (metrics.violations.length === 0) return 20
  const penaltyPerViolation = Math.max(3, 7 - Math.floor(benchDepth / 2))
  return Math.max(0, 20 - metrics.violations.length * penaltyPerViolation)
}

function computeGenderScore(metrics: GenderPrefMetrics): number {
  if (metrics.total_pref_opportunities <= 0) return 20
  return Math.max(0, Math.min(20, Math.round(20 * metrics.satisfaction_rate)))
}

function gradeFromScore(score: number): SessionFairnessScore['grade'] {
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  if (score >= 60) return 'acceptable'
  return 'poor'
}

function detectUnsatisfiableGenderPrefs(
  players: PlayerSessionState[],
  activeOnly = true,
): { player_id: string; reason: string }[] {
  const activePlayers = activeOnly
    ? players.filter((player) => player.checked_out_at === null)
    : players
  const counts = {
    M: activePlayers.filter((player) => player.gender === 'M').length,
    F: activePlayers.filter((player) => player.gender === 'F').length,
  }
  const wants = {
    M: activePlayers.filter((player) => player.partner_gender_pref === 'M'),
    F: activePlayers.filter((player) => player.partner_gender_pref === 'F'),
  }
  const unsatisfiable: { player_id: string; reason: string }[] = []

  for (const gender of ['M', 'F'] as const) {
    if (wants[gender].length > counts[gender] * 2) {
      const label = gender === 'F' ? 'nu' : 'nam'
      const reason = `${wants[gender].length} người muốn xếp cặp với ${label} nhưng chỉ có ${counts[gender]} ${label}`
      for (const player of wants[gender]) {
        unsatisfiable.push({ player_id: player.player_id, reason })
      }
    }
  }

  for (const player of activePlayers) {
    if (
      player.opponent_gender_pref !== 'any' &&
      counts[player.opponent_gender_pref] === 0
    ) {
      const label = player.opponent_gender_pref === 'F' ? 'nu' : 'nam'
      unsatisfiable.push({
        player_id: player.player_id,
        reason: `Không có đối thủ ${label} nào đang có mặt`,
      })
    }
  }

  return unsatisfiable.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason.localeCompare(b.reason)
    return a.player_id.localeCompare(b.player_id)
  })
}

type PreferenceCheck = {
  player: PlayerSessionState
  target: PlayerSessionState | undefined
}

function getPreferenceChecks(
  match: Match,
  state: SessionState,
): { partner: PreferenceCheck[]; opponent: PreferenceCheck[] } {
  return {
    partner: [
      getPartnerCheck(match.team_a, 0, state),
      getPartnerCheck(match.team_a, 1, state),
      getPartnerCheck(match.team_b, 0, state),
      getPartnerCheck(match.team_b, 1, state),
    ].filter((check): check is PreferenceCheck => check !== null),
    opponent: [
      ...getOpponentChecks(match.team_a, match.team_b, state),
      ...getOpponentChecks(match.team_b, match.team_a, state),
    ],
  }
}

function getPartnerCheck(
  team: Team,
  index: 0 | 1,
  state: SessionState,
): PreferenceCheck | null {
  const player = state.players.get(team[index])
  if (!player) return null

  return {
    player,
    target: state.players.get(team[index === 0 ? 1 : 0]),
  }
}

function getOpponentChecks(
  team: Team,
  opponents: Team,
  state: SessionState,
): PreferenceCheck[] {
  const checks: PreferenceCheck[] = []

  for (const playerId of team) {
    const player = state.players.get(playerId)
    if (!player) continue

    for (const opponentId of opponents) {
      checks.push({
        player,
        target: state.players.get(opponentId),
      })
    }
  }

  return checks
}

function collectSplitRepeatPairs(
  state: SessionState,
  field: 'partner_counts' | 'opponent_counts',
): {
  cross_group: { player_a: string; player_b: string; count: number }[]
  intra_group: { player_a: string; player_b: string; count: number }[]
} {
  const crossGroup = new Map<string, { player_a: string; player_b: string; count: number }>()
  const intraGroup = new Map<string, { player_a: string; player_b: string; count: number }>()
  const type: 'partner' | 'opponent' = field === 'partner_counts' ? 'partner' : 'opponent'

  for (const player of state.players.values()) {
    for (const [otherId] of player[field]) {
      if (!state.players.has(otherId)) continue
      const count = getActiveRepeatCount(player, otherId, state, type)
      if (count <= 1) continue

      const [playerA, playerB] =
        player.player_id < otherId ? [player.player_id, otherId] : [otherId, player.player_id]
      const key = `${playerA}:${playerB}`
      const other = state.players.get(otherId)
      const sameGroup = !!player.group_id && player.group_id === other?.group_id
      const target = sameGroup ? intraGroup : crossGroup
      const existing = target.get(key)
      target.set(key, { player_a: playerA, player_b: playerB, count: Math.max(existing?.count ?? 0, count) })
    }
  }

  const sortFn = (
    a: { player_a: string; player_b: string; count: number },
    b: { player_a: string; player_b: string; count: number },
  ) => {
    if (b.count !== a.count) return b.count - a.count
    return `${a.player_a}:${a.player_b}`.localeCompare(`${b.player_a}:${b.player_b}`)
  }

  return {
    cross_group: [...crossGroup.values()].sort(sortFn),
    intra_group: [...intraGroup.values()].sort(sortFn),
  }
}

function collectRepeatPairs(
  state: SessionState,
  field: 'partner_counts' | 'opponent_counts',
): { player_a: string; player_b: string; count: number }[] {
  const pairs = new Map<string, { player_a: string; player_b: string; count: number }>()

  for (const player of state.players.values()) {
    for (const [otherId, count] of player[field]) {
      if (count <= 1) continue
      if (!state.players.has(otherId)) continue

      const [playerA, playerB] =
        player.player_id < otherId ? [player.player_id, otherId] : [otherId, player.player_id]
      const key = `${playerA}:${playerB}`
      const existing = pairs.get(key)

      pairs.set(key, {
        player_a: playerA,
        player_b: playerB,
        count: Math.max(existing?.count ?? 0, count),
      })
    }
  }

  return [...pairs.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return `${a.player_a}:${a.player_b}`.localeCompare(`${b.player_a}:${b.player_b}`)
  })
}

const AVAILABILITY_PENALTY_MULTIPLIER: Record<AvailabilityPressureLevel, number> = {
  low: 1,
  medium: 0.85,
  high: 0.7,
  extreme: 0.55,
}

function availabilityLevelFromChurn(
  avgChurnRatio: number,
  maxChurnRatio: number,
  totalRosterChanges: number,
  roundsTracked: number,
): AvailabilityPressureLevel {
  if (roundsTracked < 2 || totalRosterChanges === 0) return 'low'
  if (avgChurnRatio > 0.3 || maxChurnRatio > 0.45) return 'extreme'
  if (avgChurnRatio > 0.18 || maxChurnRatio > 0.3) return 'high'
  if (avgChurnRatio > 0.08 || maxChurnRatio > 0.15) return 'medium'
  return 'low'
}

function getRoundRoster(round: { matches: Match[]; resting: string[] }): Set<string> {
  return new Set([
    ...round.matches.flatMap((match) => [...match.team_a, ...match.team_b]),
    ...round.resting,
  ])
}

function symmetricDifferenceSize(a: Set<string>, b: Set<string>): number {
  let changes = 0
  for (const item of a) {
    if (!b.has(item)) changes += 1
  }
  for (const item of b) {
    if (!a.has(item)) changes += 1
  }
  return changes
}

function sortedPlayers(state: SessionState): PlayerSessionState[] {
  return [...state.players.values()].sort((a, b) => a.player_id.localeCompare(b.player_id))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const avg = average(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function round(value: number): number {
  return Number(value.toFixed(2))
}
