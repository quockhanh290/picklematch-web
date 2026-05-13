import { AppLoading } from '@/components/design'
import { SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { optimizeRotationPlan, type RotationScheduledMatch } from '@/lib/scheduler/rotationOptimizer'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
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
  onSelect?: (plan: any) => void
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

const STAT_EXPLANATIONS: Record<string, { title: string, meaning: string, calculation: string, advice: string, unit: string }> = {
  'Chất lượng': {
    title: 'Điểm Chất lượng Tổng quát',
    meaning: 'Đánh giá tổng thể độ "ngon" của lịch đấu dựa trên tất cả các tiêu chí.',
    calculation: 'Trung bình trọng số của Phủ trận, Phủ giờ, Fit sân và Nhịp nghỉ.',
    advice: 'Ưu tiên các phương án > 85 điểm để đảm bảo mọi người đều hài lòng.',
    unit: 'điểm'
  },
  'Phủ trận': {
    title: 'Điểm Phủ Số trận',
    meaning: 'Đảm bảo người chơi đạt số trận mục tiêu (ví dụ: 5 trận/buổi).',
    calculation: '100 điểm - (số người thiếu trận × 5 điểm).',
    advice: 'Nếu thấp, hãy tăng thời lượng hoặc giảm số người chơi.',
    unit: 'điểm'
  },
  'Phủ giờ': {
    title: 'Điểm Phủ Thời gian',
    meaning: 'Đo lường mức độ khớp lịch đấu với khung giờ đăng ký.',
    calculation: '100 điểm - (số vòng lố × 7 điểm) hoặc (số vòng thiếu × 14 điểm).',
    advice: 'Mức phạt 7 điểm/vòng cho phép lố nhẹ 1-2 vòng để đạt đủ trận.',
    unit: 'điểm'
  },
  'Fit sân': {
    title: 'Điểm Khớp Sân đấu',
    meaning: 'Đánh giá xem số lượng sân có phù hợp với số lượng người chơi hiện tại hay không.',
    calculation: 'Thang điểm 100. Lý tưởng là 9.5 người/sân. Trừ 10 điểm cho mỗi đơn vị lệch so với mức lý tưởng.',
    advice: 'Tỷ lệ 8-10 người/sân là đẹp nhất để mọi người đều có thời gian nghỉ ngơi hợp lý.',
    unit: 'điểm'
  },
  'Nhịp nghỉ': {
    title: 'Điểm Nhịp nghỉ',
    meaning: 'Đo lường sự công bằng trong thời gian nghỉ ngơi giữa các trận đấu.',
    calculation: '100 điểm - (độ lệch chuẩn của thời gian nghỉ × 10).',
    advice: 'Điểm cao đảm bảo không ai bị nghỉ quá lâu hoặc đánh quá dồn dập.',
    unit: 'điểm'
  },
  'Đa dạng Bạn chơi': {
    title: 'Độ đa dạng Bạn chơi',
    meaning: 'Đo lường khả năng một người chơi được ghép cặp với nhiều người khác nhau trong buổi.',
    calculation: 'Tỉ lệ giữa số bạn chơi khác nhau và tổng số trận đánh.',
    advice: 'Lịch social nên có độ đa dạng cao để mọi người được giao lưu với nhau nhiều nhất.',
    unit: 'điểm'
  },
  'Đa dạng Đối thủ': {
    title: 'Độ đa dạng Đối thủ',
    meaning: 'Đo lường khả năng một người chơi được gặp nhiều đối thủ khác nhau.',
    calculation: 'Tỉ lệ giữa số đối thủ khác nhau và tổng số trận đánh.',
    advice: 'Gặp nhiều đối thủ khác nhau giúp buổi chơi bớt nhàm chán và tăng tính giao lưu.',
    unit: 'điểm'
  },
  'Hài lòng Partner': {
    title: 'Mức độ Hài lòng Bạn chơi',
    meaning: 'Tỉ lệ đáp ứng các yêu cầu ghép cặp (ví dụ: muốn đánh cặp với Nam/Nữ).',
    calculation: 'Số lượt đáp ứng được sở thích / Tổng số lượt có yêu cầu.',
    advice: 'Nếu điểm này thấp, hãy kiểm tra lại cấu trúc giới tính của session.',
    unit: '%'
  },
  'Hài lòng Đối thủ': {
    title: 'Mức độ Hài lòng Đối thủ',
    meaning: 'Tỉ lệ đáp ứng các yêu cầu về đối thủ (ví dụ: muốn đối đầu với Nam/Nữ).',
    calculation: 'Số lượt đáp ứng được sở thích / Tổng số lượt có yêu cầu.',
    advice: 'Hài lòng về đối thủ giúp các trận đấu diễn ra theo đúng mong đợi của người chơi.',
    unit: '%'
  },
  'Cân bằng Skill': {
    title: 'Cân bằng Trình độ',
    meaning: 'Đo lường độ chênh lệch trình độ (Skill Gap) giữa hai đội trong mỗi trận đấu.',
    calculation: 'Trung bình cộng của tất cả Skill Gap trong toàn bộ lịch. Điểm 100 nếu Gap = 0.',
    advice: 'Nên giữ chênh lệch trung bình < 0.5 để các trận đấu kịch tính và công bằng.',
    unit: 'điểm'
  },
  'B2B': {
    title: 'Số trận đánh liên tục (Back-to-Back)',
    meaning: 'Số lần người chơi phải đánh ngay trận sau không nghỉ.',
    calculation: 'Đếm tổng số lượt đánh liên tiếp trong toàn bộ lịch.',
    advice: 'Nên giữ chỉ số này thấp để tránh kiệt sức.',
    unit: 'lượt'
  },
  'Chuỗi max': {
    title: 'Chuỗi đánh liên tục dài nhất',
    meaning: 'Số trận tối đa mà một người phải đánh liên tiếp không nghỉ.',
    calculation: 'Tìm chuỗi trận liên tiếp dài nhất của một người chơi bất kỳ.',
    advice: 'Lý tưởng là 1 hoặc 2. Nếu > 3, hãy tăng người chơi dự bị.',
    unit: 'trận'
  },
  'Min nghỉ': {
    title: 'Khoảng nghỉ ngắn nhất',
    meaning: 'Số vòng nghỉ ít nhất mà mọi người chắc chắn có được.',
    calculation: 'Tìm khoảng nghỉ nhỏ nhất của tất cả người chơi.',
    advice: 'Lý tưởng là mọi người có nhất 1 vòng nghỉ giữa các trận.',
    unit: 'vòng'
  }
}


export function OneClickOptimizationScreen({ players, maxCourts, onSelect }: Props) {
  const activePlayers = useMemo(
    () => players.filter(p => p.status === 'confirmed' || !p.status),
    [players]
  )

  const [durationMinutes, setDurationMinutes] = useState(150)
  const [minutesPerRound, setMinutesPerRound] = useState(15)
  const [courtLimit, setCourtLimit] = useState(Math.max(1, maxCourts))
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<OptimizationResult[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0)
  const [activeModal, setActiveModal] = useState<{ result: OptimizationResult, type: OptimizationModalType, statKey?: string, statValue?: string | number } | null>(null)
  const [explanationStat, setExplanationStat] = useState<{ key: string, value: string | number, result: OptimizationResult } | null>(null)

  const candidateSet = useMemo(
    () => buildCandidateSet(activePlayers.length, courtLimit, durationMinutes, minutesPerRound),
    [courtLimit, durationMinutes, minutesPerRound, activePlayers.length]
  )
  const courtOptions = useMemo(
    () => Array.from({ length: Math.max(1, Math.min(16, Math.max(maxCourts, Math.floor(activePlayers.length / 4), 1))) }, (_, i) => i + 1),
    [maxCourts, activePlayers.length]
  )
  const targetRounds = Math.max(1, Math.ceil(durationMinutes / Math.max(1, minutesPerRound)))
  const desiredGamesPerPlayer = Math.max(2, Math.ceil(targetRounds / 2))
  const maxUsableCourts = Math.max(1, Math.min(Math.floor(activePlayers.length / 4), Math.floor(courtLimit || 1)))
  const visibleResults = results.slice(0, 3)

  const runOptimization = () => {
    setRunning(true)
    try {
      const nextResults = candidateSet
        .map(setup => {
          const result = optimizeRotationPlan(activePlayers, {
            targetGamesPerPlayer: setup.targetGames,
            courtCount: setup.courts,
            iterations: 8000,
          })

          const baseResult = {
            setup,
            matches: result.matches,
            players: activePlayers,
            quality: result.quality,
          }
          const actualRoundCount = getActualRoundCount(baseResult)
          const restStats = getRestPatternStats(activePlayers, result.matches)
          const scores = calculateSetupScores({
            qualityScore: result.quality.overallScore,
            targetGames: setup.targetGames,
            targetRounds: setup.targetRounds,
            actualRounds: actualRoundCount,
            desiredGamesPerPlayer,
            courts: setup.courts,
            maxUsableCourts,
            playerCount: activePlayers.length,
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
        .sort(compareResultsBySetupScore)
      setResults(nextResults)
    } finally {
      setRunning(false)
    }
  }

  if (activePlayers.length < 4) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', textAlign: 'center' }}>
          Cần ít nhất 4 người chơi để tối ưu lịch.
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
          Nhập bối cảnh buổi social, hệ thống thử nhiều setup và xếp hạng bằng điểm setup: chất lượng lịch + độ phủ thời lượng + số trận/người + fit sân hợp lý.
        </Text>
      </View>

      <View style={{ backgroundColor: '#FFFCF5', borderRadius: 20, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginBottom: 10 }}>
          Input tối ưu
        </Text>

        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900', marginBottom: 8 }}>Thời lượng buổi chơi</Text>
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

        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900', marginBottom: 8 }}>Nhịp 1 vòng</Text>
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

        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900', marginBottom: 8 }}>Số sân tối đa có thể dùng</Text>
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
            Sẽ thử {candidateSet.length} setup quanh mục tiêu {targetRounds} vòng, tìm số sân hợp lý theo group size thay vì mặc định dùng full sân.
            Sàn trận/người: {desiredGamesPerPlayer}.
          </Text>
        </View>

        <TouchableOpacity onPress={runOptimization} disabled={running || candidateSet.length === 0} style={{ backgroundColor: candidateSet.length > 0 ? '#0F6E56' : '#9CA3AF', borderRadius: 14, paddingVertical: 13, alignItems: 'center', opacity: running ? 0.7 : 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
            {running ? 'Đang tối ưu...' : 'Tìm setup tối ưu'}
          </Text>
        </TouchableOpacity>
      </View>

      {running && <AppLoading />}

      {results.length > 0 && (
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }}>{activePlayers.length} NGƯỜI CHƠI CHÍNH THỨC</Text>
            <TouchableOpacity onPress={runOptimization} disabled={running}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#0F6E56', fontWeight: '900' }}>{running ? 'ĐANG TÍNH...' : 'TÍNH LẠI'}</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontStyle: 'italic', marginTop: -8, marginBottom: 4 }}>
            * Các chỉ số đã được cân bằng trọng số để đảm bảo tính ổn định và thực tế cho mọi phương án.
          </Text>

          {visibleResults.map((result, index) => {
            const isExpanded = expandedIndex === index
            return (
              <TouchableOpacity
                activeOpacity={0.8}
                key={result.setup.key}
                onPress={() => setExpandedIndex(isExpanded ? null : index)}
                style={{ backgroundColor: '#FFFCF5', borderRadius: 22, padding: 12, borderWidth: 1, borderColor: index === 0 ? '#88D4B5' : '#E5E3DC' }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#1A2E2A', fontWeight: '900' }}>
                      #{index + 1} · {result.setup.targetGames} trận/người · {result.setup.courts} sân
                    </Text>
                    {!isExpanded && (
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', marginTop: 4, fontStyle: 'italic', fontWeight: '600' }} numberOfLines={1}>
                        {getResultInterpretation(result, index, visibleResults)}
                      </Text>
                    )}
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: isExpanded ? 3 : 1 }}>
                      Khoảng {result.setup.estimatedRounds}/{result.setup.targetRounds} vòng · {result.matches.length} trận
                    </Text>
                  </View>
                  {!isExpanded && (
                    <View style={{ backgroundColor: result.setupScore > 85 ? '#E1F5EE' : '#FFF4D6', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: result.setupScore > 85 ? '#88D4B5' : '#F5DFA0' }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', fontWeight: '900' }}>
                        {result.setupScore}
                      </Text>
                    </View>
                  )}
                </View>

                {isExpanded && (
                  <>
                    <View style={{ backgroundColor: result.setupScore > 85 ? '#E1F5EE' : '#FFF4D6', borderRadius: 18, padding: 12, borderWidth: 1, borderColor: result.setupScore > 85 ? '#88D4B5' : '#F5DFA0', marginVertical: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', fontWeight: '900', textTransform: 'uppercase' }}>
                            Điểm setup
                          </Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', marginTop: 3, lineHeight: 13 }}>
                            {getResultInterpretation(result, index, visibleResults)}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 30, color: result.setupScore > 85 ? '#0F6E56' : '#A05A16', fontWeight: '900' }}>
                          {result.setupScore}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: isExpanded ? 10 : 0 }}>
                      {[
                        { label: 'Chất lượng', value: result.quality.overallScore },
                        { label: 'Phủ trận', value: result.gamesCoverageScore },
                        { label: 'Phủ giờ', value: result.durationCoverageScore },
                        { label: 'Fit sân', value: result.courtFitScore },
                        { label: 'Nhịp nghỉ', value: result.restPatternScore },
                        { label: 'B2B', value: result.backToBackCount },
                        { label: 'Chuỗi max', value: result.maxConsecutivePlays },
                        { label: 'Min nghỉ', value: result.minRestAcrossPlayers == null ? '-' : result.minRestAcrossPlayers },
                      ].map(item => {
                        const explanation = STAT_EXPLANATIONS[item.label]
                        const unit = explanation?.unit || ''
                        const space = (unit && unit !== '%') ? ' ' : ''
                        const displayValue = item.value === '-' ? '-' : `${item.value}${space}${unit}`
                        
                        if (item.label === 'Chất lượng') {
                          return (
                            <TouchableOpacity
                              key={item.label}
                              onPress={() => setActiveModal({ result, type: 'quality', statKey: item.label, statValue: displayValue })}
                              style={{ backgroundColor: '#F8F3E8', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 6, borderWidth: 1, borderColor: '#EFE3CC', width: '23.5%', alignItems: 'center' }}
                            >
                              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#7A8884', fontWeight: '900', textAlign: 'center' }} numberOfLines={1}>{item.label}</Text>
                              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginTop: 1 }}>{displayValue}</Text>
                            </TouchableOpacity>
                          )
                        }

                        return (
                          <TouchableOpacity
                            key={item.label}
                            onPress={() => setExplanationStat({ key: item.label, value: displayValue, result })}
                            style={{ backgroundColor: '#F8F3E8', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 6, borderWidth: 1, borderColor: '#EFE3CC', width: '23.5%', alignItems: 'center' }}
                          >
                            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#7A8884', fontWeight: '900', textAlign: 'center' }} numberOfLines={1}>{item.label}</Text>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginTop: 1 }}>{displayValue}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>

                    {isExpanded && (
                      <View style={{ marginTop: 14 }}>
                        {/* Section 1: Actions */}
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <TouchableOpacity
                            onPress={() => setActiveModal({ result, type: 'players' })}
                            style={{ flex: 1, backgroundColor: '#E1F5EE', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#88D4B5' }}
                          >
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
                              SOI CHI TIẾT NGƯỜI CHƠI
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setActiveModal({ result, type: 'rounds' })}
                            style={{ flex: 1, backgroundColor: '#F5F1E8', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#D5D2C8' }}
                          >
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
                              XEM CHI TIẾT CÁC VÒNG ĐẤU
                            </Text>
                          </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                          onPress={() => {
                            const plan = buildFinalPlan(result)
                            onSelect?.(plan)
                          }}
                          style={{ backgroundColor: '#0F6E56', borderRadius: 16, padding: 16, alignItems: 'center', marginTop: 12 }}
                        >
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: 'white', fontWeight: '900' }}>
                            SỬ DỤNG LỊCH NÀY
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                )}
              </TouchableOpacity>
            )
          })}
        </View>
      )}

      {activeModal && activeModal.type === 'explanation' && (
        <ExplanationModal 
          statKey={activeModal.statKey || ''} 
          statValue={activeModal.statValue}
          result={activeModal.result}
          durationMinutes={durationMinutes}
          minutesPerRound={minutesPerRound}
          onClose={() => setActiveModal(null)} 
        />
      )}

      {activeModal && activeModal.type !== 'rounds' && activeModal.type !== 'explanation' && (
        <PlayerDetailsModal
          result={activeModal.result}
          type={activeModal.type}
          onClose={() => setActiveModal(null)}
          onOpenStatExplanation={(key, value) => setExplanationStat({ key, value, result: activeModal.result })}
        />
      )}

      {explanationStat && (
        <ExplanationModal
          statKey={explanationStat.key}
          statValue={explanationStat.value}
          result={explanationStat.result}
          durationMinutes={durationMinutes}
          minutesPerRound={minutesPerRound}
          onClose={() => setExplanationStat(null)}
        />
      )}

      {activeModal?.type === 'rounds' && (
        <RoundsDetailsModal
          result={activeModal.result}
          onClose={() => setActiveModal(null)}
        />
      )}
    </ScrollView>
  )
}

function buildFinalPlan(result: OptimizationResult) {
  return {
    courts: result.setup.courts,
    targetGames: result.setup.targetGames,
    matches: result.matches,
    playerCount: result.players.length,
  }
}

function ExplanationModal({ 
  statKey, 
  statValue, 
  result, 
  durationMinutes,
  minutesPerRound,
  onClose 
}: { 
  statKey: string, 
  statValue?: string | number, 
  result: OptimizationResult, 
  durationMinutes: number,
  minutesPerRound: number,
  onClose: () => void 
}) {
  const info = STAT_EXPLANATIONS[statKey] || { title: statKey, meaning: 'Đang cập nhật...', calculation: 'Đang cập nhật...', advice: 'Đang cập nhật...', unit: '' }

  const getDetailedCalculation = () => {
    const totalPlayers = result.players.length
    const targetGames = result.setup.targetGames
    const actualRounds = getActualRoundCount(result)
    const targetRounds = result.setup.targetRounds

    switch (statKey) {
      case 'Phủ trận':
        const playersWithTarget = result.players.filter(p => {
          const games = result.matches.filter(m => m.teamA.includes(String(p.id)) || m.teamB.includes(String(p.id))).length
          return games >= targetGames
        }).length
        const missingTarget = totalPlayers - playersWithTarget
        return `Mục tiêu: Đủ ${targetGames} trận/người.\nThực tế: ${playersWithTarget}/${totalPlayers} người đạt được.\n\nLogic: 100 - (${missingTarget} người thiếu × 5) = ${result.gamesCoverageScore} điểm.`
      case 'Phủ giờ':
        const extraRounds = actualRounds - targetRounds
        const overtime = extraRounds * minutesPerRound
        const totalPlaysNeeded = totalPlayers * targetGames
        const playsPerRound = result.setup.courts * 4
        
        let explanation = `Mục tiêu: ${durationMinutes} phút / ${minutesPerRound} phút ≈ ${targetRounds} vòng.`
        explanation += `\n\nThực tế cần: (${totalPlayers} × ${targetGames} trận) / (${result.setup.courts} sân × 4) ≈ ${actualRounds} vòng.`
        
        if (extraRounds > 0) {
          explanation += `\n\nLố ${extraRounds} vòng (≈ ${overtime} phút).\nLogic: 100 - (${extraRounds} × 7) = ${result.durationCoverageScore} điểm.`
        } else if (extraRounds < 0) {
          explanation += `\n\nThiếu ${Math.abs(extraRounds)} vòng.\nLogic: 100 - (${Math.abs(extraRounds)} × 14) = ${result.durationCoverageScore} điểm.`
        }
        return explanation
      case 'Fit sân':
        const ratio = (totalPlayers / result.setup.courts).toFixed(1)
        const diff = Math.abs(Number(ratio) - 9.5).toFixed(1)
        return `Tỉ lệ: ${totalPlayers} người / ${result.setup.courts} sân = ${ratio} người/sân.\n(Lý tưởng: 9.5).\n\nLogic: 100 - (${diff} độ lệch × 10) = ${result.courtFitScore} điểm.`
      case 'Nhịp nghỉ':
        return `Độ lệch chuẩn khoảng nghỉ: ${(100 - result.restPatternScore) / 10}.\n\nLogic: 100 - (độ lệch × 10) = ${result.restPatternScore} điểm.`
      case 'Cân bằng Skill':
        const avgGap = (result as any).quality?.avgSkillGap || 0
        return `Chênh lệch trình độ TB: ${avgGap.toFixed(2)} điểm/trận.\n(Lý tưởng: 0.0).\n\nLogic: 100 - (chênh lệch TB × 15) = ${result.quality.score} điểm.`
      case 'Đa dạng Bạn chơi':
        return `Đây là mức độ "xoay vòng" bạn chơi. Thuật toán cố gắng để mọi người đều được đánh cặp với nhau ít nhất 1 lần.`
      case 'Đa dạng Đối thủ':
        return `Đây là mức độ "xoay vòng" đối thủ. Thuật toán cố gắng để bạn không phải gặp lại cùng 1 đối thủ quá nhiều lần.`
      case 'Hài lòng Partner':
        return `Tỉ lệ đáp ứng yêu cầu giới tính của bạn chơi đã được cài đặt trong Metadata.`
      case 'Hài lòng Đối thủ':
        return `Tỉ lệ đáp ứng yêu cầu giới tính của đối thủ đã được cài đặt trong Metadata.`
      case 'B2B':
        return `Tổng lượt đánh liên tiếp: ${result.backToBackCount}.\n\nĐây là số lần người chơi không có vòng nghỉ giữa 2 trận.`
      case 'Chuỗi max':
        return `Người chơi đánh liên tục nhiều nhất: ${result.maxConsecutivePlays} trận.`
      case 'Min nghỉ':
        return `Trong phương án này, mọi người chắc chắn được nghỉ ít nhất ${result.minRestAcrossPlayers || 0} vòng giữa các trận đấu.\n\nLý tưởng nhất là chỉ số này ≥ 1 để đảm bảo nhịp hồi phục cơ bắp.`
      default:
        return info.calculation
    }
  }

  // Check if statValue already contains the unit to avoid duplication (e.g. 79% %)
  const valueStr = String(statValue || '')
  const hasUnitAlready = info.unit && valueStr.includes(info.unit)

  return (
    <Modal visible={true} animationType="fade" transparent={true} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
        <Pressable style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 4, height: 20, backgroundColor: '#0F6E56', borderRadius: 2 }} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: '#1A2E2A', fontWeight: '900' }}>{info.title}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#7A8884', fontWeight: '900' }}>ĐÓNG</Text>
            </TouchableOpacity>
          </View>

          {/* Actual Value Highlight */}
          <View style={{ backgroundColor: '#F8F3E8', borderRadius: 20, padding: 20, alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: '#EFE3CC' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '800', marginBottom: 4, textTransform: 'uppercase' }}>KẾT QUẢ HIỆN TẠI</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 32, color: '#1A2E2A', fontWeight: '900' }}>{statValue}</Text>
              {info.unit && !hasUnitAlready && <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 14, color: '#7A8884', fontWeight: '800', marginLeft: 4 }}>{info.unit}</Text>}
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', fontWeight: '700', marginTop: 4 }}>Chỉ số của phương án tối ưu này</Text>
          </View>

          <View style={{ gap: 20 }}>
            <View>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800', marginBottom: 6, textTransform: 'uppercase' }}>Ý NGHĨA</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 14, color: '#1A2E2A', lineHeight: 20 }}>{info.meaning}</Text>
            </View>

            <View>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800', marginBottom: 6, textTransform: 'uppercase' }}>CÁCH TÍNH CHI TIẾT</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 14, color: '#596864', lineHeight: 20, fontStyle: 'italic' }}>
                {getDetailedCalculation()}
              </Text>
            </View>

            <View style={{ backgroundColor: '#F0F9F6', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#BFE3D6' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', fontWeight: '800', marginBottom: 6, textTransform: 'uppercase' }}>LỜI KHUYÊN THỰC TẾ</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 14, color: '#0F6E56', fontWeight: '600', lineHeight: 20 }}>{info.advice}</Text>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function PlayerDetailsModal({ result, type, onClose, onOpenStatExplanation }: { result: OptimizationResult, type: OptimizationModalType, onClose: () => void, onOpenStatExplanation?: (key: string, value: string | number) => void }) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  const isQualityMode = type === 'quality'

  const sortedPlayers = useMemo(() =>
    [...result.players].sort((a, b) => a.name.localeCompare(b.name)),
    [result.players]
  )

  const selectedPlayer = focusedId ? result.players.find(p => String(p.id) === focusedId) : null

  return (
    <Modal visible={true} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F9F8F4' }}>
        <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E3DC', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', fontWeight: '900' }}>
              {isQualityMode ? `PHÂN TÍCH CHẤT LƯỢNG #${result.setup.key}` : `CHI TIẾT NGƯỜI CHƠI #${result.setup.key}`}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864' }}>
              {isQualityMode ? 'Báo cáo chi tiết các chỉ số chất lượng lịch đấu' : 'Báo cáo độ phủ và cân bằng trình độ từng thành viên'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#7A8884', fontWeight: '900' }}>ĐÓNG</Text>
          </TouchableOpacity>
        </View>

        {!isQualityMode && (
          /* Custom Dropdown Selector - Only for Player Mode */
          <View style={{ backgroundColor: 'white', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E3DC', zIndex: 10 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '800', marginBottom: 8, textTransform: 'uppercase' }}>
              SOI NHANH NGƯỜI CHƠI
            </Text>

            <TouchableOpacity
              onPress={() => setShowDropdown(!showDropdown)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: '#F8F3E8', borderRadius: 12, padding: 12,
                borderWidth: 1, borderColor: '#E5E3DC'
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: selectedPlayer ? '#1A2E2A' : '#7A8884', fontWeight: '700' }}>
                {selectedPlayer ? selectedPlayer.name : 'Chọn người chơi để xem chi tiết...'}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#0F6E56', fontWeight: '900' }}>
                {showDropdown ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>

            {showDropdown && (
              <View style={{
                marginTop: 4, backgroundColor: 'white', borderRadius: 12,
                borderWidth: 1, borderColor: '#E5E3DC', maxHeight: 250,
                shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5
              }}>
                <ScrollView nestedScrollEnabled={true}>
                  <TouchableOpacity
                    onPress={() => { setFocusedId(null); setShowDropdown(false) }}
                    style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#F1EFE8' }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: focusedId === null ? '#0F6E56' : '#1A2E2A', fontWeight: focusedId === null ? '900' : '500' }}>
                      --- Hiện tất cả mọi người ---
                    </Text>
                  </TouchableOpacity>
                  {sortedPlayers.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => { setFocusedId(String(p.id)); setShowDropdown(false) }}
                      style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#F1EFE8', backgroundColor: focusedId === String(p.id) ? '#E1F5EE' : 'transparent' }}
                    >
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: focusedId === String(p.id) ? '#0F6E56' : '#1A2E2A', fontWeight: focusedId === String(p.id) ? '900' : '500' }}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <ScheduleCoverageReport
            players={result.players}
            schedule={result.matches}
            mode="limited"
            minGamesPerPlayer={result.setup.targetGames}
            variant="rotation"
            quality={{ ...result.quality, timedOut: false, fallbackUsed: false }}
            playerStatsInitiallyExpanded={!isQualityMode}
            hideSummary={!isQualityMode}
            hidePlayerStats={isQualityMode}
            focusedPlayerId={focusedId}
            onOpenStatExplanation={onOpenStatExplanation}
          />
        </ScrollView>
      </View>
    </Modal>
  )
}

function RoundsDetailsModal({ result, onClose }: { result: OptimizationResult, onClose: () => void }) {
  return (
    <Modal visible={true} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F9F8F4' }}>
        <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E3DC', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white' }}>
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', fontWeight: '900' }}>
              LỊCH ĐẤU CHI TIẾT #{result.setup.key}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864' }}>
              Danh sách trận đấu và người nghỉ theo từng vòng
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#7A8884', fontWeight: '900' }}>ĐÓNG</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <DetailedRoundsPreview
            matches={result.matches}
            players={result.players}
          />
        </ScrollView>
      </View>
    </Modal>
  )
}

function getResultInterpretation(result: OptimizationResult, index: number, allResults: OptimizationResult[]) {
  if (index === 0) {
    return 'Lựa chọn vàng: Cân bằng hoàn hảo giữa chất lượng trận đấu và thời gian nghỉ.'
  }

  const first = allResults[0]
  if (result.setup.courts > first.setup.courts) {
    const timeSaved = (first.setup.estimatedRounds - result.setup.estimatedRounds) * 15
    return `Ưu tiên tốc độ: Dùng thêm sân giúp mọi người được đánh nhiều hơn và kết thúc sớm hơn${timeSaved > 0 ? ` khoảng ${timeSaved} phút` : ''}.`
  }

  if (result.quality.overallScore > first.quality.overallScore + 2) {
    return 'Chất lượng là trên hết: Các trận đấu được tối ưu trình độ cực tốt, dù thời gian có thể kéo dài hơn.'
  }

  if (result.setup.courts < first.setup.courts) {
    return 'Tiết kiệm & Giao lưu: Nhịp chơi thong thả, tận dụng ít sân hơn nhưng vẫn đảm bảo mọi người đều được vào sân.'
  }

  return 'Phương án dự phòng: Thay đổi nhẹ về số trận mỗi người để phù hợp với quỹ thời gian.'
}

function getPlayerSkill(player: ArrangementPlayer | undefined) {
  if (!player) return 0
  return Number(player.pvna ?? (player.elo / 100) ?? 0)
}

function DetailedRoundsPreview({ matches, players }: { matches: RotationScheduledMatch[], players: ArrangementPlayer[] }) {
  const playerById = useMemo(() => {
    const map = new Map<string, ArrangementPlayer>()
    players.forEach(p => map.set(String(p.id), p))
    return map
  }, [players])

  const rotations = useMemo(() => {
    const rots = Array.from(new Set(matches.map(m => m.rotation || 0))).sort((a, b) => a - b)
    return rots
  }, [matches])

  return (
    <View style={{ gap: 20 }}>
      {rotations.map((r) => {
        const matchesInR = matches.filter(m => m.rotation === r).sort((a, b) => (a.court || 0) - (b.court || 0))
        const playingIds = new Set(matchesInR.flatMap(m => [...m.teamA, ...m.teamB]))
        const sitters = players.filter(p => !playingIds.has(String(p.id))).map(p => p.name.split(' ').pop()).sort()

        return (
          <View key={`rot-${r}`} style={{ backgroundColor: 'white', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#E5E3DC', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 }}>
            {/* Round Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#0F6E56', paddingLeft: 10 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', fontWeight: '900' }}>
                VÒNG {r}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#7A8884', fontWeight: '700' }}>
                ({matchesInR.length} trận)
              </Text>
            </View>

            {/* Matches List - Super Compact */}
            <View style={{ borderTopWidth: 1, borderTopColor: '#F1EFE8' }}>
              {matchesInR.map((match, mIdx) => {
                const teamAPlayers = match.teamA.map(id => playerById.get(id))
                const teamBPlayers = match.teamB.map(id => playerById.get(id))
                const teamASkill = teamAPlayers.reduce((sum, p) => sum + getPlayerSkill(p), 0)
                const teamBSkill = teamBPlayers.reduce((sum, p) => sum + getPlayerSkill(p), 0)
                const skillGap = Math.abs(teamASkill - teamBSkill)
                const gapColor = skillGap <= 0.4 ? '#0F6E56' : skillGap <= 0.8 ? '#A05A16' : '#B91C1C'

                return (
                  <View key={`m-${r}-${mIdx}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1EFE8' }}>
                    {/* Compact Court Indicator */}
                    <View style={{ width: 30, height: 30, borderRadius: 6, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#88D4B5', marginRight: 12 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#0F6E56', fontWeight: '900' }}>{match.court}</Text>
                    </View>

                    {/* Match Details */}
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                      {/* Teams Section */}
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                        {/* Team A */}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: '#1A2E2A', fontWeight: '900' }} numberOfLines={1}>
                            {teamAPlayers.map(p => p?.name.split(' ').pop()).join(' / ')}
                          </Text>
                        </View>

                        {/* VS Divider */}
                        <View style={{ paddingHorizontal: 8 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800' }}>vs</Text>
                        </View>

                        {/* Team B */}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: '#1A2E2A', fontWeight: '900' }} numberOfLines={1}>
                            {teamBPlayers.map(p => p?.name.split(' ').pop()).join(' / ')}
                          </Text>
                        </View>
                      </View>

                      {/* Gap Indicator (Far Right) */}
                      <View style={{ paddingLeft: 12, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: '#F1EFE8', marginLeft: 8, width: 45 }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#7A8884', fontWeight: '800' }}>Δ</Text>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: gapColor, fontWeight: '900', marginTop: -2 }}>{skillGap.toFixed(1)}</Text>
                      </View>
                    </View>
                  </View>
                )
              })}
            </View>
          </View>
        )
      })}
    </View>
  )
}
