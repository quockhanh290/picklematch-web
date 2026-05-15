import { compareCorrector } from './analysis'
import { BASELINE_SCENARIOS } from './scenarios'

describe('Corrector A/B Comparison', () => {
  const nSeeds = 10

  it(
    'corrector improves or preserves fairness across majority of scenarios',
    async () => {
      const results = []

      for (const config of BASELINE_SCENARIOS) {
        const comparison = await compareCorrector(config, nSeeds)
        results.push(comparison)
      }

      const nonRegressions = results.filter(
        (result) => result.improvement.fairness_delta >= -2,
      ).length
      expect(nonRegressions).toBeGreaterThanOrEqual(Math.floor(BASELINE_SCENARIOS.length * 0.8))
    },
    900000,
  )

  it(
    'no scenario significantly regresses with corrector',
    async () => {
      for (const config of BASELINE_SCENARIOS) {
        const comparison = await compareCorrector(config, nSeeds)
        expect(comparison.improvement.fairness_delta).toBeGreaterThanOrEqual(-5)
      }
    },
    900000,
  )
})
