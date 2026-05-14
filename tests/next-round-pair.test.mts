import assert from 'node:assert/strict'

import { bestTeamSplit } from '../lib/next-round-suggester/pair.ts'
import { makePlayer, makeState } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('bestTeamSplit picks the minimum of the three splits', () => {
  const players = [
    makePlayer('a', { elo: 1200 }),
    makePlayer('b', { elo: 1000 }),
    makePlayer('c', { elo: 1000 }),
    makePlayer('d', { elo: 1200 }),
  ]
  const state = makeState(players)
  const split = bestTeamSplit(players, state)

  assert.deepEqual(split?.match.team_a, ['a', 'b'])
  assert.deepEqual(split?.match.team_b, ['c', 'd'])
  assert.equal(split?.stats.elo_diff, 0)
})

run('bestTeamSplit returns null when all splits violate tolerance', () => {
  const players = [
    makePlayer('a', { elo: 1600 }),
    makePlayer('b', { elo: 1500 }),
    makePlayer('c', { elo: 1400 }),
    makePlayer('d', { elo: 900 }),
  ]
  const state = makeState(players, 10)

  assert.equal(bestTeamSplit(players, state), null)
})
