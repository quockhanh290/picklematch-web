import React, { useEffect, useState } from 'react'
import { usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { safeStorageGetItem } from '@/lib/storage'
import { Platform } from 'react-native'

export type AuthStatus = 'loading' | 'unauthenticated' | 'needs_setup' | 'needs_onboarding' | 'ready'
export type UserRole = 'player' | 'owner' | null

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
  const isOwnerLoginRoute = firstSegment === 'owner' && secondSegment === 'login'
  const isRegisterRoute = firstSegment === 'register'
  const isPublicRoute = firstSegment === 'login' || isOwnerLoginRoute || isRegisterRoute
  const isOnboardingRoute = firstSegment === 'onboarding'
  const isProfileSetupRoute = firstSegment === 'profile-setup'
  const isOwnerRoute = firstSegment === 'owner'
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
        const storedRole = await safeStorageGetItem('user_role') as UserRole
        
        // Parallel checks for optimization
        const [playerRes, ownerRes] = await Promise.all([
          supabase.from('players').select('onboarding_completed').eq('id', userId).maybeSingle(),
          supabase.from('owners').select('id').eq('id', userId).maybeSingle()
        ])

        if (playerRes.error || ownerRes.error) {
          console.error('[AuthGate] Check failed:', playerRes.error?.message || ownerRes.error?.message)
          setUserRole(null)
          setAuthStatus('unauthenticated')
          return
        }

        const isOwner = !!ownerRes.data
        const playerData = playerRes.data
        
        console.log(`[AuthGate] User:${userId} isOwner:${isOwner} hasPlayer:${!!playerData} storedRole:${storedRole}`)

        // If user is an owner, and they either prefer owner role or don't have a player profile yet
        if (isOwner && (storedRole === 'owner' || !playerData)) {
          setUserRole('owner')
          setAuthStatus('ready')
          return
        }

        if (!playerData) {
          setAuthStatus('needs_setup')
        } else if (!playerData.onboarding_completed) {
          // Even if onboarding is needed for player, if they are an owner and were on owner route, let them stay
          if (isOwner && storedRole === 'owner') {
             setUserRole('owner')
             setAuthStatus('ready')
          } else {
             setAuthStatus('needs_onboarding')
          }
        } else {
          // If they are both, but storedRole is owner, keep owner
          if (isOwner && storedRole === 'owner') {
            setUserRole('owner')
          } else {
            setUserRole('player')
          }
          setAuthStatus('ready')
        }
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

    console.log(`[AuthGate] Status:${authStatus} Role:${userRole} Path:/${segments.join('/')}`)

    const replaceIfNeeded = (target: string) => {
      if (pathname !== target) {
        router.replace(target as any)
      }
    }

    // Prevent infinite loops and handle redirects
    if (authStatus === 'unauthenticated' && !isPublicRoute) {
      if (isWeb) {
        replaceIfNeeded('/owner/login')
      } else {
        replaceIfNeeded('/login')
      }
    } else if (authStatus === 'needs_setup' && !isProfileSetupRoute && !isOwnerRoute && !isPublicRoute) {
      replaceIfNeeded('/profile-setup')
    } else if (authStatus === 'needs_onboarding' && !isOnboardingRoute && !isOwnerRoute && !isPublicRoute) {
      replaceIfNeeded('/onboarding')
    } else if (authStatus === 'ready') {
      // 1. If at login screen or root, go to appropriate dashboard
      if (isPublicRoute || segments.length === 0) {
        if (isWeb && (isOwnerLoginRoute || isRegisterRoute)) {
          return
        }
        if (isWeb) {
          replaceIfNeeded('/owner/dashboard')
        } else if (userRole === 'owner') {
          replaceIfNeeded('/owner/dashboard')
        } else {
          replaceIfNeeded('/(tabs)')
        }
      } 
      // 2. If Role is Owner but we are on a Player route, force redirect to Owner
      else if (userRole === 'owner' && isPlayerRoute) {
        console.log('[AuthGate] Forced redirect: Owner role on Player route')
        replaceIfNeeded('/owner/dashboard')
      }
    }
  }, [authStatus, fontsLoaded, navReady, pathname, segments, userRole, router])

  // Don't render anything while determining auth status or loading fonts
  if (authStatus === 'loading' || !fontsLoaded) {
    return null
  }

  return <>{children}</>
}
