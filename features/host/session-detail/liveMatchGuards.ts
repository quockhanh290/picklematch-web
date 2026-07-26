import type { SessionLiveMatchRow } from '@/lib/next-round-suggester/types'

export function getMatchPlayerIds(match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>): string[] {
  return [...match.team_a.map(String), ...match.team_b.map(String)]
}

export function isSameCourtAndPlayers(
  left: Pick<SessionLiveMatchRow, 'court_idx' | 'team_a' | 'team_b'>,
  right: Pick<SessionLiveMatchRow, 'court_idx' | 'team_a' | 'team_b'>,
) {
  if (Number(left.court_idx ?? -1) !== Number(right.court_idx ?? -1)) return false
  const leftPlayers = getMatchPlayerIds(left).sort()
  const rightPlayers = getMatchPlayerIds(right).sort()
  return leftPlayers.length === rightPlayers.length
    && leftPlayers.every((playerId, index) => playerId === rightPlayers[index])
}

/**
 * Idempotency backstops for the complete / cancel actions, mirroring the start path's
 * "already committed → reconcile silently" check. After the coarse `live_state_version`
 * CAS was removed, these actions no longer fail with a retryable 'Session changed'; a
 * dropped response (flaky mobile) or a second device makes the RPC raise a specific error
 * (`Only live matches can be completed`, `Only suggested/live matches can be cancelled`)
 * even though the action actually landed. These helpers detect that from a fresh snapshot.
 *
 * NOTE: the live snapshot RPC (`get_live_session_snapshot_versioned`) returns ALL rows
 * including `cancelled` ones (it selects * with no status filter). A cancelled match is
 * therefore usually PRESENT with status='cancelled'; it may also be absent (pruned). Cancel
 * treats both "present but no longer live/suggested" and "gone" as the done state.
 */
export function completeAlreadyApplied(
  rows: Pick<SessionLiveMatchRow, 'id' | 'status'>[],
  matchId: string,
): boolean {
  const row = rows.find((r) => r.id === matchId)
  return row?.status === 'completed'
}

export function cancelAlreadyApplied(
  rows: Pick<SessionLiveMatchRow, 'id' | 'status'>[],
  matchId: string,
): boolean {
  const row = rows.find((r) => r.id === matchId)
  // Present in a terminal/non-actionable state (e.g. status='cancelled') or absent entirely
  // means the match is no longer a live/suggested board slot — the cancel goal is met.
  return !row || (row.status !== 'live' && row.status !== 'suggested')
}

export function shouldInvalidatePreviewAfterStartError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  return message.includes('Session changed')
    || message.includes('Preview is stale')
    || message.includes('Preview version')
    || message.includes('A player is already in a live match')
    || message.includes('Court already has a live match')
    || message.includes('available checked-in players')
}
