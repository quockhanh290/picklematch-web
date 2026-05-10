import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { router, useFocusEffect } from 'expo-router'
import { 
  Plus, 
  Users, 
  Calendar, 
  Trophy, 
  UserCircle, 
  MapPin, 
  Clock, 
  ChevronRight, 
  Activity, 
  LogOut,
  Star,
  Landmark,
  Settings,
  BarChart3,
  RotateCcw,
  PlusCircle,
  LayoutGrid,
  AlertTriangle,
  Share2,
  Bell,
  User,
  UserPlus,
  ArrowUpRight,
  TrendingUp
} from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { StatusBar } from 'expo-status-bar'
import { HomeGreetingHeader } from '@/components/home/HomeGreetingHeader'
import { useState, useEffect, useCallback } from 'react'
import { formatDistance } from '@/utils/formatters'
import { 
  parseSessionStartDate, 
  parseSessionEndDate, 
  getSuggestedDayInfo, 
  formatClock 
} from '@/lib/home/matchCardHelpers'
import { 
  Text, 
  TouchableOpacity, 
  View, 
  ScrollView,
  SafeAreaView,
  Pressable,
  ActivityIndicator,
  Share
} from 'react-native'
import { WebContainer } from '@/components/design/WebContainer'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, BUTTON, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { format as formatDate } from 'date-fns'
import { vi } from 'date-fns/locale'
import { MaterialCommunityIcons } from '@expo/vector-icons'

import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppNav } from '@/lib/navigation/AppNavContext'
import { fetchCourtDetailApi } from '@/features/player/court/api'
import { getSessionSkillLabel } from '@/lib/skillAssessment'
import { NextSessionCard } from '@/components/sessions/NextSessionCard'
import { formatRelativeDate } from '@/utils/formatters'
import { useRoleSwitcher } from '@/lib/useRoleSwitcher'
import { DashboardStatsStrip, buildDashboardStats } from '@/components/dashboard/DashboardStatsStrip'
import { BrandedFooter } from '@/components/design/BrandedFooter'

export default function HostDashboardScreen() {
  const theme = useAppTheme()
  const { userId, isLoading: authLoading } = useAuth()
  const { onOpenSession } = useSessionNav()
  const { onOpenProfile, onCreateSession } = useAppNav()
  const insets = useSafeAreaInsets()
  const isWeb = Platform.OS === 'web'
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>('upcoming')
  const [court, setCourt] = useState<any>(null)
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const { switchToPlayer } = useRoleSwitcher()

  const parseRobustDate = (d: any) => {
    let str = String(d).trim()
    // Remove leading non-digits (e.g., "Thứ Sáu, 08/05/2026" -> "08/05/2026")
    str = str.replace(/^[^\d]+/, '')
    
    // Try ISO first
    let t = new Date(str).getTime()
    if (!isNaN(t)) return t

    // Try Vietnamese/Custom DD/MM/YYYY
    str = str.replace(/\//g, '-')
    const dateMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(.*)/)
    if (dateMatch) {
      str = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}${dateMatch[4]}`
      str = str.replace(' ', 'T')
      t = new Date(str).getTime()
      if (!isNaN(t)) return t
    }
    
    return 0
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/host/login')
  }

  async function handleSwitchToPlayer() {
    await switchToPlayer()
  }

  const fetchHostData = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)

    try {
      // 0. Fetch Host Profile
      const { data: profileData } = await supabase
        .from('players')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      
      if (profileData) setProfile(profileData)

      // Host dashboard now focused strictly on sessions organized by this user
      setCourt(null)

      // 2. Fetch sessions using RPC for better reliability
      console.log('[HostDashboard] Fetching sessions via RPC for userId:', userId)
      const { data: mySessionsData, error: sessionErr } = await supabase.rpc('get_my_sessions_overview')
      
      if (sessionErr) throw sessionErr

      // Filter only those where we are the host
      const hostSessions = (mySessionsData ?? []).filter((s: any) => s.role === 'host')
      
      console.log('[HostDashboard] Found host sessions count:', hostSessions.length)
      
      // Need to fetch full detail for these sessions (slot, court, session_players)
      // or map the RPC data if it's sufficient. 
      // The RPC returns basic info, we need the join for the UI.
      if (hostSessions.length > 0) {
        const sessionIds = hostSessions.map((s: any) => s.id)
        const { data: fullSessions, error: fullErr } = await supabase
          .from('sessions')
          .select(`
            *,
            owner_sessions(sub_court_numbers, format_type),
            slot:slot_id(
              start_time, end_time,
              court:court_id(*)
            ),
            session_players!session_id(player_id, status)
          `)
          .in('id', sessionIds)
          .order('created_at', { ascending: false })
          
        if (fullErr) throw fullErr
        setSessions(fullSessions || [])
      } else {
        setSessions([])
      }
    } catch (err) {
      console.error('Error fetching host dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useFocusEffect(
    useCallback(() => {
      if (authLoading) return
      fetchHostData()
    }, [authLoading, fetchHostData])
  )
  const upcomingFiltered = sessions.filter(s => {
    const startTs = parseRobustDate(s.slot?.start_time)
    const endTs = parseRobustDate(s.slot?.end_time)
    const now = Date.now()
    const isWayPastStart = startTs > 0 && (now - startTs) > (12 * 3600000)
    const isPastTime = endTs > 0 && endTs <= now
    const confirmedCount = s.session_players?.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length || 0
    const minPlayers = s.min_players || 2
    const isAfterEnd = isPastTime || isWayPastStart
    const isInvalidPlayerCount = !s.is_unlimited && confirmedCount < minPlayers && isAfterEnd
    const isPastStatus = ['completed', 'finished', 'archived', 'done', 'cancelled', 'pending_results', 'pending_completion', 'failed_to_fill', 'cancelled_no_players'].includes(s.status)
    const isPast = isPastTime || isPastStatus || isWayPastStart || isInvalidPlayerCount
    return !isPast
  }).sort((a, b) => parseRobustDate(a.slot?.start_time) - parseRobustDate(b.slot?.start_time))

  const nextSession = upcomingFiltered[0]
  const nextSessionId = nextSession?.id

  const handleShareSession = async (session: any) => {
    try {
      const startTime = session.slot?.start_time ? formatDate(new Date(session.slot.start_time), 'HH:mm - dd/MM') : ''
      const courtName = court?.name || 'Pickleball Court'
      const message = `Tham gia kèo Pickleball tại ${courtName}!\n⏰ Thời gian: ${startTime}\n📍 Địa điểm: ${court?.address}\n\nTải ứng dụng PickleMatch để đăng ký ngay!`
      
      await Share.share({
        message,
        title: 'Chia sẻ kèo Pickleball'
      })
    } catch (error) {
      console.error('Error sharing session:', error)
    }
  }

  const renderSessionCard = (session: any) => {
    const startTimestamp = parseRobustDate(session.slot?.start_time)
    const endTimestamp = parseRobustDate(session.slot?.end_time)
    const now = Date.now()
    
    const start = new Date(startTimestamp)
    const end = new Date(endTimestamp)
    
    const confirmedCount = session.session_players?.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length || 0
    const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
    const minPlayers = session.min_players || 2
    const pricePerPerson = session.total_cost > 0 ? `${Math.round(session.total_cost / 1000)}K` : 'Miễn phí'
    
    const isWayPastStart = startTimestamp > 0 && (now - startTimestamp) > (12 * 3600000)
    const isPastEnd = (endTimestamp > 0 && endTimestamp <= now) || isWayPastStart
    const isInvalidPlayerCount = !session.is_unlimited && confirmedCount < minPlayers && isPastEnd
    
    const isPlaying = session.status === 'playing' && !isPastEnd
    const isCancelled = session.status === 'cancelled' || session.status === 'cancelled_no_players' || session.status === 'failed_to_fill' || isInvalidPlayerCount
    const isCompleted = ['completed', 'finished', 'archived', 'done', 'pending_results', 'pending_completion'].includes(session.status) || (isPastEnd && !isCancelled)
    const isDone = isCompleted || isCancelled
    
    // Format variables for rendering (restoring original context)
    const ownerSessions = session.owner_sessions
    const ownerDetails = Array.isArray(ownerSessions) ? (ownerSessions[0] || {}) : (ownerSessions || {})
    const formatType = ownerDetails.format_type || session.format_type || 'social'
    const subCourts = ownerDetails.sub_court_numbers || session.sub_court_numbers || []
    
    // Skill Level Labels
    const skillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)

    // Day Badge Logic
    const dateLabel = formatRelativeDate(start)
    let dayBadgeBg = theme.outline
    if (dateLabel === 'Hôm nay') dayBadgeBg = theme.primary
    else if (dateLabel === 'Ngày mai') dayBadgeBg = theme.onSurfaceVariant

    // Enhanced Color System
    const COLORS = {
      teal: '#0F6E56',
      darkTeal: '#064E3B',
      amber: '#D97706',
      coral: '#D85A30',
      gray: '#6B7280'
    }

    const fillRatio = confirmedCount / maxPlayers
    const isFull = fillRatio >= 1
    const isUnderfilled = fillRatio < 0.6 && !isDone && !isPlaying && !isCancelled

    let statusLabel = 'ĐANG MỞ'
    let statusBg = COLORS.teal
    
    if (isPlaying) {
      statusLabel = 'THI ĐẤU'
      statusBg = COLORS.darkTeal
    } else if (isCancelled) {
      statusLabel = 'ĐÃ HỦY'
      statusBg = COLORS.gray
    } else if (isDone) {
      statusLabel = 'KẾT THÚC'
      statusBg = COLORS.gray
    } else if (isFull) {
      statusLabel = 'ĐÃ ĐẦY'
      statusBg = COLORS.amber
    } else if (isUnderfilled) {
      statusLabel = 'CẦN THÊM NGƯỜI'
      statusBg = COLORS.coral
    }

    const statusColor = statusBg

    return (
      <TouchableOpacity
        key={session.id}
        onPress={() => onOpenSession(session.id)}
        style={{
          backgroundColor: theme.surface,
          borderRadius: RADIUS.lg,
          marginBottom: 12,
          overflow: 'hidden',
          borderWidth: BORDER.hairline,
          borderColor: theme.outlineVariant,
          ...LAYOUT_SHADOW.sm
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
            <View style={{ 
              width: 6, 
              height: 6, 
              borderRadius: 3, 
              backgroundColor: 'white' 
            }} />
            <Text style={{ 
              color: 'white', 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 12, 
              letterSpacing: 1,
              fontWeight: '700'
            }}>
              {statusLabel}
            </Text>
          </View>

          {subCourts.length > 0 && (
            <Text style={{ 
              color: 'white', 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 12, 
              letterSpacing: 1,
              fontWeight: '700',
              opacity: 0.95
            }}>
              {`SÂN ${subCourts.join(', ')}`}
            </Text>
          )}
        </View>

        <View style={{ paddingHorizontal: 14, paddingTop: 9, paddingBottom: 8 }}>
          {/* Title Row: Court Name as Primary Title */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 20, 
                color: theme.onSurface, 
                textTransform: 'uppercase',
                lineHeight: 24
              }} numberOfLines={1}>
                {session.title || (formatType === 'round_robin' ? 'Round Robin' : (formatType === 'open_play' ? 'Open Play' : 'Giao lưu Social'))}
              </Text>
              
              <Text style={{ 
                fontFamily: SCREEN_FONTS.body, 
                fontSize: 12, 
                color: theme.onSurfaceVariant,
                marginTop: 2,
                letterSpacing: 0.3
              }}>
                {session.slot?.court?.name || 'KÈO PICKLEBALL'}
              </Text>
            </View>
            
            <View style={{ alignItems: 'flex-end', marginLeft: 12, paddingTop: 2 }}>
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 20, 
                color: theme.onSurface 
              }}>
                {pricePerPerson}
              </Text>
              {session.total_cost > 0 && (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.onSurfaceVariant, marginTop: -3 }}>/người</Text>
              )}
            </View>
          </View>

          <View style={{ 
            flexDirection: 'row', 
            alignItems: 'center', 
            marginBottom: 6,
            marginTop: 8
          }}>
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
              <View style={{ backgroundColor: isDone ? theme.outlineVariant : '#E1F5EE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: isDone ? theme.outlineVariant : '#0F6E5630' }}>
                <Text style={{ color: isDone ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NAM</Text>
                <Text style={{ color: isDone ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                  {(skillLabel || '').split('/')[0]?.replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/g, '').trim()}
                </Text>
              </View>
              <View style={{ backgroundColor: isDone ? theme.outlineVariant : '#FAECE7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: isDone ? theme.outlineVariant : '#993C1D30' }}>
                <Text style={{ color: isDone ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>NỮ</Text>
                <Text style={{ color: isDone ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>
                  {((skillLabel || '').split('/')[1] || skillLabel || '').replace('♀', '').replace(/\(Nữ\)|\(nữ\)|Trình|trình/g, '').trim()}
                </Text>
              </View>
            </View>
          </View>

          {/* Urgent Add-Guest Alert */}
          {(() => {
            const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
            const remaining = maxPlayers - confirmedCount
            const timeDiff = start.getTime() - Date.now()
            const minutesUntilStart = timeDiff / (1000 * 60)
            const isUrgentTime = minutesUntilStart > 0 && minutesUntilStart <= 90
            const isUnderfilled = remaining > 0

            if (isUrgentTime && isUnderfilled && !isDone) {
              return (
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  gap: 6, 
                  marginTop: 2,
                  marginBottom: 6,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  backgroundColor: '#fff7ed',
                  borderRadius: 6
                }}>
                  <UserPlus size={14} color="#d97706" />
                  <Text style={{ 
                    flex: 1,
                    fontFamily: SCREEN_FONTS.medium, 
                    fontSize: 11, 
                    color: '#d97706',
                    lineHeight: 14,
                    fontStyle: 'italic'
                  }}>
                    Sắp bắt đầu, thiếu {remaining} người. Thêm khách ngay?
                  </Text>
                  <ArrowUpRight size={14} color="#d97706" />
                </View>
              )
            }
            return null
          })()}
        </View>

        {/* Footer Section: Compact Player Capacity & Detail Button */}
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
          {(() => {
            const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
            const remaining = maxPlayers - confirmedCount
            const isFull = remaining <= 0
            const isUrgent = confirmedCount < maxPlayers / 2 && !isFull
            
            const statusColor = isFull 
              ? theme.successText 
              : (isUrgent ? '#d97706' : theme.primary)

            return (
              <>
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
                              backgroundColor: isActive ? statusColor : theme.outlineVariant,
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
                  onPress={() => onOpenSession(session.id)}
                  style={{ 
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: statusColor + '10', // Tint matching top strip
                    paddingHorizontal: 10, 
                    paddingVertical: 5, 
                    borderRadius: 20,
                    gap: 2
                  }}
                >
                  <Text style={{ 
                    color: statusColor, 
                    fontFamily: SCREEN_FONTS.headline, 
                    fontSize: 10,
                    textTransform: 'uppercase'
                  }}>
                    Chi tiết
                  </Text>
                  <ChevronRight size={12} color={statusColor} />
                </TouchableOpacity>
              </>
            )
          })()}
        </View>
      </TouchableOpacity>
    )
  }

  // Calculate performance metrics
  const completedSessions = sessions.filter(s => 
    ['completed', 'finished', 'archived', 'done'].includes(s.status)
  )
  
  // Calculate total unique confirmed players
  const confirmedPlayers = new Set()
  sessions.forEach(s => {
    s.session_players?.forEach((p: any) => {
      if (p.status === 'confirmed' || p.status === 'checked_in') {
        confirmedPlayers.add(p.player_id)
      }
    })
  })
  
  const stats = {
    hostedCount: sessions.length,
    fillRate: sessions.length > 0 
      ? (sessions.reduce((acc, s) => acc + (s.confirmed_count || 0), 0) / 
         sessions.reduce((acc, s) => acc + (s.max_players || 1), 0)) * 100
      : 0,
    rating: profile?.rating ?? 4.8,
    totalPlayers: confirmedPlayers.size
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" />
      
      <ScrollView 
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100, overflow: 'visible' }}
      >
        <View style={{ backgroundColor: '#FDFBF7', zIndex: 10 }}>
          <HomeGreetingHeader 
            name={profile?.name ?? 'Host'} 
            role="host"
            onRoleChange={() => switchToPlayer()}
            profilePhotoUrl={profile?.avatar_url}
            onPhotoPress={onOpenProfile}
            rating={4.8}
            sessionCount={sessions.length}
          />
          <WebContainer>
            <DashboardStatsStrip 
              items={buildDashboardStats(stats)} 
            />
          </WebContainer>
        </View>

        <WebContainer>
          <View style={{ height: 20 }} />          {/* Performance Overview Card */}
          {(() => {
            const upcomingSessions = sessions.filter(s => {
              const endTime = s.slot?.end_time ? new Date(s.slot.end_time).getTime() : 0
              const now = Date.now()
              const isPastTime = endTime > 0 && endTime < now
              const isPastStatus = ['completed', 'finished', 'archived', 'done', 'cancelled'].includes(s.status)
              return !(isPastTime || isPastStatus)
            })
            
            if (upcomingSessions.length === 0) return null

            const totalConfirmed = upcomingSessions.reduce((acc, s) => acc + (s.confirmed_count || 0), 0)
            const totalMax = upcomingSessions.reduce((acc, s) => acc + (s.max_players || 0), 0)
            const fillPercentage = totalMax > 0 ? (totalConfirmed / totalMax) * 100 : 0
            
            const barColor = fillPercentage < 60 ? '#D85A30' : (fillPercentage >= 100 ? '#D97706' : '#0F6E56')

            return (
              <View style={{ 
                marginTop: 16,
                paddingHorizontal: 24,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <MaterialCommunityIcons name="trending-up" size={22} color={barColor} />
                    <View>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurface }}>
                        Tỉ lệ lấp đầy
                      </Text>
                    </View>
                  </View>

                  {/* Segmented Performance Bar (Roundash) */}
                  <View style={{ flex: 1, flexDirection: 'row', gap: 3, height: 6 }}>
                    {(() => {
                      const displayMax = 8
                      const segments = []
                      const barColor = fillPercentage < 60 ? '#D85A30' : (fillPercentage >= 100 ? '#D97706' : '#0F6E56')
                      
                      for (let i = 0; i < displayMax; i++) {
                        const isActive = (i / displayMax) * 100 < fillPercentage
                        segments.push(
                          <View 
                            key={i} 
                            style={{ 
                              flex: 1, 
                              height: '100%', 
                              borderRadius: 4, 
                              backgroundColor: isActive ? barColor : '#F1EFE9',
                              opacity: isActive ? 1 : 0.5
                            }} 
                          />
                        )
                      }
                      return segments
                    })()}
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 16, color: barColor }}>
                      {Math.round(fillPercentage)}%
                    </Text>
                  </View>
                </View>
              </View>
            )
          })()}
      {/* Pill Tab Selector */}
      <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
        <View style={{ 
          flexDirection: 'row', 
          backgroundColor: theme.surfaceContainerHighest, 
          borderRadius: RADIUS.lg, 
          padding: 4,
          gap: 4
        }}>
          {(() => {
            const upcomingCount = sessions.filter(s => {
              const isPast = s.status === 'completed' || s.status === 'finished' || s.status === 'archived' || s.status === 'done'
              return !isPast
            }).length
            
            const historyCount = sessions.length - upcomingCount

            return [
              { id: 'upcoming', label: 'SẮP TỚI' },
              { id: 'history', label: 'LỊCH SỬ' }
            ].map((tab) => (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id as any)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 10,
                  borderRadius: RADIUS.md,
                  backgroundColor: activeTab === tab.id ? theme.surface : 'transparent',
                  ... (activeTab === tab.id ? LAYOUT_SHADOW.xs : {})
                }}
              >
                <Text style={{
                  fontFamily: SCREEN_FONTS.headlineBlack,
                  fontSize: 14,
                  color: activeTab === tab.id ? theme.primary : theme.onSurfaceVariant,
                  letterSpacing: 0.5
                }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))
          })()}
        </View>
      </View>

      {/* Content */}
      <View style={{ paddingVertical: 24, paddingTop: 10 }}>
        {activeTab === 'upcoming' && nextSession && (
          <View style={{ marginBottom: 12, paddingHorizontal: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 14, 
                color: theme.primary, 
                letterSpacing: 1,
                textTransform: 'uppercase'
              }}>
                KÈO TIẾP THEO
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.primary, opacity: 0.2 }} />
            </View>
            
            <NextSessionCard 
              session={nextSession}
              isHost={true}
              onPress={(id) => onOpenSession(id)}
            />
          </View>
        )}
        
        <View style={{ paddingHorizontal: 24 }}>
          {loading ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
        ) : sessions.length > 0 ? (
          (() => {
            const filteredSessions = sessions.filter(s => {
              const startTs = parseRobustDate(s.slot?.start_time)
              const endTs = parseRobustDate(s.slot?.end_time)
              const now = Date.now()
              
              const isWayPastStart = startTs > 0 && (now - startTs) > (12 * 3600000)
              const isPastTime = endTs > 0 && endTs <= now
              
              const confirmedCount = s.session_players?.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length || 0
              const minPlayers = s.min_players || 2
              const isAfterEnd = isPastTime || isWayPastStart
              const isInvalidPlayerCount = !s.is_unlimited && confirmedCount < minPlayers && isAfterEnd
              
              const isPastStatus = [
                'completed', 'finished', 'archived', 'done', 'cancelled', 
                'pending_results', 'pending_completion', 'failed_to_fill', 
                'cancelled_no_players'
              ].includes(s.status)
              
              const isPast = isPastTime || isPastStatus || isWayPastStart || isInvalidPlayerCount
              
              // Exclude the nextSession if it's currently highlighted in upcoming tab
              if (activeTab === 'upcoming' && s.id === nextSessionId) return false
              
              return activeTab === 'upcoming' ? !isPast : isPast
            })
            
            if (filteredSessions.length === 0) {
              return (
                <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 40 }}>
                  <Text style={{ 
                    fontFamily: SCREEN_FONTS.medium, 
                    color: theme.onSurfaceVariant, 
                    textAlign: 'center',
                    lineHeight: 20
                  }}>
                    {activeTab === 'upcoming' 
                      ? (nextSessionId 
                          ? 'Bạn đã xem hết danh sách kèo sắp tới.\nTiếp tục tạo thêm kèo mới nhé!' 
                          : 'Chưa có kèo nào sắp diễn ra.\nTạo kèo mới để bắt đầu ngay!')
                      : 'Chưa có dữ liệu kèo trong lịch sử.'}
                  </Text>
                </View>
              )
            }

            // Sort chronologically
            filteredSessions.sort((a, b) => {
              const timeA = parseRobustDate(a.slot?.start_time)
              const timeB = parseRobustDate(b.slot?.start_time)
              return activeTab === 'upcoming' ? timeA - timeB : timeB - timeA
            })

            if (activeTab === 'history') {
              // Group by month
              const monthGroups: Record<string, any[]> = {}
              filteredSessions.forEach(s => {
                const date = new Date(s.slot?.start_time || 0)
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
                if (!monthGroups[monthKey]) monthGroups[monthKey] = []
                monthGroups[monthKey].push(s)
              })

              const sortedMonthKeys = Object.keys(monthGroups).sort((a, b) => b.localeCompare(a))

              return (
                <View>
                  {sortedMonthKeys.map((monthKey) => {
                    const [year, month] = monthKey.split('-')
                    const monthLabel = `THÁNG ${month}/${year}`
                    const groupSessions = monthGroups[monthKey]

                    return (
                      <View key={monthKey} style={{ marginBottom: 24 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>
                          <Text style={{ 
                            fontFamily: SCREEN_FONTS.headline, 
                            fontSize: 14, 
                            color: theme.onSurfaceVariant, 
                            letterSpacing: 1,
                            textTransform: 'uppercase'
                          }}>
                            {monthLabel}
                          </Text>
                          <View style={{ flex: 1, height: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
                          <Text style={{ 
                            fontFamily: SCREEN_FONTS.label, 
                            fontSize: 11, 
                            color: theme.outline,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5
                          }}>
                            {groupSessions.length} trận
                          </Text>
                        </View>
                        <View style={{ gap: 4 }}>
                          {groupSessions.map(renderSessionCard)}
                        </View>
                      </View>
                    )
                  })}
                </View>
              )
            }

            // Grouping for Upcoming
            const now = new Date()
            const todayStr = formatDate(now, 'yyyy-MM-dd')
            const tomorrow = new Date(now)
            tomorrow.setDate(now.getDate() + 1)
            const tomorrowStr = formatDate(tomorrow, 'yyyy-MM-dd')

            const todaySessions: any[] = []
            const tomorrowSessions: any[] = []
            const laterSessions: any[] = []

            filteredSessions.forEach(s => {
              const startTs = parseRobustDate(s.slot?.start_time)
              const sDate = new Date(startTs || 0)
              const sDateStr = formatDate(sDate, 'yyyy-MM-dd')
              
              if (sDateStr === todayStr) todaySessions.push(s)
              else if (sDateStr === tomorrowStr) tomorrowSessions.push(s)
              else laterSessions.push(s)
            })

            const renderSection = (title: string, data: any[], isLast = false) => {
              if (data.length === 0) return null
              return (
                <View key={title} style={{ marginBottom: isLast ? 0 : 24 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, 
                      fontSize: 14, 
                      color: theme.onSurfaceVariant, 
                      letterSpacing: 1,
                      textTransform: 'uppercase'
                    }}>
                      {title}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
                  </View>
                  <View style={{ gap: 8 }}>
                    {data.map(renderSessionCard)}
                  </View>
                </View>
              )
            }

            return (
              <View>
                {renderSection('Hôm nay', todaySessions)}
                {renderSection('Ngày mai', tomorrowSessions)}
                {renderSection('Sắp tới', laterSessions, true)}
              </View>
            )
          })()
        ) : (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <View style={{ width: 80, height: 80, borderRadius: RADIUS.full, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Calendar size={32} color={theme.outline} />
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>Chưa có kèo nào</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}>Nhấn nút '+' để tạo kèo mới.</Text>
          </View>
        )}
        </View>
      </View>
    </WebContainer>
        <BrandedFooter />
      </ScrollView>
    </View>
  )
}
