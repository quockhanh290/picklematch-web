import assert from 'node:assert/strict'

import { scoreMatch } from '../lib/next-round-suggester/score.ts'
import { makePlayer, makeState } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('score hard rejects elo diff beyond tolerance', () => {
  const state = makeState([
    makePlayer('a', { elo: 1600 }),
    makePlayer('b', { elo: 1600 }),
    makePlayer('c', { elo: 1000 }),
    makePlayer('d', { elo: 1000 }),
  ], 150)

  assert.equal(scoreMatch(['a', 'b'], ['c', 'd'], state).score, Infinity)
})

run('score hard rejects duplicated player', () => {
  const state = makeState([
    makePlayer('a'),
    makePlayer('b'),
    makePlayer('c'),
  ])

  assert.equal(scoreMatch(['a', 'b'], ['c', 'c'], state).score, Infinity)
})

run('score adds elo partner opponent penalties and group bonus', () => {
  const a = makePlayer('a', { elo: 1100, group_id: 'g1' })
  const b = makePlayer('b', { elo: 1000, group_id: 'g1' })
  const c = makePlayer('c', { elo: 1050 })
  const d = makePlayer('d', { elo: 1000 })
  a.partner_counts.set('b', 2)
  c.partner_counts.set('d', 1)
  a.opponent_counts.set('c', 1)
  b.opponent_counts.set('d', 2)

  const state = makeState([a, b, c, d])
  const scored = scoreMatch(['a', 'b'], ['c', 'd'], state)

  assert.equal(scored.stats.elo_diff, 25)
  assert.equal(scored.stats.partner_repeats, 3)
  assert.equal(scored.stats.opponent_repeats, 3)
  assert.equal(scored.stats.group_bonus, 1)
  assert.equal(scored.score, 13.5)
})

run('score group bonus lowers score', () => {
  const base = makeState([
    makePlayer('a', { elo: 1000 }),
    makePlayer('b', { elo: 1000 }),
    makePlayer('c', { elo: 1000 }),
    makePlayer('d', { elo: 1000 }),
  ])
  const grouped = makeState([
    makePlayer('a', { elo: 1000, group_id: 'g1' }),
    makePlayer('b', { elo: 1000, group_id: 'g1' }),
    makePlayer('c', { elo: 1000 }),
    makePlayer('d', { elo: 1000 }),
  ])

  assert.equal(scoreMatch(['a', 'b'], ['c', 'd'], grouped).score, scoreMatch(['a', 'b'], ['c', 'd'], base).score - 0.5)
})
