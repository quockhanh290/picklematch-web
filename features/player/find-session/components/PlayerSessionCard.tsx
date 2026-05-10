import React from 'react'
import { View, Text, TouchableOpacity, Share } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { getSessionSkillLabel } from '@/lib/skillAssessment'
import { format } from 'date-fns'
import { Users, MapPin, Share2, ChevronRight } from 'lucide-react-native'

type PlayerSessionCardProps = {
  session: any
  onPress: () => void
}

export function PlayerSessionCard({ session, onPress }: PlayerSessionCardProps) {
  const theme = useAppTheme()
  
  const start = session.slot?.start_time ? new Date(session.slot.start_time) : new Date()
  const end = session.slot?.end_time ? new Date(session.slot.end_time) : new Date()
  
  const confirmedCount = session.player_count || 0
  const maxPlayers = session.max_players || 16
  const rawPrice = session.total_cost ?? session.slot?.price
  const pricePerPerson = (rawPrice !== undefined && rawPrice !== null)
    ? (rawPrice === 0 ? 'FREE' : `${Math.round(rawPrice / 1000)}K`)
    : '?'

  const skillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)

  // Status Logic
  const now = new Date()
  const isPast = end < now
  
  // Enhanced Color System (Matching Host Dashboard)
  const COLORS = {
    teal: '#0F6E56',
    darkTeal: '#064E3B',
    amber: '#D97706',
    coral: '#D85A30',
    gray: '#6B7280'
  }

  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1
  const isUnderfilled = fillRatio < 0.6 && !isPast && !isFull
  
  let statusLabel = 'ĐANG MỞ'
  let statusBg = theme.primary
  
  if (isPast) {
    statusLabel = 'KẾT THÚC'
    statusBg = COLORS.gray
  } else if (isFull) {
    statusLabel = 'ĐÃ ĐẦY'
    // Still use primary or maybe a slightly different shade? 
    // User said "default primary", so let's stick to it.
    statusBg = theme.primary 
  } else if (session.is_joined) {
    statusLabel = 'ĐÃ THAM GIA'
    statusBg = theme.primary
  } else if (isUnderfilled) {
    statusLabel = 'CẦN THÊM NGƯỜI'
    statusBg = theme.primary
  }

  // Day Badge Logic (Matching Host Dashboard style)
  const isToday = start.toDateString() === now.toDateString()
  const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === start.toDateString()
  const dateLabel = isToday ? 'Hôm nay' : (isTomorrow ? 'Ngày mai' : format(start, 'dd/MM'))
  let dayBadgeBg = theme.outline
  if (isToday) dayBadgeBg = theme.primary
  else if (isTomorrow) dayBadgeBg = theme.onSurfaceVariant

  const handleShare = async () => {
    try {
      const courtName = session.slot?.court?.name || 'Pickleball Court'
      const timeStr = format(start, 'HH:mm - dd/MM')
      const message = `Tham gia kèo Pickleball tại ${courtName}!\n⏰ ${timeStr}\n📍 ${session.slot?.court?.address}\n\nĐăng ký ngay trên PickleMatch!`
      await Share.share({ message })
    } catch (e) {}
  }

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
      {/* Top Accent Bar (Restored with Primary Color) */}
      <View style={{ 
        backgroundColor: statusBg, 
        paddingHorizontal: 14, 
        paddingVertical: 5, 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' }} />
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 9.5, letterSpacing: 0.5 }}>
            {statusLabel}
          </Text>
        </View>
        <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 9.5, letterSpacing: 0.5 }}>
          {session.slot?.court?.city?.toUpperCase() || 'TP.HCM'}
        </Text>
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
              {session.slot?.court?.name || 'KÈO PICKLEBALL'}
            </Text>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.body, 
              fontSize: 12, 
              color: theme.onSurfaceVariant, 
              marginTop: 2,
              letterSpacing: 0.3
            }}>
              {session.slot?.court?.address || 'Địa chỉ đang cập nhật'} • {session.slot?.court?.city || 'TP.HCM'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', marginLeft: 12, paddingTop: 2 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
              {pricePerPerson}
            </Text>
            {pricePerPerson !== 'FREE' && pricePerPerson !== '?' && (
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.onSurfaceVariant, marginTop: -3 }}>/người</Text>
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
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 9.5 }}>
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
              backgroundColor: isPast ? theme.outlineVariant : '#E1F5EE', 
              borderRadius: 6, 
              paddingHorizontal: 8, 
              paddingVertical: 4, 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: 3, 
              borderWidth: 1, 
              borderColor: isPast ? theme.outlineVariant : '#0F6E5630' 
            }}>
              <Text style={{ color: isPast ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NAM</Text>
              <Text style={{ color: isPast ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                {(skillLabel || '').split('/')[0]?.replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/g, '').trim()}
              </Text>
            </View>
            {/* Female Skill Badge */}
            <View style={{ 
              backgroundColor: isPast ? theme.outlineVariant : '#FAECE7', 
              borderRadius: 6, 
              paddingHorizontal: 8, 
              paddingVertical: 4, 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: 3, 
              borderWidth: 1, 
              borderColor: isPast ? theme.outlineVariant : '#993C1D30' 
            }}>
              <Text style={{ color: isPast ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NỮ</Text>
              <Text style={{ color: isPast ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
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
              {confirmedCount}/{session.is_unlimited ? '∞' : session.max_players}
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
            Chi tiết
          </Text>
          <ChevronRight size={12} color={statusBg} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}
