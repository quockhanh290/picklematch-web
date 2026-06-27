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
