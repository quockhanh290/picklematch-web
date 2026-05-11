import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'


export function useAuth() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let isMounted = true
    // Removed hard timeout to prevent false logouts on slow networks.
    // AuthGate will handle "slow connection" UX instead.

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
        // No timeout to clear
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
      subscription.unsubscribe()
    }
  }, [])

  return { userId, isLoading: userId === undefined }
}
