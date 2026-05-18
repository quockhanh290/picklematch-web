import type { Match, PlayerSessionState, SessionState, Team } from '../types'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeRepeatPressure } from './pressure.ts'

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
}

export function computeMatchCountMetrics(state: SessionState): MatchCountMetrics {
  const perPlayer = sortedPlayers(state).map((player) => ({
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
    const counts = [...player.partner_counts.values()].filter((count) => count > 0)
    const uniqueCount = counts.length
    const totalPartnerships = counts.reduce((sum, count) => sum + count, 0)
    const effectivePartnerships = getEffectiveDiversityCredits(player, state, 'partner_counts')

    return {
      player_id: player.player_id,
      unique_count: uniqueCount,
      unique_partners: uniqueCount,
      total_partnerships: totalPartnerships,
      diversity_ratio: player.matches_played === 0
        ? 1
        : Math.min(1, effectivePartnerships / player.matches_played),
    }
  })

  return {
    avg_unique_partners: average(perPlayer.map((player) => player.unique_count)),
    avg_diversity_ratio: average(perPlayer.map((player) => player.diversity_ratio)),
    per_player: perPlayer,
    repeat_pairs: collectRepeatPairs(state, 'partner_counts'),
  }
}

export function computeOpponentDiversity(state: SessionState): DiversityMetrics {
  const perPlayer = sortedPlayers(state).map((player) => {
    const counts = [...player.opponent_counts.values()].filter((count) => count > 0)
    const uniqueCount = counts.length
    const totalOppositions = counts.reduce((sum, count) => sum + count, 0)
    const expectedOppositions = player.matches_played * 2
    const effectiveOppositions = getEffectiveDiversityCredits(player, state, 'opponent_counts')

    return {
      player_id: player.player_id,
      unique_count: uniqueCount,
      unique_opponents: uniqueCount,
      total_oppositions: totalOppositions,
      diversity_ratio: expectedOppositions === 0
        ? 1
        : Math.min(1, effectiveOppositions / expectedOppositions),
    }
  })
  const avgUnique = average(perPlayer.map((player) => player.unique_count))

  return {
    avg_unique_partners: avgUnique,
    avg_unique_opponents: avgUnique,
    avg_diversity_ratio: average(perPlayer.map((player) => player.diversity_ratio)),
    per_player: perPlayer,
    repeat_pairs: collectRepeatPairs(state, 'opponent_counts'),
  }
}

export function computeOpponentRepeatBurden(state: SessionState): OpponentRepeatBurdenMetrics {
  const perPlayer = sortedPlayers(state).map((player) => {
    const repeatedOpponentIds = [...player.opponent_counts.entries()]
      .filter(([opponentId, count]) => isBurdenRepeat(player, state.players.get(opponentId), count))
      .map(([opponentId]) => opponentId)
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
    const repeatedPartnerIds = [...player.partner_counts.entries()]
      .filter(([partnerId, count]) => isBurdenRepeat(player, state.players.get(partnerId), count))
      .map(([partnerId]) => partnerId)
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
        .filter(([opponentId, count]) => isBurdenRepeat(state.players.get(playerId), state.players.get(opponentId), count))
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
        .filter(([partnerId, count]) => isBurdenRepeat(state.players.get(playerId), state.players.get(partnerId), count))
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

function getEffectiveDiversityCredits(
  player: PlayerSessionState,
  state: SessionState,
  field: 'partner_counts' | 'opponent_counts',
): number {
  let credits = 0

  for (const [otherId, count] of player[field]) {
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
): boolean {
  if (count <= 1) return false
  if (player?.group_id && player.group_id === other?.group_id) {
    return count > 2
  }
  return true
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

    for (const [playerId, metrics] of byPlayer) {
      if (!roster.has(playerId)) {
        currentRestRun.set(playerId, 0)
        continue
      }

      if (resting.has(playerId)) {
        const nextRun = (currentRestRun.get(playerId) ?? 0) + 1
        currentRestRun.set(playerId, nextRun)
        metrics.total_rests += 1
        metrics.max_consecutive_rest = Math.max(metrics.max_consecutive_rest, nextRun)
        if (nextRun === 1) metrics.rest_segments += 1
      } else {
        currentRestRun.set(playerId, 0)
      }
    }
  }

  for (const player of sortedPlayers(state)) {
    const metrics = byPlayer.get(player.player_id)
    if (!metrics) continue
    if (player.checked_out_at !== null || player.opted_rest) continue
    metrics.max_consecutive_rest = Math.max(metrics.max_consecutive_rest, player.consecutive_rest)
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

    for (const match of round.matches) {
      const checks = getPreferenceChecks(match, state)

      for (const { player, target } of checks.partner) {
        if (player.partner_gender_pref === 'any' || !target?.gender) continue
        const counts = perPlayerCounts.get(player.player_id)
        if (!counts) continue

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

        totalPrefOpportunities += 1
        counts.opponentTotal += 1
        if (target.gender === player.opponent_gender_pref) {
          satisfiedCount += 1
          counts.opponentSatisfied += 1
        }
      }
    }
  }

  return {
    total_pref_opportunities: totalPrefOpportunities,
    satisfied_count: satisfiedCount,
    satisfaction_rate: totalPrefOpportunities === 0 ? 1 : satisfiedCount / totalPrefOpportunities,
    per_player: [...perPlayerCounts]
      .map(([playerId, counts]) => ({
        player_id: playerId,
        partner_satisfaction_rate:
          counts.partnerTotal === 0 ? 1 : counts.partnerSatisfied / counts.partnerTotal,
        opponent_satisfaction_rate:
          counts.opponentTotal === 0 ? 1 : counts.opponentSatisfied / counts.opponentTotal,
      }))
      .sort((a, b) => a.player_id.localeCompare(b.player_id)),
    unsatisfiable: detectUnsatisfiableGenderPrefs([...state.players.values()]),
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
  const isWarmup = completedRounds < 3
  const breakdown = {
    match_count: isWarmup
      ? 25
      : Math.max(
        computeContextAwareMatchCountScore(matchCount, availability.penalty_multiplier),
        computeAvailabilityMatchCountScore(availability),
      ),
    partner_diversity: isWarmup ? 20 : computeContextAwareDiversityScore(partner, 20, contextPenaltyMultiplier),
    opponent_diversity: isWarmup ? 15 : computeContextAwareDiversityScore(opponent, 15, contextPenaltyMultiplier),
    rest: computeRestScore(rest),
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

function computeRestScore(metrics: RestFairnessMetrics): number {
  if (metrics.violations.length === 0) return 20
  return Math.max(0, 20 - metrics.violations.length * 10)
}

function computeGenderScore(metrics: GenderPrefMetrics): number {
  if (metrics.total_pref_opportunities === 0) return 20
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
): { player_id: string; reason: string }[] {
  const activePlayers = players.filter((player) => player.checked_out_at === null)
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
      const reason = `${wants[gender].length} nguoi muon partner ${label} nhung chi co ${counts[gender]} ${label}`
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
        reason: `Khong co doi thu ${label} nao dang co mat`,
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
