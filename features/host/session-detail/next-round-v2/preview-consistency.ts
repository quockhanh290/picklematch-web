import type { SessionState } from '@/lib/next-round-suggester/types'
import { getSuggestedMatchPvnaGap } from './preview-helpers'

type PreviewRow = {
  status?: string | null
}

type PreviewLaneRow = PreviewRow & {
  court_idx?: unknown
  sequence_no?: unknown
}

function previewCourtIndex(row: PreviewLaneRow) {
  const courtIdx = Number(row.court_idx ?? row.sequence_no)
  return Number.isFinite(courtIdx) && courtIdx >= 0 ? courtIdx : null
}

export function mergePreviewLaneCandidates<T extends PreviewLaneRow>({
  cachedMatches,
  visibleMatches,
  persistedMatches,
}: {
  cachedMatches: Iterable<[number, T]>
  visibleMatches: T[]
  persistedMatches: T[]
}) {
  const candidates = new Map<number, T>()
  for (const [courtIdx, match] of cachedMatches) {
    if (Number.isFinite(courtIdx) && courtIdx >= 0 && !candidates.has(courtIdx)) {
      candidates.set(courtIdx, match)
    }
  }
  for (const matches of [visibleMatches, persistedMatches]) {
    for (const match of matches) {
      const courtIdx = previewCourtIndex(match)
      if (courtIdx !== null && !candidates.has(courtIdx)) candidates.set(courtIdx, match)
    }
  }
  return candidates
}

export function getSuggestedPreviewQueueCount({
  courtCount,
  capacityOccupyingMatchCount,
}: {
  courtCount: number
  capacityOccupyingMatchCount: number
}) {
  // Every idle physical lane needs a startable suggestion. A lane that just became
  // idle is current work, not preview-ahead capacity.
  return Math.max(0, Math.floor(courtCount) - Math.max(0, capacityOccupyingMatchCount))
}

export function hasMissingRestPriorityPlayer({
  players,
  assignedPlayerIds,
  pvnaTolerance,
}: {
  players: Array<{
    player_id: string
    consecutive_rest: number
    opted_rest: boolean
    checked_out_at: unknown
    pvna: number
  }>
  assignedPlayerIds: Set<string>
  pvnaTolerance: number
}) {
  const unassignedActive = players.filter(player =>
    player.checked_out_at === null
    && !player.opted_rest
    && !assignedPlayerIds.has(player.player_id)
  )
  return unassignedActive.some(player => {
    if (player.consecutive_rest < 1) return false
    // Balance-justified deferral: a rest-priority player with no near-level partner left in the
    // unassigned pool can only be seated by forcing a lopsided (blowout) court, so the engine
    // deliberately rests them (deferLowViabilityRequiredIdsForCourt). Don't count that as a "miss"
    // — doing so forces an unwinnable full-board re-suggest and leaves lanes stuck. Only flag a
    // rest-priority player who actually has a near-level partner available to pair with.
    return unassignedActive.some(other =>
      other.player_id !== player.player_id
      && Math.abs(other.pvna - player.pvna) <= pvnaTolerance
    )
  })
}

export function mergePersistedSuggestionMetadata<T extends { suggestion_metadata?: Record<string, unknown> | null }>(row: T) {
  return {
    ...((row.suggestion_metadata && typeof row.suggestion_metadata === 'object')
      ? row.suggestion_metadata
      : {}),
    ...row,
  }
}

export function hasPendingPlanAdoption(rows: Array<{
  plan_adoption_pending?: unknown
  suggestion_metadata?: Record<string, unknown> | null
}>) {
  return rows.some(row => {
    const pendingPlanVersion = row.plan_adoption_pending
      ?? row.suggestion_metadata?.plan_adoption_pending
    return typeof pendingPlanVersion === 'string' && pendingPlanVersion.length > 0
  })
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
    return responseVersion >= requestVersion && currentVersion <= responseVersion
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
  if (previewSource === 'session_plan') {
    return persistedSuggestedMatchId === matchId
  }
  return previewSource === 'edge_committed'
    && (
      committedBatchMatchIds.includes(matchId)
      || committedLaneMatchId === matchId
      || persistedSuggestedMatchId === matchId
    )
}

export function isServerPersistedPreviewSource(previewSource?: string | null) {
  return previewSource === 'edge_committed' || previewSource === 'session_plan'
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

type PreviewQualityMatch = {
  round_no?: number | string | null
  team_a: [string, string]
  team_b: [string, string]
}

export function hasHardPreviewQualityViolation(
  match: PreviewQualityMatch,
  state: SessionState,
  pvnaTolerance: number,
) {
  const roundNo = Number(match.round_no ?? 0)
  const isEarlyOrMidRound = roundNo < 5

  // NEVER reject on intra-team gap alone, at any round. A wide-PVNA pool — and the live per-court
  // flow that fills lanes incrementally — forces strong+weak pairing to keep the team TOTALS
  // balanced. A balanced (competitive) match with mixed-strength teams is a GOOD outcome, not a
  // defect; a fixed intra cap (even a relaxed 2x) still rejects the structurally-necessary lineup
  // when the pool spread exceeds it (observed intra 2.57 at gap 0.39 on round 4), leaving the last
  // lane unfillable and thrashing the board into an under-filled round. We reject only on the
  // team-total axis (a real blowout), never on intra. Early/mid rounds keep a tighter total-gap
  // threshold since the pool has more room to stay balanced; late rounds allow more.
  const pvnaGap = getSuggestedMatchPvnaGap(match, state)
  const pvnaOverBy = pvnaGap - pvnaTolerance
  if (pvnaOverBy > 1) return true

  if (!isEarlyOrMidRound) return false

  return pvnaOverBy > 0.25
}

type PreviewBoardQualityMatch = PreviewQualityMatch & {
  id: string
  available_pool_only?: boolean
}

// A PERSISTED (committed) suggestion is a startable board slot the host already has. Its
// intra-team gap can be structurally unavoidable in a wide-PVNA pool (balancing team totals
// forces a high+low pairing), so treating it as a "hard violation" would escalate every cycle
// into a full-board re-suggest that can never converge to an all-clean board. Only fresh,
// not-yet-committed previews should force a full-board re-suggest.
export function computeHasGenuinePreviewQualityViolation({
  previewBoard,
  persistedSuggestedMatchIds,
  state,
  pvnaTolerance,
}: {
  previewBoard: PreviewBoardQualityMatch[]
  persistedSuggestedMatchIds: Set<string>
  state: SessionState
  pvnaTolerance: number
}) {
  return previewBoard.some(match =>
    !persistedSuggestedMatchIds.has(match.id)
    && !match.available_pool_only
    && hasHardPreviewQualityViolation(match, state, pvnaTolerance)
  )
}

// A rest-priority miss only forces a full-board re-optimization when the board is already full.
// If a lane is empty, mini-recover fills it from the unassigned pool — which seats the very
// rest-priority players that are "missing" — so blocking recovery there just leaves the lane
// stuck. Genuine bad-match violations still force a full re-suggest.
export function shouldRestMissForceFullBoard({
  hasRestPriorityMiss,
  missingPreviewCourtIdxsForRecoveryCount,
}: {
  hasRestPriorityMiss: boolean
  missingPreviewCourtIdxsForRecoveryCount: number
}) {
  return hasRestPriorityMiss && missingPreviewCourtIdxsForRecoveryCount === 0
}

export function canRecoverMissingPreviewCourts({
  hasGenuinePreviewQualityViolation,
  missingPreviewCourtIdxsForRecoveryCount,
  reusableMatchCount,
  suggestedQueueCount,
}: {
  hasGenuinePreviewQualityViolation: boolean
  missingPreviewCourtIdxsForRecoveryCount: number
  reusableMatchCount: number
  suggestedQueueCount: number
}) {
  return !hasGenuinePreviewQualityViolation
    && missingPreviewCourtIdxsForRecoveryCount > 0
    && reusableMatchCount < suggestedQueueCount
}

export function computeShouldRequestFullBoardPreview({
  pendingPlanAdoption,
  hasGenuinePreviewQualityViolation,
  restMissForcesFullBoard,
  reusableMatchCount,
  shouldRecoverMissingPreviewCourts,
  missingPreviewCourtIdxsForRecoveryCount,
  replacementMaxCount,
}: {
  pendingPlanAdoption: boolean
  hasGenuinePreviewQualityViolation: boolean
  restMissForcesFullBoard: boolean
  reusableMatchCount: number
  shouldRecoverMissingPreviewCourts: boolean
  missingPreviewCourtIdxsForRecoveryCount: number
  replacementMaxCount: number
}) {
  return pendingPlanAdoption
    || hasGenuinePreviewQualityViolation
    || restMissForcesFullBoard
    // No reusable suggestions normally means "rebuild the board" — but NOT when the only gap is a few
    // open lanes that mini-recover (replace_courts) can fill. With live matches occupying the other
    // courts, a full_board re-persists their already-assigned players → "already assigned" conflict →
    // the empty lane stays stuck. Recover the open lanes in-place instead (still full_board when the
    // gap is larger than replace_courts can cover, handled by the next clause).
    || (reusableMatchCount === 0 && !shouldRecoverMissingPreviewCourts)
    || (shouldRecoverMissingPreviewCourts && missingPreviewCourtIdxsForRecoveryCount > replacementMaxCount)
}
