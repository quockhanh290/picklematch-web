type IdentifiedRow = { id: string }

function isIdentifiedRow<T extends IdentifiedRow>(row: T | null | undefined): row is T {
  return row !== null && row !== undefined && typeof row.id === 'string' && row.id.length > 0
}

export function compactRowsById<T extends IdentifiedRow>(
  rows: ReadonlyArray<T | null | undefined>,
): T[] {
  return rows.filter(isIdentifiedRow)
}

export function mergeRowsById<T extends IdentifiedRow>(
  current: ReadonlyArray<T | null | undefined>,
  incoming: ReadonlyArray<T | null | undefined>,
): T[] {
  const byId = new Map<string, T>()
  for (const row of compactRowsById(current)) byId.set(row.id, row)
  for (const row of compactRowsById(incoming)) byId.set(row.id, row)
  return [...byId.values()]
}

export function withoutRowsById<T extends IdentifiedRow>(
  rows: ReadonlyArray<T | null | undefined>,
  ids: ReadonlySet<string>,
): T[] {
  return compactRowsById(rows).filter(row => !ids.has(row.id))
}

export function pruneOptimisticLiveMatchesByServerId<T extends IdentifiedRow>(
  current: ReadonlyArray<T | null | undefined>,
  serverRows: ReadonlyArray<IdentifiedRow | null | undefined>,
): T[] {
  if (current.length === 0) return []
  const compactCurrent = compactRowsById(current)
  const serverIds = new Set(compactRowsById(serverRows).map(match => match.id))
  const next = compactCurrent.filter(match => !serverIds.has(match.id))
  return next.length === compactCurrent.length ? compactCurrent : next
}
