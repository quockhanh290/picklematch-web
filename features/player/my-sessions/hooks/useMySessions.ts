import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/lib/useAuth'
import { resolveTab } from '@/lib/mySessionsLogic'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'
import { MySession, SessionTab } from '../types'
import { fetchMySessionsApi } from '../api'

export type HistoryStatusFilter = 'all' | 'done' | 'pending_completion' | 'cancelled'
export type HistoryRoleFilter = 'all' | 'host' | 'player'
export type HistoryTimeFilter = 'all' | '7d' | '30d' | '90d'
export type HistoryRatingFilter = 'all' | 'rated' | 'not_rated'
export type HistoryResultFilter = 'all' | 'submitted' | 'not_submitted'

type MySessionsCache = {
  userId: string
  sessions: MySession[]
  updatedAt: number
}

const mySessionsCacheByUser = new Map<string, MySessionsCache>()
const MY_SESSIONS_LAST_USER_KEY = 'my_sessions_last_user_id_v1'

function getMySessionsCacheKey(userId: string) {
  return `my_sessions_overview_cache_v1:${userId}`
}

export const HISTORY_PAGE_SIZE = 20

function sessionsFingerprint(items: MySession[]) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      status: item.status,
      court_booking_status: item.court_booking_status,
      host_id: item.host_id,
      role: item.role,
      request_status: item.request_status,
      start_time: item.start_time,
      end_time: item.end_time,
      court_name: item.court_name,
      court_city: item.court_city,
      court_address: item.court_address,
      host_name: item.host_name,
      player_count: item.player_count,
      max_players: item.max_players,
      elo_min: item.elo_min,
      elo_max: item.elo_max,
      has_rated: item.has_rated,
      results_status: item.results_status ?? null,
    })),
  )
}

function isSessionInPast(session: Pick<MySession, 'start_time' | 'end_time'>, nowMs = Date.now()) {
  const endAt = new Date(session.end_time).getTime()
  if (!Number.isNaN(endAt)) return endAt < nowMs
  const startAt = new Date(session.start_time).getTime()
  if (!Number.isNaN(startAt)) return startAt < nowMs
  return false
}

export function useMySessions() {
  const { userId, isLoading: isAuthLoading } = useAuth()
  const [sessions, setSessions] = useState<MySession[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<SessionTab>('upcoming')
  
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>('all')
  const [historyRoleFilter, setHistoryRoleFilter] = useState<HistoryRoleFilter>('all')
  const [historyTimeFilter, setHistoryTimeFilter] = useState<HistoryTimeFilter>('all')
  const [historyRatingFilter, setHistoryRatingFilter] = useState<HistoryRatingFilter>('all')
  const [historyResultFilter, setHistoryResultFilter] = useState<HistoryResultFilter>('all')
  
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_PAGE_SIZE)
  const [historyExpandedMonths, setHistoryExpandedMonths] = useState<Record<string, boolean>>({})
  
  const initInFlightRef = useRef(false)
  const fetchInFlightRef = useRef<Promise<void> | null>(null)
  const sessionsRef = useRef<MySession[]>([])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const hydrateCachedSessions = useCallback(async (nextUserId: string) => {
    const memoryCache = mySessionsCacheByUser.get(nextUserId) ?? null
    if (memoryCache?.sessions.length) {
      setSessions(memoryCache.sessions)
      setLoading(false)
      return true
    }

    try {
      const raw = await safeStorageGetItem(getMySessionsCacheKey(nextUserId))
      if (!raw) return false
      const parsed = JSON.parse(raw) as MySessionsCache
      if (parsed.userId !== nextUserId || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return false
      mySessionsCacheByUser.set(parsed.userId, parsed)
      setSessions(parsed.sessions)
      setLoading(false)
      return true
    } catch (error) {
      console.warn('[MySessions] cache hydrate failed:', error)
      return false
    }
  }, [])

  const fetchMySessions = useCallback(
    async (nextUserId: string, options?: { showLoader?: boolean }) => {
      if (fetchInFlightRef.current) {
        await fetchInFlightRef.current
        return
      }

      const run = async () => {
        const showLoader = options?.showLoader ?? false
        if (showLoader) setLoading(true)

        const nextSessions = await fetchMySessionsApi(nextUserId)

        const nextCache = { userId: nextUserId, sessions: nextSessions, updatedAt: Date.now() }
        mySessionsCacheByUser.set(nextUserId, nextCache)

        try {
          await Promise.all([
            safeStorageSetItem(getMySessionsCacheKey(nextUserId), JSON.stringify(nextCache)),
            safeStorageSetItem(MY_SESSIONS_LAST_USER_KEY, nextUserId),
          ])
        } catch (error) {
          console.warn('[MySessions] cache persist failed:', error)
        }

        const nextFingerprint = sessionsFingerprint(nextSessions)
        const currentFingerprint = sessionsFingerprint(sessionsRef.current)
        if (nextFingerprint !== currentFingerprint) {
          setSessions(nextSessions)
        }

        if (showLoader) setLoading(false)
      }

      fetchInFlightRef.current = run()
      try {
        await fetchInFlightRef.current
      } finally {
        fetchInFlightRef.current = null
      }
    },
    [],
  )

  const init = useCallback(async () => {
    if (initInFlightRef.current) return
    initInFlightRef.current = true

    try {
      if (isAuthLoading) return
      if (!userId) {
        setSessions([])
        setLoading(false)
        return
      }

      const hydrated = await hydrateCachedSessions(userId)
      if (hydrated) {
        void fetchMySessions(userId, { showLoader: false })
        return
      }
      await fetchMySessions(userId, { showLoader: true })
    } finally {
      initInFlightRef.current = false
    }
  }, [fetchMySessions, hydrateCachedSessions, isAuthLoading, userId])

  useEffect(() => {
    void init()
  }, [init])


  const onRefresh = useCallback(async () => {
    if (!userId) return
    setRefreshing(true)
    try {
      await fetchMySessions(userId, { showLoader: false })
    } finally {
      setRefreshing(false)
    }
  }, [fetchMySessions, userId])

  const sessionsByTab = useMemo(
    () => ({
      upcoming: sessions
        .filter((s) => {
          const tab = resolveTab(s)
          return (tab === 'upcoming' || tab === 'pending') && !isSessionInPast(s)
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
      history: sessions
        .filter((s) => resolveTab(s) === 'history' || (resolveTab(s) === 'upcoming' && isSessionInPast(s)))
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()),
    }),
    [sessions],
  )

  const filteredHistorySessions = useMemo(() => {
    const now = Date.now()
    return sessionsByTab.history.filter((session) => {
      if (historyStatusFilter !== 'all' && session.status !== historyStatusFilter) return false
      if (historyRoleFilter !== 'all' && session.role !== historyRoleFilter) return false
      if (historyRatingFilter === 'rated' && !session.has_rated) return false
      if (historyRatingFilter === 'not_rated' && session.has_rated) return false

      const hasSubmittedResult =
        session.results_status !== null &&
        session.results_status !== undefined &&
        session.results_status !== 'not_submitted'
      if (historyResultFilter === 'submitted' && !hasSubmittedResult) return false
      if (historyResultFilter === 'not_submitted' && hasSubmittedResult) return false

      if (historyTimeFilter !== 'all') {
        const startAt = new Date(session.start_time).getTime()
        if (Number.isNaN(startAt)) return false
        const ageDays = (now - startAt) / (1000 * 60 * 60 * 24)
        if (historyTimeFilter === '7d' && ageDays > 7) return false
        if (historyTimeFilter === '30d' && ageDays > 30) return false
        if (historyTimeFilter === '90d' && ageDays > 90) return false
      }
      return true
    })
  }, [historyRatingFilter, historyResultFilter, historyRoleFilter, sessionsByTab.history, historyStatusFilter, historyTimeFilter])

  return {
    userId,
    loading,
    refreshing,
    onRefresh,
    activeTab,
    setActiveTab,
    sessionsByTab,
    filteredHistorySessions,
    historyStatusFilter,
    setHistoryStatusFilter,
    historyRoleFilter,
    setHistoryRoleFilter,
    historyTimeFilter,
    setHistoryTimeFilter,
    historyRatingFilter,
    setHistoryRatingFilter,
    historyResultFilter,
    setHistoryResultFilter,
    historyVisibleCount,
    setHistoryVisibleCount,
    historyExpandedMonths,
    setHistoryExpandedMonths,
  }
}
