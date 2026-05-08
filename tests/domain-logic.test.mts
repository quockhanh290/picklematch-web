import assert from 'node:assert/strict'

import { formatEstimatedCostPerPerson, getEstimatedCostPerPerson } from '../lib/sessionPricing.ts'
import { getMatchStatus } from '../lib/matchmaking.ts'
import { getEloBandByTier, getLevelIdForElo, getTierForElo } from '../lib/eloSystem.ts'

function run(name: string, fn: () => void) {
  fn()
  console.log(`PASS ${name}`)
}

run('elo mapping uses the shared master table', () => {
  assert.equal(getLevelIdForElo(800), 'level_1')
  assert.equal(getLevelIdForElo(1000), 'level_2')
  assert.equal(getLevelIdForElo(1100), 'level_3')
  assert.equal(getLevelIdForElo(1200), 'level_4')
  assert.equal(getLevelIdForElo(1375), 'level_5')

  assert.equal(getTierForElo(1200), 'upper_intermediate')
})

run('tier mapping preserves the level 4 distinction', () => {
  assert.equal(getEloBandByTier('upper_intermediate')?.levelId, 'level_4')
  assert.equal(getEloBandByTier('intermediate')?.levelId, 'level_3')
})

run('matchmaking helper returns the expected join state', () => {
  assert.equal(getMatchStatus(1100, 1050, 3, 4), 'MATCHED')
  assert.equal(getMatchStatus(900, 1050, 3, 4), 'LOWER_SKILL')
  assert.equal(getMatchStatus(1300, 1050, 4, 4), 'WAITLIST')
})

run('session pricing formats per-player cost safely', () => {
  assert.equal(getEstimatedCostPerPerson(400000, 4), 100000)
  assert.equal(getEstimatedCostPerPerson(null, 4), 0)
  assert.equal(formatEstimatedCostPerPerson(0, 4), 'Miễn phí')
})

console.log('All domain logic checks passed.')
