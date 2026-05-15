import assert from 'node:assert/strict'

import { genderPenalty, scoreMatch } from '../lib/next-round-suggester/score.ts'
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

run('genderPenalty returns 0 when all preferences are any', () => {
  const state = makeState([
    makePlayer('a', { gender: 'M' }),
    makePlayer('b', { gender: 'F' }),
    makePlayer('c', { gender: 'M' }),
    makePlayer('d', { gender: 'F' }),
  ])

  assert.equal(genderPenalty(['a', 'b'], ['c', 'd'], state), 0)
})

run('genderPenalty returns 0 when partner gender is null', () => {
  const state = makeState([
    makePlayer('a', { partner_gender_pref: 'F' }),
    makePlayer('b', { gender: null }),
    makePlayer('c', { gender: 'M' }),
    makePlayer('d', { gender: 'F' }),
  ])

  assert.equal(genderPenalty(['a', 'b'], ['c', 'd'], state), 0)
})

run('genderPenalty adds penalty when partner gender mismatches preference', () => {
  const state = makeState([
    makePlayer('a', { gender: 'M', partner_gender_pref: 'F' }),
    makePlayer('b', { gender: 'M' }),
    makePlayer('c', { gender: 'M' }),
    makePlayer('d', { gender: 'F' }),
  ])

  assert.equal(genderPenalty(['a', 'b'], ['c', 'd'], state), 4)
})

run('genderPenalty adds penalty for each opponent mismatch', () => {
  const state = makeState([
    makePlayer('a', { gender: 'F', opponent_gender_pref: 'F' }),
    makePlayer('b', { gender: 'F' }),
    makePlayer('c', { gender: 'M' }),
    makePlayer('d', { gender: 'M' }),
  ])

  assert.equal(genderPenalty(['a', 'b'], ['c', 'd'], state), 4)
})

run('genderPenalty accumulates penalty across all four players', () => {
  const state = makeState([
    makePlayer('a', { gender: 'M', partner_gender_pref: 'F', opponent_gender_pref: 'F' }),
    makePlayer('b', { gender: 'M', partner_gender_pref: 'F' }),
    makePlayer('c', { gender: 'M' }),
    makePlayer('d', { gender: 'F' }),
  ])

  assert.equal(genderPenalty(['a', 'b'], ['c', 'd'], state), 10)
})

run('score preserves baseline when no gender preferences are set', () => {
  const state = makeState([
    makePlayer('a', { elo: 1100, gender: 'M' }),
    makePlayer('b', { elo: 1000, gender: 'F' }),
    makePlayer('c', { elo: 1050, gender: 'M' }),
    makePlayer('d', { elo: 1000, gender: 'F' }),
  ])

  assert.equal(scoreMatch(['a', 'b'], ['c', 'd'], state).score, 0.5)
})

run('score does not hard reject due to gender mismatch', () => {
  const state = makeState([
    makePlayer('a', { gender: 'M', partner_gender_pref: 'F' }),
    makePlayer('b', { gender: 'M', partner_gender_pref: 'F' }),
    makePlayer('c', { gender: 'M', partner_gender_pref: 'F' }),
    makePlayer('d', { gender: 'M', partner_gender_pref: 'F' }),
  ])

  assert.equal(Number.isFinite(scoreMatch(['a', 'b'], ['c', 'd'], state).score), true)
})
