import React, { useEffect, useState } from 'react'
import { usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { safeStorageGetItem, safeStorageSetItem, checkStoragePersistence } from '@/lib/storage'
import { Platform, View, Text, TouchableOpacity } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { AlertTriangle, X } from 'lucide-react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { AppLoading } from '@/components/design/AppLoading'
import { useNetworkState } from '@/lib/NetworkContext'

export type AuthStatus = 'loading' | 'unauthenticated' | 'needs_setup' | 'needs_onboarding' | 'ready'
export type UserRole = 'player' | 'host' | null

interface AuthGateProps {
  children: React.ReactNode
  fontsLoaded: boolean
}

export function AuthGate({ children, fontsLoaded }: AuthGateProps) {
  const { userId, isLoading } = useAuth()
  const segments = useSegments()
  const pathname = usePathname()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()
  const navReady = Boolean(rootNavigationState?.key)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [userRole, setUserRole] = useState<UserRole>(null)
  const [persistenceWarning, setPersistenceWarning] = useState(false)
  const { isOnline, status, reportDegraded, retry } = useNetworkState()
  const theme = useAppTheme()
  const firstSegment = segments[0] ?? ''
  const secondSegment = segments[1] ?? ''
  const isWeb = Platform.OS === 'web'
  
  // Route categorizations
  const isHostLoginRoute = firstSegment === 'host' && secondSegment === 'login'
  const isRegisterRoute = firstSegment === 'register' || (firstSegment === '(player)' && secondSegment === 'register')
  const isOnboardingRoute = firstSegment === 'onboarding' || (firstSegment === '(player)' && secondSegment === 'onboarding')
  const isPublicRoute = firstSegment === 'login' || (firstSegment === '(player)' && secondSegment === 'login') || isHostLoginRoute || isRegisterRoute || isOnboardingRoute
  const isProfileSetupRoute = firstSegment === 'profile-setup' || (firstSegment === '(player)' && secondSegment === 'profile-setup')
  const isHostRoute = firstSegment === 'host'
  const isPlayerRoute = firstSegment === '(player)' || firstSegment === '(tabs)'

  // 1. Auth Bootstrap Guard (Slow Connection Indicator)
  useEffect(() => {
    if (!fontsLoaded || !isLoading || authStatus !== 'loading' || !isOnline) {
      reportDegraded(false)
      return
    }
    const guardTimer = setTimeout(() => {
      console.warn('[AuthGate] Connection seems slow...')
      reportDegraded(true)
    }, 10000)
    return () => clearTimeout(guardTimer)
  }, [authStatus, fontsLoaded, isLoading, isOnline, reportDegraded])

  // 2. Storage Persistence Check
  useEffect(() => {
    if (isWeb) {
      checkStoragePersistence().then(persistent => {
        if (!persistent) setPersistenceWarning(true)
      })
    }
  }, [isWeb])

  // 3. Determine Detailed Auth Status
  useEffect(() => {
    if (isLoading || !fontsLoaded) return

    if (!userId) {
      setAuthStatus('unauthenticated')
      return
    }

    const checkStatus = async () => {
      try {
        // Check stored role preference
        const storedRole = await safeStorageGetItem('user_role') as UserRole
        
        // Fetch player profile to check onboarding and host status
        const { data: playerData, error } = await supabase
          .from('players')
          .select('onboarding_completed, is_host')
          .eq('id', userId)
          .maybeSingle()

        if (error) {
          console.error('[AuthGate] Player check failed:', error.message)
          setAuthStatus('unauthenticated')
          return
        }

        const isHost = !!playerData?.is_host
        
        console.log(`[AuthGate] User:${userId} isHost:${isHost} hasPlayer:${!!playerData} storedRole:${storedRole}`)

        // Logic for role determination
        if (isHost && (storedRole === 'host' || !playerData)) {
          setUserRole('host')
          setAuthStatus('ready')
          return
        }

        if (!playerData) {
          setAuthStatus('needs_setup')
        } else if (!playerData.onboarding_completed) {
          // If they are a host and were on host route, let them stay even if player profile incomplete
          if (isHost && storedRole === 'host') {
             setUserRole('host')
             setAuthStatus('ready')
          } else {
             setAuthStatus('needs_onboarding')
          }
        } else {
          // Both profiles exist, use stored preference or default to player
          if (isHost && storedRole === 'host') {
            setUserRole('host')
          } else {
            setUserRole('player')
          }
          setAuthStatus('ready')
        }
      } catch (e) {
        console.error('[AuthGate] Auth status execution error:', e)
        setAuthStatus('unauthenticated')
      }
    }

    checkStatus()
  }, [isLoading, fontsLoaded, userId])

  // 4. Handle Redirects
  useEffect(() => {
    if (authStatus === 'loading' || !fontsLoaded || !navReady) return

    const replaceIfNeeded = (target: string) => {
      if (pathname !== target) {
        console.log(`[AuthGate] Redirecting to ${target}`)
        router.replace(target as any)
      }
    }

    if (authStatus === 'unauthenticated' && !isPublicRoute) {
      replaceIfNeeded(isWeb ? '/host/login' : '/login')
    } else if (authStatus === 'needs_setup' && !isProfileSetupRoute && !isHostRoute && !isPublicRoute) {
      replaceIfNeeded('/profile-setup')
    } else if (authStatus === 'needs_onboarding' && !isOnboardingRoute && !isHostRoute && !isPublicRoute) {
      replaceIfNeeded('/onboarding')
    } else if (authStatus === 'ready') {
      // Landing redirects
      if (isPublicRoute || segments.length === 0) {
        // Don't auto-redirect from host login if we are already there and just became ready
        if (isWeb && (isHostLoginRoute || isRegisterRoute)) return
        
        if (isWeb || userRole === 'host') {
          replaceIfNeeded('/host/dashboard')
        } else {
          replaceIfNeeded('/(tabs)')
        }
      } 
      // Cross-role protection
      else if (userRole === 'host' && isPlayerRoute) {
        console.log('[AuthGate] Forced redirect: Host on Player route')
        replaceIfNeeded('/host/dashboard')
      }
    }
  }, [authStatus, fontsLoaded, navReady, pathname, segments, userRole, router, isWeb, isPublicRoute, isProfileSetupRoute, isHostRoute, isOnboardingRoute, isHostLoginRoute, isRegisterRoute, isPlayerRoute])

  // 5. Synchronous Render Guard
  // Don't render anything while determining auth status or loading fonts
  if (authStatus === 'loading' || !fontsLoaded) {
    if (status !== 'online') {
      return (
        <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <AppLoading label={status === 'offline' ? "KHÔNG CÓ KẾT NỐI" : "ĐANG KẾT NỐI LẠI..."} />
          <Text style={{ 
            marginTop: 8, 
            color: theme.onSurfaceVariant, 
            fontFamily: SCREEN_FONTS.body, 
            fontSize: 14,
            textAlign: 'center' 
          }}>
            {status === 'offline' 
              ? "Vui lòng kiểm tra kết nối mạng của bạn để tiếp tục." 
              : "Kết nối mạng của bạn có vẻ không ổn định. Đang thử lại..."}
          </Text>
          <TouchableOpacity 
            onPress={() => status === 'offline' ? retry() : router.replace(pathname as any)} 
            style={{ 
              marginTop: 32, 
              paddingVertical: 12, 
              paddingHorizontal: 24, 
              borderRadius: 100, 
              backgroundColor: theme.secondaryContainer 
            }}
          >
            <Text style={{ color: theme.onSecondaryContainer, fontFamily: SCREEN_FONTS.medium }}>
              {status === 'offline' ? 'Thử lại ngay' : 'Thử tải lại trang'}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }
    return null
  }

  // Security: Only render children if it's a public route OR if auth is in a valid state for the route.
  // This prevents "flashing" protected UI before the redirect useEffect kicks in.
  const shouldRenderChildren = isPublicRoute || 
    (authStatus === 'ready') || 
    (authStatus === 'needs_setup' && isProfileSetupRoute) || 
    (authStatus === 'needs_onboarding' && isOnboardingRoute)

  if (!shouldRenderChildren) {
    return null
  }

  return (
    <>
      {persistenceWarning && (
        <View style={{ 
          backgroundColor: theme.warningContainer, 
          paddingVertical: 10, 
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.warningStrong + '30',
          zIndex: 9999
        }}>
          <AlertTriangle size={18} color={theme.warningStrong} />
          <Text style={{ 
            flex: 1,
            fontSize: 12, 
            color: theme.onWarningContainer, 
            fontFamily: SCREEN_FONTS.medium,
            lineHeight: 16
          }}>
            Trình duyệt đang chặn lưu trữ (chế độ ẩn danh). Bạn sẽ bị đăng xuất khi đóng tab này.
          </Text>
          <TouchableOpacity onPress={() => setPersistenceWarning(false)}>
            <X size={16} color={theme.warningStrong} />
          </TouchableOpacity>
        </View>
      )}
      {children}
    </>
  )
}
