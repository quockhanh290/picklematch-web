import { AppButton } from '@/components/design/AppButton'
import { AppDialog, type AppDialogConfig, MainHeader } from '@/components/design'
import { ScreenHeader } from '@/components/design/ScreenHeader'
import {
    ProfileSkillHero,
} from '@/components/profile/ProfileSections'
import { SCREEN_FONTS } from '@/constants/typography'
import { getSkillLevelFromPlayer, getEloBandByLevelId } from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { router } from 'expo-router'
import {
    AlertCircle,
    PencilLine,
    UserCircle,
    MapPin,
    LogOut
} from 'lucide-react-native'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { WebContainer } from '@/components/design/WebContainer'
import { StatusBar } from 'expo-status-bar'
import { DashboardStatsStrip, buildDashboardStats } from '@/components/home/DashboardStatsStrip'

import type { 
    ProfilePlayer as Player, 
    ProfilePlayerStats as PlayerStats, 
    ProfileSessionHistory as SessionHistory 
} from '../../player/profile/types'
import { 
    fetchCurrentPlayerProfileDataApi, 
    clearCurrentPlayerProfileCacheApi 
} from '../../player/profile/api'

function ProfileSectionDivider({ index, title, theme }: { index: string; title: string; theme: any }) {
  const isFirst = index === '01' || index === '1'
  return (
    <View style={{ marginTop: isFirst ? 0 : 18 }}>
      {!isFirst && <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginBottom: 18, opacity: 0.5 }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <Text style={{ fontSize: 11, color: theme.outline, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 4 }}>
          {index} / {title}
        </Text>
        <View style={{ height: 1, flex: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
      </View>
    </View>
  )
}

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

export function HostProfileScreen() {
  const insets = useSafeAreaInsets()
  const theme = useAppTheme()
  const [checking, setChecking] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [player, setPlayer] = useState<Player | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [_history, setHistory] = useState<SessionHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  const init = useCallback(async () => {
    setLoading(true)
    const snapshot = await fetchCurrentPlayerProfileDataApi()
    setLoggedIn(snapshot.loggedIn)
    setPlayer(snapshot.player)
    setPlayerStats(snapshot.playerStats)
    setHistory(snapshot.history)
    setLoading(false)
    setChecking(false)
  }, [])

  useEffect(() => {
    void init()
  }, [init])

  async function logout() {
    setDialogConfig({
      title: 'Đăng xuất?',
      message: 'Bạn chắc muốn đăng xuất không?',
      actions: [
        { label: 'QUAY LẠI', tone: 'secondary' },
        {
          label: 'ĐĂNG XUẤT',
          tone: 'danger',
          onPress: async () => {
            await supabase.auth.signOut()
            clearCurrentPlayerProfileCacheApi()
            router.replace('/')
          },
        },
      ],
    })
  }

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceContainerLow, paddingTop: insets.top }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    )
  }

  if (!loggedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surfaceContainerLow, paddingTop: insets.top }}>
        <ScreenHeader compact title="HỒ SƠ" />
        <View style={{ padding: 24, alignItems: 'center' }}>
          <UserCircle size={48} color={theme.outline} />
          <Text style={{ marginTop: 16, fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>
            Đăng nhập để xem hồ sơ
          </Text>
          <AppButton label="Đăng nhập" onPress={() => router.push('/login' as any)} style={{ marginTop: 24, width: '100%' }} />
        </View>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceContainerLow, paddingTop: insets.top }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    )
  }

  if (!player) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top }}>
        <ScreenHeader compact title="KHÔNG TÌM THẤY HỒ SƠ" />
      </View>
    )
  }

  const skill = getSkillLevelFromPlayer(player)
  let effectiveElo = player.current_elo ?? player.elo ?? 0
  if (effectiveElo === 0) {
    effectiveElo = player.gender === 'female' ? 800 : 1000
    if (skill && skill.id !== 'pvna_1') {
      const seed = getEloBandByLevelId(skill.id)?.seedElo ?? 800
      effectiveElo = Math.max(effectiveElo, seed)
    }
  }

  const displayHistory = _history.length > 0 ? _history : _PROFILE_MOCK_HISTORY

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="host-profile-screen">
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <ScrollView 
        contentContainerStyle={{ flexGrow: 1 }} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={init} tintColor={theme.primary} />
        }
      >
        <WebContainer maxWidth={600}>
          <View style={{ paddingTop: 12 }}>
            <MainHeader 
              title="HỒ SƠ CHỦ SÂN" 
              brandedSubtitle="PICKLEMATCH" 
              style={{ paddingHorizontal: 0 }} 
              testID="host-profile-header"
            />
          </View>

          <View style={{ paddingHorizontal: 24 }}>
            {/* Identity */}
            <View style={{ paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View style={{ 
                width: 64, height: 64, borderRadius: 32, 
                backgroundColor: theme.primary, borderWidth: 2, borderColor: 'white',
                alignItems: 'center', justifyContent: 'center', ...SHADOW.xs
              }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 24, color: 'white' }}>
                  {player.name?.[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, color: theme.onSurface, letterSpacing: -0.5 }}>
                  {player.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <MapPin size={12} color={theme.outline} />
                  <Text style={{ marginLeft: 4, fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: theme.onSurfaceVariant, textTransform: 'uppercase' }}>
                    {player.city || 'CHƯA CẬP NHẬT'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity 
                onPress={() => router.push('/host/edit-profile' as any)}
                style={{ 
                  width: 36, height: 36, borderRadius: 18, 
                  backgroundColor: theme.primary, borderWidth: 1, borderColor: 'white',
                  alignItems: 'center', justifyContent: 'center', ...SHADOW.xs
                }}
              >
                <PencilLine size={16} color="white" />
              </TouchableOpacity>
            </View>

            {/* Stats Strip */}
            <View style={{ marginBottom: 12 }}>
              <DashboardStatsStrip items={buildDashboardStats(player as any, playerStats)} />
            </View>

            <View style={{ paddingBottom: 100 }}>
              {/* Skill Section */}
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

              {/* Favorite Courts Section */}
              <View>
                <ProfileSectionDivider index="02" title="SÂN HAY CHƠI" theme={theme} />
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
                      const sortedCourts = Array.from(courtMap.values()).sort((a, b) => b.count - a.count).slice(0, 3)
                      return sortedCourts.map((court, idx) => (
                        <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surfaceAlt, padding: 12, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.outlineVariant, gap: 10 }}>
                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
                            <MapPin size={16} color="white" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.onSurface, textTransform: 'uppercase' }}>{court.name}</Text>
                            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurfaceVariant }}>{court.city}</Text>
                          </View>
                          <View style={{ backgroundColor: theme.background, paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1, borderColor: theme.outlineVariant }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: theme.primary }}>{court.count} TRẬN</Text>
                          </View>
                        </View>
                      ))
                    })()}
                  </View>
                ) : (
                  <View style={{ padding: 24, backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.lg, borderStyle: 'dashed', borderWidth: 1, borderColor: theme.outlineVariant, alignItems: 'center' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.outline }}>Chưa có dữ liệu sân đã chơi</Text>
                  </View>
                )}
              </View>

              {/* Account Actions */}
              <View>
                <ProfileSectionDivider index="03" title="QUẢN LÝ TÀI KHOẢN" theme={theme} />
                <View style={{ gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => router.replace('/player-hub/profile')}
                    activeOpacity={0.8}
                    style={{ backgroundColor: theme.primary, borderRadius: RADIUS.lg, padding: 12, alignItems: 'center', justifyContent: 'center', ...SHADOW.xs }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: 'white', textTransform: 'uppercase', letterSpacing: 1 }}>
                      CHẾ ĐỘ NGƯỜI CHƠI
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={logout}
                    activeOpacity={0.8}
                    style={{ backgroundColor: theme.error, borderRadius: RADIUS.lg, padding: 12, alignItems: 'center', justifyContent: 'center', ...SHADOW.xs }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: 'white', textTransform: 'uppercase', letterSpacing: 1 }}>
                      ĐĂNG XUẤT
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </WebContainer>
      </ScrollView>
      <AppDialog visible={Boolean(dialogConfig)} config={dialogConfig} onClose={() => setDialogConfig(null)} />
    </View>
  )
}
