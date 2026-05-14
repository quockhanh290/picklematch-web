import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { optimizeRotationPlan, type RotationScheduledMatch } from './rotationOptimizer'

export type CandidateSetup = {
  key: string
  courts: number
  targetGames: number
  estimatedRounds: number
  targetRounds: number
}

export type OptimizationResult = {
  setup: CandidateSetup
  matches: RotationScheduledMatch[]
  players: ArrangementPlayer[]
  setupScore: number
  durationCoverageScore: number
  gamesCoverageScore: number
  courtFitScore: number
  restPatternScore: number
  minRestAcrossPlayers: number | null
  backToBackCount: number
  maxConsecutivePlays: number
  quality: {
    runtimeMs: number
    score: number
    overallScore: number
  }
}

export type OneClickOptimizationInput = {
  players: ArrangementPlayer[]
  maxCourts: number
  durationMinutes: number
  minutesPerRound: number
  iterations?: number
}

export type OneClickOptimizationProgress = {
  current: number
  total: number
}

const MAX_ROUND_PACE_DRIFT = 1.1
const IDEAL_PLAYERS_PER_COURT = 9.5
const CLOSE_SCORE_TOLERANCE = 2

type RestPatternStats = {
  minRest: number | null
  backToBackCount: number
  maxConsecutivePlays: number
  averageRestDeviation: number
  restPatternScore: number
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].filter(Number.isFinite)
}

export function buildCandidateSet(playerCount: number, maxCourts: number, durationMinutes: number, minutesPerRound: number) {
  const safePlayerCount = Math.max(4, playerCount)
  const safeMinutesPerRound = Math.max(1, minutesPerRound)
  const targetRounds = Math.max(1, Math.ceil(durationMinutes / safeMinutesPerRound))
  const desiredGamesPerPlayer = Math.max(2, Math.ceil(targetRounds / 2))
  const maxAllowedMinutesPerRound = safeMinutesPerRound * MAX_ROUND_PACE_DRIFT
  const playableCourts = Math.max(1, Math.min(Math.floor(safePlayerCount / 4), Math.floor(maxCourts || 1)))
  const idealCourts = Math.max(1, Math.round(safePlayerCount / IDEAL_PLAYERS_PER_COURT))
  const candidateCourts = uniqueNumbers([
    idealCourts - 1,
    idealCourts,
    idealCourts + 1,
    idealCourts + 2,
    playableCourts,
  ]).filter(courts => courts >= 1 && courts <= playableCourts).sort((a, b) => a - b)
  const candidates: CandidateSetup[] = []
  const seen = new Set<string>()

  candidateCourts.forEach(courts => {
    const rawTarget = Math.ceil((targetRounds * courts * 4) / safePlayerCount)
    uniqueNumbers([rawTarget - 1, rawTarget, rawTarget + 1, rawTarget + 2]).forEach(targetGames => {
      if (targetGames < desiredGamesPerPlayer || targetGames > 12) return
      const estimatedRounds = Math.ceil(Math.ceil((targetGames * safePlayerCount) / 4) / courts)
      const estimatedMinutesPerRound = durationMinutes / estimatedRounds
      if (estimatedMinutesPerRound > maxAllowedMinutesPerRound || estimatedRounds > targetRounds + 4) return
      const key = `${courts}-${targetGames}`
      if (seen.has(key)) return
      seen.add(key)
      candidates.push({ key, courts, targetGames, estimatedRounds, targetRounds })
    })
  })

  return candidates.sort((a, b) => {
    const aCoversDuration = a.estimatedRounds >= targetRounds
    const bCoversDuration = b.estimatedRounds >= targetRounds
    if (aCoversDuration !== bCoversDuration) return aCoversDuration ? -1 : 1

    if (a.targetGames !== b.targetGames) return b.targetGames - a.targetGames

    const roundA = aCoversDuration ? a.estimatedRounds - targetRounds : targetRounds - a.estimatedRounds
    const roundB = bCoversDuration ? b.estimatedRounds - targetRounds : targetRounds - b.estimatedRounds
    if (roundA !== roundB) return roundA - roundB
    return b.courts - a.courts
  })
}

export function getActualRoundCount(result: Pick<OptimizationResult, 'matches' | 'setup'>) {
  return new Set(result.matches.map(match => match.rotation || 0)).size || result.setup.estimatedRounds
}

function getRestPatternStats(players: ArrangementPlayer[], matches: RotationScheduledMatch[]): RestPatternStats {
  let minRest: number | null = null
  let backToBackCount = 0
  let maxConsecutivePlays = 0
  let totalRestDeviation = 0
  let restGapCount = 0
  const rotationsByPlayer = new Map<string, number[]>()
  players.forEach(player => rotationsByPlayer.set(String(player.id), []))

  matches.forEach(match => {
    ;[...match.teamA, ...match.teamB].forEach(playerId => {
      if (!rotationsByPlayer.has(playerId)) rotationsByPlayer.set(playerId, [])
      rotationsByPlayer.get(playerId)!.push(match.rotation || 0)
    })
  })

  rotationsByPlayer.forEach(rotations => {
    const sorted = [...new Set(rotations)].sort((a, b) => a - b)
    let currentStreak = sorted.length > 0 ? 1 : 0
    let playerMaxStreak = currentStreak

    for (let index = 1; index < sorted.length; index++) {
      const gap = sorted[index] - sorted[index - 1]
      const rest = Math.max(0, gap - 1)
      minRest = minRest == null ? rest : Math.min(minRest, rest)

      if (gap === 1) {
        backToBackCount += 1
        currentStreak += 1
      } else {
        currentStreak = 1
      }

      playerMaxStreak = Math.max(playerMaxStreak, currentStreak)
      totalRestDeviation += Math.abs(rest - 1)
      restGapCount += 1
    }

    maxConsecutivePlays = Math.max(maxConsecutivePlays, playerMaxStreak)
  })

  const averageRestDeviation = restGapCount > 0 ? totalRestDeviation / restGapCount : 0
  const restPatternScore = clampScore(
    100 -
    backToBackCount * 5 -
    Math.max(0, maxConsecutivePlays - 2) * 15 -
    averageRestDeviation * 18
  )

  return {
    minRest,
    backToBackCount,
    maxConsecutivePlays,
    averageRestDeviation,
    restPatternScore,
  }
}

function calculateSetupScores(options: {
  qualityScore: number
  targetGames: number
  targetRounds: number
  actualRounds: number
  desiredGamesPerPlayer: number
  courts: number
  maxUsableCourts: number
  playerCount: number
  minRestAcrossPlayers: number | null
}) {
  const playerCount = Math.max(1, options.playerCount)
  const idealPlayersPerCourt = 9.0
  const playersPerCourt = playerCount / Math.max(1, options.courts)
  let courtFitScore = 100 - Math.abs(playersPerCourt - idealPlayersPerCourt) * 14

  if (playersPerCourt < 8) {
    courtFitScore -= (8 - playersPerCourt) * 18
  }

  if (playersPerCourt > 11) {
    courtFitScore -= (playersPerCourt - 11) * 10
  }

  const maxEfficientCourts = Math.max(1, Math.floor(playerCount / idealPlayersPerCourt))
  const overCourtPenalty = Math.max(0, options.courts - Math.min(options.maxUsableCourts, maxEfficientCourts)) * 8
  courtFitScore = clampScore(courtFitScore - overCourtPenalty)
  const capacityGamesForCourtFit = Math.max(1, (options.targetRounds * options.courts * 4) / playerCount)
  const meaningfulGamesTarget = Math.max(options.desiredGamesPerPlayer, Math.min(options.targetRounds, capacityGamesForCourtFit))
  const gamesCoverageScore = clampScore((options.targetGames / meaningfulGamesTarget) * 100)
  const roundsDiff = options.actualRounds - options.targetRounds
  const durationPenalty = roundsDiff > 0 ? roundsDiff * 7 : Math.abs(roundsDiff) * 14
  const durationCoverageScore = clampScore(100 - durationPenalty)
  const setupScore = clampScore(
    options.qualityScore * 0.20 +
    gamesCoverageScore * 0.40 +
    durationCoverageScore * 0.20 +
    courtFitScore * 0.20
  )

  return {
    setupScore,
    durationCoverageScore,
    gamesCoverageScore,
    courtFitScore,
  }
}

function compareResultsBySetupScore(a: OptimizationResult, b: OptimizationResult) {
  const scoreDiff = b.setupScore - a.setupScore
  if (Math.abs(scoreDiff) > CLOSE_SCORE_TOLERANCE) return scoreDiff
  if (b.restPatternScore !== a.restPatternScore) return b.restPatternScore - a.restPatternScore
  if (a.backToBackCount !== b.backToBackCount) return a.backToBackCount - b.backToBackCount
  if (a.maxConsecutivePlays !== b.maxConsecutivePlays) return a.maxConsecutivePlays - b.maxConsecutivePlays
  if (a.setup.targetGames !== b.setup.targetGames) return b.setup.targetGames - a.setup.targetGames
  if (b.quality.overallScore !== a.quality.overallScore) return b.quality.overallScore - a.quality.overallScore
  return a.setup.courts - b.setup.courts
}

export function runOneClickOptimization(
  input: OneClickOptimizationInput,
  onProgress?: (progress: OneClickOptimizationProgress) => void
) {
  const { players, maxCourts, durationMinutes, minutesPerRound, iterations = 8000 } = input
  const candidateSet = buildCandidateSet(players.length, maxCourts, durationMinutes, minutesPerRound)
  const targetRounds = Math.max(1, Math.ceil(durationMinutes / Math.max(1, minutesPerRound)))
  const desiredGamesPerPlayer = Math.max(2, Math.ceil(targetRounds / 2))
  const maxUsableCourts = Math.max(1, Math.min(Math.floor(players.length / 4), Math.floor(maxCourts || 1)))
  const results: OptimizationResult[] = []

  onProgress?.({ current: 0, total: candidateSet.length })

  candidateSet.forEach((setup, index) => {
    const result = optimizeRotationPlan(players, {
      targetGamesPerPlayer: setup.targetGames,
      courtCount: setup.courts,
      iterations,
    })

    const baseResult = {
      setup,
      matches: result.matches,
      players,
      quality: result.quality,
    }
    const actualRoundCount = getActualRoundCount(baseResult)
    const restStats = getRestPatternStats(players, result.matches)
    const scores = calculateSetupScores({
      qualityScore: result.quality.overallScore,
      targetGames: setup.targetGames,
      targetRounds: setup.targetRounds,
      actualRounds: actualRoundCount,
      desiredGamesPerPlayer,
      courts: setup.courts,
      maxUsableCourts,
      playerCount: players.length,
      minRestAcrossPlayers: restStats.minRest,
    })

    results.push({
      ...baseResult,
      ...scores,
      minRestAcrossPlayers: restStats.minRest,
      backToBackCount: restStats.backToBackCount,
      maxConsecutivePlays: restStats.maxConsecutivePlays,
      restPatternScore: restStats.restPatternScore,
    })
    onProgress?.({ current: index + 1, total: candidateSet.length })
  })

  return results.sort(compareResultsBySetupScore)
}
