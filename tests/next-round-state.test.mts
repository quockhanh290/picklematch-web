import assert from 'node:assert/strict'

import {
  buildCheckInPatch,
  buildCheckoutPatch,
  buildRestPatch,
  deriveGroupId,
  isPresent,
  mapRowsToSessionState,
  normalizePairKey,
} from '../lib/next-round-suggester/state.ts'
import type {
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
} from '../lib/next-round-suggester/types.ts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

const sessionId = '00000000-0000-0000-0000-000000000001'
const playerA = '00000000-0000-0000-0000-00000000000a'
const playerB = '00000000-0000-0000-0000-00000000000b'
const playerC = '00000000-0000-0000-0000-00000000000c'

run('next round pair keys are normalized deterministically', () => {
  assert.deepEqual(normalizePairKey(playerB, playerA), [playerA, playerB])
  assert.throws(() => normalizePairKey(playerA, playerA), /different players/)
})

run('next round group ids are deterministic', () => {
  assert.equal(
    deriveGroupId(sessionId, [playerB, playerA, playerA]),
    `${sessionId}:${playerA}:${playerB}`,
  )
})

run('next round check-in patch is host-managed and idempotent-friendly', () => {
  const now = new Date('2026-05-14T12:00:00.000Z')
  const patch = buildCheckInPatch(sessionId, { player_id: playerA, group_with: [playerB] }, now)

  assert.equal(patch.session_id, sessionId)
  assert.equal(patch.player_id, playerA)
  assert.equal(patch.checked_out_at, null)
  assert.equal(patch.opted_rest, false)
  assert.equal(patch.group_id, `${sessionId}:${playerA}:${playerB}`)
})

run('next round checkout and rest patches target one player', () => {
  const now = new Date('2026-05-14T12:05:00.000Z')

  assert.deepEqual(buildCheckoutPatch({ player_id: playerA }, now), {
    player_id: playerA,
    checked_out_at: now.toISOString(),
    opted_rest: false,
  })

  assert.deepEqual(buildRestPatch({ player_id: playerA, opted_rest: true }), {
    player_id: playerA,
    opted_rest: true,
  })
})

run('next round state mapper attaches symmetric pair history', () => {
  const playerRows: SessionPlayerStateRow[] = [
    {
      session_id: sessionId,
      player_id: playerA,
      group_id: null,
      checked_in_at: '2026-05-14T12:00:00.000Z',
      checked_out_at: null,
      matches_played: 1,
      last_played_round: 0,
      consecutive_rest: 0,
      consecutive_play: 1,
      opted_rest: false,
      players: { elo: 1200 },
    },
    {
      session_id: sessionId,
      player_id: playerB,
      group_id: null,
      checked_in_at: '2026-05-14T12:00:00.000Z',
      checked_out_at: '2026-05-14T12:10:00.000Z',
      matches_played: 1,
      last_played_round: 0,
      consecutive_rest: 0,
      consecutive_play: 1,
      opted_rest: false,
      players: { elo: 1180 },
    },
  ]

  const pairRows: SessionPairHistoryRow[] = [
    {
      session_id: sessionId,
      player_a: playerA,
      player_b: playerB,
      partner_count: 2,
      opponent_count: 1,
    },
  ]

  const roundRows: SessionRoundRow[] = [
    {
      id: 'round-1',
      session_id: sessionId,
      round_no: 0,
      status: 'completed',
      matches: [{ court_idx: 0, team_a: [playerA, playerB], team_b: [playerC, playerC] }],
      resting: [],
      started_at: '2026-05-14T12:00:00.000Z',
      ended_at: '2026-05-14T12:10:00.000Z',
    },
  ]

  const state = mapRowsToSessionState({ sessionId, playerRows, pairRows, roundRows })
  const mappedA = state.players.get(playerA)
  const mappedB = state.players.get(playerB)

  assert.equal(state.current_round, 1)
  assert.equal(state.status, 'waiting')
  assert.equal(mappedA?.elo, 1200)
  assert.equal(mappedA?.partner_counts.get(playerB), 2)
  assert.equal(mappedB?.opponent_counts.get(playerA), 1)
  assert.equal(isPresent(mappedA!), true)
  assert.equal(isPresent(mappedB!), false)
})

run('next round state mapper normalizes per-session gender preferences', () => {
  const playerRows: SessionPlayerStateRow[] = [
    {
      session_id: sessionId,
      player_id: playerA,
      group_id: null,
      checked_in_at: '2026-05-14T12:00:00.000Z',
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
      players: {
        elo: 1200,
        gender: 'female',
        partner_gender_pref: 'male',
        opponent_gender_pref: 'any',
      },
      session_players: {
        metadata: {
          partner_gender_pref: 'female',
        },
      },
    },
  ]

  const state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: [],
    roundRows: [],
  })
  const mappedA = state.players.get(playerA)

  assert.equal(mappedA?.gender, 'F')
  assert.equal(mappedA?.partner_gender_pref, 'F')
  assert.equal(mappedA?.opponent_gender_pref, 'any')
})
