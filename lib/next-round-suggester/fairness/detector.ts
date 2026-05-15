import type { PlayerSessionState, SessionState } from '../types'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeGenderPrefSatisfaction, computeMatchCountMetrics, computeOpponentDiversity, computeOpponentRepeatBurden, computePartnerDiversity } from './metrics.ts'

export type WarningType =
  | 'match_count_imbalance'
  | 'underplayed'
  | 'partner_repeat'
  | 'opponent_repeat'
  | 'opponent_repeat_burden'
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
  warnings.push(...detectPartnerIssues(activeState))
  warnings.push(...detectOpponentIssues(activeState))
  warnings.push(...detectOpponentBurdenIssues(activeState))
  warnings.push(...detectRestViolations(activeState))
  warnings.push(...detectGenderIssues(activeState))

  return warnings
}

function detectOpponentBurdenIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 4) return []

  const metrics = computeOpponentRepeatBurden(state)
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
      message: `${overloaded.length} nguoi dang gap lai nhieu doi thu (${maxBurden}+ cap lap).`,
      suggested_action: 'Engine se uu tien rai deu doi thu lap o vong ke tiep.',
    },
  ]
}

function detectMatchCountIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 3) return []

  const metrics = computeMatchCountMetrics(state)
  const warnings: FairnessWarning[] = []
  const allowedRange = getAllowedMatchCountRange(metrics)
  const excessRange = Math.max(0, metrics.range - allowedRange)
  const underplayed = metrics.per_player
    .filter((player) => player.matches_played < metrics.avg - 1.5)
    .map((player) => player.player_id)

  if (excessRange > 0) {
    warnings.push({
      severity: 'warning',
      type: 'match_count_imbalance',
      affected_players: underplayed.length > 0 ? underplayed : getUnderplayedByMinimum(metrics),
      message: `Chenh so tran dang la ${metrics.range}, muc hop ly la ${allowedRange}.`,
      suggested_action: 'Engine se uu tien cac ban dang choi it tran hon o vong ke tiep.',
    })
  }

  if (underplayed.length > 0) {
    warnings.push({
      severity: 'warning',
      type: 'underplayed',
      affected_players: underplayed,
      message: `${underplayed.length} nguoi dang choi it hon trung binh.`,
      suggested_action: 'Engine se uu tien nhom nay neu con du slot o vong toi.',
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

  return [
    {
      severity: 'info',
      type: 'partner_repeat',
      affected_players: uniquePlayers(highRepeats.flatMap((pair) => [pair.player_a, pair.player_b])),
      message: `${highRepeats.length} cap da danh chung 3+ lan.`,
      suggested_action: 'Engine se tang uu tien tranh lap partner.',
    },
  ]
}

function detectOpponentIssues(state: SessionState): FairnessWarning[] {
  if (state.current_round < 4) return []

  const highRepeats = computeOpponentDiversity(state).repeat_pairs.filter((pair) => pair.count >= 3)
  if (highRepeats.length === 0) return []

  return [
    {
      severity: 'info',
      type: 'opponent_repeat',
      affected_players: uniquePlayers(highRepeats.flatMap((pair) => [pair.player_a, pair.player_b])),
      message: `${highRepeats.length} cap da doi dau 3+ lan.`,
      suggested_action: 'Engine se tang uu tien tranh lap doi thu.',
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
      message: `${violations.length} nguoi da nghi 2+ vong lien tiep.`,
      suggested_action: 'Engine se force play vong ke tiep.',
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
      message: 'Mot so preferences chua duoc dap ung tot.',
      suggested_action: 'Engine se uu tien satisfy preferences.',
    })
  }

  for (const item of metrics.unsatisfiable) {
    warnings.push({
      severity: 'info',
      type: 'gender_pref_impossible',
      affected_players: [item.player_id],
      message: item.reason,
      suggested_action: 'Engine se bo qua preference nay khi can.',
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
