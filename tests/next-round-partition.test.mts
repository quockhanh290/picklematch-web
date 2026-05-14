import assert from 'node:assert/strict'

import { bestPartitioning } from '../lib/next-round-suggester/pair.ts'
import { makePlayer, makeState } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

function playedIds(result: NonNullable<ReturnType<typeof bestPartitioning>>) {
  return result.matches.flatMap((match) => [...match.team_a, ...match.team_b])
}

run('bestPartitioning supports two courts with eight players', () => {
  const players = [
    makePlayer('a', { elo: 1000 }),
    makePlayer('b', { elo: 1020 }),
    makePlayer('c', { elo: 1040 }),
    makePlayer('d', { elo: 1060 }),
    makePlayer('e', { elo: 1080 }),
    makePlayer('f', { elo: 1100 }),
    makePlayer('g', { elo: 1120 }),
    makePlayer('h', { elo: 1140 }),
  ]
  const state = makeState(players, 150, 2)
  const result = bestPartitioning(players, state)

  assert.equal(result?.matches.length, 2)
  assert.equal(new Set(playedIds(result!)).size, 8)
  assert.equal(playedIds(result!).length, 8)
  assert.deepEqual(result?.matches.map((match) => match.court_idx), [0, 1])
})

run('bestPartitioning supports three courts with twelve players', () => {
  const players = Array.from({ length: 12 }, (_, index) =>
    makePlayer(`p${String(index).padStart(2, '0')}`, { elo: 1000 + index * 10 }),
  )
  const state = makeState(players, 150, 3)
  const result = bestPartitioning(players, state)

  assert.equal(result?.matches.length, 3)
  assert.equal(new Set(playedIds(result!)).size, 12)
  assert.ok((result?.iterations ?? 0) <= 20000)
})

run('bestPartitioning sampled path is deterministic for sixteen players', () => {
  const players = Array.from({ length: 16 }, (_, index) =>
    makePlayer(`p${String(index).padStart(2, '0')}`, { elo: 1000 + (index % 4) * 20 }),
  )
  const state = makeState(players, 150, 4)
  const first = bestPartitioning(players, state)
  const second = bestPartitioning(players, state)

  assert.deepEqual(first, second)
  assert.equal(first?.matches.length, 4)
  assert.equal(new Set(playedIds(first!)).size, 16)
  assert.ok((first?.iterations ?? 0) <= 5000)
})

run('bestPartitioning returns null for non-multiple of four players', () => {
  const players = [makePlayer('a'), makePlayer('b'), makePlayer('c'), makePlayer('d'), makePlayer('e')]
  const state = makeState(players)

  assert.equal(bestPartitioning(players, state), null)
})
