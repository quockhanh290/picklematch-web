import React, { useEffect, useState, useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, BORDER, BUTTON } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'
import { formatDistance } from '@/utils/formatters'
import { 
  parseSessionStartDate, 
  parseSessionEndDate,
  getHeaderTimeLabel,
  getSuggestedDayInfo,
  formatClock
} from '@/lib/home/matchCardHelpers'
import { STRINGS } from '@/constants/strings'

interface UrgentFillCardProps {
  item: MatchSession
}

export function UrgentFillCard({ item }: UrgentFillCardProps) {
  const theme = useAppTheme()
  const { onOpenSession } = useSessionNav()
  const [now, setNow] = useState(() => new Date())
  const startDate = useMemo(() => parseSessionStartDate(item), [item])
  const endDate = parseSessionEndDate(item, startDate)
  const timeInfo = getHeaderTimeLabel(startDate, now)
  const dayInfo = getSuggestedDayInfo(startDate, theme)
  const distanceLabel = formatDistance((item as any).distanceKm)
  const _addressParts = item.address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const addressLabel = [item.address, distanceLabel].filter(Boolean).join(' \u00b7 ')
  const waitingPlayers = Math.max(item.maxPlayers - item.activePlayers, 0)
  const urgentText = waitingPlayers === 1 ? STRINGS.session.labels.remaining_slots_last : STRINGS.session.labels.remaining_slots.replace('{count}', waitingPlayers.toString())
  const stripLabel = `${waitingPlayers > 0 ? STRINGS.session.labels.remaining_slots.replace('{count}', waitingPlayers.toString()).toUpperCase() : STRINGS.session.labels.full.toUpperCase()} \u00b7 ${STRINGS.session.labels.need_players.toUpperCase()}`

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
      style={{
        backgroundColor: theme.surface,
        borderWidth: BORDER.base,
        borderColor: theme.rescueBorder,
      }}
    >
      <View
        style={{
          backgroundColor: theme.rescueStrong,
          paddingHorizontal: 16,
          paddingVertical: SPACING.xs,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6, flexShrink: 1 }}>
          <View style={{ width: 5, height: 5, borderRadius: RADIUS.full, backgroundColor: theme.onPrimary }} />
          <Text
            numberOfLines={1}
            style={{
              color: theme.onPrimary,
              fontFamily: SCREEN_FONTS.cta,
              fontSize: 11,
              lineHeight: 15,
              letterSpacing: 0.5,
              flexShrink: 1,
            }}
          >
            {stripLabel}
          </Text>
        </View>

        {timeInfo.label ? (
          <Text
            numberOfLines={1}
            style={{
              color: theme.onPrimary,
              opacity: 0.9,
              fontFamily: SCREEN_FONTS.cta,
              fontSize: 11,
              lineHeight: 15,
              marginLeft: 10,
            }}
          >
            {timeInfo.label}
          </Text>
        ) : null}
      </View>

      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: theme.onSurface,
            fontFamily: AppFontSet.headline,
            fontSize: 31,
            lineHeight: 34,
            letterSpacing: 0,
            marginBottom: 3,
            textTransform: 'uppercase',
          }}
        >
          {item.courtName}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16, flexShrink: 1 }}>
            {addressLabel}
          </Text>
          {waitingPlayers > 0 ? (
            <>
              <View style={{ width: 3, height: 3, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant }} />
              <Text style={{ color: theme.rescueStrong, fontFamily: SCREEN_FONTS.label, fontSize: 11, lineHeight: 15 }}>
                {urgentText}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      <View style={{ backgroundColor: theme.surfaceContainerLow, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8, marginBottom: 4 }}>
          <View style={{ backgroundColor: theme.rescueStrong, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, fontSize: 9, lineHeight: 12 }}>
              {dayInfo.badgeLabel}
            </Text>
          </View>
          <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15 }}>
            {dayInfo.label}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <View>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              {STRINGS.session_detail.meta.time.toUpperCase()}
            </Text>
            <Text
              style={{
                color: theme.onSurface,
                fontFamily: AppFontSet.headline,
                fontSize: 33,
                lineHeight: 33,
                letterSpacing: 0,
              }}
            >
              {formatClock(startDate)}
            </Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, marginTop: 4 }}>
              {`${STRINGS.date.until} ${formatClock(endDate)}`}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              {STRINGS.session_detail.meta.cost.toUpperCase()}
            </Text>
            <Text style={{ color: item.priceLabel === STRINGS.session.labels.free ? theme.primary : theme.onSurface, fontFamily: AppFontSet.headline, fontSize: 25, lineHeight: 25 }}>
              {item.priceLabel}
            </Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, marginTop: 2 }}>
              {item.priceLabel === STRINGS.session.labels.free ? '' : STRINGS.session.labels.per_person}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.label, fontSize: 12, lineHeight: 16 }}>
              {item.skillLabel}
            </Text>
          </View>
 
          <Text style={{ color: theme.rescueStrong, fontFamily: SCREEN_FONTS.label, fontSize: 12, lineHeight: 16 }}>
            {`${item.activePlayers}/${item.maxPlayers} ${STRINGS.common.person}`}
          </Text>

          <Pressable
            onPress={(event) => {
              event.stopPropagation()
              onOpenSession(item.id)
            }}
            style={{ backgroundColor: theme.rescueStrong, ...BUTTON.pill }}
          >
            <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 15, lineHeight: 18, textTransform: 'uppercase' }}>
              {STRINGS.session_join.button.join_now}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
}
