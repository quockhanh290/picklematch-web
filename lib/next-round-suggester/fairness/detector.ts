// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState, RoundRecord, SessionState } from '../types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeAvailabilityMetrics, computeGenderPrefSatisfaction, computeMatchCountMetrics, computeOpponentDiversity, computeOpponentRepeatBurden, computePartnerDiversity } from './metrics.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeRepeatPressure } from './pressure.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getBenchDepth } from '../state.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { isAvoidPair } from '../avoid.ts'

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
  | 'avoid_partner_violation'
  | 'avoid_opponent_violation'
  | 'pvna_outlier'

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

  const lastCompleted = [...state.rounds].reverse().find((r) => r.status === 'completed')
  if (lastCompleted) {
    warnings.push(...detectAvoidViolations(lastCompleted, state))
  }
  warnings.push(...detectPvnaOutliers(state))

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
  const N = [...state.players.values()].filter((p) => p.checked_out_at === null).length
  // 6.3: threshold scales with N — larger group → expected more diverse opponents
  const warnThreshold = Math.max(3, Math.ceil(N / 4))
  // 6.3: when repeat pressure is extreme, downgrade to 'info' (expected behavior)
  const effectiveSeverity: 'info' | 'warning' = pressure.repeat_risk === 'extreme' ? 'info' : 'warning'
  const overloaded = metrics.per_player
    .filter((player) => player.repeated_opponents >= warnThreshold)
    .sort((a, b) => {
      if (b.repeated_opponents !== a.repeated_opponents) {
        return b.repeated_opponents - a.repeated_opponents
      }
      return a.player_id.localeCompare(b.player_id)
    })
  if (overloaded.length === 0) return []

  const maxBurden = overloaded[0].repeated_opponents
  // 6.4: small group context
  const isSmallGroup = N <= 10
  const baseMessage = pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
    ? `${overloaded.length} người đang bị lặp đối thủ; cài đặt áp lực lặp ở mức ${pressure.repeat_risk}.`
    : `${overloaded.length} người đang gặp lại nhiều đối thủ (lặp ${maxBurden}+ cặp).`

  return [
    {
      severity: effectiveSeverity,
      type: 'opponent_repeat_burden',
      affected_players: overloaded.map((player) => player.player_id),
      message: isSmallGroup ? `${baseMessage} (Nhóm nhỏ — lặp đối thủ là bình thường)` : baseMessage,
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

  const diversity = computePartnerDiversity(state)
  // 6.1: only cross-group repeats are actionable warnings (intra-group same-team is expected)
  const highRepeats = (diversity.cross_group_repeat_pairs ?? diversity.repeat_pairs).filter((pair) => pair.count >= 3)
  if (highRepeats.length === 0) return []
  const pressure = computeRepeatPressure(state)
  const N = [...state.players.values()].filter((p) => p.checked_out_at === null).length
  // 6.4: small group context
  const isSmallGroup = N <= 10
  const baseMessage = pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
    ? `${highRepeats.length} cặp đã đánh chung 3+ lần; cài đặt áp lực lặp ở mức ${pressure.repeat_risk}.`
    : `${highRepeats.length} cặp đã đánh chung 3+ lần.`

  return [
    {
      severity: 'info',
      type: 'partner_repeat',
      affected_players: uniquePlayers(highRepeats.flatMap((pair) => [pair.player_a, pair.player_b])),
      message: isSmallGroup ? `${baseMessage} (Nhóm nhỏ — lặp đồng đội là bình thường)` : baseMessage,
      suggested_action: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? 'Engine vẫn tránh lặp đồng đội; host có thể giảm sân/giảm vòng/tăng dung sai nếu muốn giảm lặp mạnh hơn.'
        : 'Engine sẽ tăng ưu tiên tránh lặp đồng đội.',
    },
  ]
}

function detectOpponentIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 4) return []

  const diversity = computeOpponentDiversity(state)
  // 6.1: only cross-group opponent repeats are actionable
  const highRepeats = (diversity.cross_group_repeat_pairs ?? diversity.repeat_pairs).filter((pair) => pair.count >= 3)
  if (highRepeats.length === 0) return []
  const pressure = computeRepeatPressure(state)
  const N = [...state.players.values()].filter((p) => p.checked_out_at === null).length
  // 6.4: small group context
  const isSmallGroup = N <= 10
  const baseMessage = pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
    ? `${highRepeats.length} cặp đã đối đầu 3+ lần; cài đặt áp lực lặp ở mức ${pressure.repeat_risk}.`
    : `${highRepeats.length} cặp đã đối đầu 3+ lần.`

  return [
    {
      severity: 'info',
      type: 'opponent_repeat',
      affected_players: uniquePlayers(highRepeats.flatMap((pair) => [pair.player_a, pair.player_b])),
      message: isSmallGroup ? `${baseMessage} (Nhóm nhỏ — lặp đối thủ là bình thường)` : baseMessage,
      suggested_action: pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme'
        ? 'Engine vẫn tránh lặp đối thủ; host có thể giảm sân/giảm vòng/tăng dung sai nếu muốn giảm lặp mạnh hơn.'
        : 'Engine sẽ tăng ưu tiên tránh lặp đối thủ.',
    },
  ]
}

function detectRestViolations(state: SessionState): FairnessWarning[] {
  // 6.2: violation threshold scales with bench depth (more bench = more rest = higher threshold)
  const benchDepth = getBenchDepth(state)
  const violationThreshold = benchDepth <= 1 ? 2 : benchDepth <= 3 ? 3 : 4
  const severity: 'critical' | 'warning' = benchDepth === 0 ? 'critical' : 'warning'

  const violations = [...state.players.values()]
    .filter((player) => player.checked_out_at === null && !player.opted_rest && player.consecutive_rest >= violationThreshold)
    .sort((a, b) => a.player_id.localeCompare(b.player_id))

  if (violations.length === 0) return []

  return [
    {
      severity,
      type: 'rest_violation',
      affected_players: violations.map((player) => player.player_id),
      message: `${violations.length} người đã nghỉ ${violationThreshold}+ vòng liên tiếp.`,
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

export function detectAvoidViolations(
  lastCompletedRound: RoundRecord,
  state: SessionState,
): FairnessWarning[] {
  const warnings: FairnessWarning[] = []

  for (const match of lastCompletedRound.matches) {
    // Check partner avoid violations
    for (const team of [match.team_a, match.team_b]) {
      for (let i = 0; i < team.length - 1; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const pA = state.players.get(team[i])
          const pB = state.players.get(team[j])
          if (pA && pB && isAvoidPair(pA, pB)) {
            warnings.push({
              severity: 'warning',
              type: 'avoid_partner_violation',
              affected_players: [pA.player_id, pB.player_id].sort(),
              message: `Ghép đồng đội ${pA.player_id}/${pB.player_id} vi phạm danh sách tránh.`,
              suggested_action: 'Kiểm tra danh sách avoid_pairs và tách cặp này ở vòng kế tiếp.',
            })
          }
        }
      }
    }
    // Check opponent avoid violations (softer — info)
    for (const idA of match.team_a) {
      for (const idB of match.team_b) {
        const pA = state.players.get(idA)
        const pB = state.players.get(idB)
        if (pA && pB && isAvoidPair(pA, pB)) {
          warnings.push({
            severity: 'info',
            type: 'avoid_opponent_violation',
            affected_players: [pA.player_id, pB.player_id].sort(),
            message: `Đối thủ ${pA.player_id}/${pB.player_id} trong danh sách tránh.`,
            suggested_action: 'Engine đã cộng thêm phạt mềm; có thể không tránh được trong nhóm nhỏ.',
          })
        }
      }
    }
  }

  return warnings
}

export function detectPvnaOutliers(state: SessionState): FairnessWarning[] {
  const activePlayers = [...state.players.values()].filter((p) => p.checked_out_at === null)
  if (activePlayers.length < 4) return []

  const avgPvna = activePlayers.reduce((sum, p) => sum + p.pvna, 0) / activePlayers.length
  const tolerance = state.config.pvna_tolerance * 2
  const outliers = activePlayers.filter((p) => Math.abs(p.pvna - avgPvna) > tolerance)
  if (outliers.length === 0) return []

  return [
    {
      severity: 'info',
      type: 'pvna_outlier',
      affected_players: outliers.map((p) => p.player_id).sort(),
      message: `${outliers.length} người có PVNA cách trung bình ${tolerance.toFixed(1)}+ điểm.`,
      suggested_action: 'Host có thể điều chỉnh PVNA hoặc tăng pvna_tolerance để ghép dễ hơn.',
    },
  ]
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
