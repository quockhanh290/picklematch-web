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

export type DynamicThresholds = {
  mustRestAt: number
  mustPlayAt: number
  partnerRepeatCap: number
  opponentRepeatCap: number
  rematchBlockRounds: number
  nearRematchMinOverlap: number
}

export function computeDynamicThresholds(
  benchDepth: number,
  N: number,
  preset: 'balanced' | 'play_more' | 'relaxed' = 'balanced',
): DynamicThresholds {
  const presetRestBonus = preset === 'relaxed' ? 1 : 0
  // When bench is empty or negative, nobody can be forced to rest — there's no substitute.
  const mustRestAt =
    benchDepth <= 0
      ? Number.MAX_SAFE_INTEGER
      : Math.max(2, 1 + Math.ceil(benchDepth / 2)) + presetRestBonus
  return {
    mustRestAt,
    mustPlayAt: 1,
    partnerRepeatCap: Math.max(2, Math.ceil(N / 6)),
    opponentRepeatCap: Math.max(3, Math.ceil(N / 6) + 1),
    rematchBlockRounds: N <= 10 ? 1 : 2,
    nearRematchMinOverlap: N <= 8 ? 4 : 3,
  }
}

export type PlayerClassificationContext = {
  avgMatches: number
  matchBalance?: Map<string, number>
  thresholds?: DynamicThresholds
  phase?: 'warmup' | 'mid' | 'closing'
}

export function classifyPlayer(
  player: PlayerSessionState,
  context: PlayerClassificationContext,
  tierOverride?: Tier,
): Tier {
  if (tierOverride !== undefined) return tierOverride
  if (player.opted_rest) return Tier.OPTED_REST
  const mustPlayAt = context.thresholds?.mustPlayAt ?? 1
  const baseMustRestAt = context.thresholds?.mustRestAt ?? 2
  // Closing phase: nới mustRestAt để tăng số người eligible cho vòng cuối
  const mustRestAt = context.phase === 'closing' ? baseMustRestAt + 1 : baseMustRestAt
  if (player.consecutive_rest >= mustPlayAt) return Tier.MUST_PLAY
  if (player.matches_played === 0 && player.rounds_available >= 1) return Tier.MUST_PLAY

  const balance = context.matchBalance?.get(player.player_id)
  if (balance !== undefined) {
    if (balance < -1.5) return Tier.SHOULD_PLAY
    if (player.consecutive_play >= mustRestAt) return Tier.MUST_REST
    if (balance > 1.5) return Tier.SHOULD_REST
    return Tier.FLEXIBLE
  }

  if (player.matches_played < context.avgMatches - 1.5) return Tier.SHOULD_PLAY
  if (player.consecutive_play >= mustRestAt) return Tier.MUST_REST
  if (player.matches_played > context.avgMatches + 1.5) return Tier.SHOULD_REST
  return Tier.FLEXIBLE
}

export function getAverageMatches(players: PlayerSessionState[]): number {
  if (players.length === 0) return 0
  return players.reduce((sum, player) => sum + player.matches_played, 0) / players.length
}
