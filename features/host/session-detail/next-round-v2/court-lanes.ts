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
