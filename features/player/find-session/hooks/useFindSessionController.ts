import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'
import { ADVANCED_FILTER_INITIAL, AdvancedFilter } from '@/components/find-session/AdvancedSessionFilterModal'
import { AppDialogConfig } from '@/components/design'
import { getSkillLevelFromEloRange, getSkillLevelFromPlayer } from '@/lib/skillAssessment'
import { haversineKm } from '@/lib/useNearbyCourts'

import { 
  Session, 
  QuickFilterId, 
  PlayerQueueProfile 
} from '../types'
import { 
  fetchSessionsApi, 
  fetchPlayerProfileApi 
} from '../api'
import { 
  buildSearchIndex, 
  computeMatchScore, 
  extractDistrict, 
  normalizeText 
} from '../utils'

const SMART_QUEUE_STORAGE_PREFIX = '@picklematch/smart-queue:'

export function useFindSessionController() {
  const params = useLocalSearchParams<{ courtId?: string; courtName?: string }>()
  const [sessions, setSessions] = useState<Session[]>([])
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null)
  const [loading, setLoading] = useState(true)
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(0)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sortMode, setSortMode] = useState<'match' | 'time'>('match')
  const [quickFilters, setQuickFilters] = useState<Record<QuickFilterId, boolean>>({
    nearby: false,
    recent: false,
    level3: false,
    rescue: false,
  })
  const [preferredCourtFilter, setPreferredCourtFilter] = useState<{ id?: string; name?: string } | null>(null)
  const [filterModalVisible, setFilterModalVisible] = useState(false)
  const [advancedFilter, setAdvancedFilter] = useState<AdvancedFilter>(ADVANCED_FILTER_INITIAL)
  const [playerProfile, setPlayerProfile] = useState<PlayerQueueProfile | null>(null)
  const [smartQueueEnabled, setSmartQueueEnabled] = useState(false)
  const [smartQueueHydrated, setSmartQueueHydrated] = useState(false)

  const getSmartQueueKey = (userId: string) => `${SMART_QUEUE_STORAGE_PREFIX}${userId}`
  const smartQueueStorageKey = playerProfile?.id ? getSmartQueueKey(playerProfile.id) : null

  const activeAdvancedFiltersCount = useMemo(
    () =>
      [
        advancedFilter.district,
        advancedFilter.date,
        advancedFilter.weekend,
        advancedFilter.timeSlot,
        advancedFilter.skillLevel,
        advancedFilter.priceMin != null,
        advancedFilter.priceMax != null,
        advancedFilter.bookingStatus,
        advancedFilter.slotsLeft != null,
      ].filter(Boolean).length,
    [advancedFilter],
  )

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const currentUserId = user?.id ?? null
      const data = await fetchSessionsApi(currentUserId)

      // Pre-calculate search index to speed up filtering
      const enrichedData = data.map(s => ({
        ...s,
        searchIndex: buildSearchIndex(s)
      }))

      setSessions(enrichedData as any)
      setLastFetchedAt(Date.now())
    } catch (error) {
      console.warn('[FindSession] fetchSessions failed:', error)
      setDialogConfig({
        title: 'Network issue',
        message: 'Unable to refresh sessions right now. Please try again.',
        actions: [{ label: 'OK' }],
      })
    } finally {
      setLoading(false)
      setIsFirstLoad(false)
    }
  }, [])

  const fetchPlayerProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setPlayerProfile(null)
        setSmartQueueEnabled(false)
        setSmartQueueHydrated(true)
        return
      }
      const [profile, storedFlag] = await Promise.all([
        fetchPlayerProfileApi(user.id),
        safeStorageGetItem(getSmartQueueKey(user.id)),
      ])
      setPlayerProfile(profile)
      setSmartQueueEnabled(storedFlag === '1')
    } catch (error) {
      console.warn('[FindSession] fetchPlayerProfile failed:', error)
      setPlayerProfile(null)
      setSmartQueueEnabled(false)
    } finally {
      setSmartQueueHydrated(true)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    void fetchPlayerProfile()
  }, [fetchPlayerProfile, fetchSessions])

  useFocusEffect(
    useCallback(() => {
      // Only refresh if data is older than 2 minutes and not currently loading
      const isStale = Date.now() - lastFetchedAt > 2 * 60 * 1000
      if (!isFirstLoad && !loading && isStale) {
        fetchSessions()
      }
    }, [isFirstLoad, loading, lastFetchedAt, fetchSessions])
  )

  useEffect(() => {
    const handler = setTimeout(() => {
      setQuery(searchInput)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchInput])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([fetchSessions(), fetchPlayerProfile()])
    } finally {
      setRefreshing(false)
    }
  }, [fetchPlayerProfile, fetchSessions])

  const handleNearbyFilter = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setDialogConfig({
          title: 'Quyền truy cập',
          message: 'Vui lòng cho phép ứng dụng truy cập vị trí để tìm các kèo gần bạn.',
          actions: [{ label: 'Đã hiểu' }],
        })
        return
      }

      setLoading(true)
      if (Platform.OS !== 'web') {
        try {
          await Haptics.selectionAsync()
        } catch {}
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setUserLocation(location)
      setQuickFilters(prev => ({ ...prev, nearby: true }))
    } catch (error) {
      console.warn('[FindSession] nearby filter failed:', error)
      setDialogConfig({
        title: 'Lỗi',
        message: 'Không thể xác định vị trí của bạn lúc này.',
        actions: [{ label: 'Đã hiểu' }],
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const applySmartQueueFilters = useCallback(
    async (enabled: boolean) => {
      if (!playerProfile?.id) {
        setDialogConfig({
          title: 'Cần hoàn thiện hồ sơ',
          message: 'Gợi ý hợp gu cần thành phố và mức trình gần đúng để ưu tiên kèo phù hợp hơn.',
          actions: [
            { label: 'Để sau', tone: 'secondary' },
            { label: 'Chỉnh hồ sơ', onPress: () => router.push('/edit-profile' as never) },
          ],
        })
        return
      }
      if (!enabled) {
        setSmartQueueEnabled(false)
        setQuickFilters({ nearby: false, recent: false, level3: false, rescue: false })
        setQuery('')
        setSearchInput('')
        if (smartQueueStorageKey) await safeStorageSetItem(smartQueueStorageKey, '0')
        return
      }
      const playerLevel = getSkillLevelFromPlayer(playerProfile)
      const nextQuery = playerProfile.city?.trim() ?? ''
      const normalizedCity = normalizeText(playerProfile.city)
      const canUseNearbyFilter = normalizedCity.includes('ho chi minh') || normalizedCity.includes('thu duc')
      setSortMode('match')
      setQuery(nextQuery)
      setSearchInput(nextQuery)
      setQuickFilters({ nearby: canUseNearbyFilter, recent: true, level3: playerLevel?.id === 'level_3', rescue: false })
      setSmartQueueEnabled(true)
      if (smartQueueStorageKey) await safeStorageSetItem(smartQueueStorageKey, '1')
    },
    [playerProfile, smartQueueStorageKey],
  )

  const clearCourtFilter = useCallback(() => {
    setPreferredCourtFilter(null)
    setQuery('')
    setSearchInput('')
  }, [])

  useEffect(() => {
    if (!smartQueueHydrated || !playerProfile?.id || !smartQueueEnabled) return
    void applySmartQueueFilters(true)
  }, [applySmartQueueFilters, playerProfile?.id, smartQueueEnabled, smartQueueHydrated])

  useEffect(() => {
    const routeCourtId = typeof params.courtId === 'string' ? params.courtId : undefined
    const routeCourtName = typeof params.courtName === 'string' ? params.courtName : undefined
    if (!routeCourtId && !routeCourtName) return
    setPreferredCourtFilter({ id: routeCourtId, name: routeCourtName })
    if (routeCourtName) {
      setQuery(routeCourtName)
      setSearchInput(routeCourtName)
    }
  }, [params.courtId, params.courtName])

  const filteredSessions = useMemo(() => {
    const normalizedSearch = normalizeText(query)
    return sessions.filter((session: any) => {
      if (normalizedSearch && !(session.searchIndex ?? '').includes(normalizedSearch)) return false
      if (!advancedFilter.skillLevel && quickFilters.level3 && getSkillLevelFromEloRange(session.elo_min, session.elo_max).id !== 'level_3') return false
      if (quickFilters.rescue && session.max_players - session.player_count > 2) return false
      if (quickFilters.recent) {
        const hoursUntilStart = (new Date(session.slot?.start_time ?? 0).getTime() - Date.now()) / 3600000
        if (hoursUntilStart < 0 || hoursUntilStart > 48) return false
      }
      if (quickFilters.nearby) {
        if (userLocation && session.lat != null && session.lng != null) {
          const dist = haversineKm(userLocation.coords.latitude, userLocation.coords.longitude, session.lat, session.lng)
          if (dist > 15) return false
        } else {
          const city = normalizeText(session.slot?.court?.city)
          if (!city.includes('ho chi minh') && !city.includes('thu duc')) return false
        }
      }
      if (preferredCourtFilter?.id) {
        if (session.slot?.court?.id !== preferredCourtFilter.id) return false
      } else if (preferredCourtFilter?.name) {
        if (normalizeText(session.slot?.court?.name) !== normalizeText(preferredCourtFilter.name)) return false
      }
      if (advancedFilter.district) {
        const d = extractDistrict(session.slot?.court?.address)
        if (d !== advancedFilter.district) return false
      }
      if (advancedFilter.weekend) {
        const day = session.slot?.start_time ? new Date(session.slot.start_time).getDay() : -1
        if (day !== 0 && day !== 6) return false
      } else if (advancedFilter.date && /^\d{2}\/\d{2}\/\d{4}$/.test(advancedFilter.date)) {
        const s = session.slot?.start_time ? new Date(session.slot.start_time) : null
        const [d, m, y] = advancedFilter.date.split('/')
        if (!s || s.getDate() !== Number(d) || s.getMonth() + 1 !== Number(m) || s.getFullYear() !== Number(y)) return false
      }
      if (advancedFilter.timeSlot) {
        const s = session.slot?.start_time ? new Date(session.slot.start_time) : null
        if (s) {
          const hour = s.getHours()
          if (advancedFilter.timeSlot === 'Sáng' && (hour < 5 || hour >= 12)) return false
          if (advancedFilter.timeSlot === 'Chiều' && (hour < 12 || hour >= 18)) return false
          if (advancedFilter.timeSlot === 'Tối' && (hour < 18 || hour >= 23)) return false
        }
      }
      if (advancedFilter.skillLevel) {
        if (getSkillLevelFromEloRange(session.elo_min, session.elo_max).id !== advancedFilter.skillLevel) return false
      }
      if (typeof advancedFilter.priceMin === 'number' || typeof advancedFilter.priceMax === 'number') {
        const validRange = !(typeof advancedFilter.priceMin === 'number' && typeof advancedFilter.priceMax === 'number' && advancedFilter.priceMin > advancedFilter.priceMax)
        if (validRange) {
          const pricePer = session.max_players > 0 ? Math.round((session.slot?.price ?? 0) / session.max_players) : 0
          if (typeof advancedFilter.priceMin === 'number' && pricePer < advancedFilter.priceMin * 1000) return false
          if (typeof advancedFilter.priceMax === 'number' && pricePer > advancedFilter.priceMax * 1000) return false
        }
      }
      if (advancedFilter.bookingStatus) {
        if (session.court_booking_status !== advancedFilter.bookingStatus) return false
      }
      if (typeof advancedFilter.slotsLeft === 'number') {
        if ((session.max_players - session.player_count) < advancedFilter.slotsLeft) return false
      }
      return true
    }).sort((a, b) => {
      if (sortMode === 'time') {
        return new Date(a.slot?.start_time ?? 0).getTime() - new Date(b.slot?.start_time ?? 0).getTime()
      }
      return computeMatchScore(b, quickFilters.rescue, quickFilters.level3) - computeMatchScore(a, quickFilters.rescue, quickFilters.level3)
    })
  }, [preferredCourtFilter, query, quickFilters, sessions, sortMode, advancedFilter, userLocation])

  return {
    sessions,
    userLocation,
    loading,
    isFirstLoad,
    dialogConfig,
    setDialogConfig,
    refreshing,
    onRefresh,
    query: searchInput,
    setQuery: setSearchInput,
    sortMode,
    setSortMode,
    quickFilters,
    preferredCourtFilter,
    clearCourtFilter,
    setPreferredCourtFilter,
    filterModalVisible,
    setFilterModalVisible,
    advancedFilter,
    setAdvancedFilter,
    activeAdvancedFiltersCount,
    playerProfile,
    smartQueueEnabled,
    smartQueueHydrated,
    applySmartQueueFilters,
    handleNearbyFilter,
    filteredSessions,
  }
}
