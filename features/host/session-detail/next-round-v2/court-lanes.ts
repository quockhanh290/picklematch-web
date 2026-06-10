import type { SessionLiveMatchRow } from '@/lib/next-round-suggester/types'

type CourtIndexedMatch = Pick<SessionLiveMatchRow, 'id' | 'court_idx' | 'sequence_no'>

export type CourtLaneModel<TLive extends CourtIndexedMatch, TSuggested extends CourtIndexedMatch> = {
  courtIdx: number
  liveMatch: TLive | null
  suggestedMatch: TSuggested | null
}

function courtIndexFor(match: CourtIndexedMatch) {
  return Math.max(0, Number(match.court_idx ?? match.sequence_no ?? 0))
}

export function isPreviewBoardComplete<TMatch extends CourtIndexedMatch>({
  matches,
  expectedCount,
  replacementCourtIdxs,
}: {
  matches: TMatch[]
  expectedCount: number
  replacementCourtIdxs?: Iterable<number>
}) {
  const courts = new Set(matches.map(courtIndexFor))
  const replacementsFulfilled = replacementCourtIdxs
    ? [...replacementCourtIdxs].every(courtIdx => courts.has(courtIdx))
    : true
  return replacementsFulfilled && courts.size >= Math.max(0, Math.floor(expectedCount))
}

export function hasFulfilledReplacementCourts<TMatch extends CourtIndexedMatch>(
  matches: TMatch[],
  replacementCourtIdxs: Iterable<number>,
) {
  const courts = new Set(matches.map(courtIndexFor))
  return [...replacementCourtIdxs].every(courtIdx => courts.has(courtIdx))
}

export function getMissingPreviewCourtIdxs<TLive extends CourtIndexedMatch, TPreview extends CourtIndexedMatch>({
  courtCount,
  liveMatches,
  previewMatches,
}: {
  courtCount: number
  liveMatches: TLive[]
  previewMatches: TPreview[]
}) {
  const occupiedCourts = new Set(liveMatches.map(courtIndexFor))
  const previewCourts = new Set(previewMatches.map(courtIndexFor))
  return Array.from({ length: Math.max(1, Math.floor(courtCount)) }, (_, courtIdx) => courtIdx)
    .filter(courtIdx => !occupiedCourts.has(courtIdx) && !previewCourts.has(courtIdx))
}

export function getRequestedReplacementCourtIdxs({
  pendingReplacementCourtIdxs,
  missingPreviewCourtIdxs,
  limit,
}: {
  pendingReplacementCourtIdxs: Iterable<number>
  missingPreviewCourtIdxs: Iterable<number>
  limit: number
}) {
  const requested = new Set<number>()
  for (const courtIdx of pendingReplacementCourtIdxs) requested.add(courtIdx)
  for (const courtIdx of missingPreviewCourtIdxs) requested.add(courtIdx)
  return [...requested]
    .filter(courtIdx => Number.isFinite(courtIdx) && courtIdx >= 0)
    .slice(0, Math.max(0, Math.floor(limit)))
}

export function buildCourtLaneModels<TLive extends CourtIndexedMatch, TSuggested extends CourtIndexedMatch>({
  courtCount,
  liveMatches,
  suggestedMatches,
  liveYieldsToSuggested,
}: {
  courtCount: number
  liveMatches: TLive[]
  suggestedMatches: TSuggested[]
  liveYieldsToSuggested?: (liveMatch: TLive, suggestedMatch: TSuggested) => boolean
}): Array<CourtLaneModel<TLive, TSuggested>> {
  const safeCourtCount = Math.max(1, Math.floor(courtCount))
  const liveByCourt = new Map<number, TLive>()
  for (const match of liveMatches) {
    const courtIdx = courtIndexFor(match)
    if (!liveByCourt.has(courtIdx)) liveByCourt.set(courtIdx, match)
  }

  const suggestedByCourt = new Map<number, TSuggested>()
  for (const match of suggestedMatches) {
    const courtIdx = courtIndexFor(match)
    if (!suggestedByCourt.has(courtIdx)) suggestedByCourt.set(courtIdx, match)
  }

  return Array.from({ length: safeCourtCount }, (_, courtIdx) => {
    const liveMatch = liveByCourt.get(courtIdx) ?? null
    const suggestedMatch = suggestedByCourt.get(courtIdx) ?? null
    const shouldShowSuggested = Boolean(
      suggestedMatch
        && liveMatch
        && liveYieldsToSuggested?.(liveMatch, suggestedMatch),
    )
    return {
      courtIdx,
      liveMatch: shouldShowSuggested ? null : liveMatch,
      suggestedMatch: liveMatch && !shouldShowSuggested ? null : suggestedMatch,
    }
  })
}
