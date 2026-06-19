// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState } from './types.ts'

export const AVOID_PARTNER_PENALTY = Infinity
export const AVOID_OPPONENT_PENALTY = 300

export function isAvoidPair(
  a: PlayerSessionState,
  b: PlayerSessionState,
): boolean {
  return (a.avoid_ids?.has(b.player_id) ?? false) || (b.avoid_ids?.has(a.player_id) ?? false)
}

export function getAvoidPenalty(
  a: PlayerSessionState,
  b: PlayerSessionState,
  relationship: 'partner' | 'opponent',
): number {
  if (!isAvoidPair(a, b)) return 0
  return relationship === 'partner' ? AVOID_PARTNER_PENALTY : AVOID_OPPONENT_PENALTY
}
