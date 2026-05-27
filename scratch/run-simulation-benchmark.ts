import { BASELINE_SCENARIOS } from '../tests/next-round-suggester/simulation/scenarios'
import { runSimulation, type SimulationConfig } from '../tests/next-round-suggester/simulation/runner'

function format(n: number, digits = 2) {
  return Number(n.toFixed(digits))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summary(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    avg_ms: format(total / Math.max(1, values.length)),
    p50_ms: format(percentile(values, 50)),
    p95_ms: format(percentile(values, 95)),
    max_ms: format(Math.max(0, ...values)),
  }
}

async function main() {
  const scenarios: SimulationConfig[] = BASELINE_SCENARIOS.map((scenario) => ({
    ...scenario,
    rounds: Math.min(scenario.rounds, 10),
  }))
  const results = []

  for (const scenario of scenarios) {
    const result = await runSimulation(scenario)
    const roundTimes = result.rounds_completed.map((round) => round.elapsed_ms)
    results.push({
      scenario: scenario.scenario_name,
      players: scenario.n_players,
      courts: scenario.courts,
      rounds: result.rounds_completed.length,
      fairness: result.fairness_score.total,
      invariants: result.invariant_violations.length,
      timing: summary(roundTimes),
    })
  }

  const allRoundTimes = results.flatMap((row) => {
    const source = scenarios.find((scenario) => scenario.scenario_name === row.scenario)
    return source ? [] : []
  })
  void allRoundTimes

  console.log(JSON.stringify({
    scenarios: results.length,
    rows: results,
    aggregate: {
      avg_of_avg_ms: format(results.reduce((sum, row) => sum + row.timing.avg_ms, 0) / Math.max(1, results.length)),
      max_ms: format(Math.max(0, ...results.map((row) => row.timing.max_ms))),
      invariant_scenarios: results.filter((row) => row.invariants > 0).length,
    },
  }, null, 2))
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
