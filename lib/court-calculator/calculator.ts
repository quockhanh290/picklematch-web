// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { checkFeasibility } from './feasibility.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getCourtPresetTargetMatches, PRESETS, PRESET_ROTATION_TARGETS } from './presets.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeCourtRepeatPressure } from './pressure.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { buildCourtWarnings } from './warnings.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { CourtCalculatorInput, CourtCalculatorOutput, CourtOption } from './types.ts'

const DEFAULT_MATCH_DURATION_MIN = 15

export function calculateOptimalCourts(
  input: CourtCalculatorInput,
): CourtCalculatorOutput {
  const nPlayers = normalizeInteger(input.n_players)
  const sessionDuration = normalizeInteger(input.session_duration_min)
  const matchDuration = normalizeInteger(input.match_duration_min ?? DEFAULT_MATCH_DURATION_MIN)
  const preset = input.preset ?? 'balanced'
  const totalRounds = Math.max(0, Math.floor(sessionDuration / Math.max(1, matchDuration)))
  const targetMatches = getCourtPresetTargetMatches(preset, totalRounds)
  const maxUsefulCourts = Math.max(0, Math.floor(nPlayers / 4))
  const alternatives =
    maxUsefulCourts === 0
      ? [withQuality(buildCourtOption(1, nPlayers, totalRounds), preset, targetMatches)]
      : Array.from({ length: maxUsefulCourts }, (_, index) =>
          withQuality(
            withTargetWarning(buildCourtOption(index + 1, nPlayers, totalRounds), targetMatches),
            preset,
            targetMatches,
          ),
        )
  const feasible = alternatives.filter((option) => option.feasibility === 'optimal')
  const pool = feasible.length > 0 ? feasible : alternatives.filter((option) => option.feasibility !== 'infeasible')
  const recommended = [...(pool.length > 0 ? pool : alternatives)].sort((a, b) => {
    const quality = a.quality_score - b.quality_score
    if (quality !== 0) return quality
    const distance = Math.abs(a.avg_matches_per_player - targetMatches) - Math.abs(b.avg_matches_per_player - targetMatches)
    if (distance !== 0) return distance
    return feasibilityRank(a.feasibility) - feasibilityRank(b.feasibility) || tieBreakCourts(a.courts, b.courts, preset)
  })[0]

  return {
    recommended,
    alternatives,
    reasoning: buildReasoning(recommended, targetMatches, totalRounds, PRESETS[preset].label),
    setup_warnings: buildCourtWarnings(
      {
        n_players: nPlayers,
        session_duration_min: sessionDuration,
        match_duration_min: matchDuration,
        preset,
      },
      recommended,
      alternatives,
    ),
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
  const playRatio = normalizedPlayers === 0 ? 0 : slotsPerRound / normalizedPlayers
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
    play_ratio: round2(playRatio),
    repeat_pressure: computeCourtRepeatPressure(normalizedPlayers, normalizedCourts, normalizedRounds),
    quality_score: 0,
    quality_notes: [],
  }
}

function withTargetWarning(option: CourtOption, targetMatches: number): CourtOption {
  if (option.avg_matches_per_player >= targetMatches - 0.25) return option

  return {
    ...option,
    warnings: [
      ...option.warnings,
      `Không đạt mục tiêu ${targetMatches.toFixed(1)} trận/người trong thời lượng này.`,
    ],
  }
}

function withQuality(
  option: CourtOption,
  preset: CourtCalculatorInput['preset'] = 'balanced',
  targetMatches: number,
): CourtOption {
  const selectedPreset = preset ?? 'balanced'
  const target = PRESET_ROTATION_TARGETS[selectedPreset]
  const playRatio = option.play_ratio
  const matchDistance = Math.abs(option.avg_matches_per_player - targetMatches)
  const rotationDistance = Math.abs(playRatio - target.ideal)
  const underRotationPenalty = playRatio < target.min ? (target.min - playRatio) * 8 : 0
  const overRotationPenalty = playRatio > target.max ? (playRatio - target.max) * 8 : 0
  const allPlayPenalty = playRatio >= 0.98 && option.courts > 1 ? 1.5 : 0
  const qualityScore = round2(
    matchDistance +
    rotationDistance * 6 +
    underRotationPenalty +
    overRotationPenalty +
    allPlayPenalty,
  )
  const qualityNotes = buildQualityNotes(playRatio, selectedPreset, target.min, target.max)

  return {
    ...option,
    quality_score: qualityScore,
    quality_notes: qualityNotes,
  }
}

function buildQualityNotes(
  playRatio: number,
  preset: CourtCalculatorInput['preset'],
  min: number,
  max: number,
): string[] {
  const notes: string[] = []
  if (playRatio < min) {
    notes.push('Xoay vòng hơi thấp, có thể bị lặp cặp vì ít người chơi mỗi vòng.')
  } else if (playRatio > max) {
    notes.push('Xoay vòng hơi cao, có thể bị lặp cặp vì quá nhiều người chơi mỗi vòng.')
  } else {
    notes.push(`Rotation phù hợp mode ${PRESETS[preset ?? 'balanced'].label.toLowerCase()}.`)
  }

  if (playRatio >= 0.98) {
    notes.push('Gần như all-play mỗi vòng, diversity có thể giảm nếu session dài.')
  }

  return notes
}

function buildReasoning(
  option: CourtOption,
  targetMatches: number,
  rounds: number,
  label: string,
): string {
  return `${option.courts} sân cho ${rounds} vòng: dự kiến ${option.avg_matches_per_player.toFixed(1)} trận/người, mục tiêu ${label.toLowerCase()} là ${targetMatches.toFixed(1)} trận/người.`
}

function feasibilityRank(value: CourtOption['feasibility']): number {
  if (value === 'optimal') return 0
  if (value === 'tight') return 1
  if (value === 'oversupply') return 2
  return 3
}

function tieBreakCourts(a: number, b: number, preset: CourtCalculatorInput['preset']): number {
  if (preset === 'play_more') return b - a
  return a - b
}

function normalizeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}
