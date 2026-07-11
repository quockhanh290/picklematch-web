import type { SessionLiveMatchRow } from './types'

export type ReconstructedLiveRounds = {
  matches: SessionLiveMatchRow[]
  roundByMatchId: Map<string, number>
  canonicalCycleNoAvailable: boolean
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

function hasCanonicalCycles(matches: SessionLiveMatchRow[]) {
  return matches.every(match => {
    if (match.cycle_no === null || match.cycle_no === undefined) return false
    const cycleNo = Number(match.cycle_no)
    return Number.isInteger(cycleNo) && cycleNo >= 0
  })
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
  const canonicalCycleNoAvailable = hasCanonicalCycles(matches)
  const persistedRoundNoReliable = canonicalCycleNoAvailable
    || hasReliablePersistedRounds(matches, safeRoundSize)
  const roundByMatchId = new Map(matches.map((match, index) => [
    match.id,
    canonicalCycleNoAvailable
      ? Number(match.cycle_no)
      : persistedRoundNoReliable
        ? Number(match.round_no)
        : Math.floor(index / safeRoundSize),
  ]))

  return { matches, roundByMatchId, canonicalCycleNoAvailable, persistedRoundNoReliable }
}
