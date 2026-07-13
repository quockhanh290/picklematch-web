import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import { reconstructLiveRounds } from '@/lib/next-round-suggester/live-rounds'
import type { LiveRows } from './types'

function normalizeCourtCount(value: number) {
  return Math.max(1, Math.floor(value || 1))
}

function sortLiveMatchesBySequence(matches: SessionLiveMatchRow[]): SessionLiveMatchRow[] {
  return [...matches].sort((a, b) => {
    if (a.sequence_no !== b.sequence_no) return a.sequence_no - b.sequence_no
    return (a.court_idx ?? 0) - (b.court_idx ?? 0)
  })
}

function buildCompletedRoundResting(
  playedIds: Set<string>,
  fallbackPresentIds: string[],
  fallbackOptedRestPlayerIds: Set<string>,
): string[] {
  const source = fallbackPresentIds.filter(id => !fallbackOptedRestPlayerIds.has(id))

  return [...new Set(source)].filter(id => !playedIds.has(id))
}

function roundPresentPlayerIds(
  playerRows: SessionPlayerStateRow[],
  fallbackPresentIds: string[],
  roundStartedAt: string | null | undefined,
  roundEndedAt: string | null | undefined,
): string[] {
  if (!roundStartedAt) return fallbackPresentIds

  const roundStartMs = new Date(roundStartedAt).getTime()
  const roundEndMs = roundEndedAt ? new Date(roundEndedAt).getTime() : Infinity
  return playerRows
    .filter(player => {
      const checkedIn = new Date(player.checked_in_at).getTime()
      const checkedOut = player.checked_out_at ? new Date(player.checked_out_at).getTime() : Infinity
      return checkedIn <= roundEndMs && checkedOut >= roundStartMs
    })
    .map(player => player.player_id)
}

export function buildCompletedLiveCycleRows({
  liveMatchRows,
  legacyRoundRows,
  playerRows,
  sessionId,
  courtCount,
}: {
  liveMatchRows: SessionLiveMatchRow[]
  legacyRoundRows: LiveRows['roundRows']
  playerRows: SessionPlayerStateRow[]
  sessionId: string
  courtCount: number
}): LiveRows['roundRows'] {
  const normalizedCourtCount = normalizeCourtCount(courtCount)
  const baseRoundNo = legacyRoundRows.reduce((max, row) => Math.max(max, row.round_no), -1) + 1
  const legacyRoundNos = new Set(legacyRoundRows.map(r => r.round_no))
  // Exclude completed live matches whose round_no is already covered by legacyRoundRows to avoid
  // double-counting when the RPC returns synthetic round_rows derived from the same live matches.
  const sourceLive = sortLiveMatchesBySequence(
    liveMatchRows.filter(match => match.status !== 'cancelled' && (match.round_no == null || !legacyRoundNos.has(match.round_no))),
  )
  const reconstructedRounds = reconstructLiveRounds(sourceLive, normalizedCourtCount)
  const nonCancelledLive = reconstructedRounds.matches
  const completedLive = sortLiveMatchesBySequence(
    nonCancelledLive.filter(match => match.status === 'completed'),
  )
  const presentPlayerIds = playerRows
    .filter(row => !row.checked_out_at)
    .map(row => row.player_id)
  const optedRestPlayerIds = new Set(
    playerRows
      .filter(row => !row.checked_out_at && row.opted_rest)
      .map(row => row.player_id),
  )
  const liveRoundRows: LiveRows['roundRows'] = []

  if (reconstructedRounds.persistedRoundNoReliable) {
    const byRound = new Map<number, SessionLiveMatchRow[]>()
    for (const match of nonCancelledLive) {
      const roundNo = reconstructedRounds.roundByMatchId.get(match.id) ?? 0
      const rows = byRound.get(roundNo) ?? []
      rows.push(match)
      byRound.set(roundNo, rows)
    }

    for (const [roundNo, roundMatches] of [...byRound.entries()].sort(([a], [b]) => a - b)) {
      if (!roundMatches.every(match => match.status === 'completed')) continue

      const matches = sortLiveMatchesBySequence(roundMatches)
      const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
      const roundStartedAt = matches.map(match => match.started_at).filter(Boolean).sort()[0]
      const roundEndedAt = matches.map(match => match.ended_at).filter(Boolean).sort().reverse()[0]
      const roundPresentIds = roundPresentPlayerIds(
        playerRows,
        presentPlayerIds,
        roundStartedAt,
        roundEndedAt,
      )

      liveRoundRows.push({
        id: matches[0].id,
        session_id: sessionId,
        round_no: baseRoundNo + roundNo,
        status: 'completed',
        matches: matches.map(match => ({
          court_idx: match.court_idx ?? 0,
          team_a: match.team_a,
          team_b: match.team_b,
        })),
        resting: buildCompletedRoundResting(
          playedIds,
          roundPresentIds,
          optedRestPlayerIds,
        ),
        started_at: roundStartedAt ?? null,
        ended_at: roundEndedAt ?? null,
      })
    }

    return [...legacyRoundRows, ...liveRoundRows]
  }

  const completedByRound = new Map<number, SessionLiveMatchRow[]>()
  for (const match of completedLive) {
    const roundNo = reconstructedRounds.roundByMatchId.get(match.id) ?? 0
    const matches = completedByRound.get(roundNo) ?? []
    matches.push(match)
    completedByRound.set(roundNo, matches)
  }

  for (const [, roundMatches] of [...completedByRound.entries()].sort(([a], [b]) => a - b)) {
    if (roundMatches.length !== normalizedCourtCount) continue
    const matches = sortLiveMatchesBySequence(roundMatches)
    const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
    const roundStartedAt = matches.map(match => match.started_at).filter(Boolean).sort()[0]
    const roundEndedAt = matches.map(match => match.ended_at).filter(Boolean).sort().reverse()[0]

    const roundPresentIds = roundPresentPlayerIds(
      playerRows,
      presentPlayerIds,
      roundStartedAt,
      roundEndedAt,
    )

    liveRoundRows.push({
      id: matches[0].id,
      session_id: sessionId,
      round_no: baseRoundNo + liveRoundRows.length,
      status: 'completed',
      matches: matches.map(match => ({
        court_idx: match.court_idx ?? 0,
        team_a: match.team_a,
        team_b: match.team_b,
      })),
      resting: buildCompletedRoundResting(
        playedIds,
        roundPresentIds,
        optedRestPlayerIds,
      ),
      started_at: roundStartedAt ?? null,
      ended_at: roundEndedAt ?? null,
    })
  }

  return [...legacyRoundRows, ...liveRoundRows]
}

export function hasReachedCompletedLiveCycleTarget({
  liveMatchRows,
  legacyRoundRows,
  playerRows,
  sessionId,
  courtCount,
  targetRounds,
}: {
  liveMatchRows: SessionLiveMatchRow[]
  legacyRoundRows: LiveRows['roundRows']
  playerRows: SessionPlayerStateRow[]
  sessionId: string
  courtCount: number
  targetRounds: number
}) {
  if (targetRounds <= 0) return false
  const completedRounds = buildCompletedLiveCycleRows({
    liveMatchRows,
    legacyRoundRows,
    playerRows,
    sessionId,
    courtCount,
  }).filter(round => round.status === 'completed')

  return completedRounds.length >= targetRounds
}
