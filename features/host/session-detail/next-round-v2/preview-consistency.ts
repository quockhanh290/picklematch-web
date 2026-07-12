type PreviewRow = {
  status?: string | null
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
