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
  const isRegisterRoute = firstSegment === 'register'
  const isPublicRoute = firstSegment === 'login' || isHostLoginRoute || isRegisterRoute
  const isOnboardingRoute = firstSegment === 'onboarding'
  const isProfileSetupRoute = firstSegment === 'profile-setup'
  const isHostRoute = firstSegment === 'host'
  const isPlayerRoute = firstSegment === '(player)' || firstSegment === '(tabs)'

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
          .select('onboarding_completed')
          .eq('id', userId)
          .maybeSingle()

        if (playerError) {
          console.error('[AuthGate] Check failed:', playerError.message)
          setUserRole(null)
          setAuthStatus('unauthenticated')
          return
        }

        console.log(`[AuthGate] User:${userId} hasPlayer:${!!playerData} storedRole:${storedRole}`)

        if (!playerData) {
          setAuthStatus('needs_setup')
          return
        } 
        
        if (!playerData.onboarding_completed) {
          // If they prefer host role, maybe we let them skip player onboarding for now? 
          // But usually we want a profile first.
          if (storedRole === 'host') {
            setUserRole('host')
            setAuthStatus('ready')
          } else {
            setAuthStatus('needs_onboarding')
          }
          return
        }

        setUserRole(storedRole)
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

    console.log(`[AuthGate] Processing - Status:${authStatus} Role:${userRole} Path:${pathname} userId:${userId}`)

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
    } else if (authStatus === 'needs_setup' && !isProfileSetupRoute && !isHostRoute && !isPublicRoute) {
      replaceIfNeeded('/profile-setup')
    } else if (authStatus === 'needs_onboarding' && !isOnboardingRoute && !isHostRoute && !isPublicRoute) {
      replaceIfNeeded('/onboarding')
    } else if (authStatus === 'ready') {
      // 1. If at login screen or root, go to appropriate dashboard
      if (isPublicRoute || segments.length === 0) {
        if (isWeb && (isHostLoginRoute || isRegisterRoute)) {
          return
        }
        if (isWeb) {
          replaceIfNeeded('/host/dashboard')
        } else if (userRole === 'host') {
          replaceIfNeeded('/host/dashboard')
        } else {
          replaceIfNeeded('/(tabs)')
        }
      } 
      // 2. If Role is Host but we are on a Player route, force redirect to Host
      else if (userRole === 'host' && isPlayerRoute) {
        console.log('[AuthGate] Forced redirect: Host role on Player route')
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
