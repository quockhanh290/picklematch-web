import React from 'react'
import { View, Text, TouchableOpacity, Share } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { getSessionSkillLabel } from '@/lib/skillAssessment'
import { format } from 'date-fns'
import { Users, MapPin, Share2, ChevronRight } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'

type PlayerSessionCardProps = {
  session: any
  onPress: () => void
}

export function PlayerSessionCard({ session, onPress }: PlayerSessionCardProps) {
  const theme = useAppTheme()
  const { t } = useTranslation()
  
  const start = session.slot?.start_time ? new Date(session.slot.start_time) : new Date()
  const end = session.slot?.end_time ? new Date(session.slot.end_time) : new Date()
  
  const confirmedCount = session.player_count || 0
  const maxPlayers = session.max_players || 16
  const rawPrice = session.total_cost ?? session.slot?.price
  const pricePerPerson = (rawPrice !== undefined && rawPrice !== null)
    ? (rawPrice === 0 ? t('player_session_card.free') : `${Math.round(rawPrice / 1000)}K`)
    : '?'

  const skillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)

  // Status Logic
  const now = new Date()
  const isPast = end < now
  
  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1
  const isUnderfilled = fillRatio < 0.6 && !isPast && !isFull
  
  // Format Type Label
  const formatType = (session.format_type || '').toLowerCase()
  let formatLabel = t('player_session_card.label_social')
  if (formatType === 'round_robin') formatLabel = t('player_session_card.label_round_robin')
  else if (formatType === 'open_play') formatLabel = t('player_session_card.label_open_play')

  let statusLabel = formatLabel
  let statusBg = theme.primary
  
  if (isPast) {
    statusBg = theme.outline
  } else if (session.is_joined) {
    statusBg = theme.primary
  }
  
  // Day Badge Logic (Matching Host Dashboard style)
  const isToday = start.toDateString() === now.toDateString()
  const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === start.toDateString()
  const dateLabel = isToday ? t('player_session_card.today') : (isTomorrow ? t('player_session_card.tomorrow') : format(start, 'dd/MM'))
  let dayBadgeBg = theme.outline
  if (isToday) dayBadgeBg = theme.primary
  else if (isTomorrow) dayBadgeBg = theme.onSurfaceVariant

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        backgroundColor: 'white',
        borderRadius: RADIUS.lg,
        marginBottom: 16,
        overflow: 'hidden',
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        ...SHADOW.sm
      }}
    >
      {/* Top Accent Bar */}
      <View style={{ 
        backgroundColor: statusBg, 
        paddingHorizontal: 14, 
        paddingVertical: 5, 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.surface }} />
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.bold, fontSize: 9.5, letterSpacing: 0.5 }}>
            {statusLabel}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {session.is_joined && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.bold, fontSize: 8, letterSpacing: 0.2 }}>{t('player_session_card.label_joined')}</Text>
            </View>
          )}
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.bold, fontSize: 9.5, letterSpacing: 0.5 }}>
            {session.slot?.court?.city?.toUpperCase() || t('player_session_card.default_city')}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>
        {/* Title & Price */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 20, 
              color: theme.onSurface, 
              textTransform: 'uppercase', 
              lineHeight: 24 
            }} numberOfLines={1}>
              {session.slot?.court?.name || t('player_session_card.default_title')}
            </Text>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.body, 
              fontSize: 12, 
              color: theme.onSurfaceVariant, 
              marginTop: 2,
              letterSpacing: 0.3
            }}>
              {session.slot?.court?.address || t('player_session_card.default_address')} • {session.slot?.court?.city || t('player_session_card.default_city')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', marginLeft: 12, paddingTop: 2 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
              {pricePerPerson}
            </Text>
            {pricePerPerson !== t('player_session_card.free') && pricePerPerson !== '?' && (
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.onSurfaceVariant, marginTop: -3 }}>{t('player_session_card.price_suffix')}</Text>
            )}
          </View>
        </View>

        {/* Time & Skills Badge Row */}
        <View style={{ 
          flexDirection: 'row', 
          alignItems: 'center', 
          marginBottom: 6, 
          marginTop: 10 
        }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ 
                backgroundColor: dayBadgeBg, 
                paddingHorizontal: 6, 
                paddingVertical: 2, 
                borderRadius: 4, 
                marginRight: 8 
              }}>
                <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.bold, fontSize: 9.5 }}>
                  {dateLabel.toUpperCase()}
                </Text>
              </View>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>
                {format(start, 'HH:mm')} - {format(end, 'HH:mm')}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 6 }}>
            {/* Male Skill Badge */}
            <View style={{ 
              backgroundColor: isPast ? theme.outlineVariant : theme.successContainer, 
              borderRadius: 6, 
              paddingHorizontal: 8, 
              paddingVertical: 4, 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: 3, 
              borderWidth: 1, 
              borderColor: isPast ? theme.outlineVariant : theme.successSoft 
            }}>
              <Text style={{ color: isPast ? theme.outline : theme.success, fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>{t('player_session_card.gender_male')}</Text>
              <Text style={{ color: isPast ? theme.outline : theme.success, fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                {(skillLabel || '').split('/')[0]?.replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/g, '').trim()}
              </Text>
            </View>
            {/* Female Skill Badge */}
            <View style={{ 
              backgroundColor: isPast ? theme.outlineVariant : theme.dangerContainer, 
              borderRadius: 6, 
              paddingHorizontal: 8, 
              paddingVertical: 4, 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: 3, 
              borderWidth: 1, 
              borderColor: isPast ? theme.outlineVariant : theme.dangerSoft 
            }}>
              <Text style={{ color: isPast ? theme.outline : theme.danger, fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>{t('player_session_card.gender_female')}</Text>
              <Text style={{ color: isPast ? theme.outline : theme.danger, fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                {((skillLabel || '').split('/')[1] || skillLabel || '').replace('♀', '').replace(/\(Nữ\)|\(nữ\)|Trình|trình/g, '').trim()}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Footer Section: Segmented Progress Bar & Action (EXACT MATCH WITH HOST DASHBOARD) */}
      <View style={{ 
        paddingHorizontal: 14, 
        paddingVertical: 6,
        backgroundColor: theme.surfaceAlt,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: theme.outlineVariant + '20'
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Users size={14} color={theme.onSurfaceVariant} />
            <Text style={{ 
              fontFamily: SCREEN_FONTS.medium, 
              fontSize: 12, 
              color: theme.onSurfaceVariant,
              marginRight: 2
            }}>
              {confirmedCount}/{session.is_unlimited ? t('player_session_card.unlimited') : session.max_players}
            </Text>
          </View>

          {/* Segmented Progress Bar (Roundash) */}
          <View style={{ flexDirection: 'row', gap: 3, height: 5, width: 90 }}>
            {(() => {
              const displayMax = 10
              const segments = []
              for (let i = 0; i < displayMax; i++) {
                const isActive = i < (confirmedCount / maxPlayers) * displayMax
                segments.push(
                  <View 
                    key={i} 
                    style={{ 
                      flex: 1, 
                      height: '100%', 
                      borderRadius: 4, 
                      backgroundColor: isActive ? statusBg : theme.outlineVariant,
                      opacity: isActive ? 1 : 0.3
                    }} 
                  />
                )
              }
              return segments
            })()}
          </View>
        </View>
        
        <TouchableOpacity
          onPress={onPress}
          style={{ 
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: statusBg + '10', 
            paddingHorizontal: 10, 
            paddingVertical: 5, 
            borderRadius: 20,
            gap: 2
          }}
        >
          <Text style={{ 
            color: statusBg, 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 10,
            textTransform: 'uppercase'
          }}>
            {t('player_session_card.btn_details')}
          </Text>
          <ChevronRight size={12} color={statusBg} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}
