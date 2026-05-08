import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'

const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000

export function useAuth() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let isMounted = true
    const loadingTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn('[useAuth] getSession timeout, fallback to unauthenticated')
        setUserId(null)
      }
    }, AUTH_BOOTSTRAP_TIMEOUT_MS)

    const bootstrapSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) {
          console.error('[useAuth] getSession failed:', error.message)
        }
        if (isMounted) {
          setUserId(session?.user?.id ?? null)
        }
      } catch (error) {
        console.error('[useAuth] getSession exception:', error)
        if (isMounted) {
          setUserId(null)
        }
      } finally {
        clearTimeout(loadingTimeout)
      }
    }

    void bootstrapSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUserId(session?.user?.id ?? null)
      }
    })

    return () => {
      isMounted = false
      clearTimeout(loadingTimeout)
      subscription.unsubscribe()
    }
  }, [])

  return { userId, isLoading: userId === undefined }
}
