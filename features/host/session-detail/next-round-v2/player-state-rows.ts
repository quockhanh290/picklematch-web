import type { SessionPlayerStateRow } from '@/lib/next-round-suggester/types'

export function mergePlayerStateRows(
  currentRows: SessionPlayerStateRow[],
  changedRows: SessionPlayerStateRow[],
): SessionPlayerStateRow[] {
  if (changedRows.length === 0) return currentRows
  const changedById = new Map(changedRows.map(row => [row.player_id, row]))
  return currentRows.map((current) => {
    const changed = changedById.get(current.player_id)
    if (!changed) return current
    return {
      ...current,
      ...changed,
      players: changed.players ?? current.players,
      session_players: changed.session_players ?? current.session_players,
    }
  })
}
