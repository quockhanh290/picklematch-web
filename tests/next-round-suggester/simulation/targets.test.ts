import { runMultiSeed } from './analysis'
import { BASELINE_SCENARIOS, FAIRNESS_TARGETS, PERFORMANCE_TARGETS } from './scenarios'

describe('Phase A Fairness Targets', () => {
  const nSeeds = 5

  for (const [name, target] of Object.entries(FAIRNESS_TARGETS)) {
    it(`${name} median score >= ${target.min}`, async () => {
      const config = getScenario(name)
      const aggregated = await runMultiSeed({ ...config, use_corrector: true }, nSeeds)

      expect(aggregated.fairness_score.median).toBeGreaterThanOrEqual(target.min)
    })
  }
})

describe('Phase A Performance Targets', () => {
  const nSeeds = 3

  it('small scenarios stay under budget', async () => {
    const small = BASELINE_SCENARIOS.filter((scenario) => scenario.n_players <= 12)

    for (const config of small) {
      const result = await runMultiSeed({ ...config, use_corrector: true }, nSeeds)
      expect(result.performance.avg_suggest_ms).toBeLessThan(PERFORMANCE_TARGETS.small.avg_ms)
      expect(result.performance.max_suggest_ms).toBeLessThan(PERFORMANCE_TARGETS.small.max_ms)
    }
  })

  it('medium scenarios stay under budget', async () => {
    const medium = BASELINE_SCENARIOS.filter(
      (scenario) => scenario.n_players >= 13 && scenario.n_players <= 20,
    )

    for (const config of medium) {
      const result = await runMultiSeed({ ...config, use_corrector: true }, nSeeds)
      expect(result.performance.avg_suggest_ms).toBeLessThan(PERFORMANCE_TARGETS.medium.avg_ms)
    }
  })

  it('large scenarios stay under budget', async () => {
    const large = BASELINE_SCENARIOS.filter(
      (scenario) => scenario.n_players >= 21 && scenario.n_players <= 32,
    )

    for (const config of large) {
      const result = await runMultiSeed({ ...config, use_corrector: true }, nSeeds)
      expect(result.performance.avg_suggest_ms).toBeLessThan(PERFORMANCE_TARGETS.large.avg_ms)
    }
  })

  it('xlarge scenarios stay under budget', async () => {
    const xlarge = BASELINE_SCENARIOS.filter((scenario) => scenario.n_players >= 33)

    for (const config of xlarge) {
      const result = await runMultiSeed({ ...config, use_corrector: true }, nSeeds)
      expect(result.performance.avg_suggest_ms).toBeLessThan(PERFORMANCE_TARGETS.xlarge.avg_ms)
      expect(result.performance.max_suggest_ms).toBeLessThan(PERFORMANCE_TARGETS.xlarge.max_ms)
    }
  })
})

function getScenario(name: string) {
  const scenario = BASELINE_SCENARIOS.find((item) => item.scenario_name === name)
  if (!scenario) throw new Error(`Missing scenario ${name}`)
  return scenario
}
