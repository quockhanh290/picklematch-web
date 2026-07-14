import { performance } from 'node:perf_hooks'

import {
  buildInitialState,
  type RawPlayer,
  type RawProfile,
} from './evaluate-session-quality-counterfactual'
import {
  buildPrecomputedSessionPlan,
  summarizeSessionPlan,
} from '../../lib/next-round-suggester/planner/session-plan'

type Scenario = {
  players: number
  courts: number
  rounds: number
}

const QUICK_SCENARIOS: Scenario[] = [
  { players: 24, courts: 4, rounds: 8 },
  { players: 28, courts: 6, rounds: 8 },
  { players: 32, courts: 6, rounds: 8 },
  { players: 36, courts: 6, rounds: 8 },
]

function fullScenarios() {
  const scenarios: Scenario[] = []
  for (const players of [24, 28, 32, 36]) {
    for (const courts of [4, 5, 6]) {
      if (players < courts * 4) continue
      for (const rounds of [6, 8, 10]) scenarios.push({ players, courts, rounds })
    }
  }
  return scenarios
}

function syntheticRoster(playerCount: number) {
  const players: RawPlayer[] = []
  const profiles: RawProfile[] = []
  for (let index = 0; index < playerCount; index += 1) {
    const id = `p${String(index + 1).padStart(2, '0')}`
    const pvna = Number((2.5 + (((index * 37) % 101) / 100) * 3).toFixed(2))
    players.push({
      player_id: id,
      session_id: `synthetic-${playerCount}`,
      checked_in_at: new Date(0).toISOString(),
      checked_out_at: null,
      effective_pvna: pvna,
    })
    profiles.push({
      id,
      name: id,
      pvna,
      gender: index % 2 === 0 ? 'male' : 'female',
      partner_gender_pref: 'any',
      opponent_gender_pref: 'any',
    })
  }
  return { players, profiles }
}

function main() {
  const full = process.argv.includes('--full')
  const numericArg = (name: string) => {
    const argument = process.argv.find(value => value.startsWith(`--${name}=`))
    return argument ? Number(argument.split('=')[1]) : undefined
  }
  const passesArg = process.argv.find(argument => argument.startsWith('--passes='))
  const roundBudgetMs = numericArg('round-budget-ms')
  const localSearchPasses = passesArg ? Number(passesArg.split('=')[1]) : full ? 3 : 1
  const selectedPlayers = numericArg('players')
  const selectedCourts = numericArg('courts')
  const selectedRounds = numericArg('rounds')
  const scenarios = selectedPlayers && selectedCourts && selectedRounds
    ? [{ players: selectedPlayers, courts: selectedCourts, rounds: selectedRounds }]
    : full
      ? fullScenarios()
      : QUICK_SCENARIOS
  const results = scenarios.map(scenario => {
    const roster = syntheticRoster(scenario.players)
    const state = buildInitialState(roster.players, roster.profiles, scenario.courts)
    const heapBefore = process.memoryUsage().heapUsed
    const cpuStartedAt = process.cpuUsage()
    const wallStartedAt = performance.now()
    const shadow = buildPrecomputedSessionPlan(state, scenario.rounds, scenario.courts, {
      localSearchPasses,
      maxRoundRuntimeMs: roundBudgetMs,
    })
    const wallMs = performance.now() - wallStartedAt
    const cpu = process.cpuUsage(cpuStartedAt)
    const summary = summarizeSessionPlan(shadow)
    const playingPerRound = scenario.courts * 4
    const restPerRound = scenario.players - playingPerRound
    const expectedMaxRestStreak = restPerRound === 0 ? 0 : Math.ceil(restPerRound / playingPerRound)
    if (shadow.invariants.duplicate_player_rounds !== 0) {
      throw new Error(`Duplicate player invariant failed for ${JSON.stringify(scenario)}`)
    }
    if (shadow.invariants.full_rounds !== scenario.rounds) {
      throw new Error(`Full-round invariant failed for ${JSON.stringify(scenario)}`)
    }
    if (summary.match_count_max - summary.match_count_min > 1) {
      throw new Error(`Match-count spread failed for ${JSON.stringify(scenario)}`)
    }
    if (shadow.invariants.max_consecutive_rest > expectedMaxRestStreak) {
      throw new Error(`Rest-streak bound failed for ${JSON.stringify(scenario)}`)
    }
    return {
      ...scenario,
      passes: localSearchPasses,
      wall_ms: Math.round(wallMs),
      cpu_ms: Math.round((cpu.user + cpu.system) / 1000),
      heap_delta_mb: Number(((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2)),
      slowest_round_ms: Math.round(Math.max(...shadow.timings.rounds.map(round => round.total_ms))),
      avg_round_ms: Math.round(shadow.timings.rounds.reduce((sum, round) => sum + round.total_ms, 0) / scenario.rounds),
      timed_out_rounds: shadow.timings.rounds.filter(round => round.timed_out).length,
      candidates_evaluated: shadow.timings.rounds.reduce((sum, round) => sum + round.candidates_evaluated, 0),
      invariants: shadow.invariants,
      quality: {
        match_count_range: [summary.match_count_min, summary.match_count_max],
        max_team_gap: Number(summary.max_team_gap.toFixed(3)),
        team_gap_over_1: summary.team_gap_over_1,
        max_intra_gap: Number(summary.max_intra_gap.toFixed(3)),
        intra_gap_over_2: summary.intra_gap_over_2,
        partner_repeats: summary.partner_repeats,
        opponent_repeats: summary.opponent_repeats,
      },
    }
  })

  console.log(JSON.stringify({
    mode: selectedPlayers ? 'custom' : full ? 'full' : 'quick',
    local_search_passes: localSearchPasses,
    round_budget_ms: roundBudgetMs ?? null,
    scenario_count: results.length,
    edge_cpu_budget_ms: 2000,
    results,
  }, null, 2))
}

main()
