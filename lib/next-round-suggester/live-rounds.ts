// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionLiveMatchRow } from './types.ts'

export type ReconstructedLiveRounds = {
  matches: SessionLiveMatchRow[]
  roundByMatchId: Map<string, number>
  persistedRoundNoReliable: boolean
}

function preferMatch(existing: SessionLiveMatchRow, candidate: SessionLiveMatchRow) {
  if (existing.status !== 'completed' && candidate.status === 'completed') return candidate
  return existing
}

function hasReliablePersistedRounds(matches: SessionLiveMatchRow[], roundSize: number) {
  const courtsByRound = new Map<number, Set<number>>()

  for (const match of matches) {
    if (match.round_no === null || match.round_no === undefined) return false
    const roundNo = Number(match.round_no)
    const courtIdx = Number(match.court_idx ?? match.sequence_no)
    if (!Number.isFinite(roundNo) || roundNo < 0 || !Number.isFinite(courtIdx)) return false

    const courts = courtsByRound.get(roundNo) ?? new Set<number>()
    if (courts.has(courtIdx)) return false
    courts.add(courtIdx)
    if (courts.size > roundSize) return false
    courtsByRound.set(roundNo, courts)
  }

  return true
}

export function reconstructLiveRounds(
  inputMatches: SessionLiveMatchRow[],
  roundSize: number,
): ReconstructedLiveRounds {
  const safeRoundSize = Math.max(1, Math.floor(roundSize || 1))
  const uniqueMatches = new Map<string, SessionLiveMatchRow>()

  for (const match of inputMatches) {
    if (match.status === 'cancelled') continue
    const existing = uniqueMatches.get(match.id)
    uniqueMatches.set(match.id, existing ? preferMatch(existing, match) : match)
  }

  const matches = [...uniqueMatches.values()].sort((left, right) => {
    if (left.sequence_no !== right.sequence_no) return left.sequence_no - right.sequence_no
    return left.id.localeCompare(right.id)
  })
  const persistedRoundNoReliable = hasReliablePersistedRounds(matches, safeRoundSize)
  const roundByMatchId = new Map(matches.map((match, index) => [
    match.id,
    persistedRoundNoReliable
      ? Number(match.round_no)
      : Math.floor(index / safeRoundSize),
  ]))

  return { matches, roundByMatchId, persistedRoundNoReliable }
}

export function getNextLiveRoundByCourt(
  inputMatches: SessionLiveMatchRow[],
  courtCount: number,
  courtIdxs: readonly number[],
) {
  const safeCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const reconstructed = reconstructLiveRounds(inputMatches, safeCourtCount)
  const roundCounts = new Map<number, number>()
  const lastCompletedRoundByCourt = new Map<number, number>()

  for (const match of reconstructed.matches) {
    const roundNo = reconstructed.roundByMatchId.get(match.id) ?? 0
    roundCounts.set(roundNo, (roundCounts.get(roundNo) ?? 0) + 1)
    if (match.status !== 'completed' || match.court_idx == null) continue
    const courtIdx = Number(match.court_idx)
    if (!Number.isFinite(courtIdx)) continue
    lastCompletedRoundByCourt.set(
      courtIdx,
      Math.max(lastCompletedRoundByCourt.get(courtIdx) ?? -1, roundNo),
    )
  }

  let projectedRound = 0
  if (roundCounts.size > 0) {
    const maxRound = Math.max(...roundCounts.keys())
    projectedRound = (roundCounts.get(maxRound) ?? 0) >= safeCourtCount
      ? maxRound + 1
      : maxRound
  }

  return new Map(courtIdxs.map(courtIdx => [
    courtIdx,
    (lastCompletedRoundByCourt.get(courtIdx) ?? (projectedRound - 1)) + 1,
  ]))
}
