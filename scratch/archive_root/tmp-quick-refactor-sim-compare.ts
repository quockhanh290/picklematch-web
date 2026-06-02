import fs from 'fs'

import { calculateOptimalCourts, type CourtPreset } from './lib/court-calculator'
import { computeSessionFairness } from './lib/next-round-suggester/fairness/metrics'
import { runSimulation, type SimulationConfig } from './tests/next-round-suggester/simulation/runner'

const BASELINE_PATH = 'simulation-reports/small-baseline-fairness-compare-2026-05-16T18-31-01-920Z.json'
const CASES: Array<{ n: number; duration: number; preset: CourtPreset }> = [
  { n: 8, duration: 120, preset: 'balanced' },
  { n: 9, duration: 120, preset: 'balanced' },
  { n: 12, duration: 120, preset: 'balanced' },
  { n: 33, duration: 120, preset: 'balanced' },
  { n: 40, duration: 150, preset: 'play_more' },
]

type BaselineRow = {
  id: string
  new_fairness: number
  courts: number
  rounds: number
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

function groupPlan(nPlayers: number): { group_count: number; group_size_range: [number, number] } {
  if (nPlayers < 4) return { group_count: 0, group_size_range: [2, 2] }
  if (nPlayers < 10) return { group_count: 1, group_size_range: [2, 2] }
  if (nPlayers < 20) return { group_count: 2, group_size_range: [2, 3] }
  if (nPlayers < 30) return { group_count: 3, group_size_range: [2, 4] }
  return { group_count: 5, group_size_range: [2, 4] }
}

function buildConfig(nPlayers: number, duration: number, preset: CourtPreset): SimulationConfig {
  const seed = hashSeed(`${nPlayers}:${duration}:${preset}`)
  const groups = groupPlan(nPlayers)
  const calculator = calculateOptimalCourts({
    n_players: nPlayers,
    session_duration_min: duration,
    match_duration_min: 15,
    preset,
  })

  return {
    scenario_name: `n${nPlayers}_${duration}_${preset}`,
    n_players: nPlayers,
    courts: calculator.recommended.courts,
    rounds: calculator.recommended.total_rounds,
    pvna_distribution: 'wide',
    gender_ratio: 0.5,
    gender_pref_rate: 0.3,
    group_count: groups.group_count,
    group_size_range: groups.group_size_range,
    use_corrector: true,
    seed,
  }
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as { rows: BaselineRow[] }
  const baselineById = new Map(baseline.rows.map(row => [row.id, row]))

  for (const item of CASES) {
    const config = buildConfig(item.n, item.duration, item.preset)
    const result = await runSimulation(config)
    const score = computeSessionFairness(result.final_state).total
    const baselineRow = baselineById.get(config.scenario_name ?? '')
    const baselineScore = baselineRow?.new_fairness
    const delta = baselineScore == null ? 'n/a' : String(score - baselineScore)
    const status = baselineScore == null || baselineScore === score ? 'OK' : 'CHANGED'

    console.log([
      status,
      config.scenario_name,
      `courts=${config.courts}`,
      `rounds=${config.rounds}`,
      `baseline=${baselineScore ?? 'n/a'}`,
      `current=${score}`,
      `delta=${delta}`,
      `violations=${result.invariant_violations.length}`,
    ].join(' | '))
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
