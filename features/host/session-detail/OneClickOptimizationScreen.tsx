import { AppLoading } from '@/components/design'
import { SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { optimizeRotationPlan, type RotationScheduledMatch } from '@/lib/scheduler/rotationOptimizer'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo, useState } from 'react'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { ScheduleCoverageReport } from './ScheduleCoverageReport'

type CandidateSetup = {
  key: string
  courts: number
  targetGames: number
  estimatedRounds: number
  targetRounds: number
}

type OptimizationResult = {
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

type Props = {
  players: ArrangementPlayer[]
  maxCourts: number
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

function buildCandidateSet(playerCount: number, maxCourts: number, durationMinutes: number, minutesPerRound: number) {
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

function getActualRoundCount(result: Pick<OptimizationResult, 'matches' | 'setup'>) {
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
  const idealPlayersPerCourt = playerCount >= 32 ? IDEAL_PLAYERS_PER_COURT : playerCount >= 20 ? 9 : 8.5
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
  const durationCoverageScore = clampScore(100 - Math.abs(options.actualRounds - options.targetRounds) * 14)
  const setupScore = clampScore(
    options.qualityScore * 0.4 +
    gamesCoverageScore * 0.25 +
    durationCoverageScore * 0.15 +
    courtFitScore * 0.2
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

export function OneClickOptimizationScreen({ players, maxCourts }: Props) {
  const [durationMinutes, setDurationMinutes] = useState(150)
  const [minutesPerRound, setMinutesPerRound] = useState(15)
  const [courtLimit, setCourtLimit] = useState(Math.max(1, maxCourts))
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<OptimizationResult[]>([])

  const candidateSet = useMemo(
    () => buildCandidateSet(players.length, courtLimit, durationMinutes, minutesPerRound),
    [courtLimit, durationMinutes, minutesPerRound, players.length]
  )
  const courtOptions = useMemo(
    () => Array.from({ length: Math.max(1, Math.min(6, Math.max(maxCourts, Math.floor(players.length / 4), 1))) }, (_, i) => i + 1),
    [maxCourts, players.length]
  )
  const targetRounds = Math.max(1, Math.ceil(durationMinutes / Math.max(1, minutesPerRound)))
  const desiredGamesPerPlayer = Math.max(2, Math.ceil(targetRounds / 2))
  const maxAllowedMinutesPerRound = Math.max(1, minutesPerRound) * MAX_ROUND_PACE_DRIFT
  const maxUsableCourts = Math.max(1, Math.min(Math.floor(players.length / 4), Math.floor(courtLimit || 1)))
  const visibleResults = results.slice(0, 5)

  const runOptimization = () => {
    setRunning(true)
    try {
      const nextResults = candidateSet
        .map(setup => {
          const result = optimizeRotationPlan(players, {
            targetGamesPerPlayer: setup.targetGames,
            courtCount: setup.courts,
            iterations: 6000,
          })

          const baseResult = {
            setup,
            matches: result.matches,
            players: result.players,
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

          return {
            ...baseResult,
            ...scores,
            minRestAcrossPlayers: restStats.minRest,
            backToBackCount: restStats.backToBackCount,
            maxConsecutivePlays: restStats.maxConsecutivePlays,
            restPatternScore: restStats.restPatternScore,
          }
        })
        .filter(result => {
          const actualRoundCount = getActualRoundCount(result)
          const actualMinutesPerRound = durationMinutes / Math.max(1, actualRoundCount)
          return actualMinutesPerRound <= maxAllowedMinutesPerRound
        })
        .sort(compareResultsBySetupScore)
      setResults(nextResults)
    } finally {
      setRunning(false)
    }
  }

  if (players.length < 4) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', textAlign: 'center' }}>
          {'C\u1ea7n \u00edt nh\u1ea5t 4 ng\u01b0\u1eddi ch\u01a1i \u0111\u1ec3 t\u1ed1i \u01b0u l\u1ecbch.'}
        </Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F8F3E8' }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
      <View style={{ backgroundColor: '#12352F', borderRadius: 24, padding: 18, marginBottom: 14, overflow: 'hidden', ...LAYOUT_SHADOW.sm }}>
        <View style={{ position: 'absolute', right: -40, top: -50, width: 150, height: 150, borderRadius: 75, backgroundColor: '#1F6B59', opacity: 0.45 }} />
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: '#FFF5DE', fontWeight: '900' }}>
          One-click optimization
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#D8F3E6', marginTop: 6, lineHeight: 17 }}>
          {'Nh\u1eadp b\u1ed1i c\u1ea3nh bu\u1ed5i social, h\u1ec7 th\u1ed1ng th\u1eed nhi\u1ec1u setup v\u00e0 x\u1ebfp h\u1ea1ng b\u1eb1ng \u0111i\u1ec3m setup: ch\u1ea5t l\u01b0\u1ee3ng l\u1ecbch + \u0111\u1ed9 ph\u1ee7 th\u1eddi l\u01b0\u1ee3ng + s\u1ed1 tr\u1eadn/ng\u01b0\u1eddi + fit s\u00e2n h\u1ee3p l\u00fd.'}
        </Text>
      </View>

      <View style={{ backgroundColor: '#FFFCF5', borderRadius: 20, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginBottom: 10 }}>
          {'Input t\u1ed1i \u01b0u'}
        </Text>

        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900', marginBottom: 8 }}>{'Th\u1eddi l\u01b0\u1ee3ng bu\u1ed5i ch\u01a1i'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { value: 120, label: '2h' },
            { value: 150, label: '2.5h' },
            { value: 180, label: '3h' },
          ].map(option => {
            const active = durationMinutes === option.value
            return (
              <TouchableOpacity key={option.value} onPress={() => setDurationMinutes(option.value)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? '#0F6E56' : 'white', borderWidth: 1, borderColor: '#0F6E56' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? 'white' : '#0F6E56', fontWeight: '900' }}>{option.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900', marginBottom: 8 }}>{'Nh\u1ecbp 1 v\u00f2ng'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {[12, 15, 18].map(minutes => {
            const active = minutesPerRound === minutes
            return (
              <TouchableOpacity key={minutes} onPress={() => setMinutesPerRound(minutes)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? '#0F6E56' : 'white', borderWidth: 1, borderColor: '#0F6E56' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? 'white' : '#0F6E56', fontWeight: '900' }}>{minutes}p</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900', marginBottom: 8 }}>{'S\u1ed1 s\u00e2n t\u1ed1i \u0111a c\u00f3 th\u1ec3 d\u00f9ng'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {courtOptions.map(courts => {
            const active = courtLimit === courts
            return (
              <TouchableOpacity key={courts} onPress={() => setCourtLimit(courts)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: active ? '#0F6E56' : 'white', borderWidth: 1, borderColor: '#0F6E56', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: active ? 'white' : '#0F6E56', fontWeight: '900' }}>{courts}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={{ backgroundColor: '#F8F3E8', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#EFE3CC', marginBottom: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', lineHeight: 15 }}>
            {'S\u1ebd th\u1eed'} {candidateSet.length} {'setup quanh m\u1ee5c ti\u00eau'} {targetRounds} {'v\u00f2ng, t\u00ecm s\u1ed1 s\u00e2n h\u1ee3p l\u00fd theo group size thay v\u00ec m\u1eb7c \u0111\u1ecbnh d\u00f9ng full s\u00e2n.'}
            {' S\u00e0n tr\u1eadn/ng\u01b0\u1eddi:'} {desiredGamesPerPlayer}.
          </Text>
        </View>

        <TouchableOpacity onPress={runOptimization} disabled={running || candidateSet.length === 0} style={{ backgroundColor: candidateSet.length > 0 ? '#0F6E56' : '#9CA3AF', borderRadius: 14, paddingVertical: 13, alignItems: 'center', opacity: running ? 0.7 : 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
            {running ? '\u0110ang t\u1ed1i \u01b0u...' : 'T\u00ecm setup t\u1ed1i \u01b0u'}
          </Text>
        </TouchableOpacity>
      </View>

      {running && <AppLoading />}

      {results.length > 0 && (
        <View style={{ gap: 14 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#1A2E2A', fontWeight: '900' }}>
            {'Top 5 setup t\u1ed1t nh\u1ea5t'}
          </Text>

          {visibleResults.map((result, index) => (
            <View key={result.setup.key} style={{ backgroundColor: '#FFFCF5', borderRadius: 22, padding: 12, borderWidth: 1, borderColor: index === 0 ? '#88D4B5' : '#E5E3DC' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#1A2E2A', fontWeight: '900' }}>
                    #{index + 1} {'\u00b7'} {result.setup.targetGames} {'tr\u1eadn/ng\u01b0\u1eddi'} {'\u00b7'} {result.setup.courts} {'s\u00e2n'}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 3 }}>
                    {'Kho\u1ea3ng'} {result.setup.estimatedRounds}/{result.setup.targetRounds} {'v\u00f2ng'} {'\u00b7'} {result.matches.length} {'tr\u1eadn'}
                  </Text>
                </View>
              </View>

              <View style={{ backgroundColor: result.setupScore > 85 ? '#E1F5EE' : '#FFF4D6', borderRadius: 18, padding: 12, borderWidth: 1, borderColor: result.setupScore > 85 ? '#88D4B5' : '#F5DFA0', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', fontWeight: '900', textTransform: 'uppercase' }}>
                      {'\u0110i\u1ec3m setup'}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', marginTop: 3, lineHeight: 13 }}>
                      {'X\u1ebfp h\u1ea1ng theo quality, ph\u1ee7 tr\u1eadn, ph\u1ee7 gi\u1edd v\u00e0 fit s\u00e2n. N\u1ebfu \u0111i\u1ec3m g\u1ea7n nhau, \u01b0u ti\u00ean nh\u1ecbp ngh\u1ec9 t\u1ed1t h\u01a1n.'}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 30, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', fontWeight: '900' }}>
                    {result.setupScore}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {[
                  { label: 'Ch\u1ea5t l\u01b0\u1ee3ng', value: result.quality.overallScore },
                  { label: 'Ph\u1ee7 tr\u1eadn', value: result.gamesCoverageScore },
                  { label: 'Ph\u1ee7 gi\u1edd', value: result.durationCoverageScore },
                  { label: 'Fit s\u00e2n', value: result.courtFitScore },
                  { label: 'Nh\u1ecbp ngh\u1ec9', value: result.restPatternScore },
                  { label: 'Back-to-back', value: result.backToBackCount },
                  { label: 'Chu\u1ed7i max', value: result.maxConsecutivePlays },
                  { label: 'Min ngh\u1ec9', value: result.minRestAcrossPlayers == null ? '-' : result.minRestAcrossPlayers },
                ].map(item => (
                  <View key={item.label} style={{ backgroundColor: '#F8F3E8', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 9, borderWidth: 1, borderColor: '#EFE3CC', width: '48%' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '900' }}>{item.label}</Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', fontWeight: '900', marginTop: 2 }}>{item.value}</Text>
                  </View>
                ))}
              </View>

              <ScheduleCoverageReport
                players={result.players}
                schedule={result.matches}
                mode="limited"
                minGamesPerPlayer={result.setup.targetGames}
                variant="rotation"
                quality={{ ...result.quality, timedOut: false, fallbackUsed: false }}
                playerStatsInitiallyExpanded={false}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}
