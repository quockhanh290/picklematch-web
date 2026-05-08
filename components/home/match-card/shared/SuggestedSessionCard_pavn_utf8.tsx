import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, BORDER, BUTTON, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'
import { Users, Mars, Venus } from 'lucide-react-native'
import { formatDistance } from '@/utils/formatters'
import { 
  parseSessionStartDate, 
  parseSessionEndDate, 
  getSuggestedDayInfo, 
  formatClock 
} from '@/lib/home/matchCardHelpers'
import { STRINGS } from '@/constants/strings'

interface SuggestedSessionCardProps {
  item: MatchSession
  showFullAddress?: boolean
  isOwnerDetail?: boolean
  isPreview?: boolean
}

export function SuggestedSessionCard({ item, showFullAddress, isOwnerDetail, isPreview }: SuggestedSessionCardProps) {
  const theme = useAppTheme()
  const { onOpenSession } = useSessionNav()
  const startDate = parseSessionStartDate(item)
  const endDate = parseSessionEndDate(item, startDate)
  const dayInfo = getSuggestedDayInfo(startDate, theme)
  const distanceLabel = formatDistance((item as any).distanceKm)
  const _addressParts = item.address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const addressLabel = [item.address, distanceLabel].filter(Boolean).join(' \u00b7 ')
  const levelMatchesUser = (item as any).levelMatchesUser !== false
  const pagination = `${(item.carouselIndex ?? 0) + 1} / ${item.carouselTotal ?? 1}`

  return (
    <Pressable
      onPress={() => onOpenSession(item.id)}
      className="overflow-hidden rounded-[16px]"
      style={{
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

        {isOwnerDetail ? (
          <Text
            style={{
              color: theme.onPrimary,
              opacity: 0.8,
              fontFamily: SCREEN_FONTS.headline,
              fontSize: 11,
              lineHeight: 15,
              textTransform: 'uppercase'
            }}
          >
            {(item as any).matchFormat || '─É├ính ─æ├┤i'}
          </Text>
        ) : (
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
        )}
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
            numberOfLines={1}
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

          {isOwnerDetail && (
            <>
              <View style={{ width: 1, height: 14, backgroundColor: theme.outlineVariant, marginHorizontal: 12 }} />
              {item.skillLabel === 'Mß╗¢i ch╞íi' ? (
                <View style={{ backgroundColor: theme.surface, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.outlineVariant }}>
                  <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>
                    Mß╗ÜI CH╞áI
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <View style={{ backgroundColor: theme.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: theme.outlineVariant }}>
                    <Mars size={12} color="#2563eb" strokeWidth={2.5} />
                    <Text style={{ color: '#2563eb', fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>
                      {item.skillLabel.split('/')[0].replace('ΓÖé', '').replace(/\(Nam\)|\(nam\)|Tr├¼nh|tr├¼nh/g, '').trim()}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: theme.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: theme.outlineVariant }}>
                    <Venus size={12} color="#db2777" strokeWidth={2.5} />
                    <Text style={{ color: '#db2777', fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>
                      {(item.skillLabel.split('/')[1] || item.skillLabel).replace('ΓÖÇ', '').replace(/\(Nß╗»\)|\(nß╗»\)|Tr├¼nh|tr├¼nh/g, '').trim()}
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}
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

        {isOwnerDetail ? (
          <View style={{ gap: 12 }}>
            {isPreview ? (
              <View
                style={{ 
                  backgroundColor: theme.primary, 
                  borderRadius: RADIUS.md, 
                  paddingVertical: 14, 
                  alignItems: 'center',
                  ...SHADOW.xs
                }}
              >
                <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 16, textTransform: 'uppercase' }}>
                  {STRINGS.home.actions.join_session}
                </Text>
              </View>
            ) : (
              <View style={{ 
                backgroundColor: theme.surface, 
                borderRadius: RADIUS.lg, 
                paddingVertical: 14, 
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: theme.outlineVariant,
                ...SHADOW.xs
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={18} color={theme.onPrimary} />
                  </View>
                  <View>
                    <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>NG╞»ß╗£I THAM GIA</Text>
                    <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 16 }}>
                      {item.activePlayers > 0 ? `─É├ú c├│ ${item.activePlayers} ng╞░ß╗¥i tham gia` : 'Ch╞░a c├│ ng╞░ß╗¥i tham gia'}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        ) : (
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
        )}
      </View>
    </Pressable>
  )
}
