import { AppButton } from '@/components/design/AppButton'
import { AppDialog, type AppDialogConfig } from '@/components/design/AppDialog'
import { EmptyState } from '@/components/design/EmptyState'
import { ScreenHeader } from '@/components/design/ScreenHeader'
import type { FeedbackTrait } from '@/components/profile/CommunityFeedbackSection'
import CommunityFeedbackPanel from '@/components/profile/CommunityFeedbackSection'
import {
    PROFILE_SKILL_HERO_TONE,
    ProfileSkillHero,
    ProfileWinStreak,
} from '@/components/profile/ProfileSections'
import { SCREEN_FONTS } from '@/constants/typography'
import type { TrophyBadge } from '@/components/profile/TrophyRoom'
import TrophyRoomSection from '@/components/profile/TrophyRoom'
import { getSkillLevelFromPlayer, getEloBandByLevelId } from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { router } from 'expo-router'
import {
    Calendar,
    CircleAlert,
    PencilLine,
    Swords,
    UserCircle,
    ShieldCheck,
    ShieldQuestion,
    MapPin,
    LogOut
} from 'lucide-react-native'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { WebContainer } from '@/components/design/WebContainer'
import { withAlpha } from '@/lib/utils/ui'
import { StatusBar } from 'expo-status-bar'

import type { 
    ProfilePlayer as Player, 
    ProfilePlayerStats as PlayerStats, 
    ProfileSessionHistory as SessionHistory 
} from './types'
import { 
    calculateReliabilityScore, 
    buildCommunityTraits, 
    FEEDBACK_META, 
    getBadgeIcon, 
    getBadgeTone 
} from './utils'
import { 
    fetchCurrentPlayerProfileDataApi, 
    clearCurrentPlayerProfileCacheApi 
} from './api'
import { useRoleSwitcher } from '@/lib/useRoleSwitcher'

function ProfileSectionDivider({ index, title, theme }: { index: string; title: string; theme: any }) {
  return (
    <View className="mb-6 flex-row items-center gap-4">
      <Text className="text-[11px] uppercase tracking-[4px]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>
        {index} / {title}
      </Text>
      <View className="h-px flex-1" style={{ backgroundColor: theme.outlineVariant }} />
    </View>
  )
}

const PROFILE_MOCK_TRAITS: FeedbackTrait[] = [
  {
    key: 'friendly-mock',
    icon: FEEDBACK_META.friendly.icon,
    label: FEEDBACK_META.friendly.label,
    count: '+12 ghi nhận',
    context: FEEDBACK_META.friendly.context,
    tone: 'positive',
  },
  {
    key: 'skilled-mock',
    icon: FEEDBACK_META.skilled.icon,
    label: FEEDBACK_META.skilled.label,
    count: '+9 ghi nhận',
    context: FEEDBACK_META.skilled.context,
    tone: 'positive',
  },
  {
    key: 'on-time-mock',
    icon: FEEDBACK_META.on_time.icon,
    label: FEEDBACK_META.on_time.label,
    count: '+8 ghi nhận',
    context: FEEDBACK_META.on_time.context,
    tone: 'positive',
  },
  {
    key: 'fair-play-mock',
    icon: FEEDBACK_META.fair_play.icon,
    label: FEEDBACK_META.fair_play.label,
    count: '+6 ghi nhận',
    context: FEEDBACK_META.fair_play.context,
    tone: 'positive',
  },
]

const PROFILE_MOCK_BADGES: TrophyBadge[] = [
  {
    key: 'active_member_20',
    title: 'Active Member',
    category: 'progression',
    description: 'Duy trì nhịp chơi đều và xuất hiện thường xuyên trong cộng đồng.',
    requirement: 'Chơi đủ 20 trận',
    icon: getBadgeIcon('graduation-cap'),
    tone: getBadgeTone('progression'),
    earned: true,
    earnedAt: '12/03/2026',
  },
  {
    key: 'golden_host',
    title: 'Golden Host',
    category: 'conduct',
    description: 'Được đánh giá cao ở khả năng giữ nhịp kèo và tổ chức mượt.',
    requirement: 'Chủ kèo được đánh giá 4.9+',
    icon: getBadgeIcon('shield'),
    tone: getBadgeTone('conduct'),
    earned: true,
    earnedAt: '02/04/2026',
  },
]

const _PROFILE_MOCK_HISTORY: SessionHistory[] = [
  {
    id: 'mock-session-1',
    status: 'done',
    is_host: true,
    slot: {
      start_time: '2026-04-12T19:00:00.000Z',
      end_time: '2026-04-12T21:00:00.000Z',
      court: { name: 'Saigon Pickle Dome', city: 'TP.HCM' },
    },
  },
]

export function ProfileScreen() {
  const isWeb = Platform.OS === 'web'
  const insets = useSafeAreaInsets()
  const theme = useAppTheme()
  const [checking, setChecking] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [player, setPlayer] = useState<Player | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [ratingTags, setRatingTags] = useState<Record<string, number>>({})
  const [achievements, setAchievements] = useState<TrophyBadge[]>([])
  const [_history, setHistory] = useState<SessionHistory[]>([])
  const [hostedSessionsCount, setHostedSessionsCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)
  const { switchToHost } = useRoleSwitcher()

  const init = useCallback(async () => {
    setLoading(true)
    const snapshot = await fetchCurrentPlayerProfileDataApi()
    setLoggedIn(snapshot.loggedIn)
    setPlayer(snapshot.player)
    setPlayerStats(snapshot.playerStats)
    setRatingTags(snapshot.ratingTags)
    setAchievements(snapshot.achievements)
    setHistory(snapshot.history)
    setHostedSessionsCount(snapshot.hostedSessionsCount)
    setLoading(false)
    setChecking(false)
  }, [])

  const handleSwitchToHost = async () => {
    if (!player) return

    const confirmRequired = async (): Promise<boolean> => {
      return new Promise((resolve) => {
        setDialogConfig({
          title: 'KÍCH HOẠT CHẾ ĐỘ HOST',
          message: 'Bạn có muốn kích hoạt quyền Chủ sân để bắt đầu tạo kèo và quản lý trận đấu không?',
          actions: [
            { label: 'HỦY', tone: 'secondary', onPress: () => resolve(false) },
            { 
              label: 'KÍCH HOẠT NGAY', 
              onPress: () => resolve(true) 
            },
          ],
        })
      })
    }

    await switchToHost(player.id, !!player.is_host, confirmRequired)
  }

  useEffect(() => {
    void init()
  }, [init])

  async function logout() {
    setDialogConfig({
      title: `${STRINGS.profile.actions.logout}?`,
      message: 'Bạn chắc muốn đăng xuất không?',
      actions: [
        { label: STRINGS.common.back, tone: 'secondary' },
        {
          label: STRINGS.profile.actions.logout,
          tone: 'danger',
          onPress: async () => {
            await supabase.auth.signOut()
            clearCurrentPlayerProfileCacheApi()
            setLoggedIn(false)
            setPlayer(null)
            setPlayerStats(null)
            setRatingTags({})
            setAchievements([])
            setHistory([])
            setHostedSessionsCount(0)
            router.replace('/(tabs)')
          },
        },
      ],
    })
  }

  const communityTraits = useMemo<FeedbackTrait[]>(() => buildCommunityTraits(ratingTags), [ratingTags])

  if (checking) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.backgroundMuted, paddingTop: insets.top }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    )
  }

  if (!loggedIn) {
    return (
      <View className="flex-1" style={{ backgroundColor: theme.backgroundMuted, paddingTop: insets.top }}>
        <ScreenHeader
          compact
          title={STRINGS.profile.title}
        />
        <EmptyState
          icon={<UserCircle size={28} color={theme.outline} />}
          title="Đăng nhập để xem hồ sơ"
          description="Quản lý thông tin cá nhân và lịch sử tham gia kèo của bạn ở một nơi gọn gàng hơn."
        />
        <View className="mt-6 gap-3 px-5">
          <AppButton label="Đăng nhập" onPress={() => router.push('/login' as any)} />
          <AppButton label={STRINGS.common.back} onPress={() => router.replace('/(tabs)')} variant="secondary" />
        </View>
      </View>
    )
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.backgroundMuted, paddingTop: insets.top }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    )
  }

  if (!player) {
    return (
      <View className="flex-1" style={{ backgroundColor: theme.backgroundMuted, paddingTop: insets.top }}>
        <EmptyState
          icon={<CircleAlert size={28} color={theme.outline} />}
          title="Không tìm thấy hồ sơ"
          description="Thử tải lại hoặc đăng nhập lại để tiếp tục."
        />
      </View>
    )
  }

  const skill = getSkillLevelFromPlayer(player)
  let effectiveElo = player.current_elo ?? player.elo ?? 0
  
  if (effectiveElo === 0 && skill) {
    effectiveElo = skill.id === 'level_1' ? 800 : (getEloBandByLevelId(skill.id)?.seedElo ?? 800)
  }
  const reliability = calculateReliabilityScore(player.sessions_joined, player.no_show_count)
  const hostedCount = hostedSessionsCount
  const placementPlayed = player.placement_matches_played ?? 0
  const currentWinStreak = playerStats?.current_win_streak ?? 0
  const streakActive = playerStats?.streak_fire_active ?? currentWinStreak > 0
  const joinedYear = player.created_at ? new Date(player.created_at).getFullYear() : null
  const displayCommunityTraits = communityTraits.length > 0 ? communityTraits : PROFILE_MOCK_TRAITS
  const displayAchievements = achievements.length > 0 ? achievements : PROFILE_MOCK_BADGES

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <ScrollView 
        contentContainerStyle={{ flexGrow: 1 }} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={loading} 
            onRefresh={init} 
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        alwaysBounceVertical={true}
        stickyHeaderIndices={[0]}
      >
        <View />

        <WebContainer maxWidth={600}>
          {/* HERO HEADER */}
          <View style={{ 
            backgroundColor: theme.primary, 
            paddingTop: insets.top + 32,
            paddingBottom: 80,
            paddingHorizontal: 24,
            borderBottomLeftRadius: RADIUS.hero,
            borderBottomRightRadius: RADIUS.hero,
          }}>
            <View className="flex-row items-center justify-between mb-4">
              <View>
                <View style={{ width: 40, height: 4, backgroundColor: 'white', borderRadius: 2, marginBottom: 12, opacity: 0.6 }} />
                <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 32, color: 'white', letterSpacing: -1 }}>
                  PLAYER
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 24, color: 'white', marginTop: -4, opacity: 0.9 }}>
                  PROFILE
                </Text>
              </View>
              
              <TouchableOpacity
                onPress={logout}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  alignItems: 'center', justifyContent: 'center'
                }}
              >
                <LogOut size={20} color="white" />
              </TouchableOpacity>
            </View>
            
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: SCREEN_FONTS.body, fontSize: 14, maxWidth: 280 }}>
              {player.bio || 'Chưa có mô tả bản thân. Hãy cập nhật để mọi người hiểu rõ phong cách chơi của bạn hơn.'}
            </Text>
          </View>

          {/* IDENTITY CARD - PREMIUM REDESIGN */}
          <View style={{ paddingHorizontal: 24, marginTop: 32 }}>
            <View style={{
              backgroundColor: 'white',
              borderRadius: RADIUS.xxl,
              padding: 32,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              flexDirection: isWeb ? 'row' : 'column',
              alignItems: isWeb ? 'center' : 'flex-start',
              gap: 32,
              ...SHADOW.md
            }}>
              {/* Profile Pic Container */}
              <View style={{
                width: 100, height: 100, borderRadius: 50,
                backgroundColor: theme.primaryContainer,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 4, borderColor: 'white',
                ...SHADOW.sm
              }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 44, color: theme.primary }}>
                  {player.name?.[0]?.toUpperCase()}
                </Text>
              </View>

              {/* User Identity Details */}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                  <View>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 32, color: theme.onSurface, letterSpacing: -0.5 }}>
                      {player.name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <MapPin size={14} color={theme.outline} />
                      <Text style={{ marginLeft: 6, fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant }}>
                        {joinedYear ? `Thành viên từ ${joinedYear}` : 'Thành viên mới'}
                      </Text>
                    </View>
                  </View>
                  
                  <TouchableOpacity 
                    onPress={() => router.push('/edit-profile' as any)}
                    style={{ 
                      paddingHorizontal: 20, paddingVertical: 10, 
                      borderRadius: RADIUS.full, backgroundColor: theme.surfaceAlt,
                      borderWidth: 1, borderColor: theme.outlineVariant,
                      flexDirection: 'row', alignItems: 'center', gap: 10
                    }}
                  >
                    <PencilLine size={16} color={theme.primary} />
                    <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 13, color: theme.primary, letterSpacing: 1 }}>CHỈNH SỬA</Text>
                  </TouchableOpacity>
                </View>

                {/* Status Badges */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <View style={{
                    backgroundColor: theme.secondaryContainer,
                    paddingHorizontal: 14, paddingVertical: 6,
                    borderRadius: RADIUS.lg, flexDirection: 'row', alignItems: 'center', gap: 6
                  }}>
                    <ShieldCheck size={14} color={theme.primary} />
                    <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 11, color: theme.primary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {player.is_provisional ? 'DỰ PHÓNG' : 'ĐÃ XÁC THỰC'}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: withAlpha(theme.primary, 0.05),
                    paddingHorizontal: 14, paddingVertical: 6,
                    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: withAlpha(theme.primary, 0.1)
                  }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 11, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>
                      ĐỘ TIN CẬY {reliability}%
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* DASHBOARD GRID SYSTEM */}
          <View style={{ 
            flexDirection: isWeb ? 'row' : 'column', 
            paddingHorizontal: 24, 
            marginTop: 32, 
            gap: 32 
          }}>
            {/* COLUMN 1 (PRIMARY): SKILL & STATS */}
            <View style={{ flex: isWeb ? 1.5 : 1, gap: 32 }}>
              {/* Skill Proficiency Card */}
              <View>
                <ProfileSectionDivider index="01" title="TRÌNH ĐỘ PVNA" theme={theme} />
                <ProfileSkillHero
                  elo={effectiveElo}
                  title={skill?.title ?? 'Đang hiệu chỉnh'}
                  subtitle={skill?.subtitle ?? 'Hệ thống đang tinh chỉnh.'}
                  description={skill?.description}
                  levelId={skill?.id}
                  colors={PROFILE_SKILL_HERO_TONE}
                  contentRightInset={16}
                />
              </View>

              {/* Performance Metrics Card */}
              <View>
                <ProfileSectionDivider index="02" title="CHỈ SỐ THI ĐẤU" theme={theme} />
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <View style={{
                    flex: 1, backgroundColor: 'white',
                    borderRadius: RADIUS.xxl, padding: 24,
                    borderWidth: 1, borderColor: theme.outlineVariant,
                    ...SHADOW.xs
                  }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: withAlpha(theme.primary, 0.08), alignItems: 'center', justifyContent: 'center' }}>
                      <Swords size={22} color={theme.primary} />
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 40, color: theme.onSurface, marginTop: 16 }}>
                      {player.sessions_joined ?? 0}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 11, color: theme.outline, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
                      TRẬN ĐÃ CHƠI
                    </Text>
                  </View>

                  <View style={{
                    flex: 1, backgroundColor: 'white',
                    borderRadius: RADIUS.xxl, padding: 24,
                    borderWidth: 1, borderColor: theme.outlineVariant,
                    ...SHADOW.xs
                  }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: withAlpha(theme.primary, 0.08), alignItems: 'center', justifyContent: 'center' }}>
                      <Calendar size={22} color={theme.primary} />
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 40, color: theme.onSurface, marginTop: 16 }}>
                      {hostedCount}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 11, color: theme.outline, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
                      KÈO ĐÃ TỔ CHỨC
                    </Text>
                  </View>
                </View>
              </View>

              {/* Performance Streak Card */}
              <View>
                <ProfileSectionDivider index="03" title="PHONG ĐỘ" theme={theme} />
                <ProfileWinStreak current={currentWinStreak} active={streakActive} />
              </View>
            </View>

            {/* COLUMN 2 (SECONDARY): COMMUNITY & RECOGNITION */}
            <View style={{ flex: 1, gap: 32 }}>
              {/* Community Feedback Card */}
              <View>
                <ProfileSectionDivider index="04" title="GHI NHẬN CỘNG ĐỒNG" theme={theme} />
                <View style={{ backgroundColor: 'white', borderRadius: RADIUS.xxl, padding: 24, borderWidth: 1, borderColor: theme.outlineVariant, ...SHADOW.xs }}>
                  <CommunityFeedbackPanel title="" traits={displayCommunityTraits} flushBottom />
                </View>
              </View>

              {/* Achievements Card */}
              <View>
                <ProfileSectionDivider index="05" title="PHÒNG TRUYỀN THỐNG" theme={theme} />
                <View style={{ backgroundColor: 'white', borderRadius: RADIUS.xxl, padding: 24, borderWidth: 1, borderColor: theme.outlineVariant, ...SHADOW.xs }}>
                  <TrophyRoomSection badges={displayAchievements} hideHeader flushBottom />
                </View>
              </View>

              {/* Account Management Card */}
              <View>
                <ProfileSectionDivider index="06" title="QUẢN LÝ TÀI KHOẢN" theme={theme} />
                <View style={{ gap: 12 }}>
                  <TouchableOpacity
                    onPress={handleSwitchToHost}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: theme.primary, borderRadius: RADIUS.xl,
                      paddingVertical: 18, ...SHADOW.sm,
                      gap: 12
                    }}
                  >
                    <ShieldCheck size={20} color="white" />
                    <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 16, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      KÍCH HOẠT CHẾ ĐỘ HOST
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={logout}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.xl,
                      paddingVertical: 16, borderWidth: 1, borderColor: theme.outlineVariant,
                      gap: 10
                    }}
                  >
                    <LogOut size={18} color={theme.error} />
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.error }}>
                      ĐĂNG XUẤT TÀI KHOẢN
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </WebContainer>
      </ScrollView>
      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}
