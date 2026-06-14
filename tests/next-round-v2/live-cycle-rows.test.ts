import { computeRestFairness } from '../../lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState } from '../../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '../../lib/next-round-suggester/types'
import { buildCompletedLiveCycleRows } from '../../features/host/session-detail/next-round-v2/live-cycle-rows'

function playerRow(playerId: string): SessionPlayerStateRow {
  return {
    session_id: 'session-test',
    player_id: playerId,
    group_id: null,
    checked_in_at: '2026-06-04T20:00:00.000Z',
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    players: {
      name: playerId,
      pvna: 3,
      gender: null,
      partner_gender_pref: 'any',
      opponent_gender_pref: 'any',
    },
  }
}

function liveMatch(sequenceNo: number, roundNo: number, courtIdx: number, players: [string, string, string, string]): SessionLiveMatchRow {
  return {
    id: `live-${sequenceNo}`,
    session_id: 'session-test',
    sequence_no: sequenceNo,
    round_no: roundNo,
    court_idx: courtIdx,
    status: 'completed',
    team_a: [players[0], players[1]],
    team_b: [players[2], players[3]],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: '2026-06-04T20:00:00.000Z',
    started_at: '2026-06-04T20:00:00.000Z',
    ended_at: '2026-06-04T20:10:00.000Z',
  }
}

describe('buildCompletedLiveCycleRows', () => {
  it('groups completed live matches by sequence cycles instead of stale round_no', () => {
    const playerRows = Array.from({ length: 48 }, (_, index) => playerRow(`p${index}`))
    const matchPlayers = Array.from({ length: 12 }, (_, matchIndex) => {
      const start = matchIndex * 4
      return [`p${start}`, `p${start + 1}`, `p${start + 2}`, `p${start + 3}`] as [string, string, string, string]
    })
    const liveRows = [
      ...Array.from({ length: 5 }, (_, index) => liveMatch(18 + index, 3, index, matchPlayers[index])),
      liveMatch(23, 4, 0, matchPlayers[5]),
      ...Array.from({ length: 6 }, (_, index) => liveMatch(24 + index, 4, index, matchPlayers[6 + index])),
    ]

    const roundRows = buildCompletedLiveCycleRows({
      liveMatchRows: liveRows,
      legacyRoundRows: [],
      playerRows,
      sessionId: 'session-test',
      courtCount: 6,
    })

    expect(roundRows).toHaveLength(2)
    expect(roundRows[0].matches).toHaveLength(6)
    expect(roundRows[0].matches.map(match => match.court_idx)).toEqual([0, 1, 2, 3, 4, 0])
    expect(roundRows[1].matches).toHaveLength(6)

    const state = mapRowsToSessionState({
      sessionId: 'session-test',
      playerRows,
      pairRows: [] as SessionPairHistoryRow[],
      roundRows,
      courts: 6,
      pvnaTolerance: 0.5,
    })
    expect(computeRestFairness(state).violations).toEqual([])
  })

  it('uses reliable round_no groups when a fast lane completes ahead of slower courts', () => {
    const playerRows = Array.from({ length: 24 }, (_, index) => playerRow(`p${index}`))
    const matchPlayers = Array.from({ length: 6 }, (_, matchIndex) => {
      const start = matchIndex * 4
      return [`p${start}`, `p${start + 1}`, `p${start + 2}`, `p${start + 3}`] as [string, string, string, string]
    })
    const liveRows = [
      liveMatch(0, 0, 0, matchPlayers[0]),
      liveMatch(1, 0, 1, matchPlayers[1]),
      liveMatch(2, 0, 2, matchPlayers[2]),
      liveMatch(3, 1, 0, matchPlayers[3]),
      liveMatch(4, 1, 1, matchPlayers[4]),
      liveMatch(5, 1, 2, matchPlayers[5]),
    ]

    const roundRows = buildCompletedLiveCycleRows({
      liveMatchRows: liveRows,
      legacyRoundRows: [],
      playerRows,
      sessionId: 'session-test',
      courtCount: 3,
    })

    expect(roundRows).toHaveLength(2)
    expect(roundRows[0].round_no).toBe(0)
    expect(roundRows[0].matches.map(match => match.court_idx)).toEqual([0, 1, 2])
    expect(roundRows[0].matches.flatMap(match => [...match.team_a, ...match.team_b])).toEqual([
      ...matchPlayers[0],
      ...matchPlayers[1],
      ...matchPlayers[2],
    ])
    expect(roundRows[1].round_no).toBe(1)
    expect(roundRows[1].matches.map(match => match.court_idx)).toEqual([0, 1, 2])
    expect(roundRows[1].matches.flatMap(match => [...match.team_a, ...match.team_b])).toEqual([
      ...matchPlayers[3],
      ...matchPlayers[4],
      ...matchPlayers[5],
    ])
  })
})
