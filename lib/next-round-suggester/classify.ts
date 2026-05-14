import type { PlayerSessionState } from './types'

export const Tier = {
  MUST_PLAY: 0,
  SHOULD_PLAY: 1,
  FLEXIBLE: 2,
  SHOULD_REST: 3,
  MUST_REST: 4,
  OPTED_REST: 5,
}

export type Tier = (typeof Tier)[keyof typeof Tier]

export function classifyPlayer(player: PlayerSessionState, avgMatches: number): Tier {
  if (player.opted_rest) return Tier.OPTED_REST
  if (player.consecutive_rest >= 1) return Tier.MUST_PLAY
  if (player.matches_played < avgMatches - 1.5) return Tier.SHOULD_PLAY
  if (player.consecutive_play >= 2) return Tier.MUST_REST
  if (player.matches_played > avgMatches + 1.5) return Tier.SHOULD_REST
  return Tier.FLEXIBLE
}

export function getAverageMatches(players: PlayerSessionState[]): number {
  if (players.length === 0) return 0
  return players.reduce((sum, player) => sum + player.matches_played, 0) / players.length
}
