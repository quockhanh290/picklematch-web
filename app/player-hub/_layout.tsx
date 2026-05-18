import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, SHADOW, BORDER } from '@/constants/screenLayout'
import { Slot, useRouter, usePathname } from 'expo-router'
import { View, Text, TouchableOpacity, Platform } from 'react-native'
import { User, Search, LogOut, Home, CalendarDays } from 'lucide-react-native'
import { AppDialog, type AppDialogConfig } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { SessionNavContext } from '@/lib/navigation/SessionNavContext'
import { AppNavContext } from '@/lib/navigation/AppNavContext'
import { useState } from 'react'

export default function PlayerHubLayout() {
  const theme = useAppTheme()
  const router = useRouter()
  const pathname = usePathname()
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  const sessionNav = {
    onOpenSession: (id: string) => router.push({ pathname: '/player-hub/session/[id]', params: { id } } as any),
    onEditSession: (id: string) => router.push({ pathname: '/host/create-session', params: { editSessionId: id } } as any),
    onViewMatchResult: (id: string) => router.push({ pathname: '/host/match-result/[id]', params: { id } } as any),
    onRateSession: (id: string) => router.push({ pathname: '/rate-session/[id]', params: { id } } as any),
    onConfirmResult: (id: string) => router.push({ pathname: '/session/[id]/confirm-result', params: { id } } as any),
    onReviewSession: (id: string) => router.push({ pathname: '/session/[id]/review', params: { id } } as any),
    onOpenPlayerProfile: () => {},
    onOpenCourt: (id: string) => router.push({ pathname: '/player-hub/court/[id]', params: { id } } as any),
  }

  const navItems = [
    { label: 'KHÁM PHÁ', icon: Search, route: '/player-hub/find-session' },
    { label: 'KÈO CỦA TÔI', icon: CalendarDays, route: '/player-hub/my-sessions' },
    { label: 'HỒ SƠ', icon: User, route: '/player-hub/profile' },
  ]

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const handleCreateSession = () => {
    setDialogConfig({
      title: 'Chuyển sang chế độ host',
      message: 'Bạn cần vào chế độ host để tạo và quản lý kèo.',
      actions: [
        { label: 'Để sau', tone: 'secondary' },
        { label: 'Tiếp tục', onPress: () => router.push('/host/create-session' as any) },
      ],
    })
  }

  if (Platform.OS !== 'web' && !__DEV__) {
    return <Slot />
  }

  const appNav = {
    onOpenProfile: () => router.push('/player-hub/profile'),
    onCreateSession: handleCreateSession,
    onLogout: handleLogout,
  }

  return (
    <SessionNavContext.Provider value={sessionNav}>
      <AppNavContext.Provider value={appNav}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          {/* Content Area */}
          <View style={{ flex: 1, backgroundColor: theme.background }}>
            <Slot />
          </View>

          {/* Floating Bottom Navigation Bar */}
          <View style={{
            position: Platform.OS === 'web' ? 'fixed' : 'absolute',
            bottom: 24,
            left: 0,
            right: 0,
            alignItems: 'center',
            paddingHorizontal: 20,
            pointerEvents: 'box-none',
            zIndex: 1000,
          } as any}>
            <View style={{
              flexDirection: 'row',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              paddingHorizontal: 8,
              paddingVertical: 8,
              borderRadius: 32,
              borderWidth: 1,
              borderColor: 'rgba(0, 0, 0, 0.05)',
              width: Platform.OS === 'web' ? 'auto' : '100%',
              minWidth: 320,
              justifyContent: 'space-around',
              gap: 4,
              ...SHADOW.md,
              // Backdrop blur for premium feel
              backdropFilter: 'blur(10px)',
            } as any}>
              {navItems.map((item) => {
                const isActive = pathname === item.route
                return (
                  <TouchableOpacity 
                    key={item.route}
                    onPress={() => router.push(item.route as any)}
                    style={{ 
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      gap: 8, 
                      paddingVertical: 10,
                      paddingHorizontal: 16,
                      borderRadius: 24,
                      backgroundColor: isActive ? theme.primary : 'transparent',
                    }}
                  >
                    <item.icon size={20} color={isActive ? 'white' : theme.onSurfaceVariant} strokeWidth={isActive ? 2.5 : 2} />
                    {isActive && (
                      <Text style={{ 
                        fontFamily: SCREEN_FONTS.headline, 
                        fontSize: 12, 
                        color: 'white',
                        fontWeight: '800',
                        letterSpacing: 0.5
                      }}>
                        {item.label}
                      </Text>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
          <AppDialog
            visible={Boolean(dialogConfig)}
            config={dialogConfig}
            onClose={() => setDialogConfig(null)}
          />
        </View>
      </AppNavContext.Provider>
    </SessionNavContext.Provider>
  )
}
