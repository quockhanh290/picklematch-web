import { BASELINE_SCENARIOS } from './tests/next-round-suggester/simulation/scenarios'
import { runSimulation, type SimulationResult } from './tests/next-round-suggester/simulation/runner'

function normalize(result: SimulationResult) {
  return {
    fairness_score: result.fairness_score,
    fairness_evolution: result.fairness_evolution,
    rounds_completed: result.rounds_completed.map((round) => ({
      round_no: round.round_no,
      matches: round.matches.map((match) => ({
        court_idx: match.court_idx,
        team_a: [...match.team_a],
        team_b: [...match.team_b],
        score: match.score,
        stats: match.stats,
      })),
      resting: [...round.resting],
    })),
    per_player_stats: result.per_player_stats,
    adjustments_applied: result.adjustments_applied,
    warnings_raised: result.warnings_raised,
    invariant_violations: result.invariant_violations,
  }
}

function stable(value: unknown) {
  return JSON.stringify(value)
}

async function main() {
  const rows: Array<{
    scenario: string
    rounds: number
    players: number
    courts: number
    v1_score: number
    v2_score: number
    same: boolean
    diff?: string
  }> = []

  for (const scenario of BASELINE_SCENARIOS) {
    const config = { ...scenario, seed: 42 }
    const v1 = await runSimulation(config)
    const v2 = await runSimulation(config)
    const same = stable(normalize(v1)) === stable(normalize(v2))
    rows.push({
      scenario: scenario.scenario_name ?? 'unknown',
      rounds: scenario.rounds,
      players: scenario.n_players,
      courts: scenario.courts,
      v1_score: v1.fairness_score.total,
      v2_score: v2.fairness_score.total,
      same,
      diff: same ? undefined : 'normalized simulation result differs',
    })
  }

  console.log(JSON.stringify({
    compared: rows.length,
    mismatches: rows.filter((row) => !row.same).length,
    rows,
  }, null, 2))

  if (rows.some((row) => !row.same)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
