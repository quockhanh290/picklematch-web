import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { CheckCircle2, AlertCircle, PencilLine, Star, Users, Search, ChevronRight, Share2, Pencil as Edit3 } from 'lucide-react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { getSessionSkillLabel } from '@/lib/sessionDetail'

export type SessionRequestStatus = 'pending' | 'accepted' | 'rejected' | null
export type SessionRole = 'host' | 'player'
export type SessionTab = 'upcoming' | 'pending' | 'history'

export type MySession = {
  id: string
  status: string
  court_booking_status: 'confirmed' | 'unconfirmed'
  host_id?: string | null
  role: SessionRole
  request_status: SessionRequestStatus
  start_time: string
  end_time: string
  court_name: string
  court_city: string
  court_address: string
  host_name: string
  player_count: number
  max_players: number
  elo_min: number | null
  elo_max: number | null
  has_rated: boolean
  results_status?: 'not_submitted' | 'pending_confirmation' | 'disputed' | 'finalized' | 'void' | null
  user_result?: 'win' | 'loss' | 'draw' | null
  is_ranked: boolean
}

function formatDateBadgeLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)

  const isSameDay =
    (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()

  if (isSameDay(date, today)) return 'Hôm nay'
  if (isSameDay(date, tomorrow)) return 'Ngày mai'

  const weekday = date.getDay() === 0 ? 'Chủ nhật' : `Thứ ${date.getDay() + 1}`
  const day = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`
  return `${weekday}, ${day}`
}

function getDayBadgeBackground(value: string, theme: any) {
  const startDate = new Date(value)
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
 
  if (
    startDate.getFullYear() === today.getFullYear() &&
    startDate.getMonth() === today.getMonth() &&
    startDate.getDate() === today.getDate()
  ) {
    return theme.primary
  }
 
  if (
    startDate.getFullYear() === tomorrow.getFullYear() &&
    startDate.getMonth() === tomorrow.getMonth() &&
    startDate.getDate() === tomorrow.getDate()
  ) {
    return theme.onSurfaceVariant
  }
 
  return theme.outline
}

export function MySessionCard({
  item,
  tab,
  onShare,
  formatTimeRange,
}: {
  item: MySession
  tab: SessionTab
  onShare: (session?: MySession) => void | Promise<void>
  formatTimeRange: (start: string, end: string) => string
}) {
  const theme = useAppTheme()
  const { 
    onOpenSession, 
    onRateSession, 
    onViewMatchResult, 
    onConfirmResult, 
    onReviewSession,
    onEditSession 
  } = useSessionNav()

  const isBooked = item.court_booking_status === 'confirmed'
  const address = [item.court_address, item.court_city].filter(Boolean).join(', ')
  const compactAddress = address.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 2).join(', ')
  const isHistory = tab === 'history'
  const isFinalized = item.results_status === 'finalized'
  const userResult = item.user_result

  const confirmedPlayerCount = item.player_count
  const maxPlayers = item.max_players
  const _isEven = confirmedPlayerCount % 2 === 0
  const isValidCount = maxPlayers === 2 ? confirmedPlayerCount === 2 : confirmedPlayerCount === 2 || confirmedPlayerCount === 4
  const isEnded = item.status === 'done' || item.status === 'pending_completion' || item.status === 'pending_results' || item.status === 'cancelled'
  const isInvalidPlayerCount = isEnded && !isValidCount

  let statusLabel = isBooked ? 'Đã đặt sân' : 'Chưa đặt sân'
  let statusColor: string = isBooked ? theme.successText : theme.warningText
  let dotColor: string = isBooked ? theme.primary : theme.warningStrong

  if (isHistory) {
    if (isInvalidPlayerCount && item.status !== 'cancelled') {
      statusLabel = 'Hủy - Thiếu người'
      statusColor = theme.dangerStrong
      dotColor = theme.dangerStrong
    } else if (item.status === 'cancelled') {
      statusLabel = 'Đã hủy'
      statusColor = theme.dangerStrong
      dotColor = theme.dangerStrong
    } else if (!item.is_ranked) {
      statusLabel = 'Đã kết thúc'
      statusColor = theme.onSurfaceVariant
      dotColor = theme.outline
    } else if (isFinalized) {
      if (userResult === 'win') {
        statusLabel = 'Thắng'
        statusColor = theme.successText
        dotColor = theme.primary
      } else if (userResult === 'loss') {
        statusLabel = 'Thua'
        statusColor = theme.dangerStrong
        dotColor = theme.dangerStrong
      } else {
        statusLabel = 'Đã kết thúc'
        statusColor = theme.onSurfaceVariant
        dotColor = theme.outline
      }
    } else if (item.results_status === 'not_submitted') {
      statusLabel = 'Chờ nhập kết quả'
      statusColor = theme.warningText
      dotColor = theme.warningStrong
    } else {
      statusLabel = 'Đang xác nhận'
      statusColor = theme.warningText
      dotColor = theme.warningStrong
    }
  }

  const dateBadgeLabel = formatDateBadgeLabel(item.start_time).toLocaleUpperCase('vi-VN')
  const dateBadgeBackground = getDayBadgeBackground(item.start_time, theme)

  return (
    <Pressable
      onPress={() => onOpenSession(item.id)}
      className="mb-4 overflow-hidden rounded-[14px]"
      style={{
        backgroundColor: theme.surfaceContainerLowest,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        shadowColor: theme.onBackground,
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: theme.onBackground,
            fontFamily: SCREEN_FONTS.headline,
            fontSize: 24,
            lineHeight: 26,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          {item.court_name}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, marginBottom: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.body,
              fontSize: 13,
            }}
          >
            {compactAddress || 'Đang cập nhật địa chỉ'}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: theme.surfaceContainerLow,
            borderRadius: RADIUS.sm,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                backgroundColor: dateBadgeBackground,
                borderRadius: 4,
                paddingHorizontal: 7,
                paddingVertical: 2,
                marginRight: 8,
              }}
            >
              <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, fontSize: 12, lineHeight: 16 }}>
                {dateBadgeLabel}
              </Text>
            </View>
            <Text style={{ color: theme.onBackground, fontFamily: SCREEN_FONTS.headline, fontSize: 19, lineHeight: 22 }}>
              {formatTimeRange(item.start_time, item.end_time)}
            </Text>
          </View>
          <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: RADIUS.full, backgroundColor: dotColor }} />
            <Text style={{ marginLeft: 6, color: statusColor, fontFamily: SCREEN_FONTS.cta, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 2 }}>
          <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16 }}>
            Trình độ
          </Text>
          <View
            style={{
              marginLeft: 8,
              backgroundColor: theme.secondaryContainer,
              borderRadius: RADIUS.xs,
              paddingHorizontal: SPACING.sm,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.label, fontSize: 12, lineHeight: 16 }}>
              {getSessionSkillLabel(item.elo_min ?? 0, item.elo_max ?? 0)}
            </Text>
          </View>
          <Text style={{ marginLeft: 'auto', color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 14 }}>
            {`${item.player_count}/${item.max_players} đã vào`}
          </Text>
        </View>
      </View>
      {tab === 'history' ? (() => {
        const needsResult = item.results_status === 'not_submitted'
        const needsConfirmation = item.results_status === 'pending_confirmation' || item.results_status === 'disputed'
        const needsRating = !item.has_rated && (item.status === 'done' || item.results_status === 'finalized')
        const isCancelled = item.status === 'cancelled' || isInvalidPlayerCount
        const isHost = item.role === 'host'
        
        let label = 'Kèo đã kết thúc'
        let canAction = false
        let action = () => {}
        let icon = null

        if (isInvalidPlayerCount && item.status !== 'cancelled') {
          label = 'Kèo bị hủy do thiếu người'
        } else if (isCancelled) {
          label = 'Kèo đã bị hủy'
        } else if (!item.is_ranked) {
          label = 'Kèo đã kết thúc'
          canAction = false
        } else if (needsResult || (needsConfirmation && !isHost)) {
          label = isHost ? 'Nhập kết quả' : 'Xác nhận kết quả'
          canAction = true
          action = () => {
            if (isHost) {
              onViewMatchResult(item.id)
            } else {
              onConfirmResult(item.id)
            }
          }
          icon = <PencilLine size={15} color={theme.onPrimary} strokeWidth={2.3} />
        } else if (needsConfirmation && isHost) {
          label = 'Đang chờ xác nhận'
          canAction = true
          action = () => onOpenSession(item.id)
          icon = <PencilLine size={15} color={theme.onPrimary} strokeWidth={2.3} />
        } else if (needsRating) {
          label = 'Đánh giá trận đấu'
          canAction = true
          action = () => onRateSession(item.id)
          icon = <Star size={15} color={theme.onPrimary} strokeWidth={2.3} />
        }

        if (!canAction) {
          const statusIcon = isCancelled ? <AlertCircle size={14} color={theme.outline} /> : <CheckCircle2 size={14} color={theme.outline} />
          
          return (
            <View 
              className="flex-row items-center justify-center py-3.5"
              style={{
                backgroundColor: theme.surfaceContainerLow,
                borderBottomLeftRadius: 14,
                borderBottomRightRadius: 14,
                borderTopWidth: BORDER.hairline,
                borderTopColor: theme.outlineVariant,
              }}
            >
              {statusIcon}
              <Text
                className="ml-2 text-[12px] uppercase tracking-[1px]"
                style={{
                  color: theme.outline,
                  fontFamily: SCREEN_FONTS.cta,
                }}
              >
                {label}
              </Text>
            </View>
          )
        }

        return (
          <View 
            className="px-4 py-3"
            style={{
              backgroundColor: theme.surfaceContainerLow,
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
              borderTopWidth: BORDER.hairline,
              borderTopColor: theme.outlineVariant,
            }}
          >
            <Pressable
              onPress={action}
              className="flex-row items-center justify-center py-2.5"
              style={{
                borderRadius: RADIUS.md,
                backgroundColor: theme.primary,
                shadowColor: theme.primary,
                shadowOpacity: 0.15,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }}
            >
              {icon}
              <Text
                className={icon ? "ml-2 text-[14px]" : "text-[14px]"}
                style={{
                  color: theme.onPrimary,
                  fontFamily: SCREEN_FONTS.cta,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                {label}
              </Text>
            </Pressable>
          </View>
        )
      })() : (
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: theme.surfaceContainerLow,
        }}
      >
        {tab === 'pending' && (
          <View 
            style={{ 
              marginBottom: 10, 
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Users size={14} color={item.role === 'host' ? theme.primary : theme.onSurfaceVariant} />
            <Text 
              style={{ 
                marginLeft: 8, 
                fontSize: 13, 
                fontFamily: SCREEN_FONTS.headline,
                color: item.role === 'host' ? theme.primary : theme.onSurfaceVariant,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {item.role === 'host' ? 'Có người chơi đang chờ bạn duyệt' : 'Bạn đang chờ chủ kèo duyệt yêu cầu'}
            </Text>
          </View>
        )}

        <View className="flex-row gap-3">
            <Pressable
              onPress={() => {
                if (tab === 'pending' && item.role === 'host') {
                  onReviewSession(item.id)
                } else if (tab === 'upcoming' && item.role === 'host') {
                  onEditSession(item.id)
                } else {
                  onOpenSession(item.id)
                }
              }}
              className="flex-1 flex-row items-center justify-center px-4 py-3"
              style={{ 
                backgroundColor: theme.primary,
                borderRadius: RADIUS.md 
              }}
            >
                {tab === 'pending' ? (
                  item.role === 'host' ? (
                    <Search size={15} color={theme.onPrimary} strokeWidth={2.3} />
                  ) : (
                    <ChevronRight size={18} color={theme.onPrimary} strokeWidth={2.3} />
                  )
                ) : (
                  <Edit3 size={15} color={theme.onPrimary} strokeWidth={2.3} />
                )}
                <Text
                  className="ml-2 text-[15px]"
                  style={{
                    color: theme.onPrimary,
                    fontFamily: SCREEN_FONTS.cta,
                    textTransform: 'uppercase',
                  }}
                >
                  {tab === 'pending' 
                    ? (item.role === 'host' ? 'XEM YÊU CẦU' : 'CHI TIẾT KÈO') 
                    : 'SỬA KÈO'}
                </Text>
            </Pressable>

            <Pressable
              onPress={() => void onShare(item)}
              className="flex-1 flex-row items-center justify-center px-4 py-3"
              style={{ 
                backgroundColor: theme.secondaryContainer,
                borderRadius: RADIUS.md
              }}
            >
              <Share2 size={15} color={theme.onSecondaryContainer} strokeWidth={2.3} />
              <Text
                className="ml-2 text-[15px]"
                style={{ color: theme.onSecondaryContainer, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase' }}
              >
                Chia sẻ
              </Text>
            </Pressable>
          </View>

      </View>
      )}
    </Pressable>
  )
}
