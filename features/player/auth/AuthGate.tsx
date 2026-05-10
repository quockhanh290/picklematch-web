import React, { useEffect, useState } from 'react'
import { usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { safeStorageGetItem } from '@/lib/storage'
import { Platform } from 'react-native'

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
  const firstSegment = segments[0] ?? ''
  const secondSegment = segments[1] ?? ''
  const isWeb = Platform.OS === 'web'
  const isHostLoginRoute = firstSegment === 'host' && secondSegment === 'login'
  const isRegisterRoute = firstSegment === 'register' || (firstSegment === '(player)' && secondSegment === 'register')
  const isOnboardingRoute = firstSegment === 'onboarding' || (firstSegment === '(player)' && secondSegment === 'onboarding')
  const isPublicRoute = firstSegment === 'login' || (firstSegment === '(player)' && secondSegment === 'login') || isHostLoginRoute || isRegisterRoute || isOnboardingRoute
  const isProfileSetupRoute = firstSegment === 'profile-setup' || (firstSegment === '(player)' && secondSegment === 'profile-setup')
  const isHostRoute = firstSegment === 'host'
  const isPlayerRoute = firstSegment === '(player)' || firstSegment === '(tabs)' || firstSegment === 'player-hub'

  useEffect(() => {
    if (!fontsLoaded || !isLoading || authStatus !== 'loading') return
    const guardTimer = setTimeout(() => {
      console.warn('[AuthGate] Loading guard fired, fallback to unauthenticated')
      setAuthStatus('unauthenticated')
    }, 10000)
    return () => clearTimeout(guardTimer)
  }, [authStatus, fontsLoaded, isLoading])

  useEffect(() => {
    if (isLoading || !fontsLoaded) return

    if (!userId) {
      setAuthStatus('unauthenticated')
      return
    }

    const checkStatus = async () => {
      try {
        // Check stored role preference
        const storedRole = await safeStorageGetItem('user_role') as UserRole || 'player'
        
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('*')
          .eq('id', userId)
          .maybeSingle()

        if (playerError) {
          console.error('[AuthGate] ❌ Player fetch failed:', playerError)
          setUserRole(null)
          setAuthStatus('unauthenticated')
          return
        }

        if (!playerData) {
          setAuthStatus('needs_setup')
          return
        } 
        
        if (!playerData.onboarding_completed) {
          if (storedRole === 'host' && (playerData as any).is_host) {
            setUserRole('host')
            setAuthStatus('ready')
          } else {
            setAuthStatus('needs_onboarding')
          }
          return
        }

        const actualIsHost = !!(playerData as any).is_host
        if (storedRole === 'host' && !actualIsHost) {
          setUserRole('player')
          await safeStorageSetItem('user_role', 'player')
        } else {
          setUserRole(storedRole)
        }
        setAuthStatus('ready')
      } catch (e) {
        console.error('[AuthGate] Auth status execution error:', e)
        setUserRole(null)
        setAuthStatus('unauthenticated')
      }
    }

    checkStatus()
  }, [isLoading, fontsLoaded, userId])

  useEffect(() => {
    if (authStatus === 'loading' || !fontsLoaded || !navReady) return

    const replaceIfNeeded = (target: string) => {
      if (pathname !== target) {
        console.log(`[AuthGate] Redirecting: ${pathname} -> ${target}`)
        router.replace(target as any)
      }
    }

    // Prevent infinite loops and handle redirects
    if (authStatus === 'unauthenticated' && !isPublicRoute) {
      if (isWeb) {
        replaceIfNeeded('/host/login')
      } else {
        replaceIfNeeded('/login')
      }
    } else if (authStatus === 'needs_setup' && !isProfileSetupRoute) {
      console.log('[AuthGate] Force redirect to profile-setup (authenticated but no player record)')
      replaceIfNeeded('/profile-setup')
    } else if (authStatus === 'needs_onboarding' && !isOnboardingRoute) {
      console.log('[AuthGate] Force redirect to onboarding (authenticated but incomplete profile)')
      replaceIfNeeded('/onboarding')
    } else if (authStatus === 'ready' && userRole !== null) {
      // 1. If at login screen or root, go to appropriate dashboard
      if (isPublicRoute || segments.length === 0) {
        if (isWeb && (firstSegment === 'login' || (firstSegment === '(player)' && secondSegment === 'login') || isHostLoginRoute || isRegisterRoute)) {
          if (userRole === 'host') {
            replaceIfNeeded('/host/dashboard')
          } else {
            replaceIfNeeded('/player-hub/profile')
          }
          return
        }
        if (userRole === 'host') {
          replaceIfNeeded('/host/dashboard')
        } else {
          replaceIfNeeded(isWeb ? '/player-hub/profile' : '/(tabs)')
        }
      } 
      // 2. If Role is Host but we are on a Player route, force redirect to Host
      else if (userRole === 'host' && isPlayerRoute && !__DEV__) {
        replaceIfNeeded('/host/dashboard')
      }
    }
  }, [authStatus, fontsLoaded, navReady, pathname, segments, userRole, router])

  // Don't render anything while determining auth status or loading fonts
  if (authStatus === 'loading' || !fontsLoaded) {
    return null
  }

  return <>{children}</>
}
