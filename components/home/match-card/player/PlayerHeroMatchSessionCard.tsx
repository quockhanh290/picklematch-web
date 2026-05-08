import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, BORDER, BUTTON } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'
import { formatDistance, getAvatarColor } from '@/utils/formatters'
import { 
  splitMatchTimeLabel, 
  parseUpcomingStartDate, 
  getHeaderTimeLabel, 
  getStartClockFromDate, 
  getStartSubLabel 
} from '@/lib/home/matchCardHelpers'
import { STRINGS } from '@/constants/strings'

interface PlayerHeroMatchSessionCardProps {
  item: MatchSession
  actionLabel?: string
}



export function PlayerHeroMatchSessionCard({ item }: PlayerHeroMatchSessionCardProps) {
  const theme = useAppTheme()
  const { onOpenSession, onOpenPlayerProfile } = useSessionNav()

  function openPlayerProfile(playerId?: string, event?: any) {
    event?.stopPropagation()
    if (!playerId) return
    onOpenPlayerProfile(playerId)
  }

  const [now, setNow] = useState(() => new Date())
  const { timeRange } = splitMatchTimeLabel(item.timeLabel)
  const startDate = useMemo(() => {
    if (item.startTime) {
      const parsed = new Date(item.startTime)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }

    return parseUpcomingStartDate(item.timeLabel, now)
  }, [item.startTime, item.timeLabel, now])
  const timeInfo = getHeaderTimeLabel(startDate, now)
  const startClock = getStartClockFromDate(startDate, timeRange)
  const startSubLabel = getStartSubLabel(startDate, now)
  const distanceLabel = formatDistance((item as any).distanceKm)
  const addressLine = [item.address, distanceLabel].filter(Boolean).join(' \u00b7 ')
  const _compactAddress = addressLine
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ')
  const displayCap = Math.min(item.maxPlayers, 4)
  const visiblePlayers = item.players.slice(0, displayCap)
  const emptySlots = Math.min(Math.max(item.maxPlayers - item.activePlayers, 0), Math.max(displayCap - visiblePlayers.length, 0))
  const waitingPlayers = Math.max(item.maxPlayers - item.activePlayers, 0)
  const playersLabel =
    waitingPlayers === 0 
      ? `${STRINGS.session.labels.full} \u2713` 
      : `${item.activePlayers}/${item.maxPlayers} \u00b7 ${STRINGS.session.labels.waiting_more.replace('{count}', waitingPlayers.toString())}`

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  return (
    <Pressable
      onPress={() => onOpenSession(item.id)}
      className="overflow-hidden rounded-[16px]"
      style={{ backgroundColor: theme.primary }}
    >
      <LinearGradient
        colors={[theme.heroGradientStart, theme.primary]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ paddingTop: 18, paddingHorizontal: SPACING.xl, paddingBottom: 16 }}
      >
        <View className="flex-row items-center justify-between" style={{ marginBottom: 16 }}>
          <View className="flex-row items-center">
            <View style={{ width: 5, height: 5, borderRadius: RADIUS.full, backgroundColor: theme.heroLiveDot, marginRight: 6 }} />
            <Text
              style={{
                color: theme.heroBodyMuted,
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13,
                letterSpacing: 0.8,
              }}
            >
              {STRINGS.session.labels.upcoming_match}
            </Text>
          </View>

          {timeInfo.countdown ? (
            <View
              style={{
                backgroundColor: theme.heroPillBg,
                borderRadius: RADIUS.full,
                paddingHorizontal: 9,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: theme.heroCountdownText,
                  fontFamily: SCREEN_FONTS.cta,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                {timeInfo.countdown}
              </Text>
            </View>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', columnGap: 16 }}>
          <View>
            <Text style={{ color: theme.heroBodyMuted, fontFamily: SCREEN_FONTS.body, fontSize: 10, lineHeight: 14, marginBottom: 2 }}>
              {STRINGS.session.labels.starts_at}
            </Text>
            <Text
              style={{
                color: theme.onPrimary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 52,
                lineHeight: 54,
                letterSpacing: 0,
              }}
            >
              {startClock}
            </Text>
            <Text style={{ color: theme.heroBodyMuted, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16 }}>
              {startSubLabel}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: theme.onPrimary,
                fontFamily: AppFontSet.headline,
                fontSize: 19,
                lineHeight: 21,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              {item.courtName}
            </Text>
            <View
              style={{
                alignSelf: 'flex-start',
                backgroundColor: theme.heroChipBg,
                borderRadius: 5,
                paddingHorizontal: SPACING.sm,
                paddingVertical: 3,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.label, fontSize: 12, lineHeight: 16 }}>
                {item.skillLabel}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: theme.heroBodyMuted, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16 }}
            >
              {item.address}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View
        style={{
          backgroundColor: theme.heroFooterOverlay,
          paddingHorizontal: SPACING.xl,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
          {visiblePlayers.map((player, index) => {
            const avatar = getAvatarColor(player.id)
            return (
              <Pressable
                key={player.id}
                onPress={(event) => openPlayerProfile(player.id, event)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: RADIUS.full,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: avatar.bg,
                  borderWidth: BORDER.thick,
                  borderColor: theme.heroAvatarBorder,
                  marginRight: index === visiblePlayers.length + emptySlots - 1 ? 0 : -8,
                  zIndex: 4 - index,
                }}
              >
                <Text style={{ color: avatar.fg, fontFamily: SCREEN_FONTS.cta, fontSize: 10, lineHeight: 13 }}>
                  {player.initials}
                </Text>
              </Pressable>
            )
          })}

          {Array.from({ length: emptySlots }).map((_, index) => (
            <View
              key={`hero-empty-${index}`}
              style={{
                width: 28,
                height: 28,
                borderRadius: RADIUS.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.heroSlotBg,
                borderWidth: BORDER.thick,
                borderColor: theme.heroAvatarBorder,
                marginRight: index === emptySlots - 1 ? 0 : -8,
                zIndex: 4 - visiblePlayers.length - index,
              }}
            >
              <Text style={{ color: theme.heroSlotText, fontFamily: SCREEN_FONTS.cta, fontSize: 13, lineHeight: 16 }}>
                ?
              </Text>
            </View>
          ))}
        </View>

        <Text
          numberOfLines={1}
          style={{ color: theme.heroBodyMuted, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, marginHorizontal: 12, flexShrink: 1 }}
        >
          {playersLabel}
        </Text>

        <Pressable
          onPress={(event) => {
            event.stopPropagation()
            onOpenSession(item.id)
          }}
          style={{ backgroundColor: theme.surface, ...BUTTON.pill, flexShrink: 0 }}
        >
          <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 15, lineHeight: 18, textTransform: 'uppercase' }}>
            {`${STRINGS.common.view} \u2192`}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  )
}
