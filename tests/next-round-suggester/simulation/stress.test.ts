import { runMultiSeed } from './analysis'
import { createRealSessionPlayers, realSessionPlayerCount } from './real-session-fixture'
import { runSimulation, type SimulationConfig } from './runner'

describe('Phase A Stress Tests', () => {
  it(
    'handles real 40-player session data using PVNA scores',
    async () => {
      const players = createRealSessionPlayers()
      const result = await runSimulation({
        ...stressConfig('real_40_from_session_json', 'wide', 15),
        n_players: players.length,
        initial_players: players,
      })

      expect(players).toHaveLength(40)
      expect(result.rounds_completed.length).toBe(15)
      expect(result.invariant_violations).toEqual([])
      expect(result.final_state.players.get('P38')?.pvna).toBe(4.48)
    },
    600000,
  )

  it('keeps pending players optional for current-present simulations', () => {
    expect(realSessionPlayerCount({ includePending: false })).toBeLessThan(40)
    expect(realSessionPlayerCount()).toBe(40)
  })

  it(
    'handles n=40 with extreme PVNA spread',
    async () => {
      const result = await runSimulation(stressConfig('stress_40_extreme', 'extreme', 10))

      expect(result.rounds_completed).toHaveLength(10)
      expect(result.invariant_violations).toEqual([])
    },
    600000,
  )

  it(
    'keeps n=40 stable across many seeds',
    async () => {
      const aggregated = await runMultiSeed(
        {
          ...stressConfig('large_40', 'wide', 15),
          use_corrector: true,
        },
        12,
      )

      expect(aggregated.fairness_score.std).toBeLessThan(18)
      expect(aggregated.performance.p95_suggest_ms).toBeLessThan(2000)
    },
    600000,
  )

  it(
    'long session 20 rounds fairness stays stable',
    async () => {
      const result = await runSimulation({
        scenario_name: 'long_session_20',
        n_players: 20,
        courts: 5,
        rounds: 20,
        pvna_distribution: 'wide',
        gender_ratio: 0.5,
        gender_pref_rate: 0.3,
        group_count: 2,
        group_size_range: [3, 4],
        use_corrector: true,
        seed: 0,
      })
      const lastThird = result.fairness_evolution.slice(-7).map((point) => point.score)
      const avgLast = lastThird.reduce((sum, score) => sum + score, 0) / lastThird.length

      expect(avgLast).toBeGreaterThan(55)
    },
    600000,
  )

  it(
    'high gender preference rate is handled gracefully',
    async () => {
      const result = await runSimulation({
        scenario_name: 'stress_gender_high_pref',
        n_players: 12,
        courts: 3,
        rounds: 8,
        pvna_distribution: 'wide',
        gender_ratio: 0.4,
        gender_pref_rate: 0.7,
        group_count: 1,
        group_size_range: [2, 3],
        use_corrector: true,
        seed: 0,
      })

      expect(result.invariant_violations).toEqual([])
    },
    600000,
  )
})

function stressConfig(
  scenarioName: string,
  pvnaDistribution: SimulationConfig['pvna_distribution'],
  rounds: number,
): SimulationConfig {
  return {
    scenario_name: scenarioName,
    n_players: 40,
    courts: 10,
    rounds,
    pvna_distribution: pvnaDistribution,
    gender_ratio: 0.5,
    gender_pref_rate: 0.3,
    group_count: 5,
    group_size_range: [3, 6],
    use_corrector: true,
    seed: 0,
  }
}
