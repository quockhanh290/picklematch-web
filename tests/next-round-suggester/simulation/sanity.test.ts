import { runSimulation } from './runner'
import { BASELINE_SCENARIOS } from './scenarios'

describe('Phase A Simulation Sanity', () => {
  const quickScenarios = ['small_8', 'medium_12', 'large_20', 'large_40']

  it.each(quickScenarios)('%s runs to completion', async (name) => {
    const config = getScenario(name)
    const result = await runSimulation({ ...config, seed: 42 })

    expect(result.rounds_completed.length).toBe(config.rounds)
    expect(result.invariant_violations).toEqual([])
  })

  it.each(quickScenarios)('%s is deterministic with same seed', async (name) => {
    const config = getScenario(name)
    const r1 = await runSimulation({ ...config, seed: 42 })
    const r2 = await runSimulation({ ...config, seed: 42 })

    expect(r1.fairness_score.total).toBe(r2.fairness_score.total)
    expect(stripTiming(r1.rounds_completed)).toEqual(stripTiming(r2.rounds_completed))
  })

  it.each(quickScenarios)('%s never double-books players', async (name) => {
    const config = getScenario(name)
    const result = await runSimulation({ ...config, seed: 42 })

    for (const round of result.rounds_completed) {
      const allPlayers = round.matches.flatMap((match) => [...match.team_a, ...match.team_b])
      expect(new Set(allPlayers).size).toBe(allPlayers.length)
    }
  })

  it('different seeds produce different rounds', async () => {
    const config = getScenario('medium_16')
    const r1 = await runSimulation({ ...config, seed: 1 })
    const r2 = await runSimulation({ ...config, seed: 2 })

    expect(JSON.stringify(r1.rounds_completed)).not.toBe(JSON.stringify(r2.rounds_completed))
  })
})

function getScenario(name: string) {
  const scenario = BASELINE_SCENARIOS.find((item) => item.scenario_name === name)
  if (!scenario) throw new Error(`Missing scenario ${name}`)
  return scenario
}

function stripTiming(rounds: Array<{ round_no: number; matches: unknown; resting: unknown }>) {
  return rounds.map((round) => ({
    round_no: round.round_no,
    matches: round.matches,
    resting: round.resting,
  }))
}
