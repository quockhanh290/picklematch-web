import { SCREEN_FONTS, typography } from '@/constants/typography'
import { STRINGS } from '@/constants/strings'
import {
  formatDistance,
  formatRelativeDate,
  formatTimeRange,
  formatVND,
  getCourtNameSize,
} from '@/utils/formatters'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { useAppTheme } from '@/lib/theme-context'

interface SessionCardProps {
  session: {
    id: string
    courtName: string
    courtAddress: string
    distanceKm?: number
    courtBookingConfirmed: boolean
    startTime: Date
    endTime: Date
    level: string
    levelDescription?: string
    levelMatchesUser: boolean
    host: {
      id: string
      name: string
      initial: string
    }
    enrolledCount: number
    capacity: number
    pricePerPerson: number
    status: 'open' | 'starting_soon' | 'full' | 'past'
  }
  onPress: () => void
  onJoinPress: () => void
}

type ChipVariant = 'urgent' | 'warn' | 'neutral'

const CARD_HEIGHT = 271

// Moved inside component to use dynamic theme

type ChipState = {
  variant: ChipVariant
  label: string
}

function getStatusChip(status: SessionCardProps['session']['status'], enrolledCount: number, capacity: number): ChipState | null {
  if (status === 'starting_soon') {
    return { variant: 'warn', label: STRINGS.session.status.starting_soon }
  }

  if (status === 'full') {
    return { variant: 'neutral', label: STRINGS.session.status.full }
  }

  if (status === 'past') {
    return { variant: 'neutral', label: STRINGS.session.status.past }
  }

  const remaining = capacity - enrolledCount
  if (remaining > 0) {
    return { 
      variant: 'urgent', 
      label: remaining === 1 ? STRINGS.session.labels.remaining_slots_last : STRINGS.session.labels.remaining_slots.replace('{count}', remaining.toString()) 
    }
  }

  return null
}

function Chip({ variant, label, theme }: { variant: ChipVariant; label: string; theme: any }) {
  const chipStyle =
    variant === 'urgent'
      ? { backgroundColor: theme.warningBg, textColor: theme.warningText }
      : variant === 'warn'
        ? { backgroundColor: theme.warningBg, textColor: theme.warningText }
        : { backgroundColor: theme.surfaceContainerLow, textColor: theme.onSurfaceVariant }

  return (
    <View style={[styles.statusChip, { backgroundColor: chipStyle.backgroundColor }]}>
      <Text numberOfLines={1} style={[typography.labelSm, { color: chipStyle.textColor }]}>
        {label}
      </Text>
    </View>
  )
}

function getDayBadgeBackground(startTime: Date, theme: any) {
  const todayLabel = formatRelativeDate(new Date())
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowLabel = formatRelativeDate(tomorrow)
  const dateLabel = formatRelativeDate(startTime)

  if (dateLabel === todayLabel) return theme.primary
  if (dateLabel === tomorrowLabel) return theme.onSurfaceVariant
  return theme.outline
}

export default function SessionCard({ session, onPress, onJoinPress }: SessionCardProps) {
  const theme = useAppTheme()
  const AVATAR_PALETTE = [
    { bg: theme.secondaryContainer, text: theme.primary },
    { bg: theme.dangerBg, text: theme.dangerText },
    { bg: theme.warningBg, text: theme.warningText },
    { bg: theme.tertiaryFixed, text: theme.onTertiaryFixed },
  ]

  const disabled = session.status === 'full' || session.status === 'past'
  const chip = getStatusChip(session.status, session.enrolledCount, session.capacity)
  const avatarTone = AVATAR_PALETTE[Math.abs(session.host.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % AVATAR_PALETTE.length]
  const distance = formatDistance(session.distanceKm)
  const addressLine = distance ? `${session.courtAddress} · ${distance}` : session.courtAddress

  const courtNameSize = getCourtNameSize(session.courtName)
  const compactCourtNameSize = courtNameSize === 26 ? 24 : courtNameSize
  const courtNameLineHeight = compactCourtNameSize === 24 ? 26 : compactCourtNameSize === 22 ? 24 : 20

  const ctaLabel = session.status === 'past' ? STRINGS.session.status.past : session.status === 'full' ? STRINGS.session.status.full : STRINGS.session.actions.join
  const levelChipLabel = session.levelDescription?.trim() || `${STRINGS.session.labels.level_prefix} ${session.level}`
  const dateLabel = formatRelativeDate(session.startTime)
  const dayBadgeBackground = getDayBadgeBackground(session.startTime, theme)

  return (
    <Pressable onPress={onPress} style={[styles.card, { borderColor: theme.outlineVariant, backgroundColor: theme.surface }]}>
      <View style={styles.topSection}>
        <View style={styles.courtNameWrap}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[
              styles.courtName,
              {
                fontSize: compactCourtNameSize,
                lineHeight: courtNameLineHeight,
                color: disabled ? theme.outline : theme.onSurface,
              },
            ]}
          >
            {session.courtName.toUpperCase()}
          </Text>
        </View>

        <View style={styles.subHeaderRow}>
          <Text numberOfLines={1} style={[typography.bodyMd, styles.addressText, { color: disabled ? theme.outline : theme.onSurfaceVariant }]}>
            {addressLine}
          </Text>
          {chip ? <Chip variant={chip.variant} label={chip.label} theme={theme} /> : <View style={styles.statusChipPlaceholder} />}
        </View>

        <View style={[styles.timeBlock, { backgroundColor: theme.surfaceContainerLow }]}>
          <View style={styles.timeLabelRow}>
            <View style={[styles.dayBadge, { backgroundColor: dayBadgeBackground }]}>
              <Text style={[styles.dayBadgeText, { color: theme.onPrimary }]}>{dateLabel.toLocaleUpperCase('vi-VN')}</Text>
            </View>
            <Text style={[styles.timeText, { color: disabled ? theme.outline : theme.onSurface }]}>
              {formatTimeRange(session.startTime, session.endTime)}
            </Text>
          </View>

          <View style={styles.bookingWrap}>
            <View style={[styles.statusDot, { backgroundColor: session.courtBookingConfirmed ? theme.successText : theme.warningText }]} />
            <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 10, color: session.courtBookingConfirmed ? theme.successText : theme.warningText, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {session.courtBookingConfirmed ? STRINGS.session.booking.confirmed : STRINGS.session.booking.waiting}
            </Text>
          </View>
        </View>

        <View style={styles.levelRow}>
          <Text style={[styles.levelLabel, { color: theme.onSurfaceVariant }]}>{STRINGS.find_session.filters.skill_level}</Text>
          <View style={[styles.levelChip, { backgroundColor: theme.secondaryContainer }]}>
            <Text style={[styles.levelChipText, { color: theme.primary }]}>{levelChipLabel}</Text>
          </View>
          <Text style={[styles.levelMatchHint, { color: theme.onSurfaceVariant }]}>
            {session.levelMatchesUser ? STRINGS.session.labels.match_level : STRINGS.session.labels.not_match}
          </Text>
        </View>
      </View>

      <View style={[styles.footerSection, { borderTopColor: theme.outlineVariant }]}>
        <View style={styles.hostRow}>
          <View style={[styles.avatar, { backgroundColor: avatarTone.bg }]}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: avatarTone.text }}>{session.host.initial}</Text>
          </View>
          <View style={styles.hostMeta}>
            <Text numberOfLines={1} style={[styles.hostName, { color: disabled ? theme.outline : theme.onSurface }]}>
              {session.host.name}
            </Text>
            <Text style={[typography.bodyXs, { color: disabled ? theme.outline : theme.onSurfaceVariant }]}>{`${STRINGS.session.roles.host} · ${session.enrolledCount}/${session.capacity} ${STRINGS.session.labels.joined_count}`}</Text>
          </View>
        </View>

        <View style={styles.priceWrap}>
          <Text
            style={[
              styles.priceValue,
              {
                color: disabled 
                  ? theme.outline 
                  : (session.pricePerPerson <= 0 ? theme.primary : theme.onSurface),
                fontSize: 26,
                lineHeight: 30,
                includeFontPadding: false,
                textAlignVertical: 'center',
              },
            ]}
          >
            {formatVND(session.pricePerPerson)}
          </Text>
          {session.pricePerPerson > 0 && (
            <Text style={[typography.bodyXs, styles.priceUnit, { color: disabled ? theme.outline : theme.onSurfaceVariant }]}>
              /{STRINGS.common.person}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.ctaSection}>
        <Pressable
          disabled={disabled}
          onPress={(event) => {
            event.stopPropagation()
            if (!disabled) {
              onJoinPress()
            }
          }}
          style={[styles.ctaButton, { shadowColor: theme.primary }, disabled ? { backgroundColor: theme.outline } : { backgroundColor: theme.primary }]}
        >
          <Text style={[styles.ctaText, { color: theme.onPrimary }]}>{ctaLabel.toLocaleUpperCase('vi-VN')}</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: BORDER.hairline,
    overflow: 'hidden',
  },
  topSection: {
    height: 151,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  courtNameWrap: {
    height: 28,
    marginBottom: 3,
    justifyContent: 'center',
  },
  courtName: {
    fontFamily: SCREEN_FONTS.headline,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  addressText: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  statusChipPlaceholder: {
    width: 1,
    height: 1,
  },
  statusChip: {
    borderRadius: RADIUS.sm,
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    flexShrink: 0,
  },
  timeBlock: {
    borderRadius: RADIUS.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: RADIUS.md,
    marginBottom: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: SPACING.sm,
  },
  dayBadge: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dayBadgeText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 12,
    lineHeight: 16,
  },
  timeText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 0.3,
  },
  bookingWrap: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    paddingBottom: 2,
    columnGap: SPACING.sm,
  },
  levelLabel: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 12,
    lineHeight: 16,
  },
  levelChip: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  levelChipText: {
    fontFamily: SCREEN_FONTS.label,
    fontSize: 12,
    lineHeight: 16,
  },
  levelMatchHint: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 11,
    lineHeight: 14,
    marginLeft: 'auto',
  },
  footerSection: {
    height: 52,
    borderTopWidth: 0.5,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: SPACING.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 16,
    lineHeight: 16,
  },
  hostName: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 15,
    lineHeight: 18,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  hostMeta: {
    marginLeft: SPACING.sm,
    flex: 1,
  },
  priceWrap: {
    alignItems: 'flex-end',
  },
  priceValue: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 26,
    lineHeight: 26,
    letterSpacing: 0.3,
  },
  priceUnit: {
    marginTop: 0,
  },
  ctaSection: {
    height: 68,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: RADIUS.md,
    justifyContent: 'center',
  },
  ctaButton: {
    width: '100%',
    height: 48,
    borderRadius: RADIUS.md,
    paddingVertical: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  ctaText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
})
