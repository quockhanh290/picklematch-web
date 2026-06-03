import { ScreenHeader } from '@/components/design'
import { FeaturedSessionCard } from '@/components/sessions/v2/SessionCards'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { type MatchSession, getStatusLabel } from '@/lib/homeFeed'
import type { NearByCourt } from '@/lib/useNearbyCourts'
import { ScrollView, Text, TouchableOpacity, View, Platform } from 'react-native'
import { RADIUS, BORDER } from '@/constants/screenLayout'
import { getSessionSkillLabel, pvnaToElo } from '@/lib/skillAssessment'
import React from 'react'

type Props = {
  selectedCourt: NearByCourt
  selectedDate: Date
  startTime: Date
  endTime: Date
  maxPlayers: number
  minSkill: number
  maxSkill: number
  bookingStatus: 'confirmed' | 'unconfirmed'
  deadlineMinutes: number
  requireApproval: boolean
  requireResults: boolean
  pricePerPerson: number
  onBack: () => void
  onCreate: () => void
  submitting?: boolean
  skillTolerance: number
  format: 'social' | 'round_robin' | 'open_play'
  selectedSubCourts: number[]
  isEditMode?: boolean
  isNewbie?: boolean
  hostIsPlaying: boolean
  hostGender: 'male' | 'female'
  hostSkill: number
  playMode: 'singles' | 'doubles'
}

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const WEEKDAY_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 4', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function formatHeroTimeLabel(date: Date, start: Date, end: Date) {
  const dateLabel = `${WEEKDAY_LABELS[date.getDay()]}, ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`
  const startClock = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`
  const endClock = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`
  return `${dateLabel} • ${startClock} - ${endClock}`
}

function formatPrice(pricePerPerson: number) {
  if (pricePerPerson <= 0) return 'Miễn phí'
  return `${Math.round(pricePerPerson / 1000)}K`
}

const FORMAT_LABELS: Record<string, string> = {
  social: 'SOCIAL FUN',
  round_robin: 'ROUND ROBIN',
  open_play: 'OPEN PLAY'
}

export function HostCreateSessionStep3({
  selectedCourt, selectedDate, startTime, endTime,
  maxPlayers, minSkill, maxSkill, bookingStatus, deadlineMinutes,
  requireApproval, requireResults, pricePerPerson, onBack, onCreate, submitting = false,
  skillTolerance, format, selectedSubCourts, isEditMode = false, isNewbie = false, 
  hostIsPlaying = true, hostGender = 'male', hostSkill = 3.5, playMode = 'doubles'
}: Props) {
  const theme = useAppTheme()

  const subCourtLabel = selectedSubCourts.length > 0 
    ? `Sân ${selectedSubCourts.join(', ')}` 
    : ''

  const previewMatch: MatchSession = {
    id: 'preview-Host-match',
    title: 'Xem trước',
    bookingId: 'PREVIEW',
    courtName: selectedCourt.name,
    address: selectedCourt.city ? `${selectedCourt.address}, ${selectedCourt.city}` : selectedCourt.address,
    matchScore: 100, // Dummy
    matchHint: FORMAT_LABELS[format], 
    // Requirement 1: "Trình x.x - x.x" or "Mới chơi"
    skillLabel: isNewbie ? 'Mới chơi' : `Trình ${minSkill.toFixed(1)} - ${maxSkill.toFixed(1)}`,
    timeLabel: formatHeroTimeLabel(selectedDate, startTime, endTime),
    priceLabel: formatPrice(pricePerPerson),
    // Requirement 2: "Đã có x người tham gia"
    openSlotsLabel: `Đã có 0 người tham gia`,
    statusLabel: getStatusLabel(bookingStatus, 'open'),
    courtBookingConfirmed: true,
    isBooked: true,
    isRanked: format === 'round_robin',
    activePlayers: 0,
    maxPlayers,
    levelId: `pvna_${Math.floor(maxSkill)}` as any,
    host: {
      id: 'Host',
      name: 'Host',
      initials: 'H',
      rating: 5,
    },
    players: [],
    urgent: false,
    joined: false,
    // Requirement 3: Pass subCourtLabel (custom field handled by our modified SuggestedSessionCard)
    subCourtLabel,
    matchFormat: playMode === 'singles' ? 'Đánh đơn' : 'Đánh đôi'
  } as any

  const dayLabel = WEEKDAY_LONG[selectedDate.getDay()]
  const dd = pad2(selectedDate.getDate())
  const mm = pad2(selectedDate.getMonth() + 1)
  const yyyy = selectedDate.getFullYear().toString()
  const startStr = `${pad2(startTime.getHours())}:${pad2(startTime.getMinutes())}`
  const endStr = `${pad2(endTime.getHours())}:${pad2(endTime.getMinutes())}`
  const deadlineLabel = deadlineMinutes < 60 ? `${deadlineMinutes} phút` : `${deadlineMinutes / 60} giờ`

  const details = [
    { icon: '👥', label: 'LOẠI KÈO', value: `${playMode === 'singles' ? 'Đánh đơn' : 'Đánh đôi'} · ${FORMAT_LABELS[format]}` },
    { icon: '👨‍👩‍👧‍👦', label: 'SỐ NGƯỜI TỐI ĐA', value: `${maxPlayers} người` },
    { icon: '💰', label: 'CHI PHÍ / NGƯỜI', value: pricePerPerson > 0 ? `${pricePerPerson.toLocaleString('vi-VN')} đ` : 'Miễn phí' },
    { icon: '📊', label: 'PHẠM VI TRÌNH ĐỘ', value: isNewbie ? 'Mới chơi' : `${minSkill.toFixed(1)} - ${maxSkill.toFixed(1)}${skillTolerance > 0 ? ` (+/- ${skillTolerance.toFixed(2)})` : ''}` },
    { icon: '🛡️', label: 'PHÊ DUYỆT', value: requireApproval ? 'Bật' : 'Tắt' },
    { 
      icon: '🎾', 
      label: 'HOST THAM GIA', 
      value: hostIsPlaying 
        ? `Có (${hostGender === 'male' ? 'Nam' : 'Nữ'} · Trình ${hostSkill.toFixed(1)})` 
        : 'Không' 
    },
    // Requirement 4: Show Require Results if toggle on
    ...(requireResults ? [{ icon: '📝', label: 'NHẬP KẾT QUẢ', value: 'Bật' }] : []),
    { icon: '⏰', label: 'HẠN CHỐT', value: `${deadlineLabel} trước giờ bắt đầu` },
    { icon: '📅', label: 'NGÀY & GIỜ CHƠI', value: `${dayLabel}, ${dd}/${mm}/${yyyy} · ${startStr}–${endStr}` },
  ]

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 16 }}
        style={{ flex: 1 }}
      >
        <View style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 6 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 52, color: theme.primary, lineHeight: 54, opacity: 0.2, letterSpacing: -1, paddingRight: 6, paddingTop: 6 }}>
              03
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 28, color: theme.primary, lineHeight: 30, letterSpacing: -0.3, flex: 1, paddingBottom: 2 }}>
              {isEditMode ? 'Xác nhận Cập nhật' : 'Xác nhận Tạo kèo'}
            </Text>
          </View>
          <View style={{ width: 32, height: 3, backgroundColor: theme.tertiary, borderRadius: 2 }} />
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 10, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.cta, letterSpacing: 0.8, marginBottom: 8 }}>
            XEM TRƯỚC
          </Text>
          <View pointerEvents="none">
            <FeaturedSessionCard 
              session={previewMatch} 
              isHost={true}
            />
          </View>
        </View>

        <View style={{ backgroundColor: theme.surface, borderRadius: RADIUS.md, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, overflow: 'hidden', marginBottom: 16 }}>
          {details.map((item, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 11, paddingHorizontal: 16,
                borderTopWidth: i === 0 ? 0 : 0.5,
                borderTopColor: theme.surfaceDim,
              }}
            >
              <View style={{ width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14 }}>{item.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.cta, letterSpacing: 0.3, marginBottom: 1 }}>
                  {item.label}
                </Text>
                <Text style={{ fontSize: 13, color: theme.onSurface, fontFamily: SCREEN_FONTS.label }}>
                  {item.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: -20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, backgroundColor: theme.surfaceContainerLow, borderTopWidth: 0.5, borderTopColor: theme.outlineVariant }}>
        <TouchableOpacity
          onPress={onBack}
          disabled={submitting}
          style={{ flex: 1, borderRadius: RADIUS.md, borderWidth: BORDER.medium, borderColor: theme.outlineVariant, paddingVertical: 13, alignItems: 'center', backgroundColor: theme.surface, opacity: submitting ? 0.5 : 1 }}
        >
          <Text style={{ fontSize: 15, color: theme.onSurface, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase' }}>Quay lại</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onCreate}
          disabled={submitting}
          style={{ flex: 2, borderRadius: RADIUS.md, backgroundColor: theme.primary, paddingVertical: 13, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
        >
          <Text style={{ fontSize: 15, color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase' }}>
            {submitting ? (isEditMode ? 'Đang lưu...' : 'Đang tạo...') : (isEditMode ? 'Cập nhật kèo' : 'Tạo kèo ngay')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
