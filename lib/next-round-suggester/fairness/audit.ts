// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { previewStateAfterAlternative, rebuildStateThroughRound } from '../history.ts'
import type { SessionState, SuggestionAlternative } from '../types'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import {
  computeAvailabilityMetrics,
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
  availability_before: ReturnType<typeof computeAvailabilityMetrics>
  availability_after: ReturnType<typeof computeAvailabilityMetrics>
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
  live_consecutive_rest: number
  replay_consecutive_rest: number
  live_consecutive_play: number
  replay_consecutive_play: number
  live_partner_total: number
  replay_partner_total: number
  live_opponent_total: number
  replay_opponent_total: number
}

function totalCounts(counts: Map<string, number> | undefined): number {
  return [...(counts?.values() ?? [])].reduce((sum, count) => sum + count, 0)
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
  const afterState = state
  return {
    round_no: latestRound.round_no,
    ...buildFairnessAuditBetweenStates(beforeState, afterState),
  }
}

export function buildFairnessAudits(state: SessionState): FairnessAudit[] {
  const completedRounds = state.rounds
    .filter((round) => round.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)

  const latestRoundNo = completedRounds[completedRounds.length - 1]?.round_no ?? null

  return completedRounds
    .map((round) => {
      const beforeState = rebuildStateThroughRound(state, round.round_no - 1)
      const afterState = round.round_no === latestRoundNo
        ? state
        : rebuildStateThroughRound(state, round.round_no)
      return {
        round_no: round.round_no,
        ...buildFairnessAuditBetweenStates(beforeState, afterState),
      }
    })
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
      live_consecutive_rest: liveState.players.get(playerId)?.consecutive_rest ?? 0,
      replay_consecutive_rest: replayState.players.get(playerId)?.consecutive_rest ?? 0,
      live_consecutive_play: liveState.players.get(playerId)?.consecutive_play ?? 0,
      replay_consecutive_play: replayState.players.get(playerId)?.consecutive_play ?? 0,
      live_partner_total: totalCounts(liveState.players.get(playerId)?.partner_counts),
      replay_partner_total: totalCounts(replayState.players.get(playerId)?.partner_counts),
      live_opponent_total: totalCounts(liveState.players.get(playerId)?.opponent_counts),
      replay_opponent_total: totalCounts(replayState.players.get(playerId)?.opponent_counts),
    }))
    .filter((row) => (
      row.live !== row.replay ||
      row.live_consecutive_rest !== row.replay_consecutive_rest ||
      row.live_partner_total !== row.replay_partner_total ||
      row.live_opponent_total !== row.replay_opponent_total
    ))
    .sort((a, b) => {
      const diffA =
        Math.abs(a.live - a.replay) +
        Math.abs(a.live_consecutive_rest - a.replay_consecutive_rest) +
        Math.abs(a.live_partner_total - a.replay_partner_total) +
        Math.abs(a.live_opponent_total - a.replay_opponent_total)
      const diffB =
        Math.abs(b.live - b.replay) +
        Math.abs(b.live_consecutive_rest - b.replay_consecutive_rest) +
        Math.abs(b.live_partner_total - b.replay_partner_total) +
        Math.abs(b.live_opponent_total - b.replay_opponent_total)
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
  const availabilityBefore = computeAvailabilityMetrics(beforeState)
  const availabilityAfter = computeAvailabilityMetrics(afterState)
  const rows = ([
    ['match_count', 'Số trận', describeMatchCount(afterState)],
    ['partner_diversity', 'Đồng đội', describePartnerDiversity(afterState)],
    ['opponent_diversity', 'Đối thủ', describeOpponentDiversity(afterState)],
    ['rest', 'Nghỉ', describeRestFairness(afterState)],
    ['gender_prefs', 'Sở thích giới tính', describeGenderPrefs(afterState)],
  ] as Array<[keyof SessionFairnessScore['breakdown'], string, string]>).map(([key, label]) => {
    const before = beforeScore.breakdown[key]
    const after = afterScore.breakdown[key]
    return {
      key,
      label,
      before,
      after,
      delta: after - before,
      detail: describeFairnessRowChange(key, beforeState, afterState),
    }
  })

  return {
    before_total: beforeScore.total,
    after_total: afterScore.total,
    delta_total: afterScore.total - beforeScore.total,
    pressure_before: pressureBefore,
    pressure_after: pressureAfter,
    availability_before: availabilityBefore,
    availability_after: availabilityAfter,
    rows,
  }
}

function describeFairnessRowChange(
  key: keyof SessionFairnessScore['breakdown'],
  beforeState: SessionState,
  afterState: SessionState,
): string {
  if (key === 'match_count') {
    const before = computeMatchCountMetrics(beforeState)
    const after = computeMatchCountMetrics(afterState)
    const beforeAvailability = computeAvailabilityMetrics(beforeState)
    const afterAvailability = computeAvailabilityMetrics(afterState)
    return [
      `Người chơi ít nhất vẫn có ${after.min} trận, nhiều nhất ${after.max} trận nên khoảng cách đang là ${after.range} trận.`,
      `Trước vòng này khoảng cách cũng là ${before.range} trận, nhưng trung bình tăng từ ${before.avg.toFixed(1)} lên ${after.avg.toFixed(1)} trận/người.`,
      matchCountAvailabilitySentence(
        beforeAvailability.expected_match_delta_range,
        afterAvailability.expected_match_delta_range,
      ),
    ].join(' ')
  }

  if (key === 'partner_diversity') {
    const before = computePartnerDiversity(beforeState)
    const after = computePartnerDiversity(afterState)
    const beforePressure = computeRepeatPressure(beforeState)
    const afterPressure = computeRepeatPressure(afterState)
    return [
      `Mỗi người đã đánh chung với trung bình ${after.avg_unique_partners.toFixed(1)} đồng đội khác.`,
      `Độ đa dạng đồng đội ${percent(before.avg_diversity_ratio)} → ${percent(after.avg_diversity_ratio)} (${formatPlainDelta((after.avg_diversity_ratio - before.avg_diversity_ratio) * 100)}).`,
      `Số cặp đồng đội bị lặp là ${after.repeat_pairs.length}, thay đổi ${formatPlainDelta(after.repeat_pairs.length - before.repeat_pairs.length)} so với trước vòng.`,
      `Mức khó tránh lặp đang ${repeatRiskText(afterPressure.repeat_risk)}${beforePressure.repeat_risk !== afterPressure.repeat_risk ? `, trước đó là ${repeatRiskText(beforePressure.repeat_risk)}` : ''}.`,
    ].join(' ')
  }

  if (key === 'opponent_diversity') {
    const before = computeOpponentDiversity(beforeState)
    const after = computeOpponentDiversity(afterState)
    const beforeBurden = computeOpponentRepeatBurden(beforeState)
    const afterBurden = computeOpponentRepeatBurden(afterState)
    const beforePressure = computeRepeatPressure(beforeState)
    const afterPressure = computeRepeatPressure(afterState)
    return [
      `Mỗi người đã gặp trung bình ${(after.avg_unique_opponents ?? after.avg_unique_partners).toFixed(1)} đối thủ khác.`,
      `Độ đa dạng đối thủ ${percent(before.avg_diversity_ratio)} → ${percent(after.avg_diversity_ratio)} (${formatPlainDelta((after.avg_diversity_ratio - before.avg_diversity_ratio) * 100)}).`,
      `Số cặp đối thủ bị gặp lại là ${after.repeat_pairs.length}, thay đổi ${formatPlainDelta(after.repeat_pairs.length - before.repeat_pairs.length)} so với trước vòng.`,
      `Người bị lặp nhiều nhất đang lặp với ${afterBurden.max_repeated_opponents} đối thủ, thay đổi ${formatPlainDelta(afterBurden.max_repeated_opponents - beforeBurden.max_repeated_opponents)}. Mức khó tránh lặp đang ${repeatRiskText(afterPressure.repeat_risk)}${beforePressure.repeat_risk !== afterPressure.repeat_risk ? `, trước đó là ${repeatRiskText(beforePressure.repeat_risk)}` : ''}.`,
    ].join(' ')
  }

  if (key === 'rest') {
    const before = computeRestFairness(beforeState)
    const after = computeRestFairness(afterState)
    const beforeMaxRest = Math.max(0, ...before.per_player.map((player) => player.max_consecutive_rest))
    const afterMaxRest = Math.max(0, ...after.per_player.map((player) => player.max_consecutive_rest))
    return [
      `Chuỗi nghỉ dài nhất hiện là ${afterMaxRest} vòng, thay đổi ${formatPlainDelta(afterMaxRest - beforeMaxRest)} so với trước vòng.`,
      `Có ${after.violations.length} trường hợp nghỉ liên tiếp quá lâu, thay đổi ${formatPlainDelta(after.violations.length - before.violations.length)}.`,
    ].join(' ')
  }

  const before = computeGenderPrefSatisfaction(beforeState)
  const after = computeGenderPrefSatisfaction(afterState)
  if (before.total_pref_opportunities === 0 && after.total_pref_opportunities === 0) {
    return 'Sở thích giới tính: chưa có cơ hội cần kiểm tra trong các trận đã xếp.'
  }
  return [
    `Sở thích giới tính được đáp ứng ${after.satisfied_count}/${after.total_pref_opportunities} lượt.`,
    `Tỉ lệ đáp ứng ${percent(before.satisfaction_rate)} → ${percent(after.satisfaction_rate)} (${formatPlainDelta((after.satisfaction_rate - before.satisfaction_rate) * 100)}).`,
  ].join(' ')
}

function formatPlainDelta(delta: number): string {
  if (Math.abs(delta) < 0.05) return 'không đổi'
  return delta > 0 ? `tăng ${delta.toFixed(1)}` : `giảm ${Math.abs(delta).toFixed(1)}`
}

function matchCountAvailabilitySentence(beforeRange: number, afterRange: number): string {
  const delta = afterRange - beforeRange
  const movement = Math.abs(delta) < 0.05
    ? 'Khoảng cách này không đổi so với trước vòng.'
    : delta > 0
      ? `Khoảng cách này rộng hơn ${delta.toFixed(1)} trận so với trước vòng.`
      : `Khoảng cách này thu hẹp ${Math.abs(delta).toFixed(1)} trận so với trước vòng.`
  return `Nếu chia số trận theo thời gian mỗi người có mặt, người đang được chia nhiều trận nhất và người đang được chia ít trận nhất cách nhau ${afterRange.toFixed(1)} trận. ${movement}`
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

function repeatRiskText(level: ReturnType<typeof computeRepeatPressure>['repeat_risk']): string {
  if (level === 'low') return 'thấp'
  if (level === 'medium') return 'vừa'
  if (level === 'high') return 'cao'
  return 'rất cao'
}

function describeMatchCount(state: SessionState): string {
  const metrics = computeMatchCountMetrics(state)
  const availability = computeAvailabilityMetrics(state)
  const churnText = availability.churn_level === 'low' ? 'thấp' : availability.churn_level === 'medium' ? 'vừa' : 'cao'
  return `nhỏ nhất ${metrics.min}, lớn nhất ${metrics.max}, TB ${metrics.avg.toFixed(1)}, chênh lệch ${metrics.range}, chênh lệch dự kiến ${availability.expected_match_delta_range.toFixed(1)}, biến động người chơi ${churnText} x${availability.penalty_multiplier.toFixed(2)}`
}

function describePartnerDiversity(state: SessionState): string {
  const metrics = computePartnerDiversity(state)
  const pressure = computeRepeatPressure(state)
  const availability = computeAvailabilityMetrics(state)
  const pressureText = pressure.repeat_risk === 'low' ? 'thấp' : pressure.repeat_risk === 'medium' ? 'vừa' : 'cao'
  const churnText = availability.churn_level === 'low' ? 'thấp' : availability.churn_level === 'medium' ? 'vừa' : 'cao'
  return `TB đồng đội khác ${metrics.avg_unique_partners.toFixed(1)}, tỉ lệ ${(metrics.avg_diversity_ratio * 100).toFixed(0)}%, điểm gốc ${(20 * metrics.avg_diversity_ratio).toFixed(1)}/20, hiệu chỉnh theo áp lực lặp ${pressureText} x${pressure.penalty_multiplier.toFixed(2)} và biến động ${churnText} x${availability.penalty_multiplier.toFixed(2)}, cặp lặp ${metrics.repeat_pairs.length}`
}

function describeOpponentDiversity(state: SessionState): string {
  const metrics = computeOpponentDiversity(state)
  const burden = computeOpponentRepeatBurden(state)
  const pressure = computeRepeatPressure(state)
  const availability = computeAvailabilityMetrics(state)
  const pressureText = pressure.repeat_risk === 'low' ? 'thấp' : pressure.repeat_risk === 'medium' ? 'vừa' : 'cao'
  const churnText = availability.churn_level === 'low' ? 'thấp' : availability.churn_level === 'medium' ? 'vừa' : 'cao'
  return `TB đối thủ khác ${(metrics.avg_unique_opponents ?? metrics.avg_unique_partners).toFixed(1)}, tỉ lệ ${(metrics.avg_diversity_ratio * 100).toFixed(0)}%, điểm gốc ${(15 * metrics.avg_diversity_ratio).toFixed(1)}/15, hiệu chỉnh theo áp lực lặp ${pressureText} x${pressure.penalty_multiplier.toFixed(2)} và biến động ${churnText} x${availability.penalty_multiplier.toFixed(2)}, cặp lặp đối thủ ${metrics.repeat_pairs.length}, tải lặp tối đa ${burden.max_repeated_opponents}`
}

function describeRestFairness(state: SessionState): string {
  const metrics = computeRestFairness(state)
  const maxRest = Math.max(0, ...metrics.per_player.map((player) => player.max_consecutive_rest))
  return `nghỉ liên tiếp tối đa ${maxRest}, số lần vi phạm nghỉ ${metrics.violations.length}`
}

function describeGenderPrefs(state: SessionState): string {
  const metrics = computeGenderPrefSatisfaction(state)
  if (metrics.total_pref_opportunities === 0) return 'không có cơ hội đáp ứng sở thích'
  return `${metrics.satisfied_count}/${metrics.total_pref_opportunities} thỏa mãn (${Math.round(metrics.satisfaction_rate * 100)}%)`
}
