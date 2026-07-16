import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types'
import { serializeStateToDbRows } from '../helpers/db-rows'
import { createPlayers, createState } from '../helpers/factories'
import { persistPreviewRows, runProductionLiveChain, type AuthoritativeLiveSnapshot } from '../helpers/production-live-chain'

type MatrixCase = {
  label: string
  playerCount: number
  courts: number
  order: number[]
  mutation?: 'opted_rest' | 'checkout'
}

const cases: MatrixCase[] = [
  { label: '24 players / 4 courts', playerCount: 24, courts: 4, order: [0, 1, 2, 3] },
  { label: '28 players / 5 courts + opted rest', playerCount: 28, courts: 5, order: [4, 3, 2, 1, 0], mutation: 'opted_rest' },
  { label: '32 players / 6 courts + checkout', playerCount: 32, courts: 6, order: [0, 5, 1, 4, 2, 3], mutation: 'checkout' },
  { label: '36 players / 6 courts', playerCount: 36, courts: 6, order: [2, 0, 4, 1, 5, 3] },
]

describe('rolling horizon roster and court matrix', () => {
  it.each(cases)('keeps lanes operational for $label', ({ playerCount, courts, order, mutation }) => {
    let snapshot = buildSnapshot(playerCount, courts)
    let sequence = snapshot.liveMatchRows.length
    let mutatedPlayerId: string | null = null
    const initialCounts = appearanceCounts(snapshot.liveMatchRows)
    const replacementCounts = new Map<string, number>()

    order.forEach((courtIdx, orderIndex) => {
      const completing = latestLiveOnCourt(snapshot.liveMatchRows, courtIdx)
      expect(completing).toBeDefined()
      if (orderIndex === 1 && mutation) {
        mutatedPlayerId = mutateWaitingPlayer(snapshot, mutation)
        expect(mutatedPlayerId).not.toBeNull()
      }
      const otherBusy = new Set(snapshot.liveMatchRows
        .filter(row => row.status === 'live' && row.id !== completing!.id)
        .flatMap(row => [...row.team_a, ...row.team_b]))
      const result = runProductionLiveChain({
        snapshot,
        count: 1,
        completingLiveMatchIds: new Set([completing!.id]),
        stripPersistedPreviews: true,
        options: {
          courtIdxs: [courtIdx],
          ignoreCapacityLock: true,
          rollingHorizon: true,
        },
      })

      expect(result.elapsedMs).toBeLessThan(2000)
      expect(result.payloads).toHaveLength(1)
      const payload = result.payloads[0]
      const selected = [...payload.team_a, ...payload.team_b]
      expect(selected.some(playerId => otherBusy.has(playerId))).toBe(false)
      if (mutatedPlayerId) expect(selected).not.toContain(mutatedPlayerId)
      selected.forEach(playerId => replacementCounts.set(playerId, (replacementCounts.get(playerId) ?? 0) + 1))

      const completedAt = new Date(Date.parse(completing!.started_at ?? completing!.suggested_at) + 60_000).toISOString()
      const replacement = persistPreviewRows({
        payloads: result.payloads,
        snapshot,
        sequenceStart: sequence,
        suggestedAt: completedAt,
      })[0]
      sequence += 1
      snapshot = {
        ...snapshot,
        liveStateVersion: snapshot.liveStateVersion + 1,
        liveMatchRows: [
          ...snapshot.liveMatchRows.map(row => row.id === completing!.id
            ? { ...row, status: 'completed' as const, ended_at: completedAt }
            : row),
          { ...replacement, status: 'live' as const, started_at: completedAt },
        ],
      }
    })

    const eligibleIds = snapshot.playerRows
      .filter(row => row.checked_out_at === null && !row.opted_rest)
      .map(row => row.player_id)
    const sessionCounts = eligibleIds.map(playerId => (
      (initialCounts.get(playerId) ?? 0) + (replacementCounts.get(playerId) ?? 0)
    ))
    expect(Math.max(...sessionCounts) - Math.min(...sessionCounts)).toBeLessThanOrEqual(2)
  }, 90_000)
})

function buildSnapshot(playerCount: number, courts: number): AuthoritativeLiveSnapshot {
  const players = createPlayers(playerCount).map((player, index) => ({
    ...player,
    pvna: Number((2.2 + (index % 12) * 0.22).toFixed(2)),
  }))
  const state = createState({ players, courts, pvnaTolerance: 0.5 })
  state.session_id = `rolling-matrix-${playerCount}-${courts}`
  const rows = serializeStateToDbRows(state)
  const startedAt = '2026-07-16T12:00:00.000Z'
  const liveMatchRows = Array.from({ length: courts }, (_, courtIdx): SessionLiveMatchRow => ({
    id: `seed-${courtIdx}`,
    session_id: state.session_id,
    sequence_no: courtIdx,
    round_no: 0,
    court_idx: courtIdx,
    status: 'live',
    team_a: [playerId(courtIdx * 4 + 1), playerId(courtIdx * 4 + 2)],
    team_b: [playerId(courtIdx * 4 + 3), playerId(courtIdx * 4 + 4)],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: startedAt,
    started_at: new Date(Date.parse(startedAt) + courtIdx * 10_000).toISOString(),
    ended_at: null,
  }))
  return {
    ...rows,
    sessionId: state.session_id,
    courtCount: courts,
    pvnaTolerance: 0.5,
    liveStateVersion: 1,
    liveMatchRows,
  }
}

function mutateWaitingPlayer(snapshot: AuthoritativeLiveSnapshot, mutation: 'opted_rest' | 'checkout') {
  const busy = new Set(snapshot.liveMatchRows
    .filter(row => row.status === 'live')
    .flatMap(row => [...row.team_a, ...row.team_b]))
  const row = snapshot.playerRows.find(player => (
    player.checked_out_at === null && !player.opted_rest && !busy.has(player.player_id)
  ))
  if (!row) return null
  if (mutation === 'opted_rest') row.opted_rest = true
  else row.checked_out_at = '2026-07-16T12:02:00.000Z'
  return row.player_id
}

function latestLiveOnCourt(rows: SessionLiveMatchRow[], courtIdx: number) {
  return rows
    .filter(row => row.status === 'live' && row.court_idx === courtIdx)
    .sort((left, right) => right.sequence_no - left.sequence_no)[0]
}

function appearanceCounts(rows: SessionLiveMatchRow[]) {
  const counts = new Map<string, number>()
  rows.forEach(row => [...row.team_a, ...row.team_b].forEach(id => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }))
  return counts
}

function playerId(index: number) {
  return `p${String(index).padStart(2, '0')}`
}
