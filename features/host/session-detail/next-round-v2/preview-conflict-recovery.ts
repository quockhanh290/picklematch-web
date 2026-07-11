type ConflictRow = {
  id: string
  status: string
  court_idx: number | null
  team_a: string[]
  team_b: string[]
}

export function classifyPersistAssignmentConflict({
  requestVersion,
  snapshotVersion,
  liveMatchRows,
}: {
  requestVersion: number
  snapshotVersion: number | null | undefined
  liveMatchRows: ConflictRow[]
}) {
  const authoritativeVersion = snapshotVersion === null || snapshotVersion === undefined
    ? null
    : Number(snapshotVersion)
  const hasAuthoritativeVersion = authoritativeVersion !== null
    && Number.isFinite(authoritativeVersion)
  const stateAdvanced = hasAuthoritativeVersion
    && authoritativeVersion > requestVersion
  const blockingMatches = liveMatchRows.filter(row =>
    row.status === 'live' || row.status === 'suggested'
  )

  return {
    stateAdvanced,
    authoritativeVersion: hasAuthoritativeVersion ? authoritativeVersion : null,
    conflictingMatchIds: blockingMatches.map(row => row.id),
    conflictingPlayerIds: [...new Set(
      blockingMatches.flatMap(row => [...row.team_a, ...row.team_b]).map(String),
    )],
    conflictingCourtIdxs: [...new Set(
      blockingMatches
        .map(row => row.court_idx)
        .filter((courtIdx): courtIdx is number => courtIdx !== null && Number.isFinite(courtIdx)),
    )],
  }
}
