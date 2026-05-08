import { useCallback, useEffect, useState } from 'react'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'
import { 
    type FamiliarCourt,
    type HomeProfile,
    type MatchSession,
    type PendingMatch,
    type PlayerStatsRecord,
    type PostMatchAction,
} from '@/lib/homeFeed'
import { fetchHomeDataApi, type HomeData } from '../api'

const HOME_DATA_CACHE_PREFIX = 'picklematch_home_data_cache:'

function getHomeCacheKey(userId: string) {
  return `${HOME_DATA_CACHE_PREFIX}${userId}`
}

export function useHomeFeedData(userId?: string | null, isAuthLoading?: boolean) {
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<HomeProfile | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStatsRecord | null>(null)
  const [nextMatch, setNextMatch] = useState<MatchSession | null>(null)
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([])
  const [postMatchActions, setPostMatchActions] = useState<PostMatchAction[]>([])
  const [personalizedSessions, setPersonalizedSessions] = useState<MatchSession[]>([])
  const [rescueSessions, setRescueSessions] = useState<MatchSession[]>([])
  const [familiarCourts, setFamiliarCourts] = useState<FamiliarCourt[]>([])
  const [isFirstLoad, setIsFirstLoad] = useState(true)

  useEffect(() => {
    if (isAuthLoading) return
    if (!userId) {
      setProfile(null)
      setPlayerStats(null)
      setPendingMatches([])
      setPostMatchActions([])
      setNextMatch(null)
      setPersonalizedSessions([])
      setRescueSessions([])
      setFamiliarCourts([])
      setLoading(false)
      return
    }

    const loadCache = async () => {
      try {
        const cachedStr = await safeStorageGetItem(getHomeCacheKey(userId))
        if (cachedStr) {
          const data = JSON.parse(cachedStr) as HomeData
          setProfile(data.profile)
          setPlayerStats(data.playerStats)
          setPendingMatches(data.pendingMatches)
          setPostMatchActions(data.postMatchActions)
          setNextMatch(data.nextMatch)
          setPersonalizedSessions(data.personalizedSessions)
          setRescueSessions(data.rescueSessions)
          setFamiliarCourts(data.familiarCourts)
          
          // If we have cache, we can stop the initial "hard" loading indicator
          // and let the background fetch handle the "refreshing" state if needed
          setLoading(false)
        }
      } catch (e) {
        console.warn('[HomeCache] Failed to load cache:', e)
      }
    }
    void loadCache()
  }, [isAuthLoading, userId])

  const fetchHomeData = useCallback(async () => {
    if (isAuthLoading) return
    setLoading(true)

    try {
      const data = await fetchHomeDataApi(userId ?? null)
      setProfile(data.profile)
      setPlayerStats(data.playerStats)
      setPendingMatches(data.pendingMatches)
      setPostMatchActions(data.postMatchActions)
      setNextMatch(data.nextMatch)
      setPersonalizedSessions(data.personalizedSessions)
      setRescueSessions(data.rescueSessions)
      setFamiliarCourts(data.familiarCourts)

      // Save to cache (scoped by user)
      if (userId) {
        void safeStorageSetItem(getHomeCacheKey(userId), JSON.stringify(data))
      }
    } catch (error) {
      console.error('[HomeHook] fetchHomeData failed:', error)
    } finally {
      setLoading(false)
      setIsFirstLoad(false)
    }
  }, [isAuthLoading, userId])

  useEffect(() => {
    void fetchHomeData()
  }, [fetchHomeData])


  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchHomeData()
    setRefreshing(false)
  }, [fetchHomeData])

  return {
    refreshing,
    loading,
    profile,
    playerStats,
    nextMatch,
    pendingMatches,
    postMatchActions,
    personalizedSessions,
    rescueSessions,
    familiarCourts,
    isFirstLoad,
    fetchHomeData,
    onRefresh,
  }
}
