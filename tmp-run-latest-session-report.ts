import fs from 'fs'
import path from 'path'

import { calculateOptimalCourts, type CourtPreset } from './lib/court-calculator'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computePartnerDiversity,
  computeRestFairness,
} from './lib/next-round-suggester/fairness/metrics'
import type { Match, PlayerSessionState } from './lib/next-round-suggester/types'
import { runSimulation, type SimulationConfig, type SimulationResult } from './tests/next-round-suggester/simulation/runner'

const N_MIN = 8
const N_MAX = 40
const DURATIONS = [90, 120, 150]
const PRESETS: CourtPreset[] = ['play_more', 'balanced', 'relaxed']
const MATCH_DURATION_MIN = 15
const OUTPUT_DIR = 'simulation-reports'

type PairCount = {
  player_a: string
  player_b: string
  count: number
  same_group: boolean
}

type GroupPairAudit = {
  group_id: string
  player_a: string
  player_b: string
  same_round_count: number
  same_team_count: number
  opponent_count: number
  partner_count: number
}

type CaseReport = {
  id: string
  n_players: number
  duration_min: number
  match_duration_min: number
  preset: CourtPreset
  seed: number
  group_count: number
  group_size_range: [number, number]
  recommended: {
    courts: number
    rounds: number
    calc_avg_matches: number
    play_ratio: number
    quality_score: number
    feasibility: string
    quality_notes: string[]
    warnings: string[]
  }
  fairness: SimulationResult['fairness_score']
  match_count: {
    min: number
    max: number
    avg: number
    range: number
    std: number
  }
  diversity: {
    partner_avg_unique: number
    partner_ratio: number
    opponent_avg_unique: number
    opponent_ratio: number
  }
  repeats: {
    partner_pairs_count: number
    opponent_pairs_count: number
    max_partner_pair: number
    max_opponent_pair: number
    partner_pairs_top: PairCount[]
    opponent_pairs_top: PairCount[]
    heavy_opponent_players: Array<{
      player_id: string
      repeated_opponents: number
      repeated_partners: number
      matches_played: number
      unique_opponents: number
      unique_partners: number
    }>
  }
  rest: {
    max_consecutive_rest: number
    violations: number
  }
  gender: {
    satisfaction_rate: number
    satisfied_count: number
    total_pref_opportunities: number
  }
  groups: {
    groups_count: number
    grouped_players: number
    group_pairs_total: number
    group_pairs_served: number
    group_coverage_rate: number
    unserved_group_pairs: GroupPairAudit[]
    group_pairs_top: GroupPairAudit[]
  }
  engine: {
    adjustments: SimulationResult['adjustments_applied']
    warnings: SimulationResult['warnings_raised']
    invariant_violations: string[]
    avg_suggest_ms: number
    max_suggest_ms: number
  }
  flags: string[]
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

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function pairFromKey(key: string): [string, string] {
  const [a, b] = key.split(':')
  return [a, b]
}

function buildPairLookup(pairs: PairCount[]): Map<string, number> {
  return new Map(pairs.map((pair) => [pairKey(pair.player_a, pair.player_b), pair.count]))
}

function sameGroup(state: SimulationResult['final_state'], a: string, b: string): boolean {
  const playerA = state.players.get(a)
  const playerB = state.players.get(b)
  return Boolean(playerA?.group_id && playerA.group_id === playerB?.group_id)
}

function toPairCounts(
  result: SimulationResult,
  pairs: Array<{ player_a: string; player_b: string; count: number }>,
): PairCount[] {
  return pairs
    .map((pair) => ({
      ...pair,
      same_group: sameGroup(result.final_state, pair.player_a, pair.player_b),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return `${a.player_a}/${a.player_b}`.localeCompare(`${b.player_a}/${b.player_b}`)
    })
}

function matchPlayers(match: Match): string[] {
  return [...match.team_a, ...match.team_b]
}

function buildGroupAudit(result: SimulationResult, partnerPairs: PairCount[], opponentPairs: PairCount[]) {
  const groups = new Map<string, PlayerSessionState[]>()
  for (const player of result.final_state.players.values()) {
    if (!player.group_id) continue
    const current = groups.get(player.group_id) ?? []
    current.push(player)
    groups.set(player.group_id, current)
  }

  const partnerLookup = buildPairLookup(partnerPairs)
  const opponentLookup = buildPairLookup(opponentPairs)
  const groupPairs: GroupPairAudit[] = []
  let groupedPlayers = 0

  for (const [groupId, players] of groups) {
    groupedPlayers += players.length
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i].player_id
        const b = players[j].player_id
        const key = pairKey(a, b)
        groupPairs.push({
          group_id: groupId,
          player_a: a,
          player_b: b,
          same_round_count: countSameRound(result, a, b),
          same_team_count: countSameTeam(result, a, b),
          opponent_count: opponentLookup.get(key) ?? 0,
          partner_count: partnerLookup.get(key) ?? 0,
        })
      }
    }
  }

  const served = groupPairs.filter((pair) => pair.same_team_count > 0).length

  return {
    groups_count: groups.size,
    grouped_players: groupedPlayers,
    group_pairs_total: groupPairs.length,
    group_pairs_served: served,
    group_coverage_rate: groupPairs.length === 0 ? 1 : served / groupPairs.length,
    unserved_group_pairs: groupPairs
      .filter((pair) => pair.same_team_count === 0)
      .sort((a, b) => b.same_round_count - a.same_round_count),
    group_pairs_top: groupPairs
      .sort((a, b) => {
        if (b.same_team_count !== a.same_team_count) return b.same_team_count - a.same_team_count
        if (b.same_round_count !== a.same_round_count) return b.same_round_count - a.same_round_count
        return `${a.group_id}:${a.player_a}/${a.player_b}`.localeCompare(`${b.group_id}:${b.player_a}/${b.player_b}`)
      })
      .slice(0, 10),
  }
}

function countSameRound(result: SimulationResult, a: string, b: string): number {
  let count = 0
  for (const round of result.rounds_completed) {
    const playing = new Set(round.matches.flatMap(matchPlayers))
    if (playing.has(a) && playing.has(b)) count += 1
  }
  return count
}

function countSameTeam(result: SimulationResult, a: string, b: string): number {
  let count = 0
  for (const round of result.rounds_completed) {
    for (const match of round.matches) {
      if (
        (match.team_a.includes(a) && match.team_a.includes(b)) ||
        (match.team_b.includes(a) && match.team_b.includes(b))
      ) {
        count += 1
      }
    }
  }
  return count
}

function buildFlags(report: Omit<CaseReport, 'flags'>): string[] {
  const flags: string[] = []
  if (report.engine.invariant_violations.length > 0) flags.push('invariant')
  if (report.fairness.total < 85) flags.push(`fairness_${report.fairness.total}`)
  if (report.match_count.range > 1) flags.push(`match_range_${report.match_count.range}`)
  if (report.repeats.max_partner_pair > 2) flags.push(`partner_max_${report.repeats.max_partner_pair}`)
  if (report.repeats.max_opponent_pair > 2) flags.push(`opponent_max_${report.repeats.max_opponent_pair}`)
  const maxOpponentBurden = report.repeats.heavy_opponent_players[0]?.repeated_opponents ?? 0
  if (maxOpponentBurden >= 3) flags.push(`opponent_burden_${maxOpponentBurden}`)
  if (report.rest.max_consecutive_rest > 1) flags.push(`rest_${report.rest.max_consecutive_rest}`)
  if (report.groups.group_pairs_total > 0 && report.groups.group_coverage_rate < 0.7) {
    flags.push(`group_coverage_${Math.round(report.groups.group_coverage_rate * 100)}pct`)
  }
  if (report.gender.total_pref_opportunities > 0 && report.gender.satisfaction_rate < 0.6) {
    flags.push(`gender_${Math.round(report.gender.satisfaction_rate * 100)}pct`)
  }
  if (report.engine.avg_suggest_ms > 500) flags.push(`slow_${Math.round(report.engine.avg_suggest_ms)}ms`)
  return flags
}

async function runCase(nPlayers: number, duration: number, preset: CourtPreset): Promise<CaseReport> {
  const seed = hashSeed(`${nPlayers}:${duration}:${preset}`)
  const groups = groupPlan(nPlayers)
  const calculator = calculateOptimalCourts({
    n_players: nPlayers,
    session_duration_min: duration,
    match_duration_min: MATCH_DURATION_MIN,
    preset,
  })
  const config: SimulationConfig = {
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
  const result = await runSimulation(config)
  const match = computeMatchCountMetrics(result.final_state)
  const partner = computePartnerDiversity(result.final_state)
  const opponent = computeOpponentDiversity(result.final_state)
  const rest = computeRestFairness(result.final_state)
  const gender = computeGenderPrefSatisfaction(result.final_state)
  const partnerPairs = toPairCounts(result, partner.repeat_pairs)
  const opponentPairs = toPairCounts(result, opponent.repeat_pairs)
  const groupsAudit = buildGroupAudit(result, partnerPairs, opponentPairs)
  const heavyOpponentPlayers = result.per_player_stats
    .filter((player) => player.opponent_repeats > 0 || player.partner_repeats > 0)
    .map((player) => ({
      player_id: player.player_id,
      repeated_opponents: player.opponent_repeats,
      repeated_partners: player.partner_repeats,
      matches_played: player.matches_played,
      unique_opponents: player.unique_opponents,
      unique_partners: player.unique_partners,
    }))
    .sort((a, b) => {
      if (b.repeated_opponents !== a.repeated_opponents) return b.repeated_opponents - a.repeated_opponents
      if (b.repeated_partners !== a.repeated_partners) return b.repeated_partners - a.repeated_partners
      return a.player_id.localeCompare(b.player_id)
    })
    .slice(0, 10)

  const reportWithoutFlags = {
    id: config.scenario_name ?? `${nPlayers}_${duration}_${preset}`,
    n_players: nPlayers,
    duration_min: duration,
    match_duration_min: MATCH_DURATION_MIN,
    preset,
    seed,
    group_count: groups.group_count,
    group_size_range: groups.group_size_range,
    recommended: {
      courts: calculator.recommended.courts,
      rounds: calculator.recommended.total_rounds,
      calc_avg_matches: calculator.recommended.avg_matches_per_player,
      play_ratio: calculator.recommended.play_ratio,
      quality_score: calculator.recommended.quality_score,
      feasibility: calculator.recommended.feasibility,
      quality_notes: calculator.recommended.quality_notes,
      warnings: calculator.recommended.warnings,
    },
    fairness: result.fairness_score,
    match_count: {
      min: match.min,
      max: match.max,
      avg: Number(match.avg.toFixed(2)),
      range: match.range,
      std: Number(match.std.toFixed(2)),
    },
    diversity: {
      partner_avg_unique: Number(partner.avg_unique_partners.toFixed(2)),
      partner_ratio: Number(partner.avg_diversity_ratio.toFixed(2)),
      opponent_avg_unique: Number(opponent.avg_unique_partners.toFixed(2)),
      opponent_ratio: Number(opponent.avg_diversity_ratio.toFixed(2)),
    },
    repeats: {
      partner_pairs_count: partnerPairs.length,
      opponent_pairs_count: opponentPairs.length,
      max_partner_pair: Math.max(0, ...partnerPairs.map((pair) => pair.count)),
      max_opponent_pair: Math.max(0, ...opponentPairs.map((pair) => pair.count)),
      partner_pairs_top: partnerPairs.slice(0, 10),
      opponent_pairs_top: opponentPairs.slice(0, 10),
      heavy_opponent_players: heavyOpponentPlayers,
    },
    rest: {
      max_consecutive_rest: Math.max(0, ...rest.per_player.map((player) => player.max_consecutive_rest)),
      violations: rest.violations.length,
    },
    gender: {
      satisfaction_rate: Number(gender.satisfaction_rate.toFixed(2)),
      satisfied_count: gender.satisfied_count,
      total_pref_opportunities: gender.total_pref_opportunities,
    },
    groups: groupsAudit,
    engine: {
      adjustments: result.adjustments_applied,
      warnings: result.warnings_raised,
      invariant_violations: result.invariant_violations,
      avg_suggest_ms: Number(result.avg_suggest_time_ms.toFixed(2)),
      max_suggest_ms: Number(result.max_suggest_time_ms.toFixed(2)),
    },
  }

  return {
    ...reportWithoutFlags,
    flags: buildFlags(reportWithoutFlags),
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
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

function formatPair(pair: PairCount): string {
  return `${pair.player_a}/${pair.player_b}:${pair.count}${pair.same_group ? '(group)' : ''}`
}

function formatGroupPair(pair: GroupPairAudit): string {
  return `${pair.group_id}:${pair.player_a}/${pair.player_b} team=${pair.same_team_count} sameRound=${pair.same_round_count} opp=${pair.opponent_count}`
}

function buildMarkdown(reports: CaseReport[], startedAt: string): string {
  const flagged = reports.filter((report) => report.flags.length > 0)
  const scores = reports.map((report) => report.fairness.total)
  const courtMapRows = reports.map((report) => [
    String(report.n_players),
    String(report.duration_min),
    report.preset,
    String(report.recommended.courts),
    String(report.recommended.rounds),
    report.recommended.calc_avg_matches.toFixed(1),
    `${Math.round(report.recommended.play_ratio * 100)}%`,
    report.recommended.quality_score.toFixed(2),
    String(report.fairness.total),
    `${report.match_count.min}-${report.match_count.max}`,
    `${report.repeats.partner_pairs_count}/${report.repeats.opponent_pairs_count}`,
    `${report.repeats.max_partner_pair}/${report.repeats.max_opponent_pair}`,
    String(report.repeats.heavy_opponent_players[0]?.repeated_opponents ?? 0),
    `${Math.round(report.groups.group_coverage_rate * 100)}%`,
    `${Math.round(report.gender.satisfaction_rate * 100)}%`,
    report.flags.join(', ') || '-',
  ])
  const worstRows = [...reports]
    .sort((a, b) => {
      if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length
      return a.fairness.total - b.fairness.total
    })
    .slice(0, 40)
    .map((report) => [
      report.id,
      String(report.recommended.courts),
      String(report.fairness.total),
      report.flags.join(', ') || '-',
      report.repeats.partner_pairs_top.slice(0, 3).map(formatPair).join('<br>') || '-',
      report.repeats.opponent_pairs_top.slice(0, 3).map(formatPair).join('<br>') || '-',
      report.groups.unserved_group_pairs.slice(0, 3).map(formatGroupPair).join('<br>') || '-',
    ])
  const byNRows = Array.from({ length: N_MAX - N_MIN + 1 }, (_, index) => N_MIN + index).map((n) => {
    const group = reports.filter((report) => report.n_players === n)
    return [
      String(n),
      String(group.length),
      average(group.map((report) => report.fairness.total)).toFixed(1),
      String(Math.min(...group.map((report) => report.fairness.total))),
      String(Math.max(...group.map((report) => report.fairness.total))),
      String(group.filter((report) => report.flags.length > 0).length),
      average(group.map((report) => report.recommended.courts)).toFixed(1),
      average(group.map((report) => report.groups.group_coverage_rate * 100)).toFixed(0) + '%',
    ]
  })

  return [
    '# Court Selector Full Simulation Audit',
    '',
    `Generated: ${startedAt}`,
    `Cases: ${reports.length} (n=${N_MIN}-${N_MAX}, durations=${DURATIONS.join('/')}, presets=${PRESETS.join('/')})`,
    `Match duration: ${MATCH_DURATION_MIN} min`,
    '',
    '## Summary',
    '',
    `- Average fairness: ${average(scores).toFixed(1)}`,
    `- Median fairness: ${median(scores).toFixed(1)}`,
    `- Min fairness: ${Math.min(...scores)}`,
    `- Max fairness: ${Math.max(...scores)}`,
    `- Flagged cases: ${flagged.length}/${reports.length}`,
    '',
    '## Aggregate By Player Count',
    '',
    markdownTable([
      ['n', 'cases', 'avg fairness', 'min', 'max', 'flagged', 'avg courts', 'avg group coverage'],
      ...byNRows,
    ]),
    '',
    '## Flagged / Worst Cases',
    '',
    markdownTable([
      ['case', 'courts', 'fairness', 'flags', 'top partner repeats', 'top opponent repeats', 'unserved group pairs'],
      ...worstRows,
    ]),
    '',
    '## All Cases',
    '',
    markdownTable([
      [
        'n',
        'duration',
        'preset',
        'courts',
        'rounds',
        'calc avg',
        'play ratio',
        'quality',
        'fairness',
        'matches',
        'repeat P/O',
        'max P/O',
        'opp burden',
        'group cov',
        'gender',
        'flags',
      ],
      ...courtMapRows,
    ]),
    '',
    '## Notes',
    '',
    '- `repeat P/O` = repeated partner pair count / repeated opponent pair count.',
    '- `max P/O` = highest repeat count for any partner pair / opponent pair.',
    '- `opp burden` = max number of repeated opponents attached to one player.',
    '- Full raw details, including top repeats and group pair audit per case, are in the sibling JSON file.',
    '',
  ].join('\n')
}

async function main() {
  const startedAt = new Date().toISOString()
  const reports: CaseReport[] = []
  const total = (N_MAX - N_MIN + 1) * DURATIONS.length * PRESETS.length
  let completed = 0

  for (let n = N_MIN; n <= N_MAX; n += 1) {
    for (const duration of DURATIONS) {
      for (const preset of PRESETS) {
        completed += 1
        const report = await runCase(n, duration, preset)
        reports.push(report)
        if (completed % 25 === 0 || completed === total) {
          console.log(`Progress ${completed}/${total}: ${report.id} fairness=${report.fairness.total} flags=${report.flags.join(',') || '-'}`)
        }
      }
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const stamp = startedAt.replace(/[:.]/g, '-')
  const jsonPath = path.join(OUTPUT_DIR, `court-selector-full-audit-${stamp}.json`)
  const mdPath = path.join(OUTPUT_DIR, `court-selector-full-audit-${stamp}.md`)
  const payload = {
    generated_at: startedAt,
    config: {
      n_min: N_MIN,
      n_max: N_MAX,
      durations: DURATIONS,
      presets: PRESETS,
      match_duration_min: MATCH_DURATION_MIN,
      cases: total,
    },
    reports,
  }

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
  fs.writeFileSync(mdPath, buildMarkdown(reports, startedAt), 'utf8')

  console.log(`JSON: ${jsonPath}`)
  console.log(`Markdown: ${mdPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
