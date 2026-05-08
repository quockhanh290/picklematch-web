import { LinearGradient } from 'expo-linear-gradient'
import type { LucideIcon } from 'lucide-react-native'
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CircleDollarSign,
  MapPin,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, BORDER } from '@/constants/screenLayout'

type Props = {
  courtName: string
  address: string
  timeLabel: string
  dateLabel?: string
  bookingStatus: 'confirmed' | 'unconfirmed'
  skillLabel: string
  skillIcon: LucideIcon
  skillTagClassName: string
  skillTextClassName: string
  skillBorderClassName: string
  skillIconColor: string
  eloValue: number
  duprValue: string
  matchTypeLabel: string
  hostName: string
  hostSkillIcon?: LucideIcon
  priceLabel: string
  priceDivisor?: number
  availabilityLabel: string
  onPress: () => void
  disabled?: boolean
  containerClassName?: string
  actionLabel?: string
}

function hexToRgb(hex: string) {
  if (!hex) return { r: 0, g: 0, b: 0 }
  const clean = hex.replace('#', '')
  const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(value, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function extractCounts(label: string) {
  const match = label.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null
  return { first: Number(match[1]), second: Number(match[2]) }
}

function compactPriceLabel(label: string, divisor?: number) {
  if (!label.trim()) return 'Miễn phí'
  const lower = label.toLowerCase()
  if (lower.includes('miễn phí') || lower.includes('free')) return 'Miễn phí'
  if (/[kK]/.test(label)) return label
  const raw = Number(label.replace(/[^\d]/g, ''))
  if (!raw) return 'Miễn phí'
  const normalized = divisor && divisor > 0 ? Math.ceil(raw / divisor) : raw
  return `${Math.round(normalized / 1000)}K`
}

export function FeedMatchCard({
  courtName,
  address,
  timeLabel,
  dateLabel,
  bookingStatus,
  skillLabel,
  skillIcon: SkillIcon,
  skillTagClassName: _skillTagClassName,
  skillTextClassName: _skillTextClassName,
  skillBorderClassName: _skillBorderClassName,
  skillIconColor: _skillIconColor,
  eloValue,
  duprValue,
  matchTypeLabel: _matchTypeLabel,
  hostName,
  hostSkillIcon: _hostSkillIcon,
  priceLabel,
  priceDivisor,
  availabilityLabel,
  onPress,
  disabled = false,
  containerClassName = 'mx-5 mb-4',
  actionLabel = 'Vào kèo',
}: Props) {
  const theme = useAppTheme()
  const BADGE_STYLE = {
    backgroundColor: theme.surfaceContainerLow,
    borderWidth: BORDER.base,
    borderColor: theme.outlineVariant,
  } as const

  const isConfirmed = bookingStatus === 'confirmed'
  const avatarLetter = (hostName || '?').slice(0, 1).toUpperCase()
  const counts = extractCounts(availabilityLabel)
  const isFull =
    availabilityLabel.toLowerCase().includes('đầy') ||
    availabilityLabel.toLowerCase().includes('đủ người') ||
    (counts ? counts.first >= counts.second : false)
  const progressPercent = counts
    ? Math.max(0, Math.min((counts.first / Math.max(counts.second, 1)) * 100, 100))
    : 0
  const compactAddress = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ')
  const nameLength = courtName.length
  const titleFontSize = nameLength > 52 ? 24 : nameLength > 40 ? 27 : nameLength > 30 ? 31 : 36
  const titleLineHeight = titleFontSize + 9

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`${containerClassName} overflow-hidden rounded-[24px] px-6 pt-6 pb-4`}
      style={{
        backgroundColor: 'transparent',
        borderWidth: BORDER.base,
        borderColor: theme.primary,
        borderLeftWidth: 3,
        borderLeftColor: theme.primary,
        shadowColor: withAlpha(theme.primary, 0.4),
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}
    >
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        adjustsFontSizeToFit
        minimumFontScale={0.68}
        style={{
          color: theme.primary,
          fontFamily: SCREEN_FONTS.headline,
          fontSize: titleFontSize,
          lineHeight: titleLineHeight,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {courtName}
      </Text>

      <Text
        style={{
          color: withAlpha(theme.onSurfaceVariant, 0.44),
          fontFamily: SCREEN_FONTS.headlineItalic,
          fontSize: 44,
          lineHeight: 52,
        }}
      >
        {timeLabel}
      </Text>

      <View className="mt-1.5">
        <View
          className="self-start flex-row items-center rounded-full px-3 py-1.5"
          style={{ ...BADGE_STYLE, maxWidth: '100%' }}
        >
          <MapPin size={13} color={theme.onSurfaceVariant} strokeWidth={2.4} />
          <Text
            className="ml-1.5"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 17,
            }}
          >
            {compactAddress || address}
          </Text>
        </View>
      </View>

      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        <View className="flex-row items-center rounded-full px-3 py-2" style={BADGE_STYLE}>
          {isConfirmed
            ? <ShieldCheck size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
            : <AlertCircle size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />}
          <Text
            className="ml-1.5"
            style={{
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {isConfirmed ? 'Đã đặt sân' : 'Chưa đặt sân'}
          </Text>
        </View>

        {dateLabel ? (
          <View className="flex-row items-center rounded-full px-3 py-2" style={BADGE_STYLE}>
            <CalendarDays size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
            <Text
              className="ml-1.5"
              style={{
                color: theme.onSurfaceVariant,
                fontFamily: SCREEN_FONTS.label,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {dateLabel}
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-center rounded-full px-3 py-2" style={BADGE_STYLE}>
          <SkillIcon size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
          <Text
            className="ml-1.5"
            style={{
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {skillLabel}
          </Text>
        </View>

        <View className="flex-row items-center rounded-full px-3 py-2" style={BADGE_STYLE}>
          <Target size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
          <Text
            className="ml-1.5"
            style={{
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {eloValue} ELO
          </Text>
        </View>

        <View className="flex-row items-center rounded-full px-3 py-2" style={BADGE_STYLE}>
          <Activity size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
          <Text
            className="ml-1.5"
            style={{
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {duprValue} DUPR
          </Text>
        </View>

        <View className="flex-row items-center rounded-full px-3 py-2" style={BADGE_STYLE}>
          <CircleDollarSign size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
          <Text
            className="ml-1.5"
            style={{
              color: theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {compactPriceLabel(priceLabel, priceDivisor)}{priceLabel === 'Miễn phí' ? '' : '/ng'}
          </Text>
        </View>
      </View>

      <View
        className="mt-4 rounded-[24px] p-3.5"
        style={{ backgroundColor: theme.surfaceContainerLow }}
      >
        <View className="flex-row items-center justify-between">
          <View className="mr-3 flex-1 flex-row items-center">
            <View
              className="mr-3 h-11 w-11 items-center justify-center rounded-full"
              style={{
                backgroundColor: theme.primary,
                borderWidth: BORDER.base,
                borderColor: withAlpha(theme.primary, 0.14),
              }}
            >
              <Text
                style={{
                  color: theme.onPrimary,
                  fontFamily: SCREEN_FONTS.headline,
                  fontSize: 15,
                }}
              >
                {avatarLetter}
              </Text>
            </View>

            <View className="flex-1">
              <Text
                numberOfLines={1}
                style={{
                  color: theme.onSurface,
                  fontFamily: SCREEN_FONTS.label,
                  fontSize: 13,
                }}
              >
                {hostName || 'Ẩn danh'}
              </Text>
            </View>
          </View>

          <View className="items-end">
            <Text
              style={{
                color: theme.onSurface,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 16,
              }}
            >
              {counts ? `${counts.first}/${counts.second}` : availabilityLabel}
            </Text>
            <Text
              style={{
                color: theme.onSurfaceVariant,
                fontFamily: SCREEN_FONTS.body,
                fontSize: 10,
              }}
            >
              người chơi
            </Text>
          </View>
        </View>

        <View
          className="mt-3 h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: theme.surfaceContainerHighest }}
        >
          <LinearGradient
            colors={[theme.primary, theme.tertiary]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ width: `${progressPercent}%`, height: '100%', borderRadius: RADIUS.full }}
          />
        </View>

        <View className="mt-3 flex-row items-center justify-between gap-3">
          <View className="flex-1 flex-row items-center">
            <View
              className="flex-row items-center rounded-full px-3 py-2"
              style={{
                backgroundColor: isFull
                  ? theme.errorContainer
                  : theme.surfaceContainerHighest,
                borderWidth: BORDER.base,
                borderColor: isFull ? theme.error : theme.outlineVariant,
              }}
            >
              <Users
                size={13}
                color={isFull ? theme.onErrorContainer : theme.onSurfaceVariant}
                strokeWidth={2.3}
              />
              <Text
                className="ml-1.5"
                style={{
                  color: isFull ? theme.onErrorContainer : theme.onSurfaceVariant,
                  fontFamily: SCREEN_FONTS.label,
                  fontSize: 12,
                }}
              >
                {isFull ? 'Đầy chỗ' : `Còn ${counts ? counts.second - counts.first : '?'} chỗ`}
              </Text>
            </View>
          </View>

          <View
            className="rounded-full px-4 py-2"
            style={{ backgroundColor: theme.primary }}
          >
            <Text
              style={{
                color: theme.onPrimary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                textTransform: 'uppercase',
                letterSpacing: 1.3,
              }}
            >
              {actionLabel}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}



