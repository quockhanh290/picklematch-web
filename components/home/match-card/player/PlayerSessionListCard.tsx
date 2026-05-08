import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { LinearGradient } from 'expo-linear-gradient'
import { MapPin, CalendarDays, DollarSign, Star, Trophy } from 'lucide-react-native'
import { RADIUS, SHADOW, SPACING, BORDER } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'
import { getSkillLevelUi } from '@/lib/skillLevelUi'
import { getBookingStatusVisual, withAlpha } from '@/lib/home/matchCardHelpers'
import { MiniBadgeLight } from '../shared/MiniBadgeLight'
import { useAppTheme } from '@/lib/theme-context'

import { format, parseISO, isValid } from 'date-fns'
import { vi } from 'date-fns/locale/vi'

interface PlayerSessionListCardProps {
  item: MatchSession
  actionLabel: string
  accentMode: 'default' | 'rescue'
}



export function PlayerSessionListCard({
  item,
  actionLabel,
  accentMode,
}: PlayerSessionListCardProps) {
  const theme = useAppTheme()
  const { onOpenSession, onOpenPlayerProfile } = useSessionNav()

  function openPlayerProfile(playerId?: string, event?: any) {
    event?.stopPropagation()
    if (!playerId) return
    onOpenPlayerProfile(playerId)
  }

  const levelUi = getSkillLevelUi(item.levelId, theme)
  const Icon = levelUi.icon
  
  // Robust Date Parsing and Formatting
  let fullDateLabel = ''
  let timeRangeLabel = ''
  
  const startDate = item.startTime ? parseISO(item.startTime) : null
  const endDate = item.endTime ? parseISO(item.endTime) : null

  if (startDate && isValid(startDate) && endDate && isValid(endDate)) {
    fullDateLabel = format(startDate, "EEEE, 'ngày' dd 'Tháng' MM", { locale: vi })
    timeRangeLabel = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`
  } else {
    // Fallback to timeLabel parsing if raw dates are missing
    const [datePart, clockPart] = item.timeLabel.split('•').map((part) => part.trim())
    timeRangeLabel = clockPart ?? item.timeLabel
    fullDateLabel = datePart ?? item.timeLabel
  }
  const addressParts = item.address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const compactAddress =
    addressParts.length >= 3
      ? `${addressParts[0]}, ${addressParts[addressParts.length - 2]}, ${addressParts[addressParts.length - 1]}`
      : item.address
  const progressPercent = Math.max(0, Math.min((item.activePlayers / Math.max(item.maxPlayers, 1)) * 100, 100))
  const visiblePlayers = item.players.slice(0, 4)
  const remainingPlayers = item.players.length - visiblePlayers.length
  const displayCap = Math.min(item.maxPlayers, 4)
  const emptySlots = Math.max(displayCap - visiblePlayers.length, 0)
  const isRescueAccent = accentMode === 'rescue'
  const accentColor = isRescueAccent ? theme.error : theme.primary
  const onAccentColor = isRescueAccent ? theme.onError : theme.onPrimary
  const accentSurfaceColor = isRescueAccent ? theme.onErrorContainer : theme.surfaceTint
  const bookingStatusVisual = getBookingStatusVisual(item.statusLabel)
  const BookingStatusIcon = bookingStatusVisual.Icon

  return (
    <Pressable
      onPress={() => onOpenSession(item.id)}
      className="overflow-hidden"
      style={{
        padding: SPACING.xl,
        minHeight: 300,
        borderRadius: RADIUS.lg,
        backgroundColor: theme.surfaceContainerLowest,
        ...SHADOW.sm,
      }}
    >
      <View
        className="relative overflow-hidden"
        style={{ marginHorizontal: -SPACING.xl, marginTop: -SPACING.xl, paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl, paddingBottom: SPACING.lg, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <LinearGradient
          colors={[accentColor, accentSurfaceColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <Icon
          size={98}
          color="rgba(255,255,255,0.12)"
          style={{ position: 'absolute', right: -4, bottom: -10 }}
        />

        <View className="flex-row items-start">
          <Text
            className="flex-1"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            ellipsizeMode="tail"
            style={{
              color: onAccentColor,
              fontFamily: AppFontSet.headline,
              fontSize: 32,
              lineHeight: 38,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
            }}
          >
            {item.courtName}
          </Text>
        </View>

        <Text
          className="mt-1"
          style={{
            color: withAlpha(onAccentColor, 0.68),
            fontFamily: AppFontSet.display,
            fontSize: 36,
            lineHeight: 42,
          }}
        >
          {timeRangeLabel}
        </Text>

        <View className="mt-2">
          <View
            className="self-start flex-row items-center rounded-full px-3.5 py-2"
            style={{ backgroundColor: withAlpha(onAccentColor, 0.14), maxWidth: '100%' }}
          >
            <MapPin size={13} color={withAlpha(onAccentColor, 0.78)} strokeWidth={2.5} />
            <Text
              className="ml-1.5"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: withAlpha(onAccentColor, 0.86),
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {compactAddress}
            </Text>
          </View>
        </View>

        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <View
            className="flex-row items-center rounded-full px-3.5 py-2"
            style={{ backgroundColor: withAlpha(onAccentColor, 0.14) }}
          >
            <CalendarDays size={13} color={withAlpha(onAccentColor, 0.78)} strokeWidth={2.5} />
            <Text
              className="ml-1.5"
              style={{
                color: withAlpha(onAccentColor, 0.86),
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {fullDateLabel}
            </Text>
          </View>

          <View
            className="flex-row items-center rounded-full px-3.5 py-2"
            style={{ backgroundColor: withAlpha(onAccentColor, 0.14) }}
          >
            <Icon size={13} color={withAlpha(onAccentColor, 0.78)} strokeWidth={2.5} />
            <Text
              className="ml-1.5"
              style={{
                color: withAlpha(onAccentColor, 0.86),
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {item.skillLabel}
            </Text>
          </View>
        </View>
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        {item.isRanked ? <MiniBadgeLight icon={Trophy} label="Kèo tính điểm" tone="neutral" size="lg" /> : null}
        <MiniBadgeLight icon={BookingStatusIcon} label={item.statusLabel} tone="neutral" size="lg" />
        <View
          className="flex-row items-center rounded-full px-3 py-2"
          style={{ backgroundColor: theme.surfaceContainerLow, borderWidth: BORDER.base, borderColor: theme.outlineVariant }}
        >
          <DollarSign size={15} color={theme.onSurfaceVariant} strokeWidth={2.5} />
          <Text
            className="ml-1.5"
            style={{
              color: item.priceLabel === 'Miễn phí' ? theme.primary : theme.onSurfaceVariant,
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {item.priceLabel}{item.priceLabel === 'Miễn phí' ? '' : '/ng'}
          </Text>
        </View>
      </View>

      <View
        className="mt-4"
        style={{
          padding: SPACING.md,
          borderRadius: RADIUS.lg,
          backgroundColor: theme.surfaceContainerLow,
        }}
      >
        <View className="flex-row items-center justify-between">
          <View className="mr-3 flex-1 flex-row items-center">
            <Pressable
              onPress={(event) => openPlayerProfile(item.host.id, event)}
              className="mr-3 h-11 w-11 items-center justify-center rounded-full"
              style={{
                backgroundColor: accentColor,
                borderWidth: BORDER.base,
                borderColor: withAlpha(accentColor, 0.14),
              }}
            >
              <Text
                style={{
                  color: onAccentColor,
                  fontFamily: AppFontSet.headline,
                  fontSize: 15,
                }}
              >
                {item.host.initials}
              </Text>
            </Pressable>

            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.onSurface,
                    fontFamily: SCREEN_FONTS.label,
                    fontSize: 13,
                  }}
                >
                  {item.host.name}
                </Text>
                <View className="flex-row items-center rounded-full px-2 py-2" style={{ backgroundColor: theme.surfaceContainerHighest }}>
                  <Star size={11} color={accentColor} fill={accentColor} strokeWidth={2.2} />
                  <Text
                    className="ml-1"
                    style={{
                      color: theme.onSurface,
                      fontFamily: SCREEN_FONTS.label,
                      fontSize: 11,
                    }}
                  >
                    {item.host.rating.toFixed(1)}
                  </Text>
                </View>
              </View>

              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  color: theme.onSurfaceVariant,
                  fontFamily: SCREEN_FONTS.body,
                  fontSize: 11,
                  lineHeight: 16,
                }}
              >
                {item.host.vibe}
              </Text>
            </View>
          </View>

          <View className="items-end">
            <Text
              style={{
                color: theme.onSurface,
                fontFamily: AppFontSet.headline,
                fontSize: 16,
              }}
            >
              {item.activePlayers}/{item.maxPlayers}
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

        <View className="mt-3 h-2 rounded-full overflow-hidden" style={{ backgroundColor: theme.surfaceContainerHighest }}>
          <LinearGradient
            colors={[accentColor, isRescueAccent ? theme.onErrorContainer : theme.tertiary]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ width: `${progressPercent}%`, height: '100%', borderRadius: RADIUS.full }}
          />
        </View>

        <View className="mt-3 flex-row items-center justify-between gap-3">
          <View className="flex-1 flex-row items-center">
            {visiblePlayers.map((player, index) => (
              <Pressable
                key={player.id}
                onPress={(event) => openPlayerProfile(player.id, event)}
                className={`h-8 w-8 items-center justify-center rounded-full ${index === 0 ? '' : '-ml-2.5'}`}
                style={{
                  position: 'relative',
                  zIndex: 20 - index,
                  backgroundColor: accentColor,
                  borderWidth: BORDER.thick,
                  borderColor: theme.surfaceContainerLowest,
                }}
              >
                <Text
                  style={{
                    color: onAccentColor,
                    fontFamily: SCREEN_FONTS.cta,
                    fontSize: 10,
                  }}
                >
                  {player.initials}
                </Text>
              </Pressable>
            ))}

            {Array.from({ length: emptySlots }).map((_, index) => (
              <View
                key={`list-empty-${index}`}
                className={`h-8 w-8 items-center justify-center rounded-full ${visiblePlayers.length === 0 && index === 0 ? '' : '-ml-2.5'}`}
                style={{
                  position: 'relative',
                  zIndex: 1,
                  backgroundColor: 'transparent',
                  borderWidth: BORDER.medium,
                  borderStyle: 'dashed',
                  borderColor: theme.outlineVariant,
                }}
              >
                <Text
                  style={{
                    color: theme.outlineVariant,
                    fontFamily: AppFontSet.headline,
                    fontSize: 10,
                  }}
                >
                  +
                </Text>
              </View>
            ))}

            {remainingPlayers > 0 ? (
              <View
                className="-ml-2.5 h-8 w-8 items-center justify-center rounded-full"
                style={{
                  position: 'relative',
                  zIndex: 2,
                  backgroundColor: theme.surfaceContainerHighest,
                  borderWidth: BORDER.thick,
                  borderColor: theme.surfaceContainerLowest,
                }}
              >
                <Text
                  style={{
                    color: theme.onSurfaceVariant,
                    fontFamily: SCREEN_FONTS.label,
                    fontSize: 10,
                  }}
                >
                  +{remainingPlayers}
                </Text>
              </View>
            ) : null}
          </View>

          <View
            className="rounded-full px-4 py-2"
            style={{
              backgroundColor: accentColor,
            }}
          >
            <Text
              style={{
                color: onAccentColor,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 15,
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
