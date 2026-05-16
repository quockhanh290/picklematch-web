import type { SessionState } from '../types'

export type RepeatRiskLevel = 'low' | 'medium' | 'high' | 'extreme'

export type RepeatPressureMetrics = {
  active_players: number
  rounds_completed: number
  courts: number
  avg_matches_per_player: number
  play_ratio: number
  partner_pressure: number
  opponent_pressure: number
  repeat_risk: RepeatRiskLevel
  penalty_multiplier: number
  explanation: string[]
}

const RISK_ORDER: RepeatRiskLevel[] = ['low', 'medium', 'high', 'extreme']
const PENALTY_MULTIPLIER: Record<RepeatRiskLevel, number> = {
  low: 1,
  medium: 0.75,
  high: 0.5,
  extreme: 0.3,
}

export function computeRepeatPressure(state: SessionState): RepeatPressureMetrics {
  const activePlayers = [...state.players.values()].filter((player) => player.checked_out_at === null)
  const activeCount = activePlayers.length
  const roundsCompleted = state.rounds.filter((round) => round.status === 'completed').length
  const courts = Math.max(1, state.config.courts)
  const avgMatches = average(activePlayers.map((player) => player.matches_played))
  const opponentPool = Math.max(1, activeCount - 1)
  const playRatio = activeCount === 0 ? 0 : (courts * 4) / activeCount
  const partnerPressure = avgMatches / opponentPool
  const opponentPressure = (avgMatches * 2) / opponentPool
  let repeatRisk = riskFromOpponentPressure(opponentPressure)
  const explanation: string[] = []

  if (activeCount > 0 && activeCount < 12 && avgMatches >= 4.5) {
    repeatRisk = maxRisk(repeatRisk, 'high')
    explanation.push('small_roster_many_matches')
  }

  if (activeCount > 0 && activeCount < 12 && avgMatches >= 5.5) {
    repeatRisk = 'extreme'
    explanation.push('small_roster_high_volume')
  }

  if (playRatio >= 0.8 && roundsCompleted >= 8) {
    repeatRisk = bumpRisk(repeatRisk)
    explanation.push('high_play_ratio_long_session')
  }

  return {
    active_players: activeCount,
    rounds_completed: roundsCompleted,
    courts,
    avg_matches_per_player: round(avgMatches),
    play_ratio: round(playRatio),
    partner_pressure: round(partnerPressure),
    opponent_pressure: round(opponentPressure),
    repeat_risk: repeatRisk,
    penalty_multiplier: PENALTY_MULTIPLIER[repeatRisk],
    explanation,
  }
}

function riskFromOpponentPressure(opponentPressure: number): RepeatRiskLevel {
  if (opponentPressure <= 0.75) return 'low'
  if (opponentPressure <= 1) return 'medium'
  if (opponentPressure <= 1.3) return 'high'
  return 'extreme'
}

function maxRisk(a: RepeatRiskLevel, b: RepeatRiskLevel): RepeatRiskLevel {
  return RISK_ORDER[Math.max(RISK_ORDER.indexOf(a), RISK_ORDER.indexOf(b))]
}

function bumpRisk(risk: RepeatRiskLevel): RepeatRiskLevel {
  return RISK_ORDER[Math.min(RISK_ORDER.length - 1, RISK_ORDER.indexOf(risk) + 1)]
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Number(value.toFixed(2))
}
