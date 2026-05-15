import { checkFeasibility } from './feasibility'
import { PRESETS } from './presets'
import type { CourtCalculatorInput, CourtCalculatorOutput, CourtOption } from './types'

const DEFAULT_MATCH_DURATION_MIN = 15

export function calculateOptimalCourts(
  input: CourtCalculatorInput,
): CourtCalculatorOutput {
  const nPlayers = normalizeInteger(input.n_players)
  const sessionDuration = normalizeInteger(input.session_duration_min)
  const matchDuration = normalizeInteger(input.match_duration_min ?? DEFAULT_MATCH_DURATION_MIN)
  const preset = input.preset ?? 'balanced'
  const targetMatches = PRESETS[preset].matches
  const totalRounds = Math.max(0, Math.floor(sessionDuration / Math.max(1, matchDuration)))
  const maxUsefulCourts = Math.max(0, Math.floor(nPlayers / 4))
  const alternatives =
    maxUsefulCourts === 0
      ? [buildCourtOption(1, nPlayers, totalRounds)]
      : Array.from({ length: maxUsefulCourts }, (_, index) =>
          withTargetWarning(buildCourtOption(index + 1, nPlayers, totalRounds), targetMatches),
        )
  const feasible = alternatives.filter((option) => option.feasibility === 'optimal')
  const pool = feasible.length > 0 ? feasible : alternatives.filter((option) => option.feasibility !== 'infeasible')
  const recommended = [...(pool.length > 0 ? pool : alternatives)].sort((a, b) => {
    const distance = Math.abs(a.avg_matches_per_player - targetMatches) - Math.abs(b.avg_matches_per_player - targetMatches)
    if (distance !== 0) return distance
    return feasibilityRank(a.feasibility) - feasibilityRank(b.feasibility) || a.courts - b.courts
  })[0]

  return {
    recommended,
    alternatives,
    reasoning: buildReasoning(recommended, targetMatches, totalRounds, PRESETS[preset].label),
  }
}

export function buildCourtOption(
  courts: number,
  nPlayers: number,
  rounds: number,
): CourtOption {
  const normalizedCourts = Math.max(1, Math.floor(courts))
  const normalizedPlayers = Math.max(0, Math.floor(nPlayers))
  const normalizedRounds = Math.max(0, Math.floor(rounds))
  const slotsPerRound = normalizedCourts * 4
  const totalSlots = normalizedRounds * slotsPerRound
  const avgMatches = normalizedPlayers === 0 ? 0 : totalSlots / normalizedPlayers
  const cappedMaxMatches = Math.min(normalizedRounds, Math.ceil(avgMatches))
  const minMatches = Math.min(normalizedRounds, Math.floor(avgMatches))
  const restingPerRound = Math.max(0, normalizedPlayers - slotsPerRound)
  const feasibility = checkFeasibility(normalizedCourts, normalizedPlayers, normalizedRounds)

  return {
    courts: normalizedCourts,
    total_rounds: normalizedRounds,
    avg_matches_per_player: round1(avgMatches),
    min_matches_per_player: minMatches,
    max_matches_per_player: cappedMaxMatches,
    resting_per_round: restingPerRound,
    estimated_rest_per_player: round1(Math.max(0, normalizedRounds - avgMatches)),
    feasibility: feasibility.feasibility,
    warnings: feasibility.warnings,
  }
}

function withTargetWarning(option: CourtOption, targetMatches: number): CourtOption {
  if (option.avg_matches_per_player >= targetMatches - 0.25) return option

  return {
    ...option,
    warnings: [
      ...option.warnings,
      `Khong dat muc tieu ${targetMatches.toFixed(1)} tran/nguoi trong thoi luong nay.`,
    ],
  }
}

function buildReasoning(
  option: CourtOption,
  targetMatches: number,
  rounds: number,
  label: string,
): string {
  return `${option.courts} san cho ${rounds} vong: du kien ${option.avg_matches_per_player.toFixed(1)} tran/nguoi, muc tieu ${label.toLowerCase()} la ${targetMatches.toFixed(1)} tran/nguoi.`
}

function feasibilityRank(value: CourtOption['feasibility']): number {
  if (value === 'optimal') return 0
  if (value === 'tight') return 1
  if (value === 'oversupply') return 2
  return 3
}

function normalizeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}

