import { ScreenHeader } from '@/components/design'
import { FeaturedSessionCard } from '@/components/sessions/v2/SessionCards'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { type MatchSession, getStatusLabel } from '@/lib/homeFeed'
import type { NearByCourt } from '@/lib/useNearbyCourts'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'

import { getCreateSessionSkillOption } from './skillLevelOptions'
import { RADIUS, BORDER } from '@/constants/screenLayout'
import { getSessionSkillLabel, pvnaToElo } from '@/lib/skillAssessment'
import { ELO_BANDS } from '@/constants/systemData'

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
  pricePerPerson: number
  onBack: () => void
  onCreate: () => void
  submitting?: boolean
  submitLabel?: string
  skillTolerance: number
  hideHeader?: boolean
}

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const WEEKDAY_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
// Removed hardcoded LEVELS array

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

function toLevelId(level: number): MatchSession['levelId'] {
  const clamped = Math.max(1, Math.min(6, level))
  return `pvna_${clamped}` as MatchSession['levelId']
}

export function CreateSessionStep3({
  selectedCourt, selectedDate, startTime, endTime,
  maxPlayers, minSkill, maxSkill, bookingStatus, deadlineMinutes,
  requireApproval, pricePerPerson, onBack, onCreate, submitting = false, submitLabel = 'Tạo kèo',
  skillTolerance,
  hideHeader = false,
}: Props) {
  const theme = useAppTheme()
  const minSkillOption = getCreateSessionSkillOption(minSkill)
  const maxSkillOption = getCreateSessionSkillOption(maxSkill)

  const previewMatch: MatchSession = {
    id: 'preview-upcoming-match',
    title: 'Xem trước',
    bookingId: 'PREVIEW',
    courtName: selectedCourt.name,
    address: selectedCourt.city ? `${selectedCourt.address}, ${selectedCourt.city}` : selectedCourt.address,
    matchScore: 90,
    skillLabel: getSessionSkillLabel(
      (ELO_BANDS.find(b => b.levelId === `pvna_${minSkill}`) as any)?.minElo ?? 1000,
      (ELO_BANDS.find(b => b.levelId === `pvna_${maxSkill}`) as any)?.maxElo ?? 3000
    ),
    timeLabel: formatHeroTimeLabel(selectedDate, startTime, endTime),
    priceLabel: formatPrice(pricePerPerson),
    openSlotsLabel: `${Math.max(maxPlayers - 1, 0)} chỗ trống`,
    statusLabel: getStatusLabel(bookingStatus, 'open'),
    courtBookingConfirmed: bookingStatus === 'confirmed',
    isBooked: bookingStatus === 'confirmed',
    isRanked: true,
    activePlayers: 1,
    maxPlayers,
    levelId: toLevelId(maxSkill),
    host: {
      id: 'preview-host',
      name: 'Bạn',
      initials: 'B',
      rating: 5,
      vibe: 'Host đang tạo kèo mới',
    },
    players: [
      {
        id: 'preview-host',
        name: 'Bạn',
        initials: 'B',
        badge: 'trusted',
      },
    ],
    urgent: false,
    joined: true,
  } as any

  const dayLabel = WEEKDAY_LONG[selectedDate.getDay()]
  const dd = pad2(selectedDate.getDate())
  const mm = pad2(selectedDate.getMonth() + 1)
  const yyyy = selectedDate.getFullYear().toString()
  const startStr = `${pad2(startTime.getHours())}:${pad2(startTime.getMinutes())}`
  const endStr = `${pad2(endTime.getHours())}:${pad2(endTime.getMinutes())}`
  const deadlineLabel = deadlineMinutes < 60
    ? `${deadlineMinutes} phút`
    : `${deadlineMinutes / 60} giờ`

  const _minLevelLabel = minSkillOption.label
  const _maxLevelLabel = maxSkillOption.label

  const details = [
    { icon: '👥', label: 'LOẠI KÈO', value: maxPlayers === 2 ? 'Đánh đơn · 2 người' : 'Đánh đôi · 4 người' },
    { icon: '💰', label: 'CHI PHÍ / NGƯỜI', value: pricePerPerson > 0 ? formatPrice(pricePerPerson) : 'Miễn phí' },
    { icon: '📊', label: 'PHẠM VI TRÌNH ĐỘ', value: `${getSessionSkillLabel(
      pvnaToElo(minSkill),
      pvnaToElo(maxSkill)
    )}${skillTolerance > 0 ? ` (+/- ${skillTolerance.toFixed(2)})` : ''}` },
    { icon: '🛡️', label: 'TỰ DUYỆT', value: requireApproval ? 'Bật' : 'Tắt' },
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
        {!hideHeader && (
          <>
            <ScreenHeader
              variant="brand"
              title="KINETIC"
              onBackPress={onBack}
              style={{ marginHorizontal: -20, marginTop: -12 }}
              rightSlot={<View style={{ width: 32, height: 32 }} />}
            />

            {/* Progress bar */}
            <View style={{ height: 3, backgroundColor: theme.outlineVariant, borderRadius: RADIUS.full, marginTop: 12, marginBottom: 24, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: '100%', backgroundColor: theme.primary, borderRadius: RADIUS.full }} />
            </View>
          </>
        )}

        {/* Step title */}
        <View style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 6 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 52, color: theme.primary, lineHeight: 54, opacity: 0.2, letterSpacing: -1, paddingRight: 6, paddingTop: 6 }}>
              03
            </Text>
            <Text
              style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 28, color: theme.primary, lineHeight: 30, letterSpacing: -0.3, flex: 1, paddingBottom: 2 }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Xác nhận Tạo kèo
            </Text>
          </View>
          <View style={{ width: 32, height: 3, backgroundColor: theme.tertiary, borderRadius: 2 }} />
        </View>

        {/* Preview card */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 10, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.cta, letterSpacing: 0.8, marginBottom: 8 }}>
            XEM TRƯỚC
          </Text>
          <View pointerEvents="none">
            <FeaturedSessionCard session={previewMatch} />
          </View>

        </View>

        {/* Detail list */}
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

        {/* Info note */}
        <View style={{ backgroundColor: theme.secondaryContainer, borderRadius: RADIUS.sm, padding: 12, flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <Text style={{ fontSize: 14 }}>ℹ️</Text>
          <Text style={{ fontSize: 12, color: theme.primary, lineHeight: 18, flex: 1, fontFamily: SCREEN_FONTS.body }}>
            Kiểm tra lại thông tin, chi phí và trạng thái booking để bài đăng ra feed đúng ngay từ lần đầu.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom bar */}
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
            {submitting ? 'Đang tạo...' : 'Tạo kèo ngay'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

