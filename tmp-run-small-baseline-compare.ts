import fs from 'fs'
import path from 'path'

import { calculateOptimalCourts, type CourtPreset } from './lib/court-calculator'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
} from './lib/next-round-suggester/fairness/metrics'
import { computeRepeatPressure } from './lib/next-round-suggester/fairness/pressure'
import { runSimulation, type SimulationConfig } from './tests/next-round-suggester/simulation/runner'

const N_MIN = 8
const N_MAX = 12
const DURATIONS = [90, 120, 150]
const PRESETS: CourtPreset[] = ['play_more', 'balanced', 'relaxed']
const MATCH_DURATION_MIN = 15
const OLD_REPORT_PATH = 'simulation-reports/court-selector-full-audit-2026-05-16T03-48-14-419Z.json'
const OUTPUT_DIR = 'simulation-reports'

type OldReport = {
  id: string
  fairness: {
    total: number
    breakdown: {
      match_count: number
      partner_diversity: number
      opponent_diversity: number
      rest: number
      gender_prefs: number
    }
  }
}

type CompareRow = {
  id: string
  n_players: number
  duration_min: number
  preset: CourtPreset
  courts: number
  rounds: number
  old_fairness: number
  new_fairness: number
  delta: number
  old_partner: number
  new_partner: number
  old_opponent: number
  new_opponent: number
  repeat_risk: string
  penalty_multiplier: number
  match_range: number
  partner_ratio: number
  opponent_ratio: number
  gender_rate: number
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
    match_duration_min: MATCH_DURATION_MIN,
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

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return ''
  const [head, ...body] = rows
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function byPlayerCount(rows: CompareRow[]): string[][] {
  const out: string[][] = []
  for (let n = N_MIN; n <= N_MAX; n += 1) {
    const group = rows.filter((row) => row.n_players === n)
    out.push([
      String(n),
      String(group.length),
      average(group.map((row) => row.old_fairness)).toFixed(1),
      average(group.map((row) => row.new_fairness)).toFixed(1),
      average(group.map((row) => row.delta)).toFixed(1),
      average(group.map((row) => row.old_partner)).toFixed(1),
      average(group.map((row) => row.new_partner)).toFixed(1),
      average(group.map((row) => row.old_opponent)).toFixed(1),
      average(group.map((row) => row.new_opponent)).toFixed(1),
    ])
  }
  return out
}

function buildMarkdown(rows: CompareRow[], generatedAt: string): string {
  const totalDelta = average(rows.map((row) => row.delta))
  const improved = rows.filter((row) => row.delta > 0).length
  const same = rows.filter((row) => row.delta === 0).length
  const worse = rows.filter((row) => row.delta < 0).length

  return [
    '# Small-N Baseline Fairness Compare',
    '',
    `Generated: ${generatedAt}`,
    `Compared with: ${OLD_REPORT_PATH}`,
    `Cases: ${rows.length} (n=${N_MIN}-${N_MAX}, durations=${DURATIONS.join('/')}, presets=${PRESETS.join('/')})`,
    '',
    '## Summary',
    '',
    `- Avg old fairness: ${average(rows.map((row) => row.old_fairness)).toFixed(1)}`,
    `- Avg new fairness: ${average(rows.map((row) => row.new_fairness)).toFixed(1)}`,
    `- Avg delta: ${totalDelta.toFixed(1)}`,
    `- Improved/same/worse: ${improved}/${same}/${worse}`,
    '',
    '## By Player Count',
    '',
    markdownTable([
      ['n', 'cases', 'old avg', 'new avg', 'delta', 'old partner', 'new partner', 'old opponent', 'new opponent'],
      ...byPlayerCount(rows),
    ]),
    '',
    '## All Cases',
    '',
    markdownTable([
      [
        'case',
        'courts',
        'rounds',
        'old',
        'new',
        'delta',
        'partner old/new',
        'opponent old/new',
        'risk',
        'mult',
        'range',
        'ratios p/o',
        'gender',
      ],
      ...rows.map((row) => [
        row.id,
        String(row.courts),
        String(row.rounds),
        String(row.old_fairness),
        String(row.new_fairness),
        String(row.delta),
        `${row.old_partner}/${row.new_partner}`,
        `${row.old_opponent}/${row.new_opponent}`,
        row.repeat_risk,
        row.penalty_multiplier.toFixed(2),
        String(row.match_range),
        `${Math.round(row.partner_ratio * 100)}%/${Math.round(row.opponent_ratio * 100)}%`,
        `${Math.round(row.gender_rate * 100)}%`,
      ]),
    ]),
    '',
  ].join('\n')
}

async function main() {
  const generatedAt = new Date().toISOString()
  const oldPayload = JSON.parse(fs.readFileSync(OLD_REPORT_PATH, 'utf8')) as { reports: OldReport[] }
  const oldById = new Map(oldPayload.reports.map((report) => [report.id, report]))
  const rows: CompareRow[] = []

  for (let n = N_MIN; n <= N_MAX; n += 1) {
    for (const duration of DURATIONS) {
      for (const preset of PRESETS) {
        const config = buildConfig(n, duration, preset)
        const result = await runSimulation(config)
        const score = computeSessionFairness(result.final_state)
        const match = computeMatchCountMetrics(result.final_state)
        const partner = computePartnerDiversity(result.final_state)
        const opponent = computeOpponentDiversity(result.final_state)
        const gender = computeGenderPrefSatisfaction(result.final_state)
        const rest = computeRestFairness(result.final_state)
        const pressure = computeRepeatPressure(result.final_state)
        const old = oldById.get(config.scenario_name ?? '')
        if (!old) throw new Error(`Missing old report row for ${config.scenario_name}`)

        rows.push({
          id: config.scenario_name ?? '',
          n_players: n,
          duration_min: duration,
          preset,
          courts: config.courts,
          rounds: config.rounds,
          old_fairness: old.fairness.total,
          new_fairness: score.total,
          delta: score.total - old.fairness.total,
          old_partner: old.fairness.breakdown.partner_diversity,
          new_partner: score.breakdown.partner_diversity,
          old_opponent: old.fairness.breakdown.opponent_diversity,
          new_opponent: score.breakdown.opponent_diversity,
          repeat_risk: pressure.repeat_risk,
          penalty_multiplier: pressure.penalty_multiplier,
          match_range: match.range,
          partner_ratio: partner.avg_diversity_ratio,
          opponent_ratio: opponent.avg_diversity_ratio,
          gender_rate: gender.satisfaction_rate,
        })

        console.log(
          `${config.scenario_name}: ${old.fairness.total} -> ${score.total} delta=${score.total - old.fairness.total} risk=${pressure.repeat_risk} restViol=${rest.violations.length}`,
        )
      }
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const stamp = generatedAt.replace(/[:.]/g, '-')
  const jsonPath = path.join(OUTPUT_DIR, `small-baseline-fairness-compare-${stamp}.json`)
  const mdPath = path.join(OUTPUT_DIR, `small-baseline-fairness-compare-${stamp}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify({ generated_at: generatedAt, rows }, null, 2), 'utf8')
  fs.writeFileSync(mdPath, buildMarkdown(rows, generatedAt), 'utf8')

  console.log(`JSON: ${jsonPath}`)
  console.log(`Markdown: ${mdPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
