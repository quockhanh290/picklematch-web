import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, SHADOW, BORDER } from '@/constants/screenLayout'
import { Slot, useRouter, usePathname } from 'expo-router'
import { View, Text, TouchableOpacity, Platform } from 'react-native'
import { User, Search, LogOut, Home, CalendarDays } from 'lucide-react-native'
import { WebContainer } from '@/components/design/WebContainer'
import { supabase } from '@/lib/supabase'
import { SessionNavContext } from '@/lib/navigation/SessionNavContext'
import { AppNavContext } from '@/lib/navigation/AppNavContext'

export default function PlayerHubLayout() {
  const theme = useAppTheme()
  const router = useRouter()
  const pathname = usePathname()

  const sessionNav = {
    onOpenSession: (id: string) => router.push({ pathname: '/session/[id]', params: { id } } as any),
    onEditSession: () => {},
    onViewMatchResult: () => {},
    onRateSession: () => {},
    onConfirmResult: () => {},
    onReviewSession: () => {},
    onOpenPlayerProfile: (id: string) => router.push({ pathname: '/player/[id]', params: { id } } as any),
    onOpenPlayer: (id: string) => router.push({ pathname: '/player/[id]', params: { id } } as any),
    onOpenCourt: (id: string) => router.push({ pathname: '/court/[id]', params: { id } } as any),
  }

  const navItems = [
    { label: 'KHÁM PHÁ', icon: Search, route: '/player-hub/find-session' },
    { label: 'KÈO CỦA TÔI', icon: CalendarDays, route: '/player-hub/my-sessions' },
    { label: 'HỒ SƠ', icon: User, route: '/player-hub/profile' },
  ]

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  if (Platform.OS !== 'web' && !__DEV__) {
    return <Slot />
  }

  const appNav = {
    onOpenProfile: () => router.push('/player-hub/profile'),
    onCreateSession: () => router.push('/host/create-session'),
    onLogout: handleLogout,
  }

  return (
    <SessionNavContext.Provider value={sessionNav}>
      <AppNavContext.Provider value={appNav}>
        <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          {/* Top Header - Branded */}
          <View style={{ 
            height: 64, 
            backgroundColor: 'white', 
            borderBottomWidth: 1, 
            borderBottomColor: theme.outlineVariant,
            zIndex: 100,
            ...SHADOW.xs
          }}>
            <WebContainer>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
                <TouchableOpacity 
                  onPress={() => router.push('/')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <View style={{ backgroundColor: theme.primary, width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <Home size={16} color="white" />
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 16, color: theme.primary, letterSpacing: -0.5 }}>
                    PICKLEMATCH
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={handleLogout}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.7 }}
                >
                  <LogOut size={16} color={theme.onSurfaceVariant} />
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, fontWeight: '700' }}>ĐĂNG XUẤT</Text>
                </TouchableOpacity>
              </View>
            </WebContainer>
          </View>

          {/* Content Area */}
          <View style={{ flex: 1 }}>
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
        </View>
      </AppNavContext.Provider>
    </SessionNavContext.Provider>
  )
}
