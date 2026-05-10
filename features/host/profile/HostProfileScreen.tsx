import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import {
  Settings,
  ChevronRight,
  LayoutDashboard,
  PlusCircle,
  Building2,
  CalendarDays,
  PencilLine,
  LogOut,
} from 'lucide-react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { MainHeader } from '@/components/design'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING } from '@/constants/screenLayout'
import { useAppTheme } from '@/lib/theme-context'
import { useAuth } from '@/lib/useAuth'

type HostProfile = {
  name: string
  phone: string | null
  city: string | null
  hostedSessionsCount: number
  courtsCount: number
}

const INITIAL_PROFILE: HostProfile = {
  name: '',
  phone: null,
  city: null,
  hostedSessionsCount: 0,
  courtsCount: 0,
}

async function fetchHostProfileData(userId: string): Promise<HostProfile> {

  const [playerRes, hostedRes, courtsRes] = await Promise.all([
    supabase
      .from('players')
      .select('name, phone, city')
      .eq('id', userId)
      .single(),
    supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId),
    supabase
      .from('courts')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId),
  ])

  return {
    name: playerRes.data?.name ?? 'Host',
    phone: playerRes.data?.phone ?? null,
    city: playerRes.data?.city ?? null,
    hostedSessionsCount: hostedRes.count ?? 0,
    courtsCount: courtsRes.count ?? 0,
  }
}

export function HostProfileScreen() {
  const theme = useAppTheme()
  const { userId, isLoading: authLoading } = useAuth()
  const [profile, setProfile] = useState<HostProfile>(INITIAL_PROFILE)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!userId) {
      setProfile(INITIAL_PROFILE)
      setLoading(false)
      return
    }
    const data = await fetchHostProfileData(userId)
    setProfile(data)
    setLoading(false)
  }, [userId])

  const onRefresh = useCallback(async () => {
    if (!userId) {
      setRefreshing(false)
      return
    }
    setRefreshing(true)
    const data = await fetchHostProfileData(userId)
    setProfile(data)
    setRefreshing(false)
  }, [userId])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  const menuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard Quản lý',
      subtitle: 'Xem lịch kèo và tình trạng sân',
      icon: LayoutDashboard,
      onPress: () => router.push('/host/dashboard' as any),
    },
    {
      id: 'create_session',
      label: 'Tạo kèo mới',
      subtitle: 'Tạo lịch thi đấu cho sân của bạn',
      icon: PlusCircle,
      onPress: () => router.push('/host/create-session' as any),
    },
    {
      id: 'my_courts',
      label: 'Sân của tôi',
      subtitle: 'Quản lý thông tin và cơ sở vật chất',
      icon: Building2,
      onPress: () => router.push('/host/edit-court' as any),
    },
    {
      id: 'edit_profile',
      label: 'Chỉnh sửa hồ sơ',
      subtitle: 'Cập nhật thông tin liên hệ và giới thiệu',
      icon: PencilLine,
      onPress: () => router.push('/host/edit-profile' as any),
    },
    {
      id: 'settings',
      label: 'Cài đặt tài khoản',
      subtitle: 'Bảo mật và thông báo',
      icon: Settings,
      onPress: () => router.push('/settings' as any),
    },
  ]

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
      >
        <MainHeader
          title="Host"
          rightElement={
            <Pressable
              onPress={() => router.push('/settings' as any)}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: theme.surfaceContainerLow,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Settings size={22} color={theme.onSurface} />
            </Pressable>
          }
        />

        {/* Identity */}
        <View style={{ paddingHorizontal: SPACING.xl, marginBottom: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: theme.primaryContainer,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: theme.primary,
              }}
            >
              <Text style={{ fontSize: 32, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimaryContainer }}>
                {(profile.name?.charAt(0) || 'H').toUpperCase()}
              </Text>
            </View>
            <View style={{ marginLeft: 20, flex: 1 }}>
              <Text style={{ fontSize: 24, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>
                {profile.name}
              </Text>
              {profile.city ? (
                <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, marginTop: 2 }}>
                  {profile.city}
                </Text>
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 6,
                  backgroundColor: theme.secondaryContainer,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: RADIUS.full,
                  alignSelf: 'flex-start',
                }}
              >
                <Building2 size={12} color={theme.onSecondaryContainer} />
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: SCREEN_FONTS.label,
                    color: theme.onSecondaryContainer,
                    marginLeft: 6,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Host đã xác minh
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', paddingHorizontal: SPACING.xl, gap: 12, marginBottom: 32 }}>
          <StatCard label="Kèo đã tạo" value={profile.hostedSessionsCount.toString()} icon={CalendarDays} theme={theme} />
          <StatCard label="Sân đang quản lý" value={profile.courtsCount.toString()} icon={Building2} theme={theme} />
        </View>

        {/* Management Menu */}
        <View style={{ paddingHorizontal: SPACING.xl }}>
          <Text
            style={{
              fontSize: 12,
              fontFamily: SCREEN_FONTS.label,
              color: theme.outline,
              marginBottom: 16,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
            }}
          >
            Quản lý chuyên sâu
          </Text>

          <View
            style={{
              backgroundColor: theme.surfaceContainerLow,
              borderRadius: RADIUS.xl,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.outlineVariant,
            }}
          >
            {menuItems.map((item, index) => (
              <Pressable
                key={item.id}
                onPress={item.onPress}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 20,
                  backgroundColor: pressed ? theme.surfaceContainerHigh : 'transparent',
                  borderBottomWidth: index === menuItems.length - 1 ? 0 : 1,
                  borderBottomColor: theme.outlineVariant,
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: theme.surfaceContainer,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <item.icon size={22} color={theme.primary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={{ fontSize: 16, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>
                    {item.label}
                  </Text>
                  <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, marginTop: 2 }}>
                    {item.subtitle}
                  </Text>
                </View>
                <ChevronRight size={20} color={theme.outline} />
              </Pressable>
            ))}
          </View>

          {/* Logout Button */}
          <TouchableOpacity
            onPress={async () => {
              await supabase.auth.signOut()
              router.replace('/')
            }}
            activeOpacity={0.8}
            style={{
              marginTop: 24,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 16,
              borderRadius: RADIUS.xl,
              backgroundColor: theme.surfaceAlt,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              gap: 12
            }}
          >
            <LogOut size={20} color={theme.error} />
            <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.error }}>
              ĐĂNG XUẤT TÀI KHOẢN
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  )
}

function StatCard({ label, value, icon: Icon, theme }: any) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surfaceContainerLow,
        padding: 16,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: theme.outlineVariant,
      }}
    >
      <Icon size={18} color={theme.primary} />
      <Text style={{ fontSize: 28, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface, marginTop: 12 }}>
        {value}
      </Text>
      <Text
        style={{
          fontSize: 11,
          fontFamily: SCREEN_FONTS.label,
          color: theme.onSurfaceVariant,
          marginTop: 2,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  )
}
