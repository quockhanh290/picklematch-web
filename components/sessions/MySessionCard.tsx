import React from 'react'
import { Pressable, Text, View, Platform, TouchableOpacity } from 'react-native'
import { CheckCircle2, AlertCircle, PencilLine, Star, Users, ChevronRight, Share2, Pencil as Edit3, UserPlus, ArrowUpRight } from 'lucide-react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { getSessionSkillLabel } from '@/lib/sessionDetail'
import { format as formatDate } from 'date-fns'
import { STRINGS } from '@/constants/strings'

export type SessionRequestStatus = 'pending' | 'accepted' | 'rejected' | null
export type SessionRole = 'host' | 'player'
export type SessionTab = 'upcoming' | 'pending' | 'history'

export type MySession = {
  id: string
  title?: string
  status: string
  court_booking_status: 'confirmed' | 'unconfirmed'
  host_id?: string | null
  role: SessionRole
  request_status: SessionRequestStatus
  start_time: string
  end_time: string
  court_name: string
  court_city: string
  court_address: string
  host_name: string
  player_count: number
  max_players: number
  elo_min: number | null
  elo_max: number | null
  has_rated: boolean
  results_status?: 'not_submitted' | 'pending_confirmation' | 'disputed' | 'finalized' | 'void' | null
  user_result?: 'win' | 'loss' | 'draw' | null
  is_ranked: boolean
  total_cost?: number
  format_type?: string
}

function formatRelativeDate(date: Date) {
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()

  if (isSameDay(date, today)) return STRINGS.session_card.today
  if (isSameDay(date, tomorrow)) return STRINGS.session_card.tomorrow
  
  const days = STRINGS.session_card.days
  return days[date.getDay()]
}

export function MySessionCard({
  item,
  tab,
  onShare,
}: {
  item: MySession
  tab: SessionTab
  onShare: (session?: MySession) => void | Promise<void>
  formatTimeRange: (start: string, end: string) => string
}) {
  const theme = useAppTheme()
  const { 
    onOpenSession, 
    onRateSession, 
    onViewMatchResult, 
    onConfirmResult, 
    onReviewSession,
    onEditSession 
  } = useSessionNav()

  const start = new Date(item.start_time)
  const end = new Date(item.end_time)
  const confirmedCount = item.player_count
  const maxPlayers = item.max_players
  const pricePerPerson = item.total_cost && item.total_cost > 0 ? `${Math.round(item.total_cost / 1000)}K` : STRINGS.session_card.free
  const isHistory = tab === 'history'
  const isPending = tab === 'pending'
  
  // Skill Level Labels
  const skillLabel = getSessionSkillLabel(item.elo_min ?? 0, item.elo_max ?? 0)

  // Day Badge Logic
  const dateLabel = formatRelativeDate(start)
  let dayBadgeBg = theme.outline
  if (dateLabel === STRINGS.session_card.today) dayBadgeBg = theme.primary
  else if (dateLabel === STRINGS.session_card.tomorrow) dayBadgeBg = theme.onSurfaceVariant

  // Enhanced Color System
  const COLORS = {
    teal: '#0F6E56',
    darkTeal: '#064E3B',
    amber: '#D97706',
    coral: '#D85A30',
    gray: '#6B7280',
    blue: '#2563EB'
  }

  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1

  let statusLabel = STRINGS.session_card.status_upcoming
  let statusBg = COLORS.teal
  
  if (isHistory) {
    statusLabel = STRINGS.session_card.status_history
    statusBg = COLORS.gray
    if (item.status === 'cancelled') {
      statusLabel = STRINGS.session_card.status_cancelled
    } else if (item.user_result === 'win') {
      statusLabel = STRINGS.session_card.status_win
      statusBg = COLORS.teal
    } else if (item.user_result === 'loss') {
      statusLabel = STRINGS.session_card.status_loss
      statusBg = COLORS.coral
    }
  } else if (isPending) {
    statusLabel = STRINGS.session_card.status_pending
    statusBg = COLORS.amber
  } else if (isFull) {
    statusLabel = STRINGS.session_card.status_full
    statusBg = COLORS.amber
  }

  return (
    <Pressable
      onPress={() => onOpenSession(item.id)}
      style={{
        backgroundColor: theme.surface,
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
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' }} />
          <Text style={{ 
            color: 'white', 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 12, 
            letterSpacing: 1,
            fontWeight: '700'
          }}>
            {item.role === 'host' 
              ? statusLabel 
              : (() => {
                  const fmt = (item.format_type || '').toLowerCase()
                  if (fmt === 'round_robin') return 'ROUND ROBIN'
                  if (fmt === 'open_play') return 'OPEN PLAY'
                  return STRINGS.session_card.format_social
                })()}
          </Text>
        </View>

        {item.role === 'host' && (
          <Text style={{ 
            color: 'white', 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 12, 
            letterSpacing: 1,
            fontWeight: '700',
            opacity: 0.9 
          }}>
            {STRINGS.session_card.host_role}
          </Text>
        )}
      </View>

      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>
        {/* Title Row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 20, 
              color: theme.onSurface, 
              textTransform: 'uppercase',
              lineHeight: 24
            }} numberOfLines={1}>
              {(item.court_name || STRINGS.session_card.default_court_name).toUpperCase()}
            </Text>
            
            <Text style={{ 
              fontFamily: SCREEN_FONTS.body, 
              fontSize: 12, 
              color: theme.onSurfaceVariant,
              marginTop: 2,
              letterSpacing: 0.3
            }}>
              {item.role === 'host' 
                ? (item.title || (item.format_type === 'round_robin' ? 'Round Robin' : STRINGS.session_card.format_social))
                : item.court_address}
            </Text>
          </View>
          
          <View style={{ alignItems: 'flex-end', marginLeft: 12, paddingTop: 2 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
              {pricePerPerson}
            </Text>
            {item.total_cost && item.total_cost > 0 && (
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10, color: theme.onSurfaceVariant, marginTop: -2 }}>
                {STRINGS.session_card.per_person}
              </Text>
            )}
          </View>
        </View>

        {/* Time and Skill Row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ backgroundColor: dayBadgeBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 8 }}>
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 9.5 }}>{dateLabel.toUpperCase()}</Text>
              </View>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>
                {formatDate(start, 'HH:mm')} - {formatDate(end, 'HH:mm')}
              </Text>
            </View>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ backgroundColor: isHistory ? theme.outlineVariant : '#E1F5EE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: isHistory ? theme.outlineVariant : '#0F6E5630' }}>
              <Text style={{ color: isHistory ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NAM</Text>
              <Text style={{ color: isHistory ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                {(skillLabel || '').split('/')[0]?.replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/g, '').trim()}
              </Text>
            </View>
            <View style={{ backgroundColor: isHistory ? theme.outlineVariant : '#FAECE7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: isHistory ? theme.outlineVariant : '#993C1D30' }}>
              <Text style={{ color: isHistory ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NỮ</Text>
              <Text style={{ color: isHistory ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                {((skillLabel || '').split('/')[1] || skillLabel || '').replace('♀', '').replace(/\(Nữ\)|\(nữ\)|Trình|trình/g, '').trim()}
              </Text>
            </View>
          </View>
        </View>

      </View>

      {/* Footer Section */}
      <View style={{ 
        paddingHorizontal: 14, 
        paddingVertical: 8,
        backgroundColor: theme.surfaceAlt,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: theme.outlineVariant + '40'
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Users size={14} color={theme.onSurfaceVariant} />
            <Text style={{ fontFamily: SCREEN_FONTS.medium, fontSize: 12, color: theme.onSurfaceVariant }}>
              {confirmedCount}/{maxPlayers}
            </Text>
          </View>

          {/* Progress Bar */}
          <View style={{ flexDirection: 'row', gap: 3, height: 4, width: 80 }}>
            {[...Array(10)].map((_, i) => {
              const isActive = i < (confirmedCount / maxPlayers) * 10
              return (
                <View 
                  key={i} 
                  style={{ 
                    flex: 1, 
                    borderRadius: 2, 
                    backgroundColor: isActive ? statusBg : theme.outlineVariant,
                    opacity: isActive ? 1 : 0.3
                  }} 
                />
              )
            })}
          </View>
        </View>

        {(
          <TouchableOpacity
            onPress={() => onOpenSession(item.id)}
            style={{ 
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: statusBg + '15',
              paddingHorizontal: 12, 
              paddingVertical: 6, 
              borderRadius: 20,
              gap: 4
            }}
          >
            <Text style={{ color: statusBg, fontFamily: SCREEN_FONTS.headline, fontSize: 10.5, textTransform: 'uppercase' }}>
              {STRINGS.session_card.details_btn}
            </Text>
            <ChevronRight size={12} color={statusBg} />
          </TouchableOpacity>
        )}
      </View>
    </Pressable>
  )
}
