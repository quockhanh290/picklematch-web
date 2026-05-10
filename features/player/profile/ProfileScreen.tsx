import { AppButton } from '@/components/design/AppButton'
import { AppDialog, type AppDialogConfig, MainHeader } from '@/components/design'
import { BrandedFooter } from '@/components/design/BrandedFooter'
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
    <View className="mb-4 flex-row items-center gap-4">
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
          <View style={{ paddingTop: 12 }}>
            <MainHeader
              title="HỒ SƠ NGƯỜI CHƠI"
              brandedSubtitle="PICKLEMATCH"
              style={{ paddingHorizontal: 0 }}
              rightElement={
                <TouchableOpacity
                  onPress={logout}
                  style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: theme.surfaceContainerLow,
                    borderWidth: 1, borderColor: theme.outlineVariant,
                    alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  <LogOut size={20} color={theme.primary} />
                </TouchableOpacity>
              }
            />
          </View>
          {/* MAIN PROFILE CARD */}
          <View style={{ 
            backgroundColor: 'white', 
            borderRadius: RADIUS.hero,
            borderWidth: 1,
            borderColor: theme.outlineVariant,
            paddingBottom: 40,
            marginTop: 8,
            ...SHADOW.sm,
            overflow: 'hidden'
          }}>
            {/* Identity Header (Avatar & Name) */}
            <View style={{ padding: 24, alignItems: 'center', backgroundColor: theme.surfaceAlt }}>
              <View style={{ 
                width: 88, height: 88, borderRadius: 44, 
                backgroundColor: theme.primaryContainer,
                borderWidth: 3, borderColor: 'white',
                alignItems: 'center', justifyContent: 'center',
                ...SHADOW.xs
              }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 36, color: theme.primary }}>
                  {player.name?.[0]?.toUpperCase()}
                </Text>
              </View>

              <Text style={{ 
                fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, 
                color: theme.onSurface, marginTop: 16, textAlign: 'center' 
              }}>
                {player.name}
              </Text>

              <View style={{ 
                flexDirection: 'row', alignItems: 'center', 
                marginTop: 6, paddingHorizontal: 12, paddingVertical: 4,
                backgroundColor: theme.background, borderRadius: RADIUS.full,
                borderWidth: 1, borderColor: theme.outlineVariant
              }}>
                <MapPin size={12} color={theme.outline} />
                <Text style={{ 
                  marginLeft: 6, fontFamily: SCREEN_FONTS.bold, fontSize: 11, 
                  color: theme.onSurfaceVariant, textTransform: 'uppercase' 
                }}>
                  {player.city || 'TP. HỒ CHÍ MINH'}
                </Text>
              </View>
            </View>

            {/* Bio Section */}
            <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 }}>
              <Text style={{ 
                color: theme.onSurface, 
                fontFamily: SCREEN_FONTS.body, 
                fontSize: 14,
                lineHeight: 22,
                textAlign: 'center'
              }}>
                {player.bio || 'Quản lý thông tin và trình độ cá nhân của bạn.'}
              </Text>
            </View>

            <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginHorizontal: 24, marginVertical: 8 }} />

            {/* DASHBOARD CONTENT */}
            <View style={{ paddingHorizontal: 24, marginTop: 24, gap: 40 }}>
              {/* Skill Proficiency Section */}
              <View>
                <ProfileSectionDivider index="01" title="TRÌNH ĐỘ PVNA" theme={theme} />
                <ProfileSkillHero
                  elo={effectiveElo}
                  title={skill?.title ?? 'MỚI CHƠI'}
                  subtitle={skill?.subtitle ?? 'PVNA 2.1 - Bắt đầu làm quen'}
                  description={skill?.description}
                  levelId={skill?.id}
                />
              </View>

              {/* Account Management Section */}
              <View>
                <ProfileSectionDivider index="02" title="QUẢN LÝ TÀI KHOẢN" theme={theme} />
                <View style={{ gap: 12 }}>
                  <TouchableOpacity
                    onPress={handleSwitchToHost}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', 
                      backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.xl,
                      padding: 16, borderWidth: 1, borderColor: theme.outlineVariant,
                      gap: 16, ...SHADOW.xs
                    }}
                  >
                    <View style={{ 
                      width: 44, height: 44, borderRadius: 12, 
                      backgroundColor: theme.primary,
                      alignItems: 'center', justifyContent: 'center'
                    }}>
                      <ShieldCheck size={22} color="white" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 15, color: theme.onSurface }}>
                        Chế độ Host
                      </Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant, marginTop: 2 }}>
                        Kích hoạt để quản lý và tạo kèo đấu
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={logout}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', 
                      backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.xl,
                      padding: 16, borderWidth: 1, borderColor: theme.outlineVariant,
                      gap: 16, ...SHADOW.xs
                    }}
                  >
                    <View style={{ 
                      width: 44, height: 44, borderRadius: 12, 
                      backgroundColor: withAlpha(theme.error, 0.1),
                      alignItems: 'center', justifyContent: 'center'
                    }}>
                      <LogOut size={22} color={theme.error} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 15, color: theme.error }}>
                        Đăng xuất
                      </Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant, marginTop: 2 }}>
                        Thoát khỏi tài khoản hiện tại
                      </Text>
                    </View>
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
