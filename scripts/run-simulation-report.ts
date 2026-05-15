import path from 'path'
import fs from 'fs'

import { BASELINE_SCENARIOS } from '../tests/next-round-suggester/simulation/scenarios'
import { createRealSessionPlayers } from '../tests/next-round-suggester/simulation/real-session-fixture'
import { runSimulation, type SimulationConfig } from '../tests/next-round-suggester/simulation/runner'
import { saveHTMLReport } from '../tests/next-round-suggester/simulation/reporter/html-report'

async function main() {
  const scenarioName = process.argv[2] ?? 'real_40'
  const seed = Number(process.argv[3] ?? 42)
  const config = getConfig(scenarioName, seed)
  const result = await runSimulation(config)
  const outputDir = path.resolve('simulation-reports')
  fs.mkdirSync(outputDir, { recursive: true })

  const filename = `${config.scenario_name ?? scenarioName}-seed${seed}-${Date.now()}.html`
  const outputPath = path.join(outputDir, filename)
  const jsonPath = outputPath.replace(/\.html$/i, '.json')
  saveHTMLReport(result, outputPath)
  fs.writeFileSync(jsonPath, stringifySimulationResult(result), 'utf8')

  console.log(`Report: ${outputPath}`)
  console.log(`Raw JSON: ${jsonPath}`)
  console.log(`Open: file://${outputPath}`)
}

function getConfig(name: string, seed: number): SimulationConfig {
  if (name === 'real_40') {
    const players = createRealSessionPlayers()
    return {
      scenario_name: 'real_40_from_session_json',
      n_players: players.length,
      courts: 10,
      rounds: 15,
      pvna_distribution: 'wide',
      gender_ratio: 0.5,
      gender_pref_rate: 0.3,
      group_count: 0,
      group_size_range: [2, 3],
      use_corrector: true,
      seed,
      initial_players: players,
    }
  }

  const scenario = BASELINE_SCENARIOS.find((item) => item.scenario_name === name)
  if (!scenario) {
    throw new Error(`Scenario "${name}" not found. Use real_40 or: ${BASELINE_SCENARIOS.map((item) => item.scenario_name).join(', ')}`)
  }

  return { ...scenario, seed }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})

function stringifySimulationResult(result: Awaited<ReturnType<typeof runSimulation>>): string {
  return JSON.stringify(
    result,
    (_key, value) => {
      if (value instanceof Map) return Object.fromEntries(value)
      if (value instanceof Date) return value.toISOString()
      return value
    },
    2,
  )
}
