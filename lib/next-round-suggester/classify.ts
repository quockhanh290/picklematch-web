// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState } from './types.ts'

export const Tier = {
  MUST_PLAY: 0,
  SHOULD_PLAY: 1,
  FLEXIBLE: 2,
  SHOULD_REST: 3,
  MUST_REST: 4,
  OPTED_REST: 5,
}

export type Tier = (typeof Tier)[keyof typeof Tier]

export type PlayerClassificationContext = {
  avgMatches: number
  matchBalance?: Map<string, number>
}

export function classifyPlayer(
  player: PlayerSessionState,
  context: PlayerClassificationContext,
  tierOverride?: Tier,
): Tier {
  if (tierOverride !== undefined) return tierOverride
  if (player.opted_rest) return Tier.OPTED_REST
  if (player.consecutive_rest >= 1) return Tier.MUST_PLAY

  const balance = context.matchBalance?.get(player.player_id)
  if (balance !== undefined) {
    if (balance < -1.5) return Tier.SHOULD_PLAY
    if (player.consecutive_play >= 2) return Tier.MUST_REST
    if (balance > 1.5) return Tier.SHOULD_REST
    return Tier.FLEXIBLE
  }

  if (player.matches_played < context.avgMatches - 1.5) return Tier.SHOULD_PLAY
  if (player.consecutive_play >= 2) return Tier.MUST_REST
  if (player.matches_played > context.avgMatches + 1.5) return Tier.SHOULD_REST
  return Tier.FLEXIBLE
}

export function getAverageMatches(players: PlayerSessionState[]): number {
  if (players.length === 0) return 0
  return players.reduce((sum, player) => sum + player.matches_played, 0) / players.length
}
