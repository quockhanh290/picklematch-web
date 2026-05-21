import { Tier } from '../../../lib/next-round-suggester/classify'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayers, createState } from '../helpers/factories'

describe('suggestNextRound', () => {
  it('still suggests matches when MUST_PLAY overrides exceed court capacity', () => {
    const state = createState({
      courts: 1,
      players: createPlayers(8),
    })

    const result = suggestNextRound(state, {
      tier_overrides: {
        p01: Tier.MUST_PLAY,
        p02: Tier.MUST_PLAY,
        p03: Tier.MUST_PLAY,
        p04: Tier.MUST_PLAY,
        p05: Tier.MUST_PLAY,
      },
    })

    expect(result.warnings).toContain('MUST_PLAY_OVER_CAPACITY')
    expect(result.warnings).not.toContain('NO_VALID_MATCH')
    expect(result.alternatives.length).toBeGreaterThan(0)
    expect(result.alternatives[0].matches).toHaveLength(1)
  })

  it('keeps suggestion quality equivalent with and without partition cache', () => {
    const state = createState({
      courts: 4,
      players: createPlayers(20),
    })

    const cached = suggestNextRound(state)
    const uncached = suggestNextRound(state, { partition_cache: false })

    expect(cached.alternatives).toHaveLength(uncached.alternatives.length)
    expect(cached.alternatives.map((alternative) => ({
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      score: alternative.score,
      stats: alternative.stats,
      warnings: alternative.warnings,
    }))).toEqual(uncached.alternatives.map((alternative) => ({
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      score: alternative.score,
      stats: alternative.stats,
      warnings: alternative.warnings,
    })))
  })
})
