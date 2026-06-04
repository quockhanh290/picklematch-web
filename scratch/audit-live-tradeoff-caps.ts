import {
  buildSuggestedMatchPayloads,
  getAlternativeIntraTeamGap,
  getTradeoffChoiceMetrics,
  type SuggestedLiveMatchRow,
} from '../lib/next-round-suggester/live-preview'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'
import type {
  Match,
  SessionLiveMatchRow,
  SessionState,
  SuggestionAlternative,
  SuggestionTradeoffChoice,
} from '../lib/next-round-suggester/types'
import { runSimulation, type SimulationConfig } from '../tests/next-round-suggester/simulation/runner'

type Issue = {
  scenario: string
  seed: number
  court: number | null
  match: string
  reason: string
  details?: Record<string, unknown>
}

type AuditSummary = {
  payloads: number
  capCases: number
  withChoices: number
  noUsefulChoices: number
  pvnaOverCases: number
  intraOverCases: number
  repeatOverCases: number
  issues: Issue[]
}

const scenarios: SimulationConfig[] = [
  ...[101, 102, 103, 104, 105].map(seed => baseScenario(`wide_24_seed_${seed}`, seed, 24, 6, 7, 'wide')),
  ...[201, 202, 203, 204, 205].map(seed => baseScenario(`extreme_24_seed_${seed}`, seed, 24, 6, 7, 'extreme')),
  ...[301, 302, 303, 304, 305].map(seed => baseScenario(`bimodal_28_seed_${seed}`, seed, 28, 7, 7, 'bimodal')),
  ...[401, 402, 403, 404, 405].map(seed => baseScenario(`wide_20_seed_${seed}`, seed, 20, 5, 7, 'wide')),
]

function baseScenario(
  scenarioName: string,
  seed: number,
  players: number,
  courts: number,
  rounds: number,
  pvnaDistribution: SimulationConfig['pvna_distribution'],
): SimulationConfig {
  return {
    scenario_name: scenarioName,
    seed,
    n_players: players,
    courts,
    rounds,
    pvna_distribution: pvnaDistribution,
    gender_ratio: 0.5,
    gender_pref_rate: 0.15,
    group_count: Math.max(2, Math.floor(players / 8)),
    group_size_range: [2, 4],
    use_corrector: true,
  }
}

function stateToCompletedRows(state: SessionState): SessionLiveMatchRow[] {
  const rows: SessionLiveMatchRow[] = []
  let sequenceNo = 0
  for (const round of state.rounds) {
    for (const match of round.matches) {
      rows.push({
        id: `audit-r${round.round_no}-c${match.court_idx ?? sequenceNo}`,
        session_id: state.session_id,
        sequence_no: sequenceNo++,
        round_no: round.round_no,
        court_idx: match.court_idx ?? null,
        status: 'completed',
        team_a: match.team_a,
        team_b: match.team_b,
        resting: [],
        score_a: 0,
        score_b: 0,
        suggested_at: round.started_at?.toISOString() ?? new Date().toISOString(),
        started_at: round.started_at?.toISOString() ?? null,
        ended_at: round.ended_at?.toISOString() ?? null,
      })
    }
  }
  return rows
}

function teamPvna(team: [string, string], state: SessionState) {
  return (state.players.get(team[0])?.pvna ?? 0) + (state.players.get(team[1])?.pvna ?? 0)
}

function payloadToAlternative(
  match: Pick<SuggestedLiveMatchRow, 'court_idx' | 'team_a' | 'team_b' | 'resting' | 'warnings' | 'tradeoffs' | 'approval_required'>,
  state: SessionState,
): SuggestionAlternative {
  const pvnaDiff = Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state))
  const singleMatch: Match = {
    court_idx: match.court_idx ?? 0,
    team_a: match.team_a,
    team_b: match.team_b,
    stats: {
      pvna_diff: pvnaDiff,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
  return {
    matches: [singleMatch],
    resting: match.resting,
    score: 0,
    warnings: match.warnings ?? [],
    tradeoffs: match.tradeoffs,
    approval_required: match.approval_required,
    stats: {
      pvna_diff: pvnaDiff,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
}

function namesForMatch(match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>) {
  return `${match.team_a.join('+')} vs ${match.team_b.join('+')}`
}

function choiceKey(choice: SuggestionTradeoffChoice) {
  const match = choice.alternative.matches[0]
  if (!match) return ''
  return [
    [...match.team_a].sort().join('+'),
    [...match.team_b].sort().join('+'),
  ].sort().join(' vs ')
}

async function auditScenario(config: SimulationConfig, summary: AuditSummary) {
  const { final_state: state } = await runSimulation(config)
  const adjustment = correctForFairness(state)
  const fairnessWarnings = detectFairnessIssues(state)
  const playersById = new Map([...state.players.values()].map(player => [player.player_id, { name: player.player_id }]))
  const payloads = buildSuggestedMatchPayloads({
    count: config.courts,
    sessionId: state.session_id,
    courtCount: config.courts,
    state,
    rows: {
      liveMatchRows: stateToCompletedRows(state),
    },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: {
      tier_overrides: adjustment.tier_overrides,
      applied_for_warnings: adjustment.applied_for_warnings.map(String),
    },
    fairnessWarnings,
    playersById,
    pvnaTolerance: state.config.pvna_tolerance,
  })

  for (const payload of payloads) {
    summary.payloads += 1
    const busyIds = new Set(
      payloads
        .slice(0, payloads.indexOf(payload))
        .flatMap(previous => [...previous.team_a, ...previous.team_b]),
    )
    const availableCount = [...state.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
      .length
    const alternative = payloadToAlternative(payload, state)
    const metrics = getTradeoffChoiceMetrics(alternative, state, state.config.pvna_tolerance)
    const hasPvnaOver = metrics.pvna_over_by > 0
    const hasIntraOver = metrics.intra_team_over_by > 0
    const hasRepeatOver = metrics.repeat_over_by > 0
    const hasCapIssue = hasPvnaOver || hasIntraOver || hasRepeatOver
    if (hasPvnaOver) summary.pvnaOverCases += 1
    if (hasIntraOver) summary.intraOverCases += 1
    if (hasRepeatOver) summary.repeatOverCases += 1
    if (!hasCapIssue) continue

    summary.capCases += 1
    const choices = payload.tradeoff_choices ?? []
    if (choices.length > 1) summary.withChoices += 1

    const issueBase = {
      scenario: config.scenario_name ?? 'unnamed',
      seed: config.seed,
      court: payload.court_idx,
      match: namesForMatch(payload),
    }

    if (choices.length < 2) {
      summary.noUsefulChoices += 1
      continue
    }

    const keys = choices.map(choiceKey)
    if (new Set(keys).size !== keys.length) {
      summary.issues.push({
        ...issueBase,
        reason: 'tradeoff choices contain duplicate match identities',
        details: { keys },
      })
    }

    const recommended = choices.find(choice => choice.id === payload.recommended_tradeoff_choice) ?? choices[0]
    const pvnaSafeChoiceExists = choices.some(choice => choice.metrics.pvna_over_by <= 0)
    if (pvnaSafeChoiceExists && recommended.metrics.pvna_over_by > 0) {
      summary.issues.push({
        ...issueBase,
        reason: 'recommended choice exceeds PVNA while another choice is within cap',
        details: {
          recommended: recommended.id,
          recommendedPvnaOver: recommended.metrics.pvna_over_by,
          choices: choices.map(choice => ({
            id: choice.id,
            pvnaOver: choice.metrics.pvna_over_by,
            intraOver: choice.metrics.intra_team_over_by,
            repeatOver: choice.metrics.repeat_over_by,
          })),
        },
      })
    }

    const bestPvnaGap = Math.min(...choices.map(choice => choice.metrics.pvna_gap))
    const bestIntraGap = Math.min(...choices.map(choice => choice.metrics.intra_team_gap))
    const bestRepeatOver = Math.min(...choices.map(choice => choice.metrics.repeat_over_by))
    const coversAnyImprovement =
      bestPvnaGap < metrics.pvna_gap ||
      bestIntraGap < metrics.intra_team_gap ||
      bestRepeatOver < metrics.repeat_over_by
    if (!coversAnyImprovement) {
      summary.issues.push({
        ...issueBase,
        reason: 'choices do not improve PVNA, intra-team, or repeat versus displayed match',
        details: {
          displayed: {
            pvnaGap: metrics.pvna_gap,
            intraGap: getAlternativeIntraTeamGap(alternative, state),
            repeatOver: metrics.repeat_over_by,
            preferredIntra: PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
          },
          choices: choices.map(choice => ({
            id: choice.id,
            pvnaGap: choice.metrics.pvna_gap,
            intraGap: choice.metrics.intra_team_gap,
            repeatOver: choice.metrics.repeat_over_by,
          })),
        },
      })
    }
  }
}

async function main() {
  const summary: AuditSummary = {
    payloads: 0,
    capCases: 0,
    withChoices: 0,
    noUsefulChoices: 0,
    pvnaOverCases: 0,
    intraOverCases: 0,
    repeatOverCases: 0,
    issues: [],
  }

  for (const scenario of scenarios) {
    await auditScenario(scenario, summary)
  }

  console.log(JSON.stringify({
    ...summary,
    issueCount: summary.issues.length,
    issues: summary.issues.slice(0, 20),
  }, null, 2))

  if (summary.issues.length > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
