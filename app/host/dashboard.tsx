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
import { AppLoading } from '@/components/design'
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
  Share,
  Platform
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
import { FeaturedSessionCard, ListSessionCard } from '@/components/sessions/v2/SessionCards'
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
            host:host_id(id, name, avatar_url),
            owner_sessions(sub_court_numbers, format_type),
            slot:slot_id(
              start_time, end_time,
              court:court_id(*)
            ),
            session_players!session_id(player_id, status, player:player_id(name, avatar_url))
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
  // A 'playing' session has already started, so it is neither "upcoming" nor history —
  // it belongs in its own "Đang diễn ra" section. Only recent ones count as in-progress;
  // a 'playing' session left untouched past its end / >12h after start is treated as done
  // (falls through to the past/history filters below via isWayPastStart/isPastTime).
  const inProgressSessions = sessions.filter(s => {
    if (s.status !== 'playing') return false
    const startTs = parseRobustDate(s.slot?.start_time)
    const endTs = parseRobustDate(s.slot?.end_time)
    const now = Date.now()
    const isWayPastStart = startTs > 0 && (now - startTs) > (12 * 3600000)
    const isPastTime = endTs > 0 && endTs <= now
    return !isWayPastStart && !isPastTime
  }).sort((a, b) => parseRobustDate(b.slot?.start_time) - parseRobustDate(a.slot?.start_time))
  const inProgressIds = new Set(inProgressSessions.map(s => s.id))

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
    return !isPast && !inProgressIds.has(s.id)
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
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="host-dashboard-screen">
      <StatusBar style="dark" />
      
      <ScrollView 
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100, overflow: 'visible' }}
      >
        <View style={{ backgroundColor: theme.background, zIndex: 10 }}>
          <HomeGreetingHeader 
            name={profile?.name ?? 'Host'} 
            role="host"
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
            ].map((tab) => {
              const active = activeTab === tab.id
              return (
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
                    backgroundColor: active ? theme.surface : 'transparent',
                    ...(active ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.1,
                      shadowRadius: 2,
                      elevation: 1,
                    } : {})
                  }}
                >
                  <Text style={{
                    fontFamily: SCREEN_FONTS.headlineBlack,
                    fontSize: 13,
                    color: active ? theme.primary : theme.onSurfaceVariant,
                    letterSpacing: 0.5
                  }}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              )
            })
          })()}
        </View>
      </View>

      {/* Content */}
      <View style={{ paddingVertical: 24, paddingTop: 10 }}>
        {activeTab === 'upcoming' && inProgressSessions.length > 0 && (
          <View style={{ marginBottom: 12, paddingHorizontal: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>
              <Text style={{
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                color: theme.tertiary ?? theme.primary,
                letterSpacing: 1,
                textTransform: 'uppercase'
              }}>
                ĐANG DIỄN RA
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.tertiary ?? theme.primary, opacity: 0.2 }} />
            </View>
            <View style={{ gap: 8 }}>
              {inProgressSessions.map(s => (
                <ListSessionCard key={s.id} session={s} isHost={true} onPress={(id) => onOpenSession(id)} />
              ))}
            </View>
          </View>
        )}
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
            
            <FeaturedSessionCard 
              session={nextSession}
              isHost={true}
              onPress={(id) => onOpenSession(id)}
            />
          </View>
        )}
        
        <View style={{ paddingHorizontal: 24 }}>
          {loading ? (
          <AppLoading label="Đang tải dữ liệu..." style={{ flex: 1, marginTop: 40 }} />
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
              
              // In-progress ('playing') sessions live in their own section, not in either tab.
              if (inProgressIds.has(s.id)) return false
              // Exclude the nextSession if it's currently highlighted in upcoming tab
              if (activeTab === 'upcoming' && s.id === nextSessionId) return false

              return activeTab === 'upcoming' ? !isPast : isPast
            })
            
            if (filteredSessions.length === 0) {
              // If we are in upcoming tab and already showing the nextSession at the top, 
              // don't show the empty state box below it.
              if (activeTab === 'upcoming' && nextSessionId) return null
              
              return (
                <View
                  style={{
                    borderRadius: RADIUS.xl,
                    overflow: 'hidden',
                    backgroundColor: 'white',
                    borderWidth: 1,
                    borderColor: theme.outlineVariant,
                    ...LAYOUT_SHADOW.xs,
                    marginTop: 12
                  }}
                >
                  <View style={{ padding: 28, backgroundColor: '#FCFAF7' }}>
                    <Text
                      style={{
                        color: theme.primary,
                        fontFamily: SCREEN_FONTS.cta,
                        fontSize: 10,
                        letterSpacing: 2.2,
                        textTransform: 'uppercase',
                        marginBottom: 16
                      }}
                    >
                      {activeTab === 'upcoming' ? 'QUẢN LÝ KÈO' : 'LỊCH SỬ TỔ CHỨC'}
                    </Text>
                    <Text
                      style={{
                        color: theme.onSurface,
                        fontFamily: SCREEN_FONTS.headline,
                        fontSize: 26,
                        lineHeight: 32,
                        textTransform: 'uppercase',
                        marginBottom: 10
                      }}
                    >
                      {activeTab === 'upcoming' ? 'Chưa có kèo nào sắp diễn ra' : 'Chưa có lịch sử tổ chức'}
                    </Text>
                    <Text
                      style={{
                        color: theme.onSurfaceVariant,
                        fontFamily: SCREEN_FONTS.body,
                        fontSize: 15,
                        lineHeight: 24,
                        maxWidth: '90%'
                      }}
                    >
                      {activeTab === 'upcoming' 
                        ? 'Nhấn nút "Tạo kèo mới" ngay và bắt đầu kêu gọi mọi người tham gia.'
                        : 'Danh sách các kèo bạn đã hoàn thành hoặc đã hủy trong quá khứ sẽ hiển thị tại đây.'
                      }
                    </Text>
                  </View>
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
                          {groupSessions.map(s => <ListSessionCard key={s.id} session={s} isHost={true} onPress={(id) => onOpenSession(id)} />)}
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
                    {data.map(s => <ListSessionCard key={s.id} session={s} isHost={true} onPress={(id) => onOpenSession(id)} />)}
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
          <View
            style={{
              borderRadius: RADIUS.xl,
              overflow: 'hidden',
              backgroundColor: 'white',
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              ...LAYOUT_SHADOW.xs,
              marginTop: 12
            }}
          >
            <View style={{ padding: 28, backgroundColor: '#FCFAF7' }}>
              <Text
                style={{
                  color: theme.primary,
                  fontFamily: SCREEN_FONTS.cta,
                  fontSize: 10,
                  letterSpacing: 2.2,
                  textTransform: 'uppercase',
                  marginBottom: 16
                }}
              >
                {activeTab === 'upcoming' ? 'QUẢN LÝ KÈO' : 'LỊCH SỬ TỔ CHỨC'}
              </Text>
              <Text
                style={{
                  color: theme.onSurface,
                  fontFamily: SCREEN_FONTS.headline,
                  fontSize: 26,
                  lineHeight: 32,
                  textTransform: 'uppercase',
                  marginBottom: 10
                }}
              >
                {activeTab === 'upcoming' ? 'Chưa có kèo nào sắp diễn ra' : 'Chưa có lịch sử tổ chức'}
              </Text>
              <Text
                style={{
                  color: theme.onSurfaceVariant,
                  fontFamily: SCREEN_FONTS.body,
                  fontSize: 15,
                  lineHeight: 24,
                  maxWidth: '90%'
                }}
              >
                {activeTab === 'upcoming' 
                  ? 'Nhấn nút "Tạo kèo mới" ngay và bắt đầu kêu gọi mọi người tham gia.'
                  : 'Danh sách các kèo bạn đã hoàn thành hoặc đã hủy trong quá khứ sẽ hiển thị tại đây.'
                }
              </Text>
            </View>
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
