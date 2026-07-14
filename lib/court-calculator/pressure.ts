// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { CourtRepeatPressure, CourtRepeatRiskLevel } from './types.ts'

const RISK_ORDER: CourtRepeatRiskLevel[] = ['low', 'medium', 'high', 'extreme']

export function computeCourtRepeatPressure(
  nPlayers: number,
  courts: number,
  rounds: number,
): CourtRepeatPressure {
  const normalizedPlayers = Math.max(0, Math.floor(nPlayers))
  const normalizedCourts = Math.max(1, Math.floor(courts))
  const normalizedRounds = Math.max(0, Math.floor(rounds))
  const slotsPerRound = normalizedCourts * 4
  const avgMatches = normalizedPlayers === 0 ? 0 : (normalizedRounds * slotsPerRound) / normalizedPlayers
  const playRatio = normalizedPlayers === 0 ? 0 : slotsPerRound / normalizedPlayers
  const opponentPool = Math.max(1, normalizedPlayers - 1)
  const partnerPressure = avgMatches / opponentPool
  const opponentPressure = (avgMatches * 2) / opponentPool
  let risk = riskFromOpponentPressure(opponentPressure)
  const explanation: string[] = []

  if (normalizedPlayers > 0 && normalizedPlayers < 12 && avgMatches >= 4.5) {
    risk = maxRisk(risk, 'high')
    explanation.push('small_roster_many_matches')
  }

  if (normalizedPlayers > 0 && normalizedPlayers < 12 && avgMatches >= 5.5) {
    risk = 'extreme'
    explanation.push('small_roster_high_volume')
  }

  if (playRatio >= 0.8 && normalizedRounds >= 8) {
    risk = bumpRisk(risk)
    explanation.push('high_play_ratio_long_session')
  }

  return {
    play_ratio: round2(playRatio),
    avg_matches_per_player: round1(avgMatches),
    partner_pressure: round2(partnerPressure),
    opponent_pressure: round2(opponentPressure),
    risk,
    penalty_multiplier: penaltyMultiplier(risk),
    explanation,
  }
}

function riskFromOpponentPressure(opponentPressure: number): CourtRepeatRiskLevel {
  if (opponentPressure <= 0.75) return 'low'
  if (opponentPressure <= 1) return 'medium'
  if (opponentPressure <= 1.3) return 'high'
  return 'extreme'
}

function maxRisk(a: CourtRepeatRiskLevel, b: CourtRepeatRiskLevel): CourtRepeatRiskLevel {
  return RISK_ORDER[Math.max(RISK_ORDER.indexOf(a), RISK_ORDER.indexOf(b))]
}

function bumpRisk(risk: CourtRepeatRiskLevel): CourtRepeatRiskLevel {
  return RISK_ORDER[Math.min(RISK_ORDER.length - 1, RISK_ORDER.indexOf(risk) + 1)]
}

function penaltyMultiplier(risk: CourtRepeatRiskLevel): number {
  if (risk === 'low') return 1
  if (risk === 'medium') return 0.75
  if (risk === 'high') return 0.5
  return 0.3
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}
