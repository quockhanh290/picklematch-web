import { Slot, useRouter, usePathname } from 'expo-router'
import { SessionNavContext, SessionNavigation } from '@/lib/navigation/SessionNavContext'
import { AppNavContext, AppNavigation } from '@/lib/navigation/AppNavContext'
import { View, Text, TouchableOpacity, Platform } from 'react-native'
import { LayoutDashboard, User } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { SHADOW } from '@/constants/screenLayout'

export default function HostLayout() {
  const theme = useAppTheme()
  const router = useRouter()
  const pathname = usePathname()

  const sessionNav: SessionNavigation = {
    onOpenSession: (id) => router.push({ pathname: '/host/session/[id]', params: { id } } as any),
    onEditSession: (id) => router.push({ pathname: '/host/create-session', params: { editSessionId: id } }),
    onViewMatchResult: (id) => router.push({ pathname: '/host/match-result/[id]', params: { id } } as any),
    onRateSession: (id) => {},
    onConfirmResult: (id) => {},
    onReviewSession: (id) => {}, 
    onOpenPlayerProfile: () => {},
    onOpenCourt: (id) => router.push({ pathname: '/host/court-config', params: { id } } as any),
  }

  const appNav: AppNavigation = {
    onOpenProfile: () => router.push('/host/profile'),
    onCreateSession: () => router.push('/host/create-session'),
  }

  const navItems = [
    { label: 'QUẢN LÝ KÈO', icon: LayoutDashboard, route: '/host/dashboard' },
    { label: 'HỒ SƠ', icon: User, route: '/host/profile' },
  ]

  return (
    <AppNavContext.Provider value={appNav}>
      <SessionNavContext.Provider value={sessionNav}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={{ flex: 1 }}>
            <Slot />
          </View>

          {/* Floating Bottom Navigation Bar for Host - Hide on creation/editing/detail screens */}
          {(pathname === '/host/dashboard' || pathname === '/host/profile') && (
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
                minWidth: 280,
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
                        paddingHorizontal: 20,
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
          )}
        </View>
      </SessionNavContext.Provider>
    </AppNavContext.Provider>
  )
}
