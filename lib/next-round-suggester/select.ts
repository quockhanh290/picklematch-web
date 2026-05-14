// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { classifyPlayer, getAverageMatches, Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { isPresent } from './state.ts'
import type { PlayerSessionState, SessionState } from './types'

export type PickPlayersResult = {
  selected: PlayerSessionState[]
  resting: PlayerSessionState[]
  warnings: string[]
}

function comparePlayersByPriority(
  a: PlayerSessionState,
  b: PlayerSessionState,
  tiers: Map<string, Tier>,
): number {
  const tierDiff = (tiers.get(a.player_id) ?? Tier.FLEXIBLE) - (tiers.get(b.player_id) ?? Tier.FLEXIBLE)
  if (tierDiff !== 0) return tierDiff

  if (b.consecutive_rest !== a.consecutive_rest) {
    return b.consecutive_rest - a.consecutive_rest
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

export function pickPlayers(state: SessionState, slots = 4): PickPlayersResult {
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
  const tiers = new Map(
    presentPlayers.map((player) => [player.player_id, classifyPlayer(player, avgMatches)]),
  )
  const mustPlayCount = eligiblePlayers.filter(
    (player) => tiers.get(player.player_id) === Tier.MUST_PLAY,
  ).length

  if (mustPlayCount > slots) {
    warnings.push('MUST_PLAY_OVER_CAPACITY')
  }

  const sortedEligible = [...eligiblePlayers].sort((a, b) => comparePlayersByPriority(a, b, tiers))
  const selected = sortedEligible.slice(0, slots)
  const selectedIds = new Set(selected.map((player) => player.player_id))
  const resting = presentPlayers.filter((player) => !selectedIds.has(player.player_id))

  return {
    selected,
    resting,
    warnings,
  }
}

export function sortPlayersForStrategy(
  players: PlayerSessionState[],
  strategy: 'fairness' | 'rest' | 'diversity',
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

  const avgMatches = getAverageMatches(players)
  const tiers = new Map(players.map((player) => [player.player_id, classifyPlayer(player, avgMatches)]))
  return [...players].sort((a, b) => comparePlayersByPriority(a, b, tiers))
}
