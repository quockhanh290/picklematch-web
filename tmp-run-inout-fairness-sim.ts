import seedrandom from 'seedrandom'

import { applyFairnessAdjustment, correctForFairness } from './lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues, type WarningType } from './lib/next-round-suggester/fairness/detector'
import {
  computeAvailabilityMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computePartnerRepeatBurden,
  computeSessionFairness,
} from './lib/next-round-suggester/fairness/metrics'
import { applyCompletedRoundToState } from './lib/next-round-suggester/history'
import { suggestNextRound } from './lib/next-round-suggester/suggest'
import type { PlayerSessionState, RoundRecord, SessionState } from './lib/next-round-suggester/types'
import { generatePlayers, initState } from './tests/next-round-suggester/simulation/generators'
import type { SimulationConfig } from './tests/next-round-suggester/simulation/runner'

type ChurnEvent = {
  round: number
  in?: string[]
  out?: string[]
}

type CaseConfig = {
  name: string
  config: SimulationConfig
  events: ChurnEvent[]
  initiallyOut: string[]
}

type RunSummary = {
  fairness: ReturnType<typeof computeSessionFairness>
  availability: ReturnType<typeof computeAvailabilityMetrics>
  partner: ReturnType<typeof computePartnerDiversity>
  opponent: ReturnType<typeof computeOpponentDiversity>
  partnerBurden: ReturnType<typeof computePartnerRepeatBurden>
  opponentBurden: ReturnType<typeof computeOpponentRepeatBurden>
  warnings: { type: WarningType; count: number }[]
  violations: string[]
  evolution: { round: number; score: number }[]
}

const CASES: CaseConfig[] = [
  {
    name: 'late_join_20p_4c_8r',
    config: baseConfig('late_join_20p_4c_8r', 20, 4, 8, 12001),
    initiallyOut: ['player_17', 'player_18', 'player_19', 'player_20'],
    events: [{ round: 4, in: ['player_17', 'player_18', 'player_19', 'player_20'] }],
  },
  {
    name: 'early_leave_20p_4c_8r',
    config: baseConfig('early_leave_20p_4c_8r', 20, 4, 8, 12002),
    initiallyOut: [],
    events: [{ round: 5, out: ['player_17', 'player_18', 'player_19', 'player_20'] }],
  },
  {
    name: 'mixed_in_out_rejoin_24p_5c_9r',
    config: baseConfig('mixed_in_out_rejoin_24p_5c_9r', 24, 5, 9, 12003),
    initiallyOut: ['player_21', 'player_22', 'player_23', 'player_24'],
    events: [
      { round: 3, in: ['player_21', 'player_22'] },
      { round: 5, out: ['player_05', 'player_06'] },
      { round: 7, in: ['player_23', 'player_24', 'player_05'] },
    ],
  },
]

function baseConfig(
  scenarioName: string,
  nPlayers: number,
  courts: number,
  rounds: number,
  seed: number,
): SimulationConfig {
  return {
    scenario_name: scenarioName,
    n_players: nPlayers,
    courts,
    rounds,
    pvna_distribution: 'wide',
    gender_ratio: 0.5,
    gender_pref_rate: 0.3,
    group_count: nPlayers >= 20 ? 3 : 2,
    group_size_range: [2, 4],
    use_corrector: true,
    seed,
  }
}

function clonePlayers(players: PlayerSessionState[]): PlayerSessionState[] {
  return players.map((player) => ({
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }))
}

async function runCase(input: {
  config: SimulationConfig
  players: PlayerSessionState[]
  initiallyOut?: string[]
  events?: ChurnEvent[]
}): Promise<RunSummary> {
  let state = initState(input.players, {
    courts: input.config.courts,
    pvna_tolerance: 0.5,
  })
  const warningsCount = new Map<WarningType, number>()
  const violations: string[] = []
  const evolution: { round: number; score: number }[] = []

  state = applyPresenceEvents(state, {
    round: 0,
    out: input.initiallyOut ?? [],
  })

  for (let roundNo = 1; roundNo <= input.config.rounds; roundNo += 1) {
    for (const event of input.events?.filter((item) => item.round === roundNo) ?? []) {
      state = applyPresenceEvents(state, event)
    }

    for (const warning of detectFairnessIssues(state)) {
      warningsCount.set(warning.type, (warningsCount.get(warning.type) ?? 0) + 1)
    }

    const adjustment = input.config.use_corrector ? correctForFairness(state) : null
    const effectiveState = adjustment ? applyFairnessAdjustment(state, adjustment) : state
    const suggestion = suggestNextRound(effectiveState, {
      tier_overrides: adjustment?.tier_overrides ?? {},
    })
    const alternative = suggestion.alternatives[0]
    if (!alternative) {
      violations.push(`R${roundNo}: no suggestion`)
      break
    }

    violations.push(...validateRound(state, alternative, roundNo))

    const roundRecord: RoundRecord = {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed',
      matches: alternative.matches,
      resting: alternative.resting,
      started_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 0)),
      ended_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 30)),
    }
    state = applyCompletedRoundToState(state, roundRecord)
    evolution.push({ round: roundNo, score: computeSessionFairness(state).total })
  }

  return {
    fairness: computeSessionFairness(state),
    availability: computeAvailabilityMetrics(state),
    partner: computePartnerDiversity(state),
    opponent: computeOpponentDiversity(state),
    partnerBurden: computePartnerRepeatBurden(state),
    opponentBurden: computeOpponentRepeatBurden(state),
    warnings: [...warningsCount]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    violations,
    evolution,
  }
}

function applyPresenceEvents(state: SessionState, event: ChurnEvent): SessionState {
  const players = new Map(state.players)
  const timestamp = new Date(Date.UTC(2026, 4, 15, 12, event.round, 0))

  for (const playerId of event.out ?? []) {
    const player = players.get(playerId)
    if (!player) continue
    players.set(playerId, {
      ...player,
      checked_out_at: timestamp,
      consecutive_play: 0,
      consecutive_rest: 0,
    })
  }

  for (const playerId of event.in ?? []) {
    const player = players.get(playerId)
    if (!player) continue
    players.set(playerId, {
      ...player,
      checked_out_at: null,
      checked_in_at: timestamp,
      consecutive_play: 0,
      consecutive_rest: 0,
    })
  }

  return { ...state, players }
}

function validateRound(
  state: SessionState,
  alternative: { matches: Array<{ team_a: [string, string]; team_b: [string, string] }>; resting: string[] },
  roundNo: number,
): string[] {
  const playing = alternative.matches.flatMap((match) => [...match.team_a, ...match.team_b])
  const present = [...state.players.values()].filter((player) => player.checked_out_at === null).length
  const violations: string[] = []

  if (new Set(playing).size !== playing.length) violations.push(`R${roundNo}: double-book`)
  if (playing.length + alternative.resting.length !== present) {
    violations.push(`R${roundNo}: assigned ${playing.length + alternative.resting.length}, present ${present}`)
  }
  return violations
}

function formatWarnings(warnings: RunSummary['warnings']): string {
  return warnings.length === 0
    ? '-'
    : warnings.map((warning) => `${warning.type}:${warning.count}`).join(', ')
}

function printCompare(name: string, baseline: RunSummary, churn: RunSummary) {
  const diff = churn.fairness.total - baseline.fairness.total
  console.log(`\n## ${name}`)
  console.log(`score: ${baseline.fairness.total} -> ${churn.fairness.total} (${diff >= 0 ? '+' : ''}${diff})`)
  console.log(`breakdown baseline: ${JSON.stringify(baseline.fairness.breakdown)}`)
  console.log(`breakdown in/out : ${JSON.stringify(churn.fairness.breakdown)}`)
  console.log(`availability: ${baseline.availability.churn_level} x${baseline.availability.penalty_multiplier} -> ${churn.availability.churn_level} x${churn.availability.penalty_multiplier}, changes ${baseline.availability.total_roster_changes} -> ${churn.availability.total_roster_changes}, churn ${Math.round(baseline.availability.avg_churn_ratio * 100)}% -> ${Math.round(churn.availability.avg_churn_ratio * 100)}%`)
  console.log(`partner repeats: ${baseline.partner.repeat_pairs.length} -> ${churn.partner.repeat_pairs.length}, max burden ${baseline.partnerBurden.max_repeated_partners} -> ${churn.partnerBurden.max_repeated_partners}`)
  console.log(`opponent repeats: ${baseline.opponent.repeat_pairs.length} -> ${churn.opponent.repeat_pairs.length}, max burden ${baseline.opponentBurden.max_repeated_opponents} -> ${churn.opponentBurden.max_repeated_opponents}`)
  console.log(`warnings baseline: ${formatWarnings(baseline.warnings)}`)
  console.log(`warnings in/out : ${formatWarnings(churn.warnings)}`)
  console.log(`evolution baseline: ${baseline.evolution.map((item) => item.score).join(' -> ')}`)
  console.log(`evolution in/out : ${churn.evolution.map((item) => item.score).join(' -> ')}`)
  console.log(`violations baseline/in-out: ${baseline.violations.length}/${churn.violations.length}`)
}

async function main() {
  for (const item of CASES) {
    const rng = seedrandom(String(item.config.seed))
    const players = generatePlayers(item.config, rng)
    const baseline = await runCase({ config: item.config, players: clonePlayers(players) })
    const churn = await runCase({
      config: item.config,
      players: clonePlayers(players),
      initiallyOut: item.initiallyOut,
      events: item.events,
    })

    printCompare(item.name, baseline, churn)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
