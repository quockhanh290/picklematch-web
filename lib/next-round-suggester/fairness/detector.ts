// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState, SessionState } from '../types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeAvailabilityMetrics, computeGenderPrefSatisfaction, computeMatchCountMetrics, computeOpponentDiversity, computeOpponentRepeatBurden, computePartnerDiversity } from './metrics.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeRepeatPressure } from './pressure.ts'

export type WarningType =
  | 'match_count_imbalance'
  | 'underplayed'
  | 'partner_repeat'
  | 'opponent_repeat'
  | 'opponent_repeat_burden'
  | 'repeat_pressure'
  | 'availability_pressure'
  | 'missing_pvna'
  | 'rest_violation'
  | 'gender_pref_unsatisfied'
  | 'gender_pref_impossible'

export type FairnessWarning = {
  severity: 'info' | 'warning' | 'critical'
  type: WarningType
  affected_players: string[]
  message: string
  suggested_action: string
}

export function detectFairnessIssues(state: SessionState): FairnessWarning[] {
  const activeState = getActivePlayerState(state)
  const warnings: FairnessWarning[] = []

  warnings.push(...detectMatchCountIssues(activeState))
  warnings.push(...detectAvailabilityIssues(activeState))
  warnings.push(...detectRepeatPressureIssues(activeState))
  warnings.push(...detectPartnerIssues(activeState))
  warnings.push(...detectOpponentIssues(activeState))
  warnings.push(...detectOpponentBurdenIssues(activeState))
  warnings.push(...detectRestViolations(activeState))
  warnings.push(...detectGenderIssues(activeState))

  return warnings
}

function detectAvailabilityIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 3) return []

  const availability = computeAvailabilityMetrics(state)
  if (availability.churn_level !== 'high' && availability.churn_level !== 'extreme') return []

  return [
    {
      severity: availability.churn_level === 'extreme' ? 'warning' : 'info',
      type: 'availability_pressure',
      affected_players: [],
      message: `Danh sách thay đổi ở mức ${availability.churn_level}: ${availability.total_roster_changes} lượt vào/ra, tỷ lệ thay đổi trung bình ${(availability.avg_churn_ratio * 100).toFixed(0)}%, cao nhất ${(availability.max_churn_ratio * 100).toFixed(0)}%.`,
      suggested_action: 'Điểm Fairness đã giảm nhẹ phạt lặp/chênh lệch trận vì sự lặp lại một phần đến từ người vào/ra giữa buổi chơi.',
    },
  ]
}

function detectRepeatPressureIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 3) return []

  const pressure = computeRepeatPressure(state)
  if (pressure.repeat_risk !== 'high' && pressure.repeat_risk !== 'extreme') return []

  return [
    {
      severity: pressure.repeat_risk === 'extreme' ? 'warning' : 'info',
      type: 'repeat_pressure',
      affected_players: [],
      message: `Cài đặt áp lực lặp ở mức ${pressure.repeat_risk}: trung bình ${pressure.avg_matches_per_player.toFixed(1)} trận/người, áp lực đối thủ ${pressure.opponent_pressure.toFixed(2)}.`,
      suggested_action: 'Sự lặp lại có thể đến từ cài đặt; host có thể giảm sân, giảm vòng, tăng dung sai, hoặc chấp nhận nếu ưu tiên chơi nhiều.',
    },
  ]
}

function detectOpponentBurdenIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 4) return []

  const metrics = computeOpponentRepeatBurden(state)
  const pressure = computeRepeatPressure(state)
  const overloaded = metrics.per_player
    .filter((player) => player.repeated_opponents >= 3)
    .sort((a, b) => {
      if (b.repeated_opponents !== a.repeated_opponents) {
        return b.repeated_opponents - a.repeated_opponents
      }
      return a.player_id.localeCompare(b.player_id)
    })
  if (overloaded.length === 0) return []

  const maxBurden = overloaded[0].repeated_opponents

  return [
    {
      severity: maxBurden >= 6 ? 'warning' : 'info',
      type: 'opponent_repeat_burden',
      affected_players: overloaded.map((player) => player.player_id),
      message: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? `${overloaded.length} người đang bị lặp đối thủ; cài đặt áp lực lặp ở mức ${pressure.repeat_risk}.`
        : `${overloaded.length} người đang gặp lại nhiều đối thủ (lặp ${maxBurden}+ cặp).`,
      suggested_action: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? 'Engine vẫn rải đều đối thủ lặp; host có thể chọn tinh chỉnh cài đặt nếu muốn giảm lặp mạnh hơn.'
        : 'Engine sẽ ưu tiên rải đều đối thủ lặp ở vòng kế tiếp.',
    },
  ]
}

function detectMatchCountIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 3) return []

  const metrics = computeMatchCountMetrics(state)
  const availability = computeAvailabilityMetrics(state)
  const warnings: FairnessWarning[] = []
  const allowedRange = availability.rounds_tracked > 0 ? 1 : getAllowedMatchCountRange(metrics)
  const observedRange = availability.rounds_tracked > 0
    ? availability.expected_match_delta_range
    : metrics.range
  const excessRange = Math.max(0, observedRange - allowedRange)
  const underplayed = availability.rounds_tracked > 0
    ? availability.per_player
      .filter((player) => player.rounds_available > 0 && player.delta_from_expected < -1.5)
      .map((player) => player.player_id)
    : metrics.per_player
      .filter((player) => player.matches_played < metrics.avg - 1.5)
      .map((player) => player.player_id)

  if (excessRange > 0) {
    warnings.push({
      severity: 'warning',
      type: 'match_count_imbalance',
      affected_players: underplayed.length > 0 ? underplayed : getUnderplayedByMinimum(metrics),
      message: availability.rounds_tracked > 0
        ? `Chênh lệch số trận theo thời gian có mặt đang là ${observedRange.toFixed(1)}, mức hợp lý là ${allowedRange}.`
        : `Chênh lệch số trận đang là ${metrics.range}, mức hợp lý là ${allowedRange}.`,
      suggested_action: 'Engine sẽ ưu tiên các bạn đang chơi ít trận hơn ở vòng kế tiếp.',
    })
  }

  if (underplayed.length > 0) {
    warnings.push({
      severity: 'warning',
      type: 'underplayed',
      affected_players: underplayed,
      message: `${underplayed.length} người đang chơi ít hơn trung bình.`,
      suggested_action: 'Engine sẽ ưu tiên nhóm này nếu còn dư slot ở vòng tới.',
    })
  }

  return warnings
}

function getAllowedMatchCountRange(metrics: ReturnType<typeof computeMatchCountMetrics>): number {
  if (metrics.per_player.length === 0) return 0
  return Number.isInteger(metrics.avg) ? 0 : 1
}

function detectPartnerIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 4) return []

  const highRepeats = computePartnerDiversity(state).repeat_pairs.filter((pair) => pair.count >= 3)
  if (highRepeats.length === 0) return []
  const pressure = computeRepeatPressure(state)

  return [
    {
      severity: 'info',
      type: 'partner_repeat',
      affected_players: uniquePlayers(highRepeats.flatMap((pair) => [pair.player_a, pair.player_b])),
      message: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? `${highRepeats.length} cặp đã đánh chung 3+ lần; cài đặt áp lực lặp ở mức ${pressure.repeat_risk}.`
        : `${highRepeats.length} cặp đã đánh chung 3+ lần.`,
      suggested_action: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? 'Engine vẫn tránh lặp đồng đội; host có thể giảm sân/giảm vòng/tăng dung sai nếu muốn giảm lặp mạnh hơn.'
        : 'Engine sẽ tăng ưu tiên tránh lặp đồng đội.',
    },
  ]
}

function detectOpponentIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 4) return []

  const highRepeats = computeOpponentDiversity(state).repeat_pairs.filter((pair) => pair.count >= 3)
  if (highRepeats.length === 0) return []
  const pressure = computeRepeatPressure(state)

  return [
    {
      severity: 'info',
      type: 'opponent_repeat',
      affected_players: uniquePlayers(highRepeats.flatMap((pair) => [pair.player_a, pair.player_b])),
      message: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? `${highRepeats.length} cặp đã đối đầu 3+ lần; cài đặt áp lực lặp ở mức ${pressure.repeat_risk}.`
        : `${highRepeats.length} cặp đã đối đầu 3+ lần.`,
      suggested_action: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? 'Engine vẫn tránh lặp đối thủ; host có thể giảm sân/giảm vòng/tăng dung sai nếu muốn giảm lặp mạnh hơn.'
        : 'Engine sẽ tăng ưu tiên tránh lặp đối thủ.',
    },
  ]
}

function detectRestViolations(state: SessionState): FairnessWarning[] {
  const violations = [...state.players.values()]
    .filter((player) => player.checked_out_at === null && player.consecutive_rest >= 2)
    .sort((a, b) => a.player_id.localeCompare(b.player_id))

  if (violations.length === 0) return []

  return [
    {
      severity: 'critical',
      type: 'rest_violation',
      affected_players: violations.map((player) => player.player_id),
      message: `${violations.length} người đã nghỉ 2+ vòng liên tiếp.`,
      suggested_action: 'Engine sẽ bắt buộc chơi ở vòng kế tiếp.',
    },
  ]
}

function detectGenderIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 3) return []

  const metrics = computeGenderPrefSatisfaction(state)
  if (metrics.total_pref_opportunities === 0 && metrics.unsatisfiable.length === 0) return []

  const warnings: FairnessWarning[] = []

  if (metrics.total_pref_opportunities > 0 && metrics.satisfaction_rate < 0.6) {
    warnings.push({
      severity: 'warning',
      type: 'gender_pref_unsatisfied',
      affected_players: getLowGenderSatisfactionPlayers(metrics.per_player),
      message: 'Một số yêu cầu ưu tiên chưa được đáp ứng tốt.',
      suggested_action: 'Engine sẽ ưu tiên đáp ứng yêu cầu ưu tiên.',
    })
  }

  for (const item of metrics.unsatisfiable) {
    warnings.push({
      severity: 'info',
      type: 'gender_pref_impossible',
      affected_players: [item.player_id],
      message: item.reason,
      suggested_action: 'Engine sẽ bỏ qua ưu tiên này khi cần.',
    })
  }

  return warnings
}

function getUnderplayedByMinimum(metrics: ReturnType<typeof computeMatchCountMetrics>): string[] {
  return metrics.per_player
    .filter((player) => player.matches_played === metrics.min)
    .map((player) => player.player_id)
}

function getLowGenderSatisfactionPlayers(
  perPlayer: Array<{
    player_id: string
    partner_satisfaction_rate: number
    opponent_satisfaction_rate: number
  }>,
): string[] {
  return perPlayer
    .filter(
      (player) =>
        player.partner_satisfaction_rate < 0.6 || player.opponent_satisfaction_rate < 0.6,
    )
    .map((player) => player.player_id)
}

function uniquePlayers(playerIds: string[]): string[] {
  return [...new Set(playerIds)].sort()
}

function getActivePlayerState(state: SessionState): SessionState {
  return {
    ...state,
    players: new Map(
      [...state.players]
        .filter(([, player]) => player.checked_out_at === null)
        .map(([playerId, player]) => [playerId, clonePlayer(player)]),
    ),
  }
}

function clonePlayer(player: PlayerSessionState): PlayerSessionState {
  return {
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }
}
