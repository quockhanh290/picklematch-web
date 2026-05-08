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
  ArrowUpRight
} from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { StatusBar } from 'expo-status-bar'
import { MainHeader } from '@/components/design/MainHeader'
import { useState, useEffect, useCallback } from 'react'
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
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { format as formatDate } from 'date-fns'
import { vi } from 'date-fns/locale'

import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppNav } from '@/lib/navigation/AppNavContext'
import { fetchCourtDetailApi } from '@/features/player/court/api'
import { getSessionSkillLabel } from '@/lib/skillAssessment'
import { formatRelativeDate } from '@/utils/formatters'
import { useRoleSwitcher } from '@/lib/useRoleSwitcher'

export default function HostDashboardScreen() {
  const theme = useAppTheme()
  const { userId, isLoading: authLoading } = useAuth()
  const { onOpenSession } = useSessionNav()
  const { onOpenProfile, onCreateSession } = useAppNav()
  const insets = useSafeAreaInsets()
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>('upcoming')
  const [court, setCourt] = useState<any>(null)
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const { switchToPlayer } = useRoleSwitcher()

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
      // Host dashboard now focused strictly on sessions organized by this user
      setCourt(null)

      // 2. Fetch sessions created by THIS Host
      const { data: hostSessionData, error: sessionErr } = await supabase
        .from('owner_sessions')
        .select(`
          *,
          session:id (
            *,
            slot:slot_id(
              start_time, end_time,
              court:court_id(*)
            ),
            session_players!session_id(player_id, status)
          )
        `)
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      
      if (sessionErr) throw sessionErr

      if (hostSessionData) {
        const flattened = hostSessionData.map(os => ({
          ...(os.session || {}),
          ...os,
          id: os.id,
          status: os.session?.status || 'open'
        }))
        setSessions(flattened)
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
    const start = session.slot?.start_time ? new Date(session.slot.start_time) : new Date()
    const end = session.slot?.end_time ? new Date(session.slot.end_time) : new Date()
    const formatType = session.format_type || 'social'
    const subCourts = session.sub_court_numbers || []
    const isPlaying = session.status === 'playing'
    const isCompleted = session.status === 'completed' || session.status === 'finished' || session.status === 'archived'
    const isDone = isCompleted || session.status === 'done'
    
    // Skill Level Labels
    const skillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)
    const confirmedCount = session.session_players?.filter((p: any) => p.status === 'confirmed').length || 0
    const pricePerPerson = session.total_cost > 0 ? `${Math.round(session.total_cost / 1000)}K` : 'Miễn phí'

    // Day Badge Logic
    const dateLabel = formatRelativeDate(start)
    let dayBadgeBg = theme.outline
    if (dateLabel === 'Hôm nay') dayBadgeBg = theme.primary
    else if (dateLabel === 'Ngày mai') dayBadgeBg = theme.onSurfaceVariant

    // Status Chip Logic
    let statusLabel = 'ĐANG MỞ'
    let statusBg = theme.primaryContainer
    let statusText = theme.primary
    if (isPlaying) {
      statusLabel = 'THI ĐẤU'
      statusBg = '#fef3c7'
      statusText = '#b45309'
    } else if (isDone) {
      statusLabel = 'KẾT THÚC'
      statusBg = theme.surfaceContainerHighest
      statusText = theme.onSurfaceVariant
    }

    const formatLabel = formatType === 'round_robin' ? 'ROUND ROBIN' : 'SOCIAL PLAY'

    // We check both session.owner_id and our stored userId for maximum accuracy
    const hostId = session.owner_id || session.owner_id || userId
    const nonHostConfirmedCount = session.session_players?.filter((p: any) => 
      p.status === 'confirmed' && p.player_id !== hostId
    ).length || 0
    
    const isEmpty = nonHostConfirmedCount === 0 && !isDone
    const alertColor = theme.rescueAccent || '#D85A30' // Using system rescueAccent for coral alerts

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
          backgroundColor: isEmpty ? alertColor : theme.primary, 
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
              backgroundColor: statusLabel === 'THI ĐẤU' ? '#FF4B4B' : 'white' 
            }} />
            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 9.5, letterSpacing: 0.5 }}>
              {isEmpty ? 'CHƯA CÓ NGƯỜI' : statusLabel}
            </Text>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(subCourts.length > 0 ? subCourts : [1]).map((num: number) => (
              <View key={num} style={{ backgroundColor: 'transparent', paddingHorizontal: 7, paddingVertical: 1, borderRadius: 5 }}>
                <Text style={{ fontSize: 9, fontFamily: SCREEN_FONTS.bold, color: 'white' }}>SÂN {num}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 14, paddingTop: 9, paddingBottom: 8 }}>
          {/* Title Row */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ 
              flex: 1,
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 20, 
              color: theme.onSurface, 
              textTransform: 'uppercase',
            }}>
              {session.title || (formatType === 'round_robin' ? 'GIẢI ROUND ROBIN' : 'KÈO GIAO LƯU SOCIAL')}
            </Text>
            
            <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 20, 
                color: session.total_cost <= 0 ? theme.primary : theme.onSurface 
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
            marginBottom: 6
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
              {session.slot?.court?.name && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                  <MapPin size={12} color={theme.onSurfaceVariant} />
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant }} numberOfLines={1}>
                    {session.slot.court.name}
                  </Text>
                </View>
              )}
            </View>
            
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ backgroundColor: isDone ? theme.outlineVariant : '#E1F5EE', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: isDone ? theme.outlineVariant : '#0F6E5630' }}>
                <Text style={{ color: isDone ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 10 }}>NAM</Text>
                <Text style={{ color: isDone ? theme.outline : '#0F6E56', fontFamily: SCREEN_FONTS.headline, fontSize: 10 }}>
                  {skillLabel.split('/')[0].replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/g, '').trim()}
                </Text>
              </View>
              <View style={{ backgroundColor: isDone ? theme.outlineVariant : '#FAECE7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: isDone ? theme.outlineVariant : '#993C1D30' }}>
                <Text style={{ color: isDone ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 10 }}>NỮ</Text>
                <Text style={{ color: isDone ? theme.outline : '#993C1D', fontFamily: SCREEN_FONTS.headline, fontSize: 10 }}>
                  {(skillLabel.split('/')[1] || skillLabel).replace('♀', '').replace(/\(Nữ\)|\(nữ\)|Trình|trình/g, '').trim()}
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

        {/* Footer Section: Player Capacity */}
        <View style={{ 
          paddingHorizontal: 14, 
          paddingTop: 8,
          paddingBottom: 4,
          backgroundColor: theme.surfaceAlt
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {(() => {
              const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
              const remaining = maxPlayers - confirmedCount
              const isFull = remaining <= 0
              const isUrgent = confirmedCount < maxPlayers / 2 && !isFull
              
              const statusColor = isFull 
                ? theme.successText 
                : (isUrgent ? '#d97706' : theme.primary) // Amber-600 for urgent
              
              const statusText = isFull ? 'Đã đầy' : `Còn trống ${remaining}`

              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Users size={14} color={statusColor} />
                    <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>
                      {confirmedCount}/{session.is_unlimited ? '∞' : session.max_players} người
                    </Text>
                  </View>

                  {/* Segmented Progress Bar (Enhanced) */}
                  <View style={{ flexDirection: 'row', gap: 3, height: 6, width: 130 }}>
                    {(() => {
                      const displayMax = Math.min(maxPlayers, 20)
                      const segments = []
                      for (let i = 0; i < displayMax; i++) {
                        const isActive = i < confirmedCount
                        segments.push(
                          <View 
                            key={i} 
                            style={{ 
                              flex: 1, 
                              height: '100%', 
                              borderRadius: 3, 
                              backgroundColor: isActive ? statusColor : theme.outlineVariant,
                              opacity: isActive ? 1 : 0.4
                            }} 
                          />
                        )
                      }
                      return segments
                    })()}
                  </View>
                </>
              )
            })()}
          </View>
        </View>

        {/* CTA Section */}
        <View style={{ paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2, backgroundColor: theme.surfaceAlt, flexDirection: 'row', gap: 10 }}>
          <View style={{ 
            flex: 1,
            backgroundColor: 'transparent', 
            paddingVertical: 10, 
            borderRadius: 10, 
            flexDirection: 'row',
            alignItems: 'center', 
            justifyContent: 'center',
            gap: 6,
            borderWidth: 1,
            borderColor: isDone ? theme.outlineVariant : (isEmpty ? alertColor : theme.primary),
            ...LAYOUT_SHADOW.xs
          }}>
            {isDone ? (
              <Activity size={16} color={theme.onSurfaceVariant} />
            ) : (
              <LayoutGrid size={16} color={isEmpty ? alertColor : theme.primary} />
            )}
            <Text style={{ 
              color: isDone ? theme.onSurfaceVariant : (isEmpty ? alertColor : theme.primary), 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 13, 
              letterSpacing: 0.5 
            }}>
              {isDone ? 'CHI TIẾT' : 'QUẢN LÝ'}
            </Text>
          </View>
          
          <TouchableOpacity 
            onPress={() => handleShareSession(session)}
            style={{
              width: 38,
              height: 38,
              backgroundColor: theme.surface,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              ...LAYOUT_SHADOW.xs
            }}
          >
            <Share2 size={18} color={isDone ? theme.onSurfaceVariant : (isEmpty ? alertColor : theme.primary)} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" />
      
      <MainHeader 
        title="Quản lý trận đấu"
        brandedSubtitle="PICKLEMATCH"
        rightElement={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity 
              onPress={handleSwitchToPlayer}
              style={{ 
                height: 40, 
                borderRadius: 12, 
                backgroundColor: theme.secondaryContainer, 
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center', 
                justifyContent: 'center',
                gap: 8,
                borderWidth: BORDER.hairline,
                borderColor: theme.outlineVariant,
                ...LAYOUT_SHADOW.xs
              }}
            >
              <RotateCcw size={16} color={theme.primary} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: theme.primary }}>PLAYER</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => router.push('/host/settings')}
              style={{ 
                width: 40, 
                height: 40, 
                borderRadius: 12, 
                backgroundColor: theme.surface, 
                alignItems: 'center', 
                justifyContent: 'center',
                borderWidth: BORDER.hairline,
                borderColor: theme.outlineVariant,
                ...LAYOUT_SHADOW.xs
              }}
            >
              <Settings size={18} color={theme.primary} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={handleLogout}
              style={{ 
                width: 40, 
                height: 40, 
                borderRadius: 12, 
                backgroundColor: theme.surface, 
                alignItems: 'center', 
                justifyContent: 'center',
                borderWidth: BORDER.hairline,
                borderColor: theme.error + '30',
                ...LAYOUT_SHADOW.xs
              }}
            >
              <LogOut size={18} color={theme.error} />
            </TouchableOpacity>
          </View>
        }
        style={{ paddingBottom: 8 }}
      />

      <ScrollView 
        stickyHeaderIndices={[2]} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Hero Card: Court Info (Applying Player Upcoming Card Design) */}
      <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
        <View style={{ 
          backgroundColor: theme.primary, 
          borderRadius: 16, 
          overflow: 'hidden', 
          ...LAYOUT_SHADOW.md 
        }}>
          <LinearGradient
            colors={[theme.heroGradientStart, theme.primary]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 16, position: 'relative' }}
          >
            {/* Main Content Row: Court Info */}
            <View style={{ marginBottom: 10 }}>
              <Text 
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ 
                  color: theme.onPrimary, 
                  fontFamily: AppFontSet.headline, 
                  fontSize: 26, 
                  lineHeight: 28, 
                  textTransform: 'uppercase' 
                }}
              >
                {court?.name || 'HỒ SƠ HOST CHUYÊN NGHIỆP'}
              </Text>
            </View>

            {/* Address Row with Rating Pill */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 10 }}>
                <MapPin size={14} color="white" />
                <Text numberOfLines={1} style={{ color: 'white', fontFamily: SCREEN_FONTS.body, fontSize: 13, flex: 1 }}>
                  {court ? [court?.address, court?.district, court?.city].filter(Boolean).join(', ') : 'Sẵn sàng tổ chức kèo tại mọi cụm sân.'}
                </Text>
              </View>

              {court && (
                <View style={{ 
                  backgroundColor: theme.heroPillBg, 
                  borderRadius: 10, 
                  paddingHorizontal: 8, 
                  paddingVertical: 3,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <Star size={10} color="#FFD700" fill="#FFD700" />
                  <Text style={{ color: theme.heroCountdownText, fontFamily: SCREEN_FONTS.bold, fontSize: 12 }}>
                    {court?.rating?.toFixed(1) || '4.1'}
                  </Text>
                </View>
              )}
            </View>

            {/* Hours & Actions Row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Clock size={14} color="white" />
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.body, fontSize: 13 }}>
                  {court ? `${(court?.hours_open || '05:30').slice(0, 5)} - ${(court?.hours_close || '22:00').slice(0, 5)}` : 'Hoạt động tự do'}
                </Text>
              </View>

              {court && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity 
                    onPress={() => router.push(`/host/court-detail/${court?.id}`)}
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      XEM CHI TIẾT
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </LinearGradient>
        </View>
      </View>

      {/* Performance Summary Card - Fine-tuned */}
      <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
        {(() => {
          const upcomingSessions = sessions.filter(s => {
            const isPast = s.status === 'completed' || s.status === 'finished' || s.status === 'archived' || s.status === 'done'
            return !isPast
          })
          
          const openCount = upcomingSessions.length
          let totalConfirmed = 0
          let totalMax = 0
          let urgentCount = 0

          upcomingSessions.forEach(s => {
            const confirmed = s.session_players?.filter((p: any) => p.status === 'confirmed').length || 0
            const max = s.is_unlimited ? 16 : (s.max_players || 16)
            totalConfirmed += confirmed
            totalMax += max
            if (confirmed < max / 2 && !s.is_unlimited) urgentCount++
          })

          const occupancy = totalMax > 0 ? Math.round((totalConfirmed / totalMax) * 100) : 0
          const amberColor = '#D97706' // Brighter Amber for better UI match

          return (
            <View style={{ 
              backgroundColor: 'white', 
              borderRadius: RADIUS.lg, 
              paddingHorizontal: 14,
              paddingVertical: 10, 
              ...LAYOUT_SHADOW.sm,
              borderWidth: 1,
              borderColor: theme.outlineVariant
            }}>
              {/* Row 1: Status & Percentage */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#16a34a' }} />
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, color: '#1A2B3B' }}>
                    {openCount} kèo đang mở <Text style={{ color: '#6B7280', fontFamily: SCREEN_FONTS.body, fontSize: 13 }}>· {totalConfirmed}/{totalMax}</Text>
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: amberColor, lineHeight: 20 }}>
                  {occupancy}%
                </Text>
              </View>

              {/* Row 2: Progress Bar */}
              <View style={{ height: 3, backgroundColor: '#F3F4F6', borderRadius: 1.5, overflow: 'hidden' }}>
                <View style={{ width: `${occupancy}%`, height: '100%', backgroundColor: amberColor, borderRadius: 1.5 }} />
              </View>

              {/* Row 3: Labels & Warnings */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, alignItems: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: '#6B7280' }}>
                  Lấp đầy trung bình
                </Text>
                {urgentCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={12} color={amberColor} />
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: amberColor }}>
                      {urgentCount} kèo trống
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )
        })()}
      </View>

      {/* Pill Tab Selector */}
      <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
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
      <View style={{ padding: 24, paddingTop: 10 }}>
        {loading ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
        ) : sessions.length > 0 ? (
          (() => {
            const filteredSessions = sessions.filter(s => {
              const isPast = s.status === 'completed' || s.status === 'finished' || s.status === 'archived' || s.status === 'done'
              return activeTab === 'upcoming' ? !isPast : isPast
            })
            
            if (filteredSessions.length === 0) {
              return (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant }}>Không có kèo nào trong mục này.</Text>
                </View>
              )
            }

            // Sort chronologically
            filteredSessions.sort((a, b) => {
              const timeA = new Date(a.slot?.start_time || 0).getTime()
              const timeB = new Date(b.slot?.start_time || 0).getTime()
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
              const sDate = new Date(s.slot?.start_time || 0)
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
    </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={onCreateSession}
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          right: 24,
          width: 64,
          height: 64,
          borderRadius: RADIUS.full,
          backgroundColor: theme.primary,
          alignItems: 'center',
          justifyContent: 'center',
          ...LAYOUT_SHADOW.fab
        }}
      >
        <Plus size={32} color="white" />
      </TouchableOpacity>
    </View>
  )
}
