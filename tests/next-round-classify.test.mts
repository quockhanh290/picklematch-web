import assert from 'node:assert/strict'

import { classifyPlayer, Tier } from '../lib/next-round-suggester/classify.ts'
import { makePlayer } from './next-round-helpers.mts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('classify covers opted rest', () => {
  assert.equal(classifyPlayer(makePlayer('p1', { opted_rest: true, consecutive_rest: 2 }), { avgMatches: 2 }), Tier.OPTED_REST)
})

run('classify covers must play after one rested round', () => {
  assert.equal(classifyPlayer(makePlayer('p1', { consecutive_rest: 1 }), { avgMatches: 2 }), Tier.MUST_PLAY)
})

run('classify covers should play below average', () => {
  assert.equal(classifyPlayer(makePlayer('p1', { matches_played: 0 }), { avgMatches: 2 }), Tier.SHOULD_PLAY)
})

run('classify covers must rest after two consecutive plays', () => {
  assert.equal(classifyPlayer(makePlayer('p1', { matches_played: 2, consecutive_play: 2 }), { avgMatches: 2 }), Tier.MUST_REST)
})

run('classify covers should rest above average', () => {
  assert.equal(classifyPlayer(makePlayer('p1', { matches_played: 4 }), { avgMatches: 2 }), Tier.SHOULD_REST)
})

run('classify covers flexible default', () => {
  assert.equal(classifyPlayer(makePlayer('p1', { matches_played: 2 }), { avgMatches: 2 }), Tier.FLEXIBLE)
})
