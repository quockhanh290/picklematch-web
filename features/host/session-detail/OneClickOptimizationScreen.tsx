import { AppLoading } from '@/components/design'
import { SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { buildCandidateSet, getActualRoundCount, type OptimizationResult } from '@/lib/scheduler/oneClickOptimization'
import { runOneClickOptimizationAsync } from '@/lib/scheduler/oneClickOptimizationClient'
import type { RotationScheduledMatch } from '@/lib/scheduler/rotationOptimizer'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { ScheduleCoverageReport } from './ScheduleCoverageReport'

type Props = {
  players: ArrangementPlayer[]
  maxCourts: number
  onSelect?: (plan: any) => void
}

type OptimizationModalType = 'quality' | 'players' | 'rounds' | 'explanation'

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
  const [optimizationProgress, setOptimizationProgress] = useState<{ current: number, total: number } | null>(null)
  const [results, setResults] = useState<OptimizationResult[]>([])
  const [showSetup, setShowSetup] = useState(true)
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
  const visibleResults = results.slice(0, 3)

  const runOptimization = async () => {
    setRunning(true)
    setOptimizationProgress({ current: 0, total: candidateSet.length })
    const loadingStartedAt = Date.now()
    try {
      await new Promise(resolve => setTimeout(resolve, 220))
      const nextResults = await runOneClickOptimizationAsync(
        {
          players: activePlayers,
          maxCourts: courtLimit,
          durationMinutes,
          minutesPerRound,
          iterations: 8000,
        },
        setOptimizationProgress
      )
      setResults(nextResults)
      setShowSetup(false)
      setExpandedIndex(0)
    } finally {
      const remainingLoadingMs = Math.max(0, 800 - (Date.now() - loadingStartedAt))
      setTimeout(() => {
        setOptimizationProgress(null)
        setRunning(false)
      }, remainingLoadingMs)
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
    <ScrollView style={{ flex: 1, backgroundColor: '#F8F3E8' }} contentContainerStyle={{ padding: 8, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
      {results.length > 0 && !showSetup ? (
        <View style={{ backgroundColor: '#FFFCF5', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E3DC' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', textTransform: 'uppercase' }}>
                Thiết lập hiện tại
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', fontWeight: '900', marginTop: 3 }}>
                {durationMinutes / 60}h · {minutesPerRound}p/vòng · tối đa {courtLimit} sân
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowSetup(true)} style={{ backgroundColor: '#F8F3E8', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#E5E3DC' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
                Sửa thiết lập
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
      <View style={{ backgroundColor: '#FFFCF5', borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E3DC', overflow: 'hidden' }}>
        <View style={{ backgroundColor: '#0F6E56', paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: 'white', fontWeight: '900' }}>
            • TỐI ƯU TỰ ĐỘNG
          </Text>
        </View>
        <View style={{ padding: 14 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: '#1A2E2A', fontWeight: '900', lineHeight: 25 }}>
            HỆ THỐNG TỰ XẾP LỊCH TỐI ƯU
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#7A8884', marginTop: 6, lineHeight: 18 }}>
            Nhập thông số buổi chơi - hệ thống thử nhiều cấu hình và chọn phương án tốt nhất dựa trên:
          </Text>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
            {['Chất lượng lịch', 'Độ phủ thời lượng', 'Số trận/người', 'Fit sân'].map(label => (
              <View key={label} style={{ backgroundColor: '#E1F5EE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', fontWeight: '900' }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: '#FFFCF5', borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>Thời lượng buổi chơi</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', fontWeight: '700' }}>Chọn 1</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {[
            { value: 120, label: '2h' },
            { value: 150, label: '2.5h' },
            { value: 180, label: '3h' },
            { value: 210, label: '3.5h' },
          ].map(option => {
            const active = durationMinutes === option.value
            return (
              <TouchableOpacity key={option.value} onPress={() => setDurationMinutes(option.value)} style={{ minWidth: 49, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? '#0F6E56' : 'white', borderWidth: 1, borderColor: active ? '#0F6E56' : '#D8D3C8', alignItems: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: active ? 'white' : '#7A8884', fontWeight: '900' }}>{option.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={{ height: 1, backgroundColor: '#E5E3DC', marginBottom: 15 }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>Nhịp 1 vòng</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', fontWeight: '700' }}>Thời gian mỗi trận</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {[12, 15, 18, 20].map(minutes => {
            const active = minutesPerRound === minutes
            return (
              <TouchableOpacity key={minutes} onPress={() => setMinutesPerRound(minutes)} style={{ minWidth: 49, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? '#0F6E56' : 'white', borderWidth: 1, borderColor: active ? '#0F6E56' : '#D8D3C8', alignItems: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: active ? 'white' : '#7A8884', fontWeight: '900' }}>{minutes}p</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={{ height: 1, backgroundColor: '#E5E3DC', marginBottom: 15 }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>Số sân tối đa có thể dùng</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', fontWeight: '700' }}>Chọn 1</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {courtOptions.slice(0, 10).map(courts => {
            const active = courtLimit === courts
            return (
              <TouchableOpacity key={courts} onPress={() => setCourtLimit(courts)} style={{ width: '18.3%', aspectRatio: 1, borderRadius: 9, backgroundColor: active ? '#0F6E56' : 'white', borderWidth: 1, borderColor: active ? '#0F6E56' : '#D8D3C8', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: active ? 'white' : '#7A8884', fontWeight: '900' }}>{courts}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={{ backgroundColor: '#E1F5EE', borderRadius: 9, padding: 13, marginBottom: 12, flexDirection: 'row', gap: 10 }}>
          <Text style={{ fontSize: 16 }}>💡</Text>
          <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#0F6E56', lineHeight: 18 }}>
            {candidateSet.length === 0
              ? 'Chưa có phương án phù hợp với thiết lập hiện tại. Hãy tăng thời lượng, tăng số sân hoặc rút ngắn nhịp mỗi vòng.'
              : 'Hệ thống sẽ tự so sánh nhiều phương án xếp lịch và chọn lịch cân bằng nhất theo chất lượng trận, thời lượng buổi chơi và mức dùng sân hợp lý.'}
          </Text>
        </View>

        <TouchableOpacity onPress={runOptimization} disabled={running || candidateSet.length === 0} style={{ backgroundColor: candidateSet.length > 0 ? '#0F6E56' : '#9CA3AF', borderRadius: 999, paddingVertical: 16, alignItems: 'center', opacity: running ? 0.82 : 1, marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
              {running ? 'ĐANG TỐI ƯU...' : '⚡ TÌM SETUP TỐI ƯU'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
        </>
      )}

      {running && (
        <View style={{ backgroundColor: '#FFFCF5', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E5E3DC', alignItems: 'center' }}>
          <AppLoading label="" style={{ minHeight: 108, padding: 14 }} />
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#0F6E56', fontWeight: '900', textAlign: 'center' }}>
            Đang tối ưu lịch
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#596864', lineHeight: 17, textAlign: 'center', marginTop: 4 }}>
            Vui lòng chờ trong giây lát.
          </Text>
        </View>
      )}

      {results.length > 0 && (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: '#9E998D', fontWeight: '900', textTransform: 'uppercase' }}>
              Kết quả tối ưu
            </Text>
            <View style={{ backgroundColor: '#DFF7EE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
                {visibleResults.length} phương án
              </Text>
            </View>
          </View>

          {visibleResults.map((result, index) => {
            const isExpanded = expandedIndex === index
            const theme = getResultTheme(index)
            const gameSummary = getPlayerGameSummary(result)
            return (
              <TouchableOpacity
                activeOpacity={0.9}
                key={result.setup.key}
                onPress={() => setExpandedIndex(isExpanded ? null : index)}
                style={{ backgroundColor: '#FFFCF5', borderRadius: 16, borderWidth: 1, borderColor: '#E5E3DC', overflow: 'hidden' }}
              >
                <View style={{ backgroundColor: theme.header, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
                    #{index + 1} · {index === 0 ? 'LỰA CHỌN VÀNG' : 'PHƯƠNG ÁN ĐỀ XUẤT'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: 'rgba(255,255,255,0.86)', fontWeight: '900' }}>ĐIỂM</Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 22, color: 'white', fontWeight: '900' }}>{result.setupScore}</Text>
                  </View>
                </View>

                {!isExpanded ? (
                  <View style={{ paddingHorizontal: 14, paddingVertical: 13 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#1A2E2A', fontWeight: '900' }}>
                          {gameSummary.label} · {result.setup.courts} sân · {result.matches.length} trận
                        </Text>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', lineHeight: 16, marginTop: 4 }} numberOfLines={2}>
                          {getResultInterpretation(result, index, visibleResults)}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: '#BDB6A8', fontWeight: '900' }}>›</Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ padding: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                      {[
                        { value: gameSummary.shortLabel, label: 'TRẬN/NGƯỜI' },
                        { value: result.setup.courts, label: 'SÂN DÙNG' },
                        { value: result.matches.length, label: 'TỔNG TRẬN' },
                      ].map((item, metricIndex) => (
                        <View key={item.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: metricIndex === 0 ? 0 : 1, borderLeftColor: '#E5E3DC' }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 24, color: '#082A27', fontWeight: '900' }}>{item.value}</Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', marginTop: 2 }}>{item.label}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={{ backgroundColor: theme.soft, borderRadius: 10, padding: 12, marginBottom: 12, flexDirection: 'row', gap: 8 }}>
                      <Text style={{ fontSize: 15, color: '#0F6E56' }}>•</Text>
                      <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#0F6E56', fontWeight: '700', lineHeight: 18 }}>
                        {getResultInterpretation(result, index, visibleResults)}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {[
                        { label: 'Chất lượng', subLabel: 'Chất lượng trận', value: result.quality.overallScore },
                        { label: 'Phủ trận', subLabel: 'Phủ trận', value: result.gamesCoverageScore },
                        { label: 'Phủ giờ', subLabel: 'Phủ giờ', value: result.durationCoverageScore },
                        { label: 'Fit sân', subLabel: 'Fit sân', value: result.courtFitScore },
                      ].map(item => {
                        const displayValue = `${item.value}đ · ${item.value >= 85 ? 'Tốt' : item.value >= 75 ? 'Ổn' : 'Cần xem'}`
                        return (
                          <TouchableOpacity
                            key={item.label}
                            onPress={() => item.label === 'Chất lượng'
                              ? setActiveModal({ result, type: 'quality', statKey: item.label, statValue: displayValue })
                              : setExplanationStat({ key: item.label, value: displayValue, result })}
                            style={{ width: '48.7%', backgroundColor: '#F4EFE5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }}
                          >
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>{displayValue}</Text>
                            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800', marginTop: 2 }}>{item.subLabel}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => setActiveModal({ result, type: 'players' })}
                        style={{ flex: 1, borderRadius: 999, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#CFE8DE', backgroundColor: '#FFFCF5' }}
                      >
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
                          Xem người chơi
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setActiveModal({ result, type: 'rounds' })}
                        style={{ flex: 1, borderRadius: 999, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#CFE8DE', backgroundColor: '#FFFCF5' }}
                      >
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
                          Xem lịch đề xuất
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      onPress={() => {
                        const plan = buildFinalPlan(result)
                        onSelect?.(plan)
                      }}
                      style={{ backgroundColor: '#0F6E56', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 10 }}
                    >
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: 'white', fontWeight: '900' }}>
                        Dùng lịch này
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            )
          })}

          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', textAlign: 'center', lineHeight: 16, paddingHorizontal: 14, marginTop: 4 }}>
            * Các chỉ số đã được cân bằng trọng số để đảm bảo tính ổn định và thực tế cho mỗi phương án.
          </Text>
        </View>
      )}

      {false && results.length > 0 && (
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

      {activeModal && activeModal.type === 'quality' && (
        <QualityDetailsModal
          result={activeModal.result}
          onClose={() => setActiveModal(null)}
          onOpenStatExplanation={(key, value) => setExplanationStat({ key, value, result: activeModal.result })}
        />
      )}

      {activeModal && activeModal.type === 'players' && (
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

function getPlayerGameSummary(result: OptimizationResult) {
  const counts = getPlayerGameCounts(result)
  if (counts.length === 0) {
    return { label: `Mục tiêu ${result.setup.targetGames} trận/người`, shortLabel: result.setup.targetGames }
  }

  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const avg = counts.reduce((sum, count) => sum + count, 0) / counts.length

  if (min === max) {
    return { label: `${min} trận/người`, shortLabel: min }
  }

  return { label: `${min}-${max} trận/người`, shortLabel: avg.toFixed(1) }
}

function getPlayerGameCounts(result: OptimizationResult) {
  return result.players.map(player => {
    const id = String(player.id)
    return result.matches.filter(match => match.teamA.includes(id) || match.teamB.includes(id)).length
  })
}

function getResultTheme(index: number) {
  if (index === 0) {
    return { header: '#0B5E49', soft: '#DFF7EE' }
  }

  if (index === 1) {
    return { header: '#7F9088', soft: '#EEF3EF' }
  }

  return { header: '#B4AA99', soft: '#F3EEE5' }
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
        const gameCounts = getPlayerGameCounts(result)
        const playersWithTarget = gameCounts.filter(count => count >= targetGames).length
        const minGames = gameCounts.length ? Math.min(...gameCounts) : 0
        const maxGames = gameCounts.length ? Math.max(...gameCounts) : 0
        const avgGames = gameCounts.length ? gameCounts.reduce((sum, count) => sum + count, 0) / gameCounts.length : 0
        return `Mục tiêu setup: ${targetGames} trận/người.\nThực tế: ${playersWithTarget}/${totalPlayers} người đạt mục tiêu, dao động ${minGames}-${maxGames} trận/người, trung bình ${avgGames.toFixed(1)} trận.\n\nĐiểm này được tính từ số trận thực tế sau khi thuật toán sinh lịch, không lấy thẳng target setup. Kết quả hiện tại: ${result.gamesCoverageScore} điểm.`
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

function LegacyPlayerDetailsModal({ result, type, onClose, onOpenStatExplanation }: { result: OptimizationResult, type: OptimizationModalType, onClose: () => void, onOpenStatExplanation?: (key: string, value: string | number) => void }) {
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

function PlayerDetailsModal({ result, type, onClose }: { result: OptimizationResult, type: OptimizationModalType, onClose: () => void, onOpenStatExplanation?: (key: string, value: string | number) => void }) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [expandedIssueRows, setExpandedIssueRows] = useState<Set<string>>(new Set())
  const isQualityMode = type === 'quality'
  const rows = useMemo(() => buildPlayerDetailRows(result), [result])
  const visibleRows = useMemo(() => rows.filter(row => !focusedId || row.id === focusedId), [rows, focusedId])
  const selectedRow = focusedId ? rows.find(row => row.id === focusedId) : null
  const maxRound = Math.max(1, ...result.matches.map(match => match.rotation || 0))

  const toggleIssues = (id: string) => {
    setExpandedIssueRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <Modal visible={true} animationType="slide" transparent={true} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(26,46,42,0.42)', justifyContent: 'flex-end' }}>
        <Pressable style={{ maxHeight: '92%', backgroundColor: '#F8F3E8', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 42, height: 5, borderRadius: 999, backgroundColor: '#D8D3C8' }} />
          </View>

          <View style={{ backgroundColor: '#FFFCF5', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E5E3DC' }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: '#1A2E2A', fontWeight: '900' }}>
                  {isQualityMode ? 'PHÂN TÍCH CHẤT LƯỢNG' : 'CHI TIẾT NGƯỜI CHƠI'}
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 2 }}>
                  Báo cáo độ phủ và cân bằng trình độ · Setup #{result.setup.key}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#F4EFE5', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 18, color: '#7A8884', lineHeight: 20 }}>×</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: 18, backgroundColor: '#F4EFE5', borderRadius: 8, borderWidth: 1, borderColor: '#E5E3DC', paddingHorizontal: 12, paddingVertical: 11 }}>
              <TouchableOpacity onPress={() => setShowDropdown(!showDropdown)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: selectedRow ? '#1A2E2A' : '#A6A096', fontWeight: '700' }}>
                  {selectedRow ? selectedRow.name : 'Tìm nhanh người chơi...'}
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#B4B2A9', fontWeight: '900' }}>{showDropdown ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {showDropdown && (
                <View style={{ marginTop: 10, maxHeight: 230, borderTopWidth: 1, borderTopColor: '#E5E3DC' }}>
                  <ScrollView nestedScrollEnabled={true}>
                    <TouchableOpacity onPress={() => { setFocusedId(null); setShowDropdown(false) }} style={{ paddingVertical: 10 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: focusedId === null ? '#0F6E56' : '#1A2E2A', fontWeight: focusedId === null ? '900' : '600' }}>
                        Tất cả người chơi
                      </Text>
                    </TouchableOpacity>
                    {rows.map(row => (
                      <TouchableOpacity key={row.id} onPress={() => { setFocusedId(row.id); setShowDropdown(false) }} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#E5E3DC' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: focusedId === row.id ? '#0F6E56' : '#1A2E2A', fontWeight: focusedId === row.id ? '900' : '600' }}>
                          {row.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {visibleRows.map(row => {
              const issuesExpanded = expandedIssueRows.has(row.id)
              const primaryMetrics = [
                { value: `${row.games}/${result.setup.targetGames}`, label: 'TRẬN ĐẤU', tone: getMetricTone(row.games / Math.max(1, result.setup.targetGames)) },
                { value: `${row.partners}/${Math.max(1, row.games)}`, label: 'PARTNER ĐA DẠNG', tone: getMetricTone(row.partners / Math.max(1, row.games)) },
                { value: `${row.opponents}/${Math.max(1, row.games * 2)}`, label: 'ĐỐI THỦ ĐA DẠNG', tone: getMetricTone(row.opponents / Math.max(1, row.games * 2)) },
              ]

              return (
                <View key={row.id} style={{ backgroundColor: '#FFFCF5', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E3DC' }}>
                  <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: row.avatarColor, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: 'white', fontWeight: '900' }}>{row.initial}</Text>
                      </View>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#07312B', fontWeight: '900' }} numberOfLines={1}>{row.name}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: 180 }}>
                      {row.preferenceTags.map(tag => (
                        <View key={tag.label} style={{ backgroundColor: tag.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: tag.fg, fontWeight: '900' }}>{tag.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={{ borderTopWidth: 1, borderTopColor: '#E5E3DC', paddingHorizontal: 16, paddingTop: 12 }}>
                    <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                      {primaryMetrics.map((metric, metricIndex) => (
                        <View key={metric.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: metricIndex === 0 ? 0 : 1, borderLeftColor: '#E5E3DC' }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: metric.tone, fontWeight: '900' }}>{metric.value}</Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '900', marginTop: 2 }}>{metric.label}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                      <View style={{ flex: 1, backgroundColor: '#F4EFE5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800' }}>Hài lòng pref</Text>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: getPreferenceTone(row.preferenceRatio), fontWeight: '900' }}>{row.preferenceLabel}</Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: '#F4EFE5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800' }}>Nghỉ TB</Text>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#082A27', fontWeight: '900' }}>{row.avgRestLabel}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#9E998D', fontWeight: '900' }}>VÒNG CHƠI</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800' }}>
                        {row.games}/{result.setup.targetGames} trận · {maxRound} vòng
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        {Array.from({ length: maxRound }, (_, index) => index + 1).map((round) => {
                          const gameCount = row.gamesByRound.get(round) || 0
                          const active = gameCount > 0
                          return (
                            <View key={round} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: active ? '#0F6E56' : '#F4EFE5', borderWidth: 1, borderColor: active ? '#0F6E56' : '#D8D3C8', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: gameCount > 1 ? 8 : 10, color: active ? 'white' : '#B4B2A9', fontWeight: '900' }}>{gameCount > 1 ? `${round}x${gameCount}` : round}</Text>
                            </View>
                          )
                        })}
                    </View>
                  </View>

                  {row.preferenceMisses.length > 0 && (
                    <View style={{ backgroundColor: '#FFF1D8', borderTopWidth: 1, borderTopColor: '#F3D49A' }}>
                      <TouchableOpacity onPress={() => toggleIssues(row.id)} style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#A05A16', fontWeight: '800' }}>
                          • Preference chưa đáp ứng · {row.preferenceMisses.length} mục
                        </Text>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#A05A16', fontWeight: '900' }}>{issuesExpanded ? 'Thu' : 'Xem ›'}</Text>
                      </TouchableOpacity>
                      {issuesExpanded && (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 6 }}>
                          {row.preferenceMisses.map(issue => (
                            <Text key={issue.key} style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A4B12', lineHeight: 16 }}>
                              V{issue.rotation}{issue.court ? ` S${issue.court}` : ''}: muốn {issue.type === 'partner' ? 'partner' : 'đối thủ'} {issue.preferred} · Thực tế: {issue.actual || 'không có'}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

type PlayerDetailRow = {
  id: string
  name: string
  initial: string
  avatarColor: string
  games: number
  partners: number
  opponents: number
  rotations: number[]
  gameTimeline: { key: string, label: string }[]
  gamesByRound: Map<number, number>
  rotationSet: Set<number>
  preferenceTags: { label: string, bg: string, fg: string }[]
  preferenceRatio: number | null
  preferenceLabel: string
  preferenceMisses: { key: string, type: 'partner' | 'opponent', preferred: string, actual: string, rotation: number, court?: number }[]
  avgRestLabel: string
  duplicateRotationCount: number
}

function buildPlayerDetailRows(result: OptimizationResult): PlayerDetailRow[] {
  const playerById = new Map<string, ArrangementPlayer>()
  result.players.forEach(player => playerById.set(String(player.id), player))

  return result.players.map(player => {
    const id = String(player.id)
    const partnerSet = new Set<string>()
    const opponentSet = new Set<string>()
    const rotations: number[] = []
    const gameTimeline: PlayerDetailRow['gameTimeline'] = []
    const gamesByRound = new Map<number, number>()
    const preferenceMisses: PlayerDetailRow['preferenceMisses'] = []
    let preferenceHits = 0
    let preferenceTotal = 0

    result.matches.forEach((match, matchIndex) => {
      const teamA = match.teamA.map(String)
      const teamB = match.teamB.map(String)
      const inA = teamA.includes(id)
      const inB = teamB.includes(id)
      if (!inA && !inB) return

      const ownTeam = inA ? teamA : teamB
      const otherTeam = inA ? teamB : teamA
      const partners = ownTeam.filter(otherId => otherId !== id).map(otherId => playerById.get(otherId)).filter(Boolean) as ArrangementPlayer[]
      const opponents = otherTeam.map(otherId => playerById.get(otherId)).filter(Boolean) as ArrangementPlayer[]

      const rotation = match.rotation || matchIndex + 1
      rotations.push(rotation)
      gameTimeline.push({
        key: `${matchIndex}-${rotation}-${match.court || 0}`,
        label: `${rotation}`,
      })
      gamesByRound.set(rotation, (gamesByRound.get(rotation) || 0) + 1)
      partners.forEach(partner => partnerSet.add(String(partner.id)))
      opponents.forEach(opponent => opponentSet.add(String(opponent.id)))

      if (player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any') {
        preferenceTotal++
        if (partners.some(partner => matchesPlayerGenderPref(partner, player.metadata?.partner_gender_pref))) {
          preferenceHits++
        } else {
          preferenceMisses.push({ key: `${matchIndex}-${id}-partner`, type: 'partner', preferred: formatDetailPrefLabel(player.metadata.partner_gender_pref), actual: formatPlayersWithGender(partners), rotation: match.rotation || matchIndex + 1, court: match.court })
        }
      }

      if (player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any') {
        preferenceTotal++
        if (opponents.some(opponent => matchesPlayerGenderPref(opponent, player.metadata?.opponent_gender_pref))) {
          preferenceHits++
        } else {
          preferenceMisses.push({ key: `${matchIndex}-${id}-opponent`, type: 'opponent', preferred: formatDetailPrefLabel(player.metadata.opponent_gender_pref), actual: formatPlayersWithGender(opponents), rotation: match.rotation || matchIndex + 1, court: match.court })
        }
      }
    })

    const sortedRotations = [...new Set(rotations)].sort((a, b) => a - b)
    const duplicateRotationCount = Math.max(0, rotations.length - sortedRotations.length)
    const restGaps = sortedRotations.slice(1).map((rotation, index) => Math.max(0, rotation - sortedRotations[index] - 1))
    const avgRest = restGaps.length ? restGaps.reduce((sum, gap) => sum + gap, 0) / restGaps.length : 0
    const preferenceRatio = preferenceTotal > 0 ? preferenceHits / preferenceTotal : null

    return {
      id,
      name: player.name,
      initial: getPlayerInitial(player.name),
      avatarColor: getAvatarColor(id),
      games: rotations.length,
      partners: partnerSet.size,
      opponents: opponentSet.size,
      rotations: sortedRotations,
      gameTimeline,
      gamesByRound,
      rotationSet: new Set(sortedRotations),
      preferenceTags: buildPreferenceTags(player),
      preferenceRatio,
      preferenceLabel: preferenceTotal > 0 ? `${Math.round((preferenceHits / preferenceTotal) * 100)}%` : '100%',
      preferenceMisses,
      avgRestLabel: `${avgRest.toFixed(1)} vòng`,
      duplicateRotationCount,
    }
  }).sort((a, b) => {
    if (b.preferenceMisses.length !== a.preferenceMisses.length) return b.preferenceMisses.length - a.preferenceMisses.length
    if (a.games !== b.games) return a.games - b.games
    return a.name.localeCompare(b.name)
  })
}

function buildPreferenceTags(player: ArrangementPlayer) {
  const tags: { label: string, bg: string, fg: string }[] = []
  const partnerPref = player.metadata?.partner_gender_pref
  const opponentPref = player.metadata?.opponent_gender_pref
  if (partnerPref && partnerPref !== 'any') tags.push(getPreferenceTag('Partner', partnerPref))
  if (opponentPref && opponentPref !== 'any') tags.push(getPreferenceTag('Đối', opponentPref))
  return tags
}

function getPreferenceTag(prefix: 'Partner' | 'Đối', pref: string) {
  const label = `${prefix} ${formatDetailPrefLabel(pref)}`
  if (prefix === 'Partner' && pref === 'female') return { label, bg: '#FFE4DD', fg: '#B64A2F' }
  if (prefix === 'Partner' && pref === 'male') return { label, bg: '#DFF7EE', fg: '#0F6E56' }
  if (prefix === 'Đối' && pref === 'female') return { label, bg: '#FFF1D8', fg: '#A05A16' }
  return { label, bg: '#EEF0EC', fg: '#596864' }
}

function formatDetailPrefLabel(pref?: string | null) {
  if (pref === 'female') return 'Nữ'
  if (pref === 'male') return 'Nam'
  return 'Bất kỳ'
}

function matchesPlayerGenderPref(player: ArrangementPlayer | undefined, pref?: string | null) {
  if (!player || !pref || pref === 'any') return true
  const gender = String(player.gender || '').toLowerCase()
  if (pref === 'female') return gender === 'female' || gender === 'f' || gender === 'nữ' || gender === 'nu'
  if (pref === 'male') return gender === 'male' || gender === 'm' || gender === 'nam'
  return true
}

function formatPlayersWithGender(players: ArrangementPlayer[]) {
  return players.map(player => `${player.name} (${formatDetailPrefLabel(normalizePlayerGender(player.gender))})`).join(', ')
}

function normalizePlayerGender(value?: string | null) {
  const gender = String(value || '').toLowerCase()
  if (gender === 'female' || gender === 'f' || gender === 'nữ' || gender === 'nu') return 'female'
  if (gender === 'male' || gender === 'm' || gender === 'nam') return 'male'
  return null
}

function getMetricTone(ratio: number) {
  if (ratio >= 0.9) return '#0F6E56'
  if (ratio >= 0.7) return '#F2A51A'
  return '#D86A4A'
}

function getPreferenceTone(ratio: number | null) {
  if (ratio == null || ratio >= 0.75) return '#0F6E56'
  if (ratio >= 0.5) return '#F2A51A'
  return '#D86A4A'
}

function getPlayerInitial(name: string) {
  return (name || 'P').trim().charAt(0).toUpperCase() || 'P'
}

function getAvatarColor(id: string) {
  const colors = ['#0F6E56', '#9B5F08', '#B04726', '#5B6B64']
  const value = id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return colors[value % colors.length]
}

function QualityDetailsModal({ result, onClose, onOpenStatExplanation }: { result: OptimizationResult, onClose: () => void, onOpenStatExplanation?: (key: string, value: string | number) => void }) {
  return (
    <Modal visible={true} animationType="slide" transparent={true} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(26,46,42,0.42)', justifyContent: 'flex-end' }}>
        <Pressable style={{ maxHeight: '88%', backgroundColor: '#F8F3E8', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 42, height: 5, borderRadius: 999, backgroundColor: '#D8D3C8' }} />
          </View>

          <View style={{ backgroundColor: '#FFFCF5', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E5E3DC' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: '#1A2E2A', fontWeight: '900' }}>
                  CHẤT LƯỢNG LỊCH
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 2 }}>
                  Tổng hợp các chỉ số cân bằng · Setup #{result.setup.key}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#F4EFE5', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 18, color: '#7A8884', lineHeight: 20 }}>×</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            <ScheduleCoverageReport
              players={result.players}
              schedule={result.matches}
              mode="limited"
              minGamesPerPlayer={result.setup.targetGames}
              variant="rotation"
              quality={{ ...result.quality, timedOut: false, fallbackUsed: false, overallScore: result.quality.overallScore }}
              playerStatsInitiallyExpanded={false}
              hideSummary={false}
              hidePlayerStats={true}
              onOpenStatExplanation={onOpenStatExplanation}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
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
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginBottom: 10, lineHeight: 16 }}>
              Nghỉ: {sitters.length > 0 ? sitters.join(', ') : 'Không có'}
            </Text>

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
