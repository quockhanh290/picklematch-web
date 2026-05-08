import React from 'react'
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
  getSuggestedDayInfo, 
  formatClock 
} from '@/lib/home/matchCardHelpers'
import { STRINGS } from '@/constants/strings'
import { router } from 'expo-router'

interface PlayerSuggestedSessionCardProps {
  item: MatchSession
  fullCourtName?: boolean
}

export function PlayerSuggestedSessionCard({ item, fullCourtName }: PlayerSuggestedSessionCardProps) {
  const theme = useAppTheme()
  const { onOpenSession } = useSessionNav()
  const startDate = parseSessionStartDate(item)
  const endDate = parseSessionEndDate(item, startDate)
  const dayInfo = getSuggestedDayInfo(startDate, theme)
  const distanceLabel = formatDistance((item as any).distanceKm)
  const addressLabel = [item.address, distanceLabel].filter(Boolean).join(' \u00b7 ')
  const levelMatchesUser = (item as any).levelMatchesUser !== false
  const pagination = `${(item.carouselIndex ?? 0) + 1} / ${item.carouselTotal ?? 1}`

  return (
    <Pressable
      onPress={() => onOpenSession(item.id)}
      style={{
        overflow: 'hidden',
        borderRadius: 16,
        backgroundColor: theme.surface,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
      }}
    >
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
              lineHeight: 15,
              letterSpacing: 0.5,
            }}
          >
            {(item.matchHint || STRINGS.home.sections.personalized_sub).toUpperCase()}
          </Text>
        </View>

        <Text
          style={{
            color: theme.onPrimary,
            opacity: 0.6,
            fontFamily: SCREEN_FONTS.label,
            fontSize: 11,
            lineHeight: 15,
          }}
        >
          {pagination}
        </Text>
      </View>

      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Pressable 
          onPress={(event) => {
            event.stopPropagation()
            const courtId = item.courtId || (item as any).courtId
            if (courtId) {
              router.push(`/(player)/court/${courtId}`)
            }
          }}
        >
          <Text
            numberOfLines={fullCourtName ? undefined : 1}
            ellipsizeMode="tail"
            style={{
              color: theme.onSurface,
              fontFamily: AppFontSet.headline,
              fontSize: 31,
              lineHeight: 36,
              letterSpacing: 0,
              marginBottom: 4,
              paddingTop: 2,
              textTransform: 'uppercase',
            }}
          >
            {item.courtName}
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16, flexShrink: 1 }}>
            {addressLabel}
          </Text>
          {levelMatchesUser ? (
            <>
              <View style={{ width: 3, height: 3, borderRadius: RADIUS.full, backgroundColor: theme.outline }} />
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.label, fontSize: 11, lineHeight: 15 }}>
                {STRINGS.session.labels.match_level}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      <View style={{ backgroundColor: theme.surfaceContainerLow, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ backgroundColor: dayInfo.badgeColor, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, fontSize: 11, lineHeight: 16, textTransform: 'uppercase' }}>
                {dayInfo.badgeLabel}
              </Text>
            </View>
            {item.subCourtLabel ? (
              <View style={{ backgroundColor: dayInfo.badgeColor, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, fontSize: 11, lineHeight: 16, textTransform: 'uppercase' }}>
                  {item.subCourtLabel}
                </Text>
              </View>
            ) : null}
          </View>
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
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16, marginTop: 4 }}>
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
          <View style={{ backgroundColor: theme.surface, borderRadius: 4, paddingHorizontal: 9, paddingVertical: 3 }}>
            <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.label, fontSize: 12, lineHeight: 16 }}>
              {item.skillLabel}
            </Text>
          </View>

          <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16 }}>
            {(item as any).openSlotsLabel || `${item.activePlayers}/${item.maxPlayers} ${STRINGS.common.person}`}
          </Text>

          <Pressable
            onPress={(event) => {
              event.stopPropagation()
              onOpenSession(item.id)
            }}
            style={{ backgroundColor: theme.primary, ...BUTTON.pill }}
          >
            <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 15, lineHeight: 18, textTransform: 'uppercase' }}>
              {STRINGS.home.actions.join_session}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
}
