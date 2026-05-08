import { useCallback, useEffect, useState } from 'react'
import { fetchCurrentPlayerProfileDataApi } from '../api'
import type { ProfileDataSnapshot } from '../types'

export function useProfileController() {
  const [profile, setProfile] = useState<ProfileDataSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await fetchCurrentPlayerProfileDataApi({ force: true })
      setProfile(data)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const data = await fetchCurrentPlayerProfileDataApi()
        if (mounted) {
          setProfile(data)
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [])

  return {
    profile,
    loading,
    refreshing,
    onRefresh,
  }
}
