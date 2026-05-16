// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { previewStateAfterAlternative, rebuildStateThroughRound } from '../history.ts'
import type { SessionState, SuggestionAlternative } from '../types'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
  type SessionFairnessScore,
} from './metrics.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeRepeatPressure } from './pressure.ts'

export type FairnessAudit = {
  round_no: number
  before_total: number
  after_total: number
  delta_total: number
  pressure_before: ReturnType<typeof computeRepeatPressure>
  pressure_after: ReturnType<typeof computeRepeatPressure>
  rows: Array<{
    key: keyof SessionFairnessScore['breakdown']
    label: string
    before: number
    after: number
    delta: number
    detail: string
  }>
}

export type FairnessPreview = Omit<FairnessAudit, 'round_no'>

export type MatchCountConsistencyRow = {
  player_id: string
  live: number
  replay: number
}

export function buildFairnessPreview(
  state: SessionState,
  alternative: SuggestionAlternative | null | undefined,
): FairnessPreview | null {
  if (!alternative) return null

  const afterState = previewStateAfterAlternative(state, alternative)
  return buildFairnessAuditBetweenStates(state, afterState)
}

export function buildLatestFairnessAudit(state: SessionState): FairnessAudit | null {
  const completedRounds = state.rounds
    .filter((round) => round.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)
  const latestRound = completedRounds[completedRounds.length - 1]
  if (!latestRound) return null

  const beforeState = rebuildStateThroughRound(state, latestRound.round_no - 1)
  const afterState = rebuildStateThroughRound(state, latestRound.round_no)
  return {
    round_no: latestRound.round_no,
    ...buildFairnessAuditBetweenStates(beforeState, afterState),
  }
}

export function buildMatchCountConsistencyRows(
  liveState: SessionState,
  replayState: SessionState,
): MatchCountConsistencyRow[] {
  const playerIds = new Set([
    ...liveState.players.keys(),
    ...replayState.players.keys(),
  ])

  return [...playerIds]
    .map((playerId) => ({
      player_id: playerId,
      live: liveState.players.get(playerId)?.matches_played ?? 0,
      replay: replayState.players.get(playerId)?.matches_played ?? 0,
    }))
    .filter((row) => row.live !== row.replay)
    .sort((a, b) => {
      const diffA = Math.abs(a.live - a.replay)
      const diffB = Math.abs(b.live - b.replay)
      if (diffA !== diffB) return diffB - diffA
      return a.player_id.localeCompare(b.player_id)
    })
}

function buildFairnessAuditBetweenStates(
  beforeState: SessionState,
  afterState: SessionState,
): FairnessPreview {
  const beforeScore = computeSessionFairness(beforeState)
  const afterScore = computeSessionFairness(afterState)
  const pressureBefore = computeRepeatPressure(beforeState)
  const pressureAfter = computeRepeatPressure(afterState)
  const rows = ([
    ['match_count', 'So tran', describeMatchCount(afterState)],
    ['partner_diversity', 'Partner', describePartnerDiversity(afterState)],
    ['opponent_diversity', 'Doi thu', describeOpponentDiversity(afterState)],
    ['rest', 'Nghi', describeRestFairness(afterState)],
    ['gender_prefs', 'Gender pref', describeGenderPrefs(afterState)],
  ] as Array<[keyof SessionFairnessScore['breakdown'], string, string]>).map(([key, label, detail]) => {
    const before = beforeScore.breakdown[key]
    const after = afterScore.breakdown[key]
    return {
      key,
      label,
      before,
      after,
      delta: after - before,
      detail,
    }
  })

  return {
    before_total: beforeScore.total,
    after_total: afterScore.total,
    delta_total: afterScore.total - beforeScore.total,
    pressure_before: pressureBefore,
    pressure_after: pressureAfter,
    rows,
  }
}

function describeMatchCount(state: SessionState): string {
  const metrics = computeMatchCountMetrics(state)
  return `min ${metrics.min}, max ${metrics.max}, avg ${metrics.avg.toFixed(1)}, range ${metrics.range}`
}

function describePartnerDiversity(state: SessionState): string {
  const metrics = computePartnerDiversity(state)
  const pressure = computeRepeatPressure(state)
  return `avg unique ${metrics.avg_unique_partners.toFixed(1)}, ratio ${(metrics.avg_diversity_ratio * 100).toFixed(0)}%, raw ${(20 * metrics.avg_diversity_ratio).toFixed(1)}/20, adjusted by pressure ${pressure.repeat_risk} x${pressure.penalty_multiplier.toFixed(2)}, repeat pairs ${metrics.repeat_pairs.length}`
}

function describeOpponentDiversity(state: SessionState): string {
  const metrics = computeOpponentDiversity(state)
  const burden = computeOpponentRepeatBurden(state)
  const pressure = computeRepeatPressure(state)
  return `avg unique ${(metrics.avg_unique_opponents ?? metrics.avg_unique_partners).toFixed(1)}, ratio ${(metrics.avg_diversity_ratio * 100).toFixed(0)}%, raw ${(15 * metrics.avg_diversity_ratio).toFixed(1)}/15, adjusted by pressure ${pressure.repeat_risk} x${pressure.penalty_multiplier.toFixed(2)}, repeat pairs ${metrics.repeat_pairs.length}, max burden ${burden.max_repeated_opponents}`
}

function describeRestFairness(state: SessionState): string {
  const metrics = computeRestFairness(state)
  const maxRest = Math.max(0, ...metrics.per_player.map((player) => player.max_consecutive_rest))
  return `max lien tiep ${maxRest}, violations ${metrics.violations.length}`
}

function describeGenderPrefs(state: SessionState): string {
  const metrics = computeGenderPrefSatisfaction(state)
  if (metrics.total_pref_opportunities === 0) return 'khong co preference opportunity'
  return `${metrics.satisfied_count}/${metrics.total_pref_opportunities} satisfied (${Math.round(metrics.satisfaction_rate * 100)}%)`
}
