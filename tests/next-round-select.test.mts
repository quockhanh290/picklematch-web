import assert from 'node:assert/strict'

import { pickPlayers } from '../lib/next-round-suggester/select.ts'
import { makePlayer, makeState } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('pickPlayers returns not enough warning below four eligible players', () => {
  const state = makeState([
    makePlayer('a'),
    makePlayer('b'),
    makePlayer('c', { opted_rest: true }),
    makePlayer('d', { checked_out_at: new Date('2026-05-14T12:10:00.000Z') }),
  ])
  const picked = pickPlayers(state)

  assert.deepEqual(picked.selected, [])
  assert.deepEqual(picked.warnings, ['NOT_ENOUGH_PRESENT'])
})

run('pickPlayers prioritizes must play and lower matches', () => {
  const state = makeState([
    makePlayer('a', { consecutive_rest: 1, matches_played: 5 }),
    makePlayer('b', { matches_played: 0 }),
    makePlayer('c', { matches_played: 1 }),
    makePlayer('d', { matches_played: 2 }),
    makePlayer('e', { matches_played: 6 }),
  ])
  const picked = pickPlayers(state)

  assert.deepEqual(picked.selected.map((player) => player.player_id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(picked.resting.map((player) => player.player_id), ['e'])
})

run('pickPlayers warns when must play exceeds capacity', () => {
  const state = makeState([
    makePlayer('a', { consecutive_rest: 1 }),
    makePlayer('b', { consecutive_rest: 1 }),
    makePlayer('c', { consecutive_rest: 1 }),
    makePlayer('d', { consecutive_rest: 1 }),
    makePlayer('e', { consecutive_rest: 1 }),
  ])
  const picked = pickPlayers(state)

  assert.equal(picked.selected.length, 4)
  assert.ok(picked.warnings.includes('MUST_PLAY_OVER_CAPACITY'))
})
