type PreviewRow = {
  status?: string | null
}

export function getSuggestedPreviewQueueCount({
  courtCount,
  capacityOccupyingMatchCount,
  completedMatchCount,
  persistedSuggestedMatchCount,
  previewAheadLimit,
}: {
  courtCount: number
  capacityOccupyingMatchCount: number
  completedMatchCount: number
  persistedSuggestedMatchCount: number
  previewAheadLimit: number
}) {
  const openCourtCount = Math.max(0, Math.floor(courtCount) - Math.max(0, capacityOccupyingMatchCount))
  if (completedMatchCount === 0) return openCourtCount

  // Let a larger bootstrap batch drain naturally. Reducing its target immediately would
  // cancel still-visible suggestions and recreate the stale-id race this limit avoids.
  return Math.min(
    openCourtCount,
    Math.max(Math.max(0, persistedSuggestedMatchCount), Math.max(0, previewAheadLimit)),
  )
}

export function mergePersistedSuggestionMetadata<T extends { suggestion_metadata?: Record<string, unknown> | null }>(row: T) {
  return {
    ...((row.suggestion_metadata && typeof row.suggestion_metadata === 'object')
      ? row.suggestion_metadata
      : {}),
    ...row,
  }
}

export function getLiveRowsForPreviewMode<T extends PreviewRow>(
  mode: 'full_board' | 'replace_courts',
  liveRows: T[],
  retainedPreviewRows: T[],
): T[] {
  if (mode === 'full_board') {
    return liveRows.filter(row => row.status !== 'suggested')
  }
  return [...liveRows, ...retainedPreviewRows]
}

export function isPreviewResponseCurrent({
  requestVersion,
  responseVersion,
  currentVersion,
  allowResponseAdvance = false,
}: {
  requestVersion: number | null
  responseVersion: number | null
  currentVersion: number | null
  allowResponseAdvance?: boolean
}) {
  if (requestVersion === null || responseVersion === null || currentVersion === null) return false
  if (allowResponseAdvance) {
    return requestVersion === currentVersion && responseVersion >= requestVersion
  }
  return requestVersion === responseVersion && responseVersion === currentVersion
}

export function isPreviewBatchCacheCurrent(cachedKey: string | null, laneCacheKey: string) {
  return cachedKey === laneCacheKey
}

export function isCommittedPreviewMatch({
  previewSource,
  matchId,
  committedBatchMatchIds,
  committedLaneMatchId,
  persistedSuggestedMatchId,
}: {
  previewSource?: string | null
  matchId: string
  committedBatchMatchIds: string[]
  committedLaneMatchId?: string | null
  persistedSuggestedMatchId?: string | null
}) {
  return previewSource === 'edge_committed'
    && (
      committedBatchMatchIds.includes(matchId)
      || committedLaneMatchId === matchId
      || persistedSuggestedMatchId === matchId
    )
}

export function isStartablePreviewRow(match: {
  id?: string | null
  status?: string | null
  team_a?: unknown
  team_b?: unknown
  court_idx?: unknown
}) {
  const courtIdx = Number(match.court_idx)
  return typeof match.id === 'string'
    && match.id.length > 0
    && match.status === 'suggested'
    && Array.isArray(match.team_a)
    && match.team_a.length === 2
    && Array.isArray(match.team_b)
    && match.team_b.length === 2
    && Number.isFinite(courtIdx)
}
