import seedrandom from 'seedrandom'

import { commitCompletedRound } from '../../../lib/next-round-suggester/commit'
import { Tier } from '../../../lib/next-round-suggester/classify'
import {
  applyFairnessAdjustment,
  correctForFairness,
  type AdjustmentResult,
} from '../../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues, type WarningType } from '../../../lib/next-round-suggester/fairness/detector'
import {
  computeOpponentDiversity,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
  type SessionFairnessScore,
} from '../../../lib/next-round-suggester/fairness/metrics'
import { buildFairnessPreview, buildLatestFairnessAudit } from '../../../lib/next-round-suggester/fairness/audit'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  ScoringWeights,
  SessionPairHistoryRow,
  SessionState,
} from '../../../lib/next-round-suggester/types'
import { generatePlayers, initState } from './generators'

export type SimulationConfig = {
  n_players: number
  courts: number
  rounds: number
  pvna_distribution: 'tight' | 'wide' | 'extreme' | 'bimodal'
  gender_ratio: number
  gender_pref_rate: number
  group_count: number
  group_size_range: [number, number]
  use_corrector: boolean
  seed: number
  scenario_name?: string
  initial_players?: PlayerSessionState[]
  first_round_alt_idx?: number
}

export type RoundResult = {
  round_no: number
  matches: Match[]
  resting: string[]
  elapsed_ms: number
}

export type AdjustmentRecord = {
  round_no: number
  triggered_by_warnings: WarningType[]
  config_changes: Partial<SessionState['config']>
  tier_overrides: Record<string, Tier>
  fairness_score_before: number
  fairness_score_without_adjustment?: number
  fairness_score_after?: number
}

export type PerPlayerStat = {
  player_id: string
  matches_played: number
  unique_partners: number
  unique_opponents: number
  max_consecutive_rest: number
  rest_total: number
  partner_repeats: number
  opponent_repeats: number
}

export type SimulationResult = {
  config: SimulationConfig
  rounds_completed: RoundResult[]
  final_state: SessionState
  fairness_score: SessionFairnessScore
  fairness_evolution: { round: number; score: number }[]
  per_player_stats: PerPlayerStat[]
  adjustments_applied: AdjustmentRecord[]
  warnings_raised: { type: WarningType; count: number }[]
  total_suggest_time_ms: number
  avg_suggest_time_ms: number
  max_suggest_time_ms: number
  total_post_processing_ms: number
  avg_post_processing_ms: number
  max_post_processing_ms: number
  invariant_violations: string[]
}

export async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const rng = seedrandom(String(config.seed))
  const players = config.initial_players ?? generatePlayers(config, rng)
  let state = initState(players, {
    courts: config.courts,
    pvna_tolerance: 0.5,
  })

  const fairnessEvolution: { round: number; score: number }[] = []
  const roundResults: RoundResult[] = []
  const adjustments: AdjustmentRecord[] = []
  const invariantViolations: string[] = []
  const warningsCount = new Map<WarningType, number>()
  let totalSuggestTimeMs = 0
  let maxSuggestTimeMs = 0
  let totalPostProcessingMs = 0
  let maxPostProcessingMs = 0

  for (let roundNo = 1; roundNo <= config.rounds; roundNo += 1) {
    const warnings = detectFairnessIssues(state)
    for (const warning of warnings) {
      warningsCount.set(warning.type, (warningsCount.get(warning.type) ?? 0) + 1)
    }

    const startedAt = performance.now()
    const adjustment = config.use_corrector ? correctForFairness(state) : null
    const baselineScoreAfter =
      adjustment && adjustment.applied_for_warnings.length > 0
        ? previewScoreAfterSuggestion(state, null, roundNo)
        : undefined
    const effectiveState = adjustment ? applyFairnessAdjustment(state, adjustment) : state
    const altIdx = roundNo === 1 ? (config.first_round_alt_idx ?? 0) : 0
    const suggestion = suggestNextRound(effectiveState, {
      tier_overrides: adjustment?.tier_overrides ?? {},
    })
    const elapsedMs = performance.now() - startedAt
    totalSuggestTimeMs += elapsedMs
    maxSuggestTimeMs = Math.max(maxSuggestTimeMs, elapsedMs)

    const postStart = performance.now()
    computeSessionFairness(effectiveState)
    buildLatestFairnessAudit(effectiveState)
    for (const alt of suggestion.alternatives.slice(0, 3)) {
      buildFairnessPreview(effectiveState, alt)
    }
    const postMs = performance.now() - postStart
    totalPostProcessingMs += postMs
    maxPostProcessingMs = Math.max(maxPostProcessingMs, postMs)

    const alternative = suggestion.alternatives[altIdx] ?? suggestion.alternatives[0]
    if (!alternative) {
      invariantViolations.push(
        `R${roundNo}: no suggestion available (${suggestion.warnings.join(',') || 'no warnings'})`,
      )
      break
    }

    invariantViolations.push(...validateInvariants(alternative, state, roundNo))

    let adjustmentIndex = -1
    if (adjustment && adjustment.applied_for_warnings.length > 0) {
      adjustmentIndex =
        adjustments.push(makeAdjustmentRecord(roundNo, adjustment, state, baselineScoreAfter)) - 1
    }

    const roundRecord: RoundRecord = {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed',
      matches: alternative.matches,
      resting: alternative.resting,
      started_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 0)),
      ended_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 30)),
    }
    state = commitRound(state, roundRecord)

    const scoreAfter = computeSessionFairness(state).total
    if (adjustmentIndex >= 0) {
      adjustments[adjustmentIndex].fairness_score_after = scoreAfter
    }

    fairnessEvolution.push({ round: roundNo, score: scoreAfter })
    roundResults.push({
      round_no: roundNo,
      matches: alternative.matches,
      resting: alternative.resting,
      elapsed_ms: elapsedMs,
    })
  }

  return buildResult({
    config,
    final_state: state,
    rounds_completed: roundResults,
    fairness_evolution: fairnessEvolution,
    adjustments_applied: adjustments,
    warnings_count: warningsCount,
    invariant_violations: invariantViolations,
    timing: {
      total: totalSuggestTimeMs,
      max: maxSuggestTimeMs,
      avg: roundResults.length === 0 ? 0 : totalSuggestTimeMs / roundResults.length,
    },
    postProcessing: {
      total: totalPostProcessingMs,
      max: maxPostProcessingMs,
      avg: roundResults.length === 0 ? 0 : totalPostProcessingMs / roundResults.length,
    },
  })
}

export function validateInvariants(
  suggestion: { matches: Match[]; resting: string[] },
  state: SessionState,
  roundNo: number,
): string[] {
  const violations: string[] = []
  const allPlaying = suggestion.matches.flatMap((match) => [...match.team_a, ...match.team_b])

  if (new Set(allPlaying).size !== allPlaying.length) {
    violations.push(`R${roundNo}: player double-booked`)
  }

  for (const match of suggestion.matches) {
    const players = [...match.team_a, ...match.team_b]
    if (players.length !== 4 || new Set(players).size !== 4) {
      violations.push(`R${roundNo}: match has invalid player set`)
    }
  }

  if (suggestion.matches.length > state.config.courts) {
    violations.push(`R${roundNo}: ${suggestion.matches.length} matches > ${state.config.courts} courts`)
  }

  const present = [...state.players.values()].filter((player) => player.checked_out_at === null).length
  const totalAssigned = allPlaying.length + suggestion.resting.length
  if (totalAssigned !== present) {
    violations.push(
      `R${roundNo}: playing(${allPlaying.length}) + resting(${suggestion.resting.length}) != present(${present})`,
    )
  }

  return violations
}

function commitRound(state: SessionState, round: RoundRecord): SessionState {
  const committed = commitCompletedRound(state, round, pairRowsFromState(state))
  applyPairHistoryToPlayers(committed.players, committed.pairHistory)

  return {
    ...state,
    current_round: round.round_no + 1,
    players: committed.players,
    rounds: [...state.rounds, round],
  }
}

function applyPairHistoryToPlayers(
  players: Map<string, PlayerSessionState>,
  pairHistory: SessionPairHistoryRow[],
) {
  for (const player of players.values()) {
    player.partner_counts = new Map()
    player.opponent_counts = new Map()
  }

  for (const row of pairHistory) {
    const playerA = players.get(row.player_a)
    const playerB = players.get(row.player_b)
    if (!playerA || !playerB) continue

    playerA.partner_counts.set(row.player_b, row.partner_count)
    playerB.partner_counts.set(row.player_a, row.partner_count)
    playerA.opponent_counts.set(row.player_b, row.opponent_count)
    playerB.opponent_counts.set(row.player_a, row.opponent_count)
  }
}

function makeAdjustmentRecord(
  roundNo: number,
  adjustment: AdjustmentResult,
  state: SessionState,
  fairnessScoreWithoutAdjustment?: number,
): AdjustmentRecord {
  return {
    round_no: roundNo,
    triggered_by_warnings: [...adjustment.applied_for_warnings],
    config_changes: cloneConfigChanges(adjustment.config_changes),
    tier_overrides: { ...adjustment.tier_overrides },
    fairness_score_before: computeSessionFairness(state).total,
    fairness_score_without_adjustment: fairnessScoreWithoutAdjustment,
  }
}

function previewScoreAfterSuggestion(
  state: SessionState,
  adjustment: AdjustmentResult | null,
  roundNo: number,
): number | undefined {
  const effectiveState = adjustment ? applyFairnessAdjustment(state, adjustment) : state
  const suggestion = suggestNextRound(effectiveState, {
    tier_overrides: adjustment?.tier_overrides ?? {},
  })
  const alternative = suggestion.alternatives[0]
  if (!alternative) return undefined

  const previewRound: RoundRecord = {
    session_id: state.session_id,
    round_no: roundNo,
    status: 'completed',
    matches: alternative.matches,
    resting: alternative.resting,
    started_at: null,
    ended_at: null,
  }

  return computeSessionFairness(commitRound(state, previewRound)).total
}

function buildResult(input: {
  config: SimulationConfig
  final_state: SessionState
  rounds_completed: RoundResult[]
  fairness_evolution: { round: number; score: number }[]
  adjustments_applied: AdjustmentRecord[]
  warnings_count: Map<WarningType, number>
  invariant_violations: string[]
  timing: { total: number; avg: number; max: number }
  postProcessing: { total: number; avg: number; max: number }
}): SimulationResult {
  return {
    config: input.config,
    rounds_completed: input.rounds_completed,
    final_state: input.final_state,
    fairness_score: computeSessionFairness(input.final_state),
    fairness_evolution: input.fairness_evolution,
    per_player_stats: computePerPlayerStats(input.final_state),
    adjustments_applied: input.adjustments_applied,
    warnings_raised: [...input.warnings_count]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return a.type.localeCompare(b.type)
      }),
    total_suggest_time_ms: input.timing.total,
    avg_suggest_time_ms: input.timing.avg,
    max_suggest_time_ms: input.timing.max,
    total_post_processing_ms: input.postProcessing.total,
    avg_post_processing_ms: input.postProcessing.avg,
    max_post_processing_ms: input.postProcessing.max,
    invariant_violations: input.invariant_violations,
  }
}

function computePerPlayerStats(state: SessionState): PerPlayerStat[] {
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const partnerByPlayer = new Map(partner.per_player.map((player) => [player.player_id, player]))
  const opponentByPlayer = new Map(opponent.per_player.map((player) => [player.player_id, player]))
  const restByPlayer = new Map(rest.per_player.map((player) => [player.player_id, player]))

  return [...state.players.values()]
    .map((player) => ({
      player_id: player.player_id,
      matches_played: player.matches_played,
      unique_partners: partnerByPlayer.get(player.player_id)?.unique_count ?? 0,
      unique_opponents: opponentByPlayer.get(player.player_id)?.unique_count ?? 0,
      max_consecutive_rest: restByPlayer.get(player.player_id)?.max_consecutive_rest ?? 0,
      rest_total: restByPlayer.get(player.player_id)?.total_rests ?? 0,
      partner_repeats: [...player.partner_counts.values()].filter((count) => count > 1).length,
      opponent_repeats: [...player.opponent_counts.values()].filter((count) => count > 1).length,
    }))
    .sort((a, b) => a.player_id.localeCompare(b.player_id))
}

function pairRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows = new Map<string, SessionPairHistoryRow>()

  for (const player of state.players.values()) {
    for (const [partnerId, partnerCount] of player.partner_counts) {
      upsertPairRow(rows, state.session_id, player.player_id, partnerId, { partner_count: partnerCount })
    }

    for (const [opponentId, opponentCount] of player.opponent_counts) {
      upsertPairRow(rows, state.session_id, player.player_id, opponentId, { opponent_count: opponentCount })
    }
  }

  return [...rows.values()]
}

function upsertPairRow(
  rows: Map<string, SessionPairHistoryRow>,
  sessionId: string,
  playerA: string,
  playerB: string,
  patch: Partial<Pick<SessionPairHistoryRow, 'partner_count' | 'opponent_count'>>,
) {
  const [a, b] = playerA < playerB ? [playerA, playerB] : [playerB, playerA]
  const key = `${a}:${b}`
  const existing =
    rows.get(key) ??
    {
      session_id: sessionId,
      player_a: a,
      player_b: b,
      partner_count: 0,
      opponent_count: 0,
    }

  rows.set(key, {
    ...existing,
    partner_count: Math.max(existing.partner_count, patch.partner_count ?? 0),
    opponent_count: Math.max(existing.opponent_count, patch.opponent_count ?? 0),
  })
}

function cloneConfigChanges(
  config: Partial<SessionState['config']>,
): Partial<SessionState['config']> {
  return {
    ...config,
    weights: config.weights ? ({ ...config.weights } as ScoringWeights) : undefined,
  }
}
