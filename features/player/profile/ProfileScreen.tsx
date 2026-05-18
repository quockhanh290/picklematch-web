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
import { router, usePathname } from 'expo-router'
import {
    Calendar,
    AlertCircle,
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
import { DashboardStatsStrip, buildDashboardStats } from '@/components/home/DashboardStatsStrip'

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
  const isFirst = index === '01' || index === '1'
  return (
    <View style={{ marginTop: isFirst ? 0 : 18 }}>
      {!isFirst && <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginBottom: 18, opacity: 0.5 }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <Text className="text-[11px] uppercase tracking-[4px]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>
          {index} / {title}
        </Text>
        <View className="h-px flex-1" style={{ backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
      </View>
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
  const pathname = usePathname()
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
          title: STRINGS.profile.actions.activate_host_title,
          message: STRINGS.profile.actions.activate_host_msg,
          actions: [
            { label: STRINGS.profile.actions.cancel, tone: 'secondary', onPress: () => resolve(false) },
            { 
              label: STRINGS.profile.actions.activate_host_btn, 
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
      message: STRINGS.profile.actions.logout_confirm,
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
            router.replace('/login' as any)
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
          title={STRINGS.profile.login_required.title}
          description={STRINGS.profile.login_required.description}
        />
        <View className="mt-6 gap-3 px-5">
          <AppButton label={STRINGS.profile.login_required.login_btn} onPress={() => router.push('/login' as any)} />
          <AppButton label={STRINGS.common.back} onPress={() => router.replace('/login' as any)} variant="secondary" />
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
          icon={<AlertCircle size={28} color={theme.outline} />}
          title={STRINGS.profile.not_found.title}
          description={STRINGS.profile.not_found.description}
        />
      </View>
    )
  }

  const skill = getSkillLevelFromPlayer(player)
  let effectiveElo = player.current_elo ?? player.elo ?? 0
  
  if (effectiveElo === 0) {
    // Fallback based on gender floor defined in engine-spec
    // Male: 2.6 PVNA (1000 ELO), Female: 2.1 PVNA (800 ELO)
    if (player.gender === 'female') {
      effectiveElo = 800
    } else {
      // Default to male floor (2.6) as per system logic if null/male
      effectiveElo = 1000
    }
    
    // If they have a skill level but 0 ELO, override with seedElo if higher
    if (skill && skill.id !== 'pvna_1') {
      const seed = getEloBandByLevelId(skill.id)?.seedElo ?? 800
      effectiveElo = Math.max(effectiveElo, seed)
    }
  }
  const reliability = calculateReliabilityScore(player.sessions_joined, player.no_show_count)
  const hostedCount = hostedSessionsCount
  const placementPlayed = player.placement_matches_played ?? 0
  const currentWinStreak = playerStats?.current_win_streak ?? 0
  const streakActive = playerStats?.streak_fire_active ?? currentWinStreak > 0
  const joinedYear = player.created_at ? new Date(player.created_at).getFullYear() : null
  const displayCommunityTraits = communityTraits.length > 0 ? communityTraits : PROFILE_MOCK_TRAITS
  const displayAchievements = achievements.length > 0 ? achievements : PROFILE_MOCK_BADGES
  const displayHistory = _history.length > 0 ? _history : _PROFILE_MOCK_HISTORY

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }} testID="player-profile-screen">
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
              title={STRINGS.profile.header}
              brandedSubtitle="PICKLEMATCH"
              style={{ paddingHorizontal: 0 }}
            />
          </View>


          <View style={{ paddingHorizontal: 24 }}>
            {/* IDENTITY SECTION - NOW AT THE TOP */}
            <View style={{ paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View style={{ 
                width: 64, height: 64, borderRadius: 32, 
                backgroundColor: theme.primary,
                borderWidth: 2, borderColor: 'white',
                alignItems: 'center', justifyContent: 'center',
                ...SHADOW.xs
              }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 24, color: 'white' }}>
                  {player.name?.[0]?.toUpperCase()}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ 
                  fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, 
                  color: theme.onSurface, letterSpacing: -0.5
                }}>
                  {player.name}
                </Text>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <MapPin size={12} color={theme.outline} />
                  <Text style={{ 
                    marginLeft: 4, fontFamily: SCREEN_FONTS.bold, fontSize: 11, 
                    color: theme.onSurfaceVariant, textTransform: 'uppercase' 
                  }}>
                    {player.city || 'TP. HỒ CHÍ MINH'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity 
                onPress={() => router.push((pathname.startsWith('/player-hub') ? '/player-hub/edit-profile' : '/edit-profile') as any)}
                style={{ 
                  width: 36, height: 36, borderRadius: 18, 
                  backgroundColor: theme.primary, borderWidth: 1, borderColor: 'white',
                  alignItems: 'center', justifyContent: 'center',
                  ...SHADOW.xs
                }}
              >
                <PencilLine size={16} color="white" />
              </TouchableOpacity>
            </View>


            {/* Stats Strip */}
            <View style={{ marginTop: 0, marginBottom: 12 }}>
              <DashboardStatsStrip items={buildDashboardStats(player as any, playerStats)} />
            </View>

            {/* DASHBOARD CONTENT - NOW FREE FLOATING */}
            <View style={{ paddingBottom: 100 }}>
              {/* Skill Proficiency Section */}
              <View>
                <ProfileSectionDivider index="01" title={STRINGS.profile.sections.pvna} theme={theme} />
                <ProfileSkillHero
                  elo={effectiveElo}
                  title={skill?.title ?? 'MỚI CHƠI'}
                  subtitle={skill?.subtitle ?? 'PVNA 2.1 - Bắt đầu làm quen'}
                  description={skill?.description}
                  levelId={skill?.id}
                />
              </View>

              {/* Favorite Courts Section */}
              <View>
                <ProfileSectionDivider index="02" title={STRINGS.profile.sections.favorite_courts} theme={theme} />
                {displayHistory.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    {(() => {
                      const courtMap = new Map<string, { name: string; city: string; count: number }>()
                      displayHistory.forEach(item => {
                        const court = item.slot?.court
                        if (court) {
                          const existing = courtMap.get(court.name)
                          if (existing) {
                            existing.count++
                          } else {
                            courtMap.set(court.name, { ...court, count: 1 })
                          }
                        }
                      })
                      const sortedCourts = Array.from(courtMap.values())
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 3)

                      return sortedCourts.map((court, idx) => (
                        <View 
                          key={idx}
                          style={{ 
                            flexDirection: 'row', alignItems: 'center', 
                            backgroundColor: theme.surfaceAlt, padding: 12,
                            borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.outlineVariant,
                            gap: 10
                          }}
                        >
                          <View style={{ 
                            width: 32, height: 32, borderRadius: 16, 
                            backgroundColor: theme.primary,
                            alignItems: 'center', justifyContent: 'center'
                          }}>
                            <MapPin size={16} color="white" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.onSurface, textTransform: 'uppercase' }}>
                              {court.name}
                            </Text>
                            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurfaceVariant }}>
                              {court.city}
                            </Text>
                          </View>
                          <View style={{ backgroundColor: theme.background, paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1, borderColor: theme.outlineVariant }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: theme.primary }}>
                              {STRINGS.profile.sections.matches_count.replace('{count}', String(court.count))}
                            </Text>
                          </View>
                        </View>
                      ))
                    })()}
                  </View>
                ) : (
                  <View style={{ padding: 24, backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.lg, borderStyle: 'dashed', borderWidth: 1, borderColor: theme.outlineVariant, alignItems: 'center' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.outline }}>
                      {STRINGS.profile.sections.empty_courts}
                    </Text>
                  </View>
                )}
              </View>

              {/* Account Management Section */}
              <View>
                <ProfileSectionDivider index="03" title={STRINGS.profile.sections.account_mgmt} theme={theme} />
                <View style={{ gap: 10 }}>
                  <TouchableOpacity
                    onPress={handleSwitchToHost}
                    activeOpacity={0.8}
                    style={{
                      backgroundColor: theme.primary, borderRadius: RADIUS.lg,
                      padding: 12, alignItems: 'center', justifyContent: 'center',
                      ...SHADOW.xs
                    }}
                  >
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: 'white',
                      textTransform: 'uppercase', letterSpacing: 1
                    }}>
                      {STRINGS.profile.actions.host_mode}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={logout}
                    activeOpacity={0.8}
                    style={{
                      backgroundColor: theme.error, borderRadius: RADIUS.lg,
                      padding: 12, alignItems: 'center', justifyContent: 'center',
                      ...SHADOW.xs
                    }}
                  >
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: 'white',
                      textTransform: 'uppercase', letterSpacing: 1
                    }}>
                      {STRINGS.profile.actions.logout}
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
