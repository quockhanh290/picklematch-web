import { reconstructLiveRounds } from '../../../lib/next-round-suggester/live-rounds'
import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types'
import { serializeStateToDbRows } from '../helpers/db-rows'
import { createMatch, createPlayer, createState, simulateRound } from '../helpers/factories'
import {
  persistPreviewRows,
  runProductionLiveChain,
  type AuthoritativeLiveSnapshot,
} from '../helpers/production-live-chain'

const SESSION_ID = 'production-live-chain-test'

describe('production-equivalent rolling live chain', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('replays async lane completion with dirty rounds, overrides, rest and roster churn', () => {
    const snapshot = buildSnapshot()
    const completingId = 'live-completing-c0'
    const reconstruction = reconstructLiveRounds(snapshot.liveMatchRows, snapshot.courtCount)

    expect(reconstruction.persistedRoundNoReliable).toBe(false)

    const first = runProductionLiveChain({
      snapshot,
      count: 1,
      completingLiveMatchIds: new Set([completingId]),
      stripPersistedPreviews: true,
      options: { courtIdxs: [0], ignoreCapacityLock: true },
    })

    expect(first.elapsedMs).toBeLessThan(2000)
    expect(first.payloads).toHaveLength(1)
    expect(new Set(playersIn(first.payloads[0]))).toEqual(new Set(['p16', 'p17', 'p18', 'p19']))
    expect(playersIn(first.payloads[0])).not.toContain('p13')
    expect(playersIn(first.payloads[0])).not.toContain('p14')
    expect(first.state.players.get('p15')?.effective_pvna).toBe(3)
    expect(first.state.players.get('p13')?.opted_rest).toBe(true)
    expect(first.state.players.get('p14')?.checked_out_at).not.toBeNull()

    const persisted = persistPreviewRows({
      payloads: first.payloads,
      snapshot,
      sequenceStart: 11,
    })
    const replaySnapshot: AuthoritativeLiveSnapshot = {
      ...snapshot,
      liveStateVersion: snapshot.liveStateVersion + 1,
      liveMatchRows: [
        ...snapshot.liveMatchRows.map(row => row.id === completingId
          ? { ...row, status: 'completed' as const, ended_at: new Date().toISOString() }
          : row),
        ...persisted,
      ],
    }
    const second = runProductionLiveChain({
      snapshot: replaySnapshot,
      count: 1,
      completingLiveMatchIds: new Set(['live-busy-c1']),
      options: { courtIdxs: [1], ignoreCapacityLock: true },
    })

    expect(second.elapsedMs).toBeLessThan(2000)
    expect(second.payloads).toHaveLength(1)
    const secondPlayers = playersIn(second.payloads[0])
    expect(secondPlayers).toHaveLength(4)
    expect(new Set(secondPlayers).size).toBe(4)
    expect(secondPlayers.some(id => playersIn(persisted[0]).includes(id))).toBe(false)
    expect(secondPlayers.some(id => ['p05', 'p06', 'p07', 'p08'].includes(id))).toBe(false)
    expect(secondPlayers).not.toContain('p13')
    expect(secondPlayers).not.toContain('p14')
    expect(secondPlayers).not.toContain('p20')
    expect(warnSpy).toHaveBeenCalledWith(
      '[next-round-suggester] live round projection drift monitor',
      expect.objectContaining({ session_id: SESSION_ID, court_capacity_drift: true }),
    )
  })
})

function buildSnapshot(): AuthoritativeLiveSnapshot {
  const players = Array.from({ length: 20 }, (_, index) => createPlayer(
    `p${String(index + 1).padStart(2, '0')}`,
    { pvna: 3 + index * 0.1 },
  ))
  let state = createState({ players, courts: 3 })
  const matches = [
    createMatch(['p01', 'p02'], ['p03', 'p04'], 0),
    createMatch(['p05', 'p06'], ['p07', 'p08'], 1),
    createMatch(['p09', 'p10'], ['p11', 'p12'], 2),
  ]
  state = simulateRound(state, matches, ['p13', 'p14', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20'])
  state = simulateRound(state, matches, ['p13', 'p14', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20'])
  state.session_id = SESSION_ID
  const rows = serializeStateToDbRows(state)
  const checkedOutAt = new Date('2026-07-10T12:30:00.000Z').toISOString()
  rows.playerRows = rows.playerRows.map(row => ({
    ...row,
    matches_played: 2,
    last_played_round: 1,
    consecutive_rest: 0,
    consecutive_play: 0,
    effective_pvna: row.player_id === 'p15' ? 3 : null,
    opted_rest: row.player_id === 'p13',
    checked_out_at: row.player_id === 'p14' || row.player_id === 'p20' ? checkedOutAt : null,
    checked_in_at: row.player_id === 'p16'
      ? '2026-07-10T12:20:00.000Z'
      : '2026-07-10T12:00:00.000Z',
    players: {
      ...row.players,
      pvna: rawPvna(row.player_id),
    },
  }))
  rows.liveMatchRows = [
    liveRow('dirty-completed-a', 6, 2, 0, 'completed', ['p01', 'p02'], ['p03', 'p04']),
    liveRow('dirty-completed-b', 7, 2, 0, 'completed', ['p05', 'p06'], ['p07', 'p08']),
    liveRow('live-busy-c1', 8, 2, 1, 'live', ['p01', 'p02'], ['p03', 'p04']),
    liveRow('live-busy-c2', 9, 2, 2, 'live', ['p05', 'p06'], ['p07', 'p08']),
    liveRow('live-completing-c0', 10, 2, 0, 'live', ['p09', 'p10'], ['p11', 'p12']),
  ]

  return {
    ...rows,
    sessionId: SESSION_ID,
    courtCount: 3,
    pvnaTolerance: 0.5,
    liveStateVersion: 7,
  }
}

function rawPvna(playerId: string) {
  const index = Number(playerId.slice(1))
  if (playerId === 'p15') return 5
  if (index >= 16) return 3 + (index - 15) * 0.1
  return 3 + (index - 1) * 0.1
}

function liveRow(
  id: string,
  sequenceNo: number,
  roundNo: number,
  courtIdx: number,
  status: SessionLiveMatchRow['status'],
  teamA: [string, string],
  teamB: [string, string],
): SessionLiveMatchRow {
  return {
    id,
    session_id: SESSION_ID,
    sequence_no: sequenceNo,
    round_no: roundNo,
    court_idx: courtIdx,
    status,
    team_a: teamA,
    team_b: teamB,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: status === 'completed' ? new Date().toISOString() : null,
  }
}

function playersIn(row: { team_a: string[]; team_b: string[] }) {
  return [...row.team_a, ...row.team_b]
}
