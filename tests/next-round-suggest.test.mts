import assert from 'node:assert/strict'

import { suggestNextRound } from '../lib/next-round-suggester/suggest.ts'
import { makePlayer, makeState } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('suggestNextRound returns a valid single-court alternative for four players', () => {
  const state = makeState([
    makePlayer('a', { elo: 1100 }),
    makePlayer('b', { elo: 1000 }),
    makePlayer('c', { elo: 1000 }),
    makePlayer('d', { elo: 1100 }),
  ])
  const result = suggestNextRound(state)

  assert.equal(result.should_end, false)
  assert.equal(result.alternatives.length, 1)
  assert.equal(result.alternatives[0].matches.length, 1)
  assert.equal(new Set(result.alternatives[0].matches.flatMap((match) => [...match.team_a, ...match.team_b])).size, 4)
})

run('suggestNextRound selects four and rests extras', () => {
  const state = makeState([
    makePlayer('a', { matches_played: 0 }),
    makePlayer('b', { matches_played: 0 }),
    makePlayer('c', { matches_played: 1 }),
    makePlayer('d', { matches_played: 1 }),
    makePlayer('e', { matches_played: 5 }),
    makePlayer('f', { opted_rest: true }),
  ])
  const result = suggestNextRound(state)

  assert.equal(result.alternatives[0].resting.includes('e'), true)
  assert.equal(result.alternatives[0].resting.includes('f'), true)
})

run('suggestNextRound suggests end when fewer than four eligible are present', () => {
  const state = makeState([
    makePlayer('a'),
    makePlayer('b'),
    makePlayer('c'),
  ])
  const result = suggestNextRound(state)

  assert.equal(result.should_end, true)
  assert.deepEqual(result.alternatives, [])
  assert.ok(result.warnings.includes('NOT_ENOUGH_PRESENT'))
})

run('suggestNextRound warns when no valid split satisfies elo tolerance', () => {
  const state = makeState([
    makePlayer('a', { elo: 1600 }),
    makePlayer('b', { elo: 1500 }),
    makePlayer('c', { elo: 1400 }),
    makePlayer('d', { elo: 900 }),
  ], 10)
  const result = suggestNextRound(state)

  assert.deepEqual(result.alternatives, [])
  assert.ok(result.warnings.includes('NO_VALID_MATCH'))
})

run('suggestNextRound is deterministic for identical input', () => {
  const state = makeState([
    makePlayer('a', { elo: 1200, matches_played: 1 }),
    makePlayer('b', { elo: 1000, matches_played: 0 }),
    makePlayer('c', { elo: 1050, matches_played: 1 }),
    makePlayer('d', { elo: 1150, matches_played: 0 }),
    makePlayer('e', { elo: 1100, matches_played: 2 }),
  ])

  assert.deepEqual(suggestNextRound(state), suggestNextRound(state))
})

run('suggestNextRound fills multiple courts without double booking', () => {
  const players = Array.from({ length: 8 }, (_, index) =>
    makePlayer(`p${String(index).padStart(2, '0')}`, { elo: 1000 + index * 20 }),
  )
  const state = makeState(players, 150, 2)
  const result = suggestNextRound(state)
  const played = result.alternatives[0].matches.flatMap((match) => [...match.team_a, ...match.team_b])

  assert.equal(result.should_end, false)
  assert.equal(result.alternatives[0].matches.length, 2)
  assert.equal(played.length, 8)
  assert.equal(new Set(played).size, 8)
})

run('suggestNextRound warns when only some configured courts can be used', () => {
  const players = Array.from({ length: 6 }, (_, index) =>
    makePlayer(`p${String(index).padStart(2, '0')}`, { elo: 1000 + index * 20 }),
  )
  const state = makeState(players, 150, 2)
  const result = suggestNextRound(state)

  assert.equal(result.alternatives[0].matches.length, 1)
  assert.ok(result.warnings.includes('PARTIAL_COURTS'))
})
