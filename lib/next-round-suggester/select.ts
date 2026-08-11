// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { classifyPlayer, getAverageMatches, Tier, type PlayerClassificationContext } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeAvailabilityMetrics } from './fairness/metrics.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { AvailabilityMetrics } from './fairness/metrics.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna, isPresent } from './state.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState, SessionState } from './types.ts'

export type TierOverrides = Record<string, Tier>

export type PickPlayersResult = {
  selected: PlayerSessionState[]
  resting: PlayerSessionState[]
  warnings: string[]
}

// Exported for tests: BUG #14 is entirely about the order this produces.
export function comparePlayersByPriority(
  a: PlayerSessionState,
  b: PlayerSessionState,
  tiers: Map<string, Tier>,
  matchBalance: Map<string, number> = new Map(),
): number {
  const tierDiff = (tiers.get(a.player_id) ?? Tier.FLEXIBLE) - (tiers.get(b.player_id) ?? Tier.FLEXIBLE)
  if (tierDiff !== 0) return tierDiff

  if (b.consecutive_rest !== a.consecutive_rest) {
    return b.consecutive_rest - a.consecutive_rest
  }
  // Same consecutive_rest: prefer player who started resting earlier (smaller round number)
  // Prefer the session-wide position; the round-derived value counts cycles on one court, so comparing
  // it across two players can compare different courts' counters. Falls back while a database predates
  // the last_played_seq column.
  const aRestStart = a.last_rest_started_seq ?? a.last_rest_started_round ?? Infinity
  const bRestStart = b.last_rest_started_seq ?? b.last_rest_started_round ?? Infinity
  if (aRestStart !== bRestStart) {
    return aRestStart - bRestStart
  }

  const balanceA = matchBalance.get(a.player_id) ?? a.matches_played
  const balanceB = matchBalance.get(b.player_id) ?? b.matches_played
  if (balanceA !== balanceB) {
    return balanceA - balanceB
  }

  if (a.matches_played !== b.matches_played) {
    return a.matches_played - b.matches_played
  }

  // `last_played_round` is the round number of one court, and courts drift apart — court 3 can be on
  // round 2 while court 1 is on round 8. Comparing them ranks a player who just walked off a slow court
  // as having waited longer than someone idle since early on, which is backwards precisely when the
  // board is most uneven. `last_played_seq` is session-wide (from sequence_no, unique per session and
  // 0.886 correlated with wall time) and is used whenever the database has it.
  const aLast = a.last_played_seq ?? a.last_played_round
  const bLast = b.last_played_seq ?? b.last_played_round
  if (aLast !== bLast) {
    return aLast - bLast
  }

  const pvnaDiff = getEffectivePvna(a) - getEffectivePvna(b)
  if (pvnaDiff !== 0) return pvnaDiff

  return a.player_id.localeCompare(b.player_id)
}

export function getPresentPlayers(state: SessionState): PlayerSessionState[] {
  return [...state.players.values()]
    .filter(isPresent)
    .sort((a, b) => a.player_id.localeCompare(b.player_id))
}

export function pickPlayers(
  state: SessionState,
  slots = 4,
  tierOverrides: TierOverrides = {},
  classificationContext?: PlayerClassificationContext,
): PickPlayersResult {
  const warnings: string[] = []
  const presentPlayers = getPresentPlayers(state)
  const eligiblePlayers = presentPlayers.filter((player) => !player.opted_rest)

  if (eligiblePlayers.length < slots) {
    warnings.push('NOT_ENOUGH_PRESENT')
    return {
      selected: [],
      resting: presentPlayers,
      warnings,
    }
  }

  const avgMatches = getAverageMatches(eligiblePlayers)
  const context = classificationContext ?? {
    avgMatches,
    matchBalance: getMatchBalanceMap(state, eligiblePlayers, slots),
  }
  const matchBalance = context.matchBalance ?? new Map<string, number>()
  const tiers = new Map(
    presentPlayers.map((player) => [
      player.player_id,
      classifyPlayer(player, context, tierOverrides[player.player_id]),
    ]),
  )
  const mustPlayCount = eligiblePlayers.filter(
    (player) => tiers.get(player.player_id) === Tier.MUST_PLAY,
  ).length

  if (mustPlayCount > slots) {
    warnings.push('MUST_PLAY_OVER_CAPACITY')
  }

  const sortedEligible = [...eligiblePlayers].sort((a, b) => comparePlayersByPriority(a, b, tiers, matchBalance))
  const selected = sortedEligible.slice(0, slots)
  if (selected.some((player) => tiers.get(player.player_id) === Tier.MUST_REST)) {
    warnings.push('MUST_REST_FORCED_PLAY')
  }
  const selectedIds = new Set(selected.map((player) => player.player_id))
  const resting = presentPlayers.filter((player) => !selectedIds.has(player.player_id) && !player.opted_rest)

  return {
    selected,
    resting,
    warnings,
  }
}

export function sortPlayersForStrategy(
  players: PlayerSessionState[],
  strategy: 'fairness' | 'rest' | 'diversity' | 'group',
  tierOverrides: TierOverrides = {},
  classificationContext?: PlayerClassificationContext,
): PlayerSessionState[] {
  if (strategy === 'rest') {
    return [...players].sort((a, b) => {
      if (b.consecutive_rest !== a.consecutive_rest) return b.consecutive_rest - a.consecutive_rest
      if (a.consecutive_play !== b.consecutive_play) return a.consecutive_play - b.consecutive_play
      return a.player_id.localeCompare(b.player_id)
    })
  }

  if (strategy === 'diversity') {
    return [...players].sort((a, b) => {
      const repeatA =
        [...a.partner_counts.values()].reduce((sum, count) => sum + count, 0) +
        [...a.opponent_counts.values()].reduce((sum, count) => sum + count, 0)
      const repeatB =
        [...b.partner_counts.values()].reduce((sum, count) => sum + count, 0) +
        [...b.opponent_counts.values()].reduce((sum, count) => sum + count, 0)

      if (repeatA !== repeatB) return repeatA - repeatB
      if (a.matches_played !== b.matches_played) return a.matches_played - b.matches_played
      return a.player_id.localeCompare(b.player_id)
    })
  }

  if (strategy === 'group') {
    return [...players].sort((a, b) => {
      const groupNeedA = getUnservedGroupPartnerCount(a, players)
      const groupNeedB = getUnservedGroupPartnerCount(b, players)
      if (groupNeedA !== groupNeedB) return groupNeedB - groupNeedA
      if (a.matches_played !== b.matches_played) return a.matches_played - b.matches_played
      if (b.consecutive_rest !== a.consecutive_rest) return b.consecutive_rest - a.consecutive_rest
      return a.player_id.localeCompare(b.player_id)
    })
  }

  const context = classificationContext ?? { avgMatches: getAverageMatches(players) }
  const tiers = new Map(
    players.map((player) => [
      player.player_id,
      classifyPlayer(player, context, tierOverrides[player.player_id]),
    ]),
  )
  return [...players].sort((a, b) => comparePlayersByPriority(a, b, tiers, context.matchBalance))
}

export function getMatchBalanceMap(
  state: SessionState,
  players: PlayerSessionState[],
  slots: number,
): Map<string, number> {
  return getMatchBalanceFromAvailabilityMetrics(computeAvailabilityMetrics(state), players, slots)
}

export function getMatchBalanceFromAvailabilityMetrics(
  availability: AvailabilityMetrics,
  players: PlayerSessionState[],
  slots: number,
): Map<string, number> {
  const currentRoundExpectedShare = players.length === 0
    ? 0
    : Math.min(slots, players.length) / players.length

  if (availability.rounds_tracked > 0) {
    return new Map(
      availability.per_player.map((player) => [
        player.player_id,
        player.delta_from_expected - (players.some((item) => item.player_id === player.player_id) ? currentRoundExpectedShare : 0),
      ]),
    )
  }

  const avgMatches = getAverageMatches(players)
  return new Map(players.map((player) => [player.player_id, player.matches_played - avgMatches]))
}

function getUnservedGroupPartnerCount(player: PlayerSessionState, players: PlayerSessionState[]): number {
  if (!player.group_id) return 0

  return players.filter((other) =>
    other.player_id !== player.player_id &&
    other.group_id === player.group_id &&
    (player.partner_counts.get(other.player_id) ?? 0) === 0
  ).length
}
