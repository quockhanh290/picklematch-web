import React from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { router } from 'expo-router'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'
import { Users, ChevronDown, ChevronUp } from 'lucide-react-native'
import { formatDistance } from '@/utils/formatters'
import { 
  parseSessionStartDate, 
  parseSessionEndDate, 
  getSuggestedDayInfo, 
  formatClock 
} from '@/lib/home/matchCardHelpers'
import { STRINGS } from '@/constants/strings'

interface HostSuggestedSessionCardProps {
  item: MatchSession
  isPreview?: boolean
  fullCourtName?: boolean
  showPlayerList?: boolean
  onTogglePlayerList?: () => void
  footer?: React.ReactNode
}

export function HostSuggestedSessionCard({ 
  item, 
  isPreview, 
  fullCourtName, 
  showPlayerList, 
  onTogglePlayerList, 
  footer 
}: HostSuggestedSessionCardProps) {
  const theme = useAppTheme()
  const { onOpenSession } = useSessionNav()
  const startDate = parseSessionStartDate(item)
  const endDate = parseSessionEndDate(item, startDate)
  const dayInfo = getSuggestedDayInfo(startDate, theme)
  const distanceLabel = formatDistance((item as any).distanceKm)
  const addressLabel = [item.address, distanceLabel].filter(Boolean).join(' \u00b7 ')
  const levelMatchesUser = (item as any).levelMatchesUser !== false

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
            opacity: 0.8,
            fontFamily: SCREEN_FONTS.headline,
            fontSize: 11,
            lineHeight: 15,
            textTransform: 'uppercase'
          }}
        >
          {(item as any).matchFormat || 'Đánh đôi'}
        </Text>
      </View>

      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Pressable 
          onPress={(event) => {
            event.stopPropagation()
            const courtId = item.courtId || (item as any).courtId
            if (courtId) {
              onOpenCourt(courtId)
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

        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6, marginBottom: 8 }}>
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

        {/* MOVED CHIPS: Day, Sub-court, Skill */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ backgroundColor: dayInfo.badgeColor, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 11, textTransform: 'uppercase' }}>
                {dayInfo.badgeLabel}
              </Text>
            </View>
            {item.subCourtLabel ? (
              <View style={{ backgroundColor: theme.primary, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 11, textTransform: 'uppercase' }}>
                  {item.subCourtLabel}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ width: 1, height: 12, backgroundColor: theme.outlineVariant, marginHorizontal: 2 }} />

          {item.skillLabel === 'Mới chơi' ? (
            <View style={{ backgroundColor: theme.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: theme.outlineVariant }}>
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                MỚI CHƠI
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ backgroundColor: '#E1F5EE', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#0F6E5630' }}>
                <Text style={{ color: '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NAM</Text>
                <Text style={{ color: '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                  {item.skillLabel.split('/')[0].replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/g, '').trim()}
                </Text>
              </View>
              <View style={{ backgroundColor: '#FAECE7', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#993C1D30' }}>
                <Text style={{ color: '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NỮ</Text>
                <Text style={{ color: '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                  {(item.skillLabel.split('/')[1] || item.skillLabel).replace('♀', '').replace(/\(Nữ\)|\(nữ\)|Trình|trình/g, '').trim()}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={{ backgroundColor: theme.surfaceAlt, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 12 }}>

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
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              ...SHADOW.xs,
              overflow: 'hidden'
            }}>
              <Pressable 
                onPress={onTogglePlayerList}
                style={{ 
                  paddingVertical: 8, 
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={12} color={theme.onPrimary} />
                  </View>
                  <View>
                    <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.bold, fontSize: 13 }}>
                      {item.activePlayers > 0 ? `Đã có ${item.activePlayers} người tham gia` : 'Chưa có người tham gia'}
                    </Text>
                  </View>
                </View>
                {item.activePlayers > 0 && (
                  showPlayerList ? <ChevronUp size={20} color={theme.outline} /> : <ChevronDown size={20} color={theme.outline} />
                )}
              </Pressable>

              {showPlayerList && item.players && item.players.length > 0 && (
                <Animated.View 
                  entering={FadeInUp.duration(300)}
                  style={{ 
                    paddingBottom: 8,
                  }}
                >
                  <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginHorizontal: 16, marginBottom: 4 }} />
                  
                  {item.players.map((playerItem, idx) => {
                    const p = (playerItem as any).player || playerItem
                    const pName = p.name || 'Người chơi'
                    
                    let pInitials = p.initials
                    if (!pInitials && p.name) {
                      const names = p.name.trim().split(' ').filter(Boolean)
                      if (names.length > 1) {
                        pInitials = (names[0][0] + names[names.length - 1][0]).toUpperCase()
                      } else if (names.length === 1) {
                        pInitials = names[0].substring(0, 2).toUpperCase()
                      }
                    }
                    if (!pInitials) pInitials = '??'

                    const pGender = (p as any).gender === 'male' || (p as any).gender === 'Nam' ? 'Nam' : (p as any).gender === 'female' || (p as any).gender === 'Nữ' ? 'Nữ' : ''
                    let pSkill = (p as any).pvna ? `Trình ${Number((p as any).pvna).toFixed(2)}` : ((p as any).skill_label || (p as any).self_assessed_level || '')
                    if (!pSkill && ((p as any).current_elo || (p as any).elo)) {
                      pSkill = `Elo ${(p as any).current_elo || (p as any).elo}`
                    }

                    return (
                      <View key={p.id || idx} style={{ 
                        flexDirection: 'row', 
                        alignItems: 'center', 
                        gap: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 16,
                        borderBottomWidth: idx === item.players.length - 1 ? 0 : 1,
                        borderBottomColor: theme.outlineVariant,
                        opacity: 0.9
                      }}>
                        <View style={{ 
                          width: 32, 
                          height: 32, 
                          borderRadius: 16, 
                          backgroundColor: theme.primary, 
                          alignItems: 'center', 
                          justifyContent: 'center' 
                        }}>
                          <Text style={{ color: theme.onPrimary, fontSize: 11, fontFamily: SCREEN_FONTS.headline }}>
                            {pInitials}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 15 }}>{pName}</Text>
                        </View>
                        
                        {(pGender || pSkill) ? (
                          <View style={{ 
                            backgroundColor: pGender === 'Nam' ? '#E1F5EE' : '#FAECE7', 
                            paddingHorizontal: 10, 
                            paddingVertical: 4, 
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: pGender === 'Nam' ? '#0F6E5630' : '#993C1D30',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6
                          }}>
                            <Text style={{ 
                              color: pGender === 'Nam' ? '#0F6E56' : '#993C1D', 
                              fontSize: 12, 
                              fontFamily: SCREEN_FONTS.headline 
                            }}>
                              {pGender ? pGender.toUpperCase() : ''}
                            </Text>
                            {pGender && pSkill ? (
                              <Text style={{ color: pGender === 'Nam' ? '#0F6E56' : '#993C1D', opacity: 0.3, fontSize: 10 }}>|</Text>
                            ) : null}
                            <Text style={{ 
                              color: pGender === 'Nam' ? '#0F6E56' : '#993C1D', 
                              fontSize: 12, 
                              fontFamily: SCREEN_FONTS.headline 
                            }}>
                              {(p as any).pvna ? Number((p as any).pvna).toFixed(2) : (pSkill.replace('Trình', '').trim())}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    )
                  })}
                </Animated.View>
              )}
            </View>
          )}

          {footer && (
            <View style={{ marginTop: 16 }}>
              {footer}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  )
}
