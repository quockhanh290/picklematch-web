export function pruneOptimisticLiveMatchesByServerId<T extends { id: string }>(
  current: T[],
  serverRows: Array<{ id: string }>,
): T[] {
  if (current.length === 0) return current
  const serverIds = new Set(serverRows.map(match => match.id))
  const next = current.filter(match => !serverIds.has(match.id))
  return next.length === current.length ? current : next
}
