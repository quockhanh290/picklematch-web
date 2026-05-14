import assert from 'node:assert/strict'

import { buildPairHistoryUpdates, commitCompletedRound } from '../lib/next-round-suggester/commit.ts'
import { makePlayer, makeState } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('commitCompletedRound updates played and resting player streaks', () => {
  const players = [
    makePlayer('a', { opted_rest: true }),
    makePlayer('b'),
    makePlayer('c'),
    makePlayer('d'),
    makePlayer('e'),
  ]
  const state = makeState(players)
  const result = commitCompletedRound(state, {
    round_no: 2,
    matches: [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }],
  })

  assert.equal(result.players.get('a')?.matches_played, 1)
  assert.equal(result.players.get('a')?.last_played_round, 2)
  assert.equal(result.players.get('a')?.consecutive_play, 1)
  assert.equal(result.players.get('a')?.consecutive_rest, 0)
  assert.equal(result.players.get('a')?.opted_rest, false)
  assert.equal(result.players.get('e')?.matches_played, 0)
  assert.equal(result.players.get('e')?.consecutive_rest, 1)
  assert.equal(result.players.get('e')?.consecutive_play, 0)
})

run('commitCompletedRound does not change checked out players', () => {
  const checkedOutAt = new Date('2026-05-14T12:10:00.000Z')
  const state = makeState([
    makePlayer('a'),
    makePlayer('b'),
    makePlayer('c'),
    makePlayer('d'),
    makePlayer('e', { checked_out_at: checkedOutAt, consecutive_rest: 3 }),
  ])
  const result = commitCompletedRound(state, {
    round_no: 1,
    matches: [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }],
  })

  assert.equal(result.players.get('e')?.consecutive_rest, 3)
})

run('buildPairHistoryUpdates increments partner and opponent counts', () => {
  const rows = buildPairHistoryUpdates(
    'session-1',
    [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }],
    [
      {
        session_id: 'session-1',
        player_a: 'a',
        player_b: 'b',
        partner_count: 2,
        opponent_count: 0,
      },
    ],
  )
  const byKey = new Map(rows.map((row) => [`${row.player_a}:${row.player_b}`, row]))

  assert.equal(byKey.get('a:b')?.partner_count, 3)
  assert.equal(byKey.get('c:d')?.partner_count, 1)
  assert.equal(byKey.get('a:c')?.opponent_count, 1)
  assert.equal(byKey.get('b:d')?.opponent_count, 1)
})
