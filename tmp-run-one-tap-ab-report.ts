import fs from 'fs'
import path from 'path'
import seedrandom from 'seedrandom'

import { calculateOptimalCourts, type CourtPreset } from './lib/court-calculator'
import { Tier } from './lib/next-round-suggester/classify'
import { commitCompletedRound } from './lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness, type AdjustmentResult } from './lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues, type WarningType } from './lib/next-round-suggester/fairness/detector'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
  type SessionFairnessScore,
} from './lib/next-round-suggester/fairness/metrics'
import { suggestNextRound } from './lib/next-round-suggester/suggest'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  ScoringWeights,
  SessionPairHistoryRow,
  SessionState,
  SuggestionAlternative,
} from './lib/next-round-suggester/types'
import { generatePlayers, initState } from './tests/next-round-suggester/simulation/generators'
import { runSimulation, validateInvariants, type PerPlayerStat, type SimulationConfig, type SimulationResult } from './tests/next-round-suggester/simulation/runner'

const N_MIN = 8
const N_MAX = 40
const DURATIONS = [90, 120, 150]
const PRESETS: CourtPreset[] = ['play_more', 'balanced', 'relaxed']
const MATCH_DURATION_MIN = 15
const OUTPUT_DIR = 'simulation-reports'

type AlternativeAudit = {
  index: number
  fairness_total: number
  match_range: number
  partner_repeat_pairs: number
  opponent_repeat_pairs: number
  max_partner_pair: number
  max_opponent_pair: number
  max_opponent_burden: number
}

type OneTapAction =
  | { type: 'none' }
  | { type: 'select_alternative'; alternative_index: number; before: AlternativeAudit; after: AlternativeAudit }
  | { type: 'set_pvna_tolerance'; pvna_tolerance: number; before: AlternativeAudit }
  | { type: 'set_courts'; courts: number; before: AlternativeAudit }

type OneTapRecord = {
  round_no: number
  action: OneTapAction['type']
  selected_alternative_index: number
  fairness_before_round: number
  projected_selected_fairness: number
  fairness_after_round: number
  before_audit?: AlternativeAudit
  after_audit?: AlternativeAudit
  pvna_tolerance?: number
  courts?: number
}

type OneTapSimulationResult = SimulationResult & {
  one_tap_records: OneTapRecord[]
}

type ResultSummary = {
  fairness: number
  match_range: number
  partner_pairs_count: number
  opponent_pairs_count: number
  max_partner_pair: number
  max_opponent_pair: number
  max_opponent_burden: number
  gender_rate: number
  group_coverage_rate: number
  avg_suggest_ms: number
  invariant_violations: number
}

type AbCaseReport = {
  id: string
  n_players: number
  duration_min: number
  preset: CourtPreset
  seed: number
  courts: number
  rounds: number
  baseline: ResultSummary
  one_tap: ResultSummary
  deltas: {
    fairness: number
    match_range: number
    partner_pairs_count: number
    opponent_pairs_count: number
    max_partner_pair: number
    max_opponent_pair: number
    max_opponent_burden: number
    gender_rate: number
    group_coverage_rate: number
  }
  one_tap_records: OneTapRecord[]
  outcome: 'win' | 'loss' | 'mixed' | 'same'
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

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function auditAlternative(state: SessionState, alternative: SuggestionAlternative, index: number): AlternativeAudit {
  const projected = previewStateAfterAlternative(state, alternative)
  const fairness = computeSessionFairness(projected)
  const match = computeMatchCountMetrics(projected)
  const partner = computePartnerDiversity(projected)
  const opponent = computeOpponentDiversity(projected)
  const burden = computeOpponentRepeatBurden(projected)

  return {
    index,
    fairness_total: fairness.total,
    match_range: match.range,
    partner_repeat_pairs: partner.repeat_pairs.length,
    opponent_repeat_pairs: opponent.repeat_pairs.length,
    max_partner_pair: Math.max(0, ...partner.repeat_pairs.map((pair) => pair.count)),
    max_opponent_pair: Math.max(0, ...opponent.repeat_pairs.map((pair) => pair.count)),
    max_opponent_burden: burden.max_repeated_opponents,
  }
}

function auditSortKey(audit: AlternativeAudit): number[] {
  return [
    audit.match_range,
    audit.max_opponent_burden,
    audit.max_opponent_pair,
    audit.max_partner_pair,
    audit.opponent_repeat_pairs,
    audit.partner_repeat_pairs,
    -audit.fairness_total,
  ]
}

function compareAudit(a: AlternativeAudit, b: AlternativeAudit): number {
  const left = auditSortKey(a)
  const right = auditSortKey(b)
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return a.index - b.index
}

function isMeaningfullyBetterAlternative(current: AlternativeAudit, candidate: AlternativeAudit): boolean {
  if (candidate.fairness_total < current.fairness_total - 3) return false
  if (candidate.match_range > current.match_range) return false
  return (
    candidate.max_opponent_burden < current.max_opponent_burden ||
    candidate.max_opponent_pair < current.max_opponent_pair ||
    candidate.max_partner_pair < current.max_partner_pair ||
    candidate.opponent_repeat_pairs < current.opponent_repeat_pairs ||
    candidate.partner_repeat_pairs < current.partner_repeat_pairs ||
    candidate.fairness_total > current.fairness_total + 2
  )
}

function buildOneTapAction(input: {
  state: SessionState
  alternatives: SuggestionAlternative[]
  selectedIndex: number
  pvnaTolerance: number
  courtCount: number
}): OneTapAction {
  const selected = input.alternatives[input.selectedIndex] ?? input.alternatives[0]
  if (!selected) return { type: 'none' }

  const audits = input.alternatives.map((alternative, index) => auditAlternative(input.state, alternative, index))
  const current = audits[input.selectedIndex] ?? audits[0]
  const repeatRisk =
    current.max_opponent_burden >= 3 ||
    current.max_opponent_pair > 2 ||
    current.max_partner_pair > 2 ||
    current.opponent_repeat_pairs >= 8 ||
    current.partner_repeat_pairs >= 6
  const rangeRisk = current.match_range > 1

  const better = audits
    .filter((audit) => audit.index !== current.index)
    .filter((audit) => isMeaningfullyBetterAlternative(current, audit))
    .sort(compareAudit)[0]

  if (better) {
    return { type: 'select_alternative', alternative_index: better.index, before: current, after: better }
  }

  if ((repeatRisk || rangeRisk) && input.pvnaTolerance <= 0.5) {
    return { type: 'set_pvna_tolerance', pvna_tolerance: 0.8, before: current }
  }

  if (repeatRisk && input.courtCount > 1) {
    return { type: 'set_courts', courts: input.courtCount - 1, before: current }
  }

  return { type: 'none' }
}

function applyRoundOneTap(
  state: SessionState,
  suggestionState: SessionState,
  alternatives: SuggestionAlternative[],
): { stateForCommit: SessionState; alternative: SuggestionAlternative | null; action: OneTapAction; selectedIndex: number } {
  let action = buildOneTapAction({
    state: suggestionState,
    alternatives,
    selectedIndex: 0,
    pvnaTolerance: suggestionState.config.pvna_tolerance,
    courtCount: suggestionState.config.courts,
  })

  if (action.type === 'select_alternative') {
    return {
      stateForCommit: suggestionState,
      alternative: alternatives[action.alternative_index] ?? alternatives[0] ?? null,
      action,
      selectedIndex: action.alternative_index,
    }
  }

  if (action.type === 'set_pvna_tolerance' || action.type === 'set_courts') {
    const patchedBaseState: SessionState = {
      ...state,
      config: {
        ...state.config,
        pvna_tolerance: action.type === 'set_pvna_tolerance' ? action.pvna_tolerance : state.config.pvna_tolerance,
        courts: action.type === 'set_courts' ? action.courts : state.config.courts,
      },
    }
    const adjustment = correctForFairness(patchedBaseState)
    const patchedSuggestionState = applyFairnessAdjustment(patchedBaseState, adjustment)
    const rerun = suggestNextRound(patchedSuggestionState, {
      tier_overrides: adjustment.tier_overrides,
    })
    const rerunAction = buildOneTapAction({
      state: patchedSuggestionState,
      alternatives: rerun.alternatives,
      selectedIndex: 0,
      pvnaTolerance: patchedSuggestionState.config.pvna_tolerance,
      courtCount: patchedSuggestionState.config.courts,
    })

    if (rerunAction.type === 'select_alternative') {
      action = rerunAction
      return {
        stateForCommit: patchedSuggestionState,
        alternative: rerun.alternatives[rerunAction.alternative_index] ?? rerun.alternatives[0] ?? null,
        action,
        selectedIndex: rerunAction.alternative_index,
      }
    }

    return {
      stateForCommit: patchedSuggestionState,
      alternative: rerun.alternatives[0] ?? null,
      action,
      selectedIndex: 0,
    }
  }

  return {
    stateForCommit: suggestionState,
    alternative: alternatives[0] ?? null,
    action,
    selectedIndex: 0,
  }
}

async function runOneTapSimulation(config: SimulationConfig): Promise<OneTapSimulationResult> {
  const rng = seedrandom(String(config.seed))
  const players = config.initial_players ?? generatePlayers(config, rng)
  let state = initState(players, {
    courts: config.courts,
    pvna_tolerance: 0.5,
  })

  const fairnessEvolution: { round: number; score: number }[] = []
  const roundResults: OneTapSimulationResult['rounds_completed'] = []
  const invariantViolations: string[] = []
  const warningsCount = new Map<WarningType, number>()
  const adjustments: OneTapSimulationResult['adjustments_applied'] = []
  const oneTapRecords: OneTapRecord[] = []
  let totalSuggestTimeMs = 0
  let maxSuggestTimeMs = 0

  for (let roundNo = 1; roundNo <= config.rounds; roundNo += 1) {
    for (const warning of detectFairnessIssues(state)) {
      warningsCount.set(warning.type, (warningsCount.get(warning.type) ?? 0) + 1)
    }

    const startedAt = performance.now()
    const adjustment = config.use_corrector ? correctForFairness(state) : null
    const suggestionState = adjustment ? applyFairnessAdjustment(state, adjustment) : state
    const suggestion = suggestNextRound(suggestionState, {
      tier_overrides: adjustment?.tier_overrides ?? {},
    })
    const selected = applyRoundOneTap(state, suggestionState, suggestion.alternatives)
    const elapsedMs = performance.now() - startedAt
    totalSuggestTimeMs += elapsedMs
    maxSuggestTimeMs = Math.max(maxSuggestTimeMs, elapsedMs)

    const alternative = selected.alternative
    if (!alternative) {
      invariantViolations.push(`R${roundNo}: no suggestion available`)
      break
    }

    invariantViolations.push(...validateInvariants(alternative, selected.stateForCommit, roundNo))

    if (adjustment && adjustment.applied_for_warnings.length > 0) {
      adjustments.push({
        round_no: roundNo,
        triggered_by_warnings: [...adjustment.applied_for_warnings],
        config_changes: cloneConfigChanges(adjustment.config_changes),
        tier_overrides: { ...adjustment.tier_overrides },
        fairness_score_before: computeSessionFairness(state).total,
      })
    }

    const projectedSelected = auditAlternative(selected.stateForCommit, alternative, selected.selectedIndex)
    const roundRecord: RoundRecord = {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed',
      matches: alternative.matches,
      resting: alternative.resting,
      started_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 0)),
      ended_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 30)),
    }
    state = commitRound(selected.stateForCommit, roundRecord)
    const scoreAfter = computeSessionFairness(state).total
    if (adjustments.length > 0) {
      const last = adjustments[adjustments.length - 1]
      if (last.round_no === roundNo) last.fairness_score_after = scoreAfter
    }

    oneTapRecords.push({
      round_no: roundNo,
      action: selected.action.type,
      selected_alternative_index: selected.selectedIndex,
      fairness_before_round: computeSessionFairness(selected.stateForCommit).total,
      projected_selected_fairness: projectedSelected.fairness_total,
      fairness_after_round: scoreAfter,
      before_audit: 'before' in selected.action ? selected.action.before : undefined,
      after_audit: 'after' in selected.action ? selected.action.after : projectedSelected,
      pvna_tolerance: selected.stateForCommit.config.pvna_tolerance,
      courts: selected.stateForCommit.config.courts,
    })
    fairnessEvolution.push({ round: roundNo, score: scoreAfter })
    roundResults.push({
      round_no: roundNo,
      matches: alternative.matches,
      resting: alternative.resting,
      elapsed_ms: elapsedMs,
    })
  }

  return {
    config,
    rounds_completed: roundResults,
    final_state: state,
    fairness_score: computeSessionFairness(state),
    fairness_evolution: fairnessEvolution,
    per_player_stats: computePerPlayerStats(state),
    adjustments_applied: adjustments,
    warnings_raised: [...warningsCount]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.type.localeCompare(b.type))),
    total_suggest_time_ms: totalSuggestTimeMs,
    avg_suggest_time_ms: roundResults.length === 0 ? 0 : totalSuggestTimeMs / roundResults.length,
    max_suggest_time_ms: maxSuggestTimeMs,
    invariant_violations: invariantViolations,
    one_tap_records: oneTapRecords,
  }
}

function previewStateAfterAlternative(state: SessionState, alternative: SuggestionAlternative): SessionState {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: state.current_round,
    status: 'completed',
    matches: alternative.matches,
    resting: alternative.resting,
    started_at: null,
    ended_at: null,
  }
  return commitRound(state, round)
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

function applyPairHistoryToPlayers(players: Map<string, PlayerSessionState>, pairHistory: SessionPairHistoryRow[]) {
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

function cloneConfigChanges(config: Partial<SessionState['config']>): Partial<SessionState['config']> {
  return {
    ...config,
    weights: config.weights ? ({ ...config.weights } as ScoringWeights) : undefined,
  }
}

function summarize(result: SimulationResult): ResultSummary {
  const match = computeMatchCountMetrics(result.final_state)
  const partner = computePartnerDiversity(result.final_state)
  const opponent = computeOpponentDiversity(result.final_state)
  const burden = computeOpponentRepeatBurden(result.final_state)
  const gender = computeGenderPrefSatisfaction(result.final_state)

  return {
    fairness: result.fairness_score.total,
    match_range: match.range,
    partner_pairs_count: partner.repeat_pairs.length,
    opponent_pairs_count: opponent.repeat_pairs.length,
    max_partner_pair: Math.max(0, ...partner.repeat_pairs.map((pair) => pair.count)),
    max_opponent_pair: Math.max(0, ...opponent.repeat_pairs.map((pair) => pair.count)),
    max_opponent_burden: burden.max_repeated_opponents,
    gender_rate: gender.total_pref_opportunities === 0 ? 1 : gender.satisfaction_rate,
    group_coverage_rate: computeGroupCoverage(result),
    avg_suggest_ms: result.avg_suggest_time_ms,
    invariant_violations: result.invariant_violations.length,
  }
}

function computeGroupCoverage(result: SimulationResult): number {
  const groupPairs = new Set<string>()
  const served = new Set<string>()
  const groups = new Map<string, string[]>()

  for (const player of result.final_state.players.values()) {
    if (!player.group_id) continue
    groups.set(player.group_id, [...(groups.get(player.group_id) ?? []), player.player_id])
  }

  for (const players of groups.values()) {
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        groupPairs.add(pairKey(players[i], players[j]))
      }
    }
  }

  for (const round of result.rounds_completed) {
    for (const match of round.matches) {
      for (const team of [match.team_a, match.team_b]) {
        if (sameGroup(result.final_state, team[0], team[1])) served.add(pairKey(team[0], team[1]))
      }
    }
  }

  return groupPairs.size === 0 ? 1 : served.size / groupPairs.size
}

function sameGroup(state: SessionState, a: string, b: string): boolean {
  const playerA = state.players.get(a)
  const playerB = state.players.get(b)
  return Boolean(playerA?.group_id && playerA.group_id === playerB?.group_id)
}

function classifyOutcome(baseline: ResultSummary, oneTap: ResultSummary): AbCaseReport['outcome'] {
  const fairnessDelta = oneTap.fairness - baseline.fairness
  const repeatDelta =
    (baseline.opponent_pairs_count - oneTap.opponent_pairs_count) +
    (baseline.partner_pairs_count - oneTap.partner_pairs_count) +
    (baseline.max_opponent_burden - oneTap.max_opponent_burden) * 2
  const rangeWorse = oneTap.match_range > baseline.match_range

  if (fairnessDelta >= -2 && repeatDelta > 0 && !rangeWorse) return 'win'
  if (fairnessDelta > 2 && repeatDelta >= 0 && !rangeWorse) return 'win'
  if (fairnessDelta < -3 || rangeWorse || repeatDelta < -2) return 'loss'
  if (fairnessDelta === 0 && repeatDelta === 0) return 'same'
  return 'mixed'
}

function buildFlags(report: AbCaseReport): string[] {
  const flags: string[] = []
  if (report.one_tap_records.some((record) => record.action !== 'none')) flags.push('triggered')
  if (report.outcome === 'win') flags.push('win')
  if (report.outcome === 'loss') flags.push('loss')
  if (report.deltas.fairness > 0) flags.push(`fairness_plus_${report.deltas.fairness}`)
  if (report.deltas.fairness < 0) flags.push(`fairness_${report.deltas.fairness}`)
  if (report.deltas.opponent_pairs_count < 0) flags.push(`opp_pairs_${report.deltas.opponent_pairs_count}`)
  if (report.deltas.partner_pairs_count < 0) flags.push(`partner_pairs_${report.deltas.partner_pairs_count}`)
  if (report.deltas.max_opponent_burden < 0) flags.push(`burden_${report.deltas.max_opponent_burden}`)
  if (report.deltas.match_range > 0) flags.push(`range_plus_${report.deltas.match_range}`)
  return flags
}

async function runCase(config: SimulationConfig): Promise<AbCaseReport> {
  const baseline = await runSimulation(config)
  const oneTap = await runOneTapSimulation(config)
  const baselineSummary = summarize(baseline)
  const oneTapSummary = summarize(oneTap)
  const reportWithoutFlags: Omit<AbCaseReport, 'flags'> = {
    id: config.scenario_name ?? `n${config.n_players}`,
    n_players: config.n_players,
    duration_min: Number(config.scenario_name?.split('_')[1] ?? 0),
    preset: (config.scenario_name?.split('_')[2] ?? 'balanced') as CourtPreset,
    seed: config.seed,
    courts: config.courts,
    rounds: config.rounds,
    baseline: baselineSummary,
    one_tap: oneTapSummary,
    deltas: {
      fairness: oneTapSummary.fairness - baselineSummary.fairness,
      match_range: oneTapSummary.match_range - baselineSummary.match_range,
      partner_pairs_count: oneTapSummary.partner_pairs_count - baselineSummary.partner_pairs_count,
      opponent_pairs_count: oneTapSummary.opponent_pairs_count - baselineSummary.opponent_pairs_count,
      max_partner_pair: oneTapSummary.max_partner_pair - baselineSummary.max_partner_pair,
      max_opponent_pair: oneTapSummary.max_opponent_pair - baselineSummary.max_opponent_pair,
      max_opponent_burden: oneTapSummary.max_opponent_burden - baselineSummary.max_opponent_burden,
      gender_rate: oneTapSummary.gender_rate - baselineSummary.gender_rate,
      group_coverage_rate: oneTapSummary.group_coverage_rate - baselineSummary.group_coverage_rate,
    },
    one_tap_records: oneTap.one_tap_records,
    outcome: classifyOutcome(baselineSummary, oneTapSummary),
  }

  return {
    ...reportWithoutFlags,
    flags: buildFlags(reportWithoutFlags as AbCaseReport),
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

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function buildMarkdown(reports: AbCaseReport[], startedAt: string): string {
  const triggered = reports.filter((report) => report.one_tap_records.some((record) => record.action !== 'none'))
  const wins = reports.filter((report) => report.outcome === 'win')
  const losses = reports.filter((report) => report.outcome === 'loss')
  const mixed = reports.filter((report) => report.outcome === 'mixed')
  const same = reports.filter((report) => report.outcome === 'same')

  const actionCounts = new Map<string, number>()
  for (const report of reports) {
    for (const record of report.one_tap_records) {
      actionCounts.set(record.action, (actionCounts.get(record.action) ?? 0) + 1)
    }
  }

  const bestRows = [...reports]
    .filter((report) => report.outcome === 'win')
    .sort((a, b) => b.deltas.fairness - a.deltas.fairness || a.deltas.max_opponent_burden - b.deltas.max_opponent_burden)
    .slice(0, 30)
    .map(reportRow)
  const worstRows = [...reports]
    .filter((report) => report.outcome === 'loss')
    .sort((a, b) => a.deltas.fairness - b.deltas.fairness || b.deltas.match_range - a.deltas.match_range)
    .slice(0, 30)
    .map(reportRow)
  const allRows = reports.map(reportRow)

  return [
    '# One-Tap Alternative A/B Audit',
    '',
    `Generated: ${startedAt}`,
    `Cases: ${reports.length} (n=${N_MIN}-${N_MAX}, durations=${DURATIONS.join('/')}, presets=${PRESETS.join('/')})`,
    '',
    '## Summary',
    '',
    `- Triggered cases: ${triggered.length}/${reports.length}`,
    `- Wins: ${wins.length}`,
    `- Losses: ${losses.length}`,
    `- Mixed: ${mixed.length}`,
    `- Same: ${same.length}`,
    `- Avg fairness delta: ${average(reports.map((report) => report.deltas.fairness)).toFixed(2)}`,
    `- Avg opponent-pairs delta: ${average(reports.map((report) => report.deltas.opponent_pairs_count)).toFixed(2)}`,
    `- Avg partner-pairs delta: ${average(reports.map((report) => report.deltas.partner_pairs_count)).toFixed(2)}`,
    `- Avg burden delta: ${average(reports.map((report) => report.deltas.max_opponent_burden)).toFixed(2)}`,
    '',
    '## Action Counts',
    '',
    markdownTable([
      ['action', 'count'],
      ...[...actionCounts].sort((a, b) => b[1] - a[1]).map(([action, count]) => [action, String(count)]),
    ]),
    '',
    '## Best Wins',
    '',
    markdownTable([
      reportHeader(),
      ...bestRows,
    ]),
    '',
    '## Worst Losses',
    '',
    markdownTable([
      reportHeader(),
      ...worstRows,
    ]),
    '',
    '## All Cases',
    '',
    markdownTable([
      reportHeader(),
      ...allRows,
    ]),
    '',
    '## Notes',
    '',
    '- `d fairness`, `d repeat`, `d max`, `d burden`, `d range` are one-tap minus baseline.',
    '- Negative repeat/burden deltas are good. Positive fairness delta is good.',
    '- One-tap applies at most one setup rerun per round: select better alternative, else PVNA +/-0.8, else reduce courts.',
    '',
  ].join('\n')
}

function reportHeader(): string[] {
  return [
    'case',
    'outcome',
    'triggered',
    'courts',
    'rounds',
    'fairness B/O',
    'd fairness',
    'repeat B/O',
    'd repeat',
    'max B/O',
    'd max',
    'burden B/O',
    'd burden',
    'range B/O',
    'd range',
    'group B/O',
    'actions',
    'flags',
  ]
}

function reportRow(report: AbCaseReport): string[] {
  const actions = report.one_tap_records
    .filter((record) => record.action !== 'none')
    .map((record) => `R${record.round_no}:${record.action}`)
    .join('<br>') || '-'

  return [
    report.id,
    report.outcome,
    String(report.one_tap_records.filter((record) => record.action !== 'none').length),
    String(report.courts),
    String(report.rounds),
    `${report.baseline.fairness}/${report.one_tap.fairness}`,
    String(report.deltas.fairness),
    `${report.baseline.partner_pairs_count + report.baseline.opponent_pairs_count}/${report.one_tap.partner_pairs_count + report.one_tap.opponent_pairs_count}`,
    String(report.deltas.partner_pairs_count + report.deltas.opponent_pairs_count),
    `${report.baseline.max_partner_pair}/${report.baseline.max_opponent_pair} -> ${report.one_tap.max_partner_pair}/${report.one_tap.max_opponent_pair}`,
    `${report.deltas.max_partner_pair}/${report.deltas.max_opponent_pair}`,
    `${report.baseline.max_opponent_burden}/${report.one_tap.max_opponent_burden}`,
    String(report.deltas.max_opponent_burden),
    `${report.baseline.match_range}/${report.one_tap.match_range}`,
    String(report.deltas.match_range),
    `${pct(report.baseline.group_coverage_rate)}/${pct(report.one_tap.group_coverage_rate)}`,
    actions,
    report.flags.join(', ') || '-',
  ]
}

async function main() {
  const startedAt = new Date().toISOString()
  const reports: AbCaseReport[] = []
  const total = (N_MAX - N_MIN + 1) * DURATIONS.length * PRESETS.length
  let completed = 0

  for (let n = N_MIN; n <= N_MAX; n += 1) {
    for (const duration of DURATIONS) {
      for (const preset of PRESETS) {
        completed += 1
        const report = await runCase(buildConfig(n, duration, preset))
        reports.push(report)
        if (completed % 10 === 0 || completed === total) {
          console.log(`Progress ${completed}/${total}: ${report.id} outcome=${report.outcome} dFair=${report.deltas.fairness} flags=${report.flags.join(',') || '-'}`)
        }
      }
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const stamp = startedAt.replace(/[:.]/g, '-')
  const jsonPath = path.join(OUTPUT_DIR, `one-tap-ab-audit-${stamp}.json`)
  const mdPath = path.join(OUTPUT_DIR, `one-tap-ab-audit-${stamp}.md`)
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
