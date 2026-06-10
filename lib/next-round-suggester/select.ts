// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { classifyPlayer, getAverageMatches, Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeAvailabilityMetrics } from './fairness/metrics.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { isPresent } from './state.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState, SessionState } from './types.ts'

export type TierOverrides = Record<string, Tier>

export type PickPlayersResult = {
  selected: PlayerSessionState[]
  resting: PlayerSessionState[]
  warnings: string[]
}

function comparePlayersByPriority(
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

  const balanceA = matchBalance.get(a.player_id) ?? a.matches_played
  const balanceB = matchBalance.get(b.player_id) ?? b.matches_played
  if (balanceA !== balanceB) {
    return balanceA - balanceB
  }

  if (a.matches_played !== b.matches_played) {
    return a.matches_played - b.matches_played
  }

  if (a.last_played_round !== b.last_played_round) {
    return a.last_played_round - b.last_played_round
  }

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
  const matchBalance = getMatchBalanceMap(state, eligiblePlayers, slots)
  const tiers = new Map(
    presentPlayers.map((player) => [
      player.player_id,
      classifyPlayerForSelection(player, avgMatches, matchBalance, tierOverrides[player.player_id]),
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

  const avgMatches = getAverageMatches(players)
  const tiers = new Map(
    players.map((player) => [
      player.player_id,
      classifyPlayer(player, avgMatches, tierOverrides[player.player_id]),
    ]),
  )
  return [...players].sort((a, b) => comparePlayersByPriority(a, b, tiers))
}

function classifyPlayerForSelection(
  player: PlayerSessionState,
  avgMatches: number,
  matchBalance: Map<string, number>,
  override?: Tier,
): Tier {
  if (override !== undefined) return override
  if (player.opted_rest) return Tier.OPTED_REST
  if (player.consecutive_rest >= 1) return Tier.MUST_PLAY

  const balance = matchBalance.get(player.player_id)
  if (balance !== undefined) {
    if (balance < -1.5) return Tier.SHOULD_PLAY
    if (player.consecutive_play >= 2) return Tier.MUST_REST
    if (balance > 1.5) return Tier.SHOULD_REST
    return Tier.FLEXIBLE
  }

  return classifyPlayer(player, avgMatches, override)
}

function getMatchBalanceMap(
  state: SessionState,
  players: PlayerSessionState[],
  slots: number,
): Map<string, number> {
  const availability = computeAvailabilityMetrics(state)
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
