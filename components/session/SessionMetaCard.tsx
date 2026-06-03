import { useAppTheme } from '@/lib/theme-context'
import { useTranslation } from 'react-i18next'
import { SCREEN_FONTS } from '@/constants/typography'
import { getSkillLevelUi } from '@/lib/skillLevelUi'
import { Text, View, TouchableOpacity } from 'react-native'
import { Info, MapPin, MessageSquareText, Phone, Clock } from 'lucide-react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { RADIUS, SPACING, SHADOW, BORDER } from '@/constants/screenLayout'
import type { EloLevelId } from '@/lib/eloSystem'
import type { Court } from '@/lib/home/types'

type Props = {
  skillLevelId: EloLevelId
  sessionSkillLabel: string
  courtBookingStatus: 'confirmed' | 'unconfirmed'
  courtName: string
  courtAddress: string
  courtCity: string
  timeLabel: string
  priceLabel: string
  isRanked?: boolean | null
  hostNote?: string | null
  sessionStatus?: string | null
  resultsStatus?: string | null
  userResult?: 'win' | 'loss' | 'draw' | null
  maxPlayers: number
  court?: Court | null
}

function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const n = Number.parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function SessionMetaCard({
  skillLevelId,
  sessionSkillLabel,
  courtBookingStatus,
  courtName,
  courtAddress,
  courtCity,
  timeLabel,
  priceLabel,
  isRanked,
  hostNote,
  sessionStatus,
  resultsStatus,
  userResult,
  isInvalidPlayerCount,
  maxPlayers,
  court,
}: Props & { isInvalidPlayerCount?: boolean }) {
  const theme = useAppTheme()
  const { t } = useTranslation()
  const { onOpenCourt } = useSessionNav()
  const levelUi = getSkillLevelUi(skillLevelId)
  const _LevelIcon = levelUi.icon
  const [datePart, clockPart] = timeLabel.split('•').map((s) => s.trim())
  const _timeRangeLabel = clockPart ?? timeLabel
  const compactAddress = [courtAddress, courtCity]
    .filter(Boolean)
    .join(', ')
    .split(',')
    .slice(0, 3)
    .join(',')
  const isConfirmed = courtBookingStatus === 'confirmed'
  const isClosedRecruitment = sessionStatus === 'closed_recruitment'
  const isRankedMatch = isRanked ?? true
  const _onAccent = theme.onPrimary
  const isFinished = sessionStatus === 'done'
  const isPendingResult = sessionStatus === 'pending_completion'
  const isDuringMatch = sessionStatus === 'in_progress'
  const isFinalized = resultsStatus === 'finalized'

  let bookingStatusLabel = isConfirmed ? t('session_meta.booked') : t('session_meta.unbooked')
  let statusColor = isConfirmed ? theme.primary : theme.warningStrong

  if (isInvalidPlayerCount && sessionStatus !== 'cancelled') {
    bookingStatusLabel = t('session_meta.cancelled_no_players')
    statusColor = theme.error
  } else if (sessionStatus === 'cancelled') {
    bookingStatusLabel = t('session_meta.cancelled')
    statusColor = theme.error
  } else if (isFinished || isPendingResult || isDuringMatch || isFinalized) {
    if ((isFinished || isPendingResult || isFinalized) && !isRankedMatch) {
      bookingStatusLabel = t('session_meta.finished')
      statusColor = theme.onSurfaceVariant
    } else if (isFinalized) {
      if (userResult === 'win') {
        bookingStatusLabel = t('session_meta.win')
        statusColor = theme.primary
      } else if (userResult === 'loss') {
        bookingStatusLabel = t('session_meta.loss')
        statusColor = theme.error
      } else {
        bookingStatusLabel = t('session_meta.finished')
        statusColor = theme.onSurfaceVariant
      }
    } else if (resultsStatus === 'not_submitted') {
      bookingStatusLabel = t('session_meta.pending_input')
      statusColor = theme.warningStrong
    } else if (resultsStatus === 'pending_confirmation' || resultsStatus === 'disputed') {
      bookingStatusLabel = t('session_meta.confirming')
      statusColor = theme.warningStrong
    } else if (isDuringMatch) {
      bookingStatusLabel = t('session_meta.in_progress')
      statusColor = theme.primary
    } else if (isFinished || isPendingResult) {
      bookingStatusLabel = t('session_meta.finished')
      statusColor = theme.onSurfaceVariant
    }
  } else if (isClosedRecruitment) {
    bookingStatusLabel = t('session_meta.closed_recruitment')
    statusColor = theme.onSurfaceVariant
  }

  return (
    <View
      style={{
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        backgroundColor: theme.surfaceContainerLowest,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        ...SHADOW.sm,
      }}
    >
      <View style={{ position: 'relative' }}>
        <View
          style={{
            backgroundColor: theme.primary,
            paddingHorizontal: 16,
            paddingVertical: SPACING.xs,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
            <View style={{ width: 5, height: 5, borderRadius: RADIUS.full, backgroundColor: theme.onPrimary }} />
            <Text
              style={{
                color: theme.onPrimary,
                fontFamily: SCREEN_FONTS.cta,
                fontSize: 11,
                letterSpacing: 0.5,
              }}
            >
              {t('session_meta.info_title')}
            </Text>
          </View>

          <Text
            style={{
              color: withAlpha(theme.onPrimary, 0.8),
              fontFamily: SCREEN_FONTS.label,
              fontSize: 11,
            }}
          >
            {maxPlayers === 2 ? t('session_meta.singles') : t('session_meta.doubles')}
          </Text>
        </View>

        <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
          <TouchableOpacity 
            onPress={() => court?.id && onOpenCourt(court.id)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
          >
            <Text
              numberOfLines={2}
              style={{
                color: theme.onSurface,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 31,
                lineHeight: 36,
                letterSpacing: 0,
                marginBottom: 4,
                textTransform: 'uppercase',
                flex: 1,
              }}
            >
              {courtName}
            </Text>
            <View style={{ marginTop: 6 }}>
              <Info size={24} color={theme.primary} strokeWidth={2.5} />
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
            <MapPin size={13} color={theme.onSurfaceVariant} strokeWidth={2.5} />
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 18, flexShrink: 1 }}>
              {compactAddress}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: theme.surfaceAlt, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <View>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              {t('session_meta.time')}
            </Text>
            <Text
              style={{
                color: theme.onSurface,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 33,
                lineHeight: 33,
                letterSpacing: 0,
              }}
            >
              {clockPart || timeLabel}
            </Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 13, marginTop: 4 }}>
              {datePart}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              {t('session_meta.cost')}
            </Text>
            <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 33, lineHeight: 33 }}>
              {priceLabel}
            </Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 11, marginTop: 4 }}>
              {priceLabel === 'Miễn phí' || priceLabel === t('session_meta.free') ? ' ' : t('session_meta.per_person')}
            </Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: theme.outlineVariant, opacity: 0.5, marginVertical: 8 }} />

        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ backgroundColor: theme.surface, borderRadius: 4, paddingHorizontal: SPACING.md, paddingVertical: 4, borderWidth: 1, borderColor: theme.outlineVariant }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.label, fontSize: 12 }}>
                {sessionSkillLabel}
              </Text>
            </View>
            <View style={{ marginLeft: 12, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 6, height: 6, borderRadius: RADIUS.full, backgroundColor: statusColor }} />
              <Text style={{ 
                marginLeft: 6, 
                color: statusColor, 
                fontFamily: SCREEN_FONTS.cta, 
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5
              }}>
                {bookingStatusLabel}
              </Text>
            </View>
          </View>

          {hostNote && hostNote.trim().length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <MessageSquareText size={14} color={theme.onSurface} strokeWidth={2.5} style={{ marginTop: 2 }} />
              <View style={{ marginLeft: 8, flex: 1 }}>
                <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {t('session_meta.note')}
                </Text>
                <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.body, fontSize: 13, marginTop: 2 }}>
                  {hostNote.trim()}
                </Text>
              </View>
            </View>
          )}

          {(court?.phone || court?.opening_hours) && (
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
              {court.phone && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Phone size={12} color={theme.onSurfaceVariant} strokeWidth={2.5} />
                  <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 11 }}>
                    {court.phone}
                  </Text>
                </View>
              )}
              {court.opening_hours && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Clock size={12} color={theme.onSurfaceVariant} strokeWidth={2.5} />
                  <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 11 }}>
                    {t('session_meta.open_hours')}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  )
}


