import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type SessionPlayer = {
  player_id: string
  team_no?: number | null
  elo_snapshot?: number | null
  status?: string | null
  match_result?: string | null
  proposed_result?: 'win' | 'loss' | 'draw' | null
  result_confirmation_status?: string | null
  result_dispute_note?: string | null
  player: {
    name: string
    elo?: number | null
    current_elo?: number | null
    self_assessed_level?: string | null
    skill_label?: string | null
    gender?: string | null
    pvna?: number | null
    reliability_score?: number | null
    sessions_joined?: number | null
    no_show_count?: number | null
    sessions_joined?: number | null
    no_show_count_total?: number | null
  } | null
  check_in_status?: 'present' | 'no_show' | 'pending' | null
}

export type SessionDetailRecord = {
  id: string
  max_players: number
  elo_min: number
  elo_max: number
  status: string
  fill_deadline?: string | null
  results_status?: string | null
  results_submitted_at?: string | null
  results_confirmation_deadline?: string | null
  is_ranked?: boolean | null
  elo_processed?: boolean | null
  elo_skip_reason?: string | null
  require_approval: boolean
  total_cost?: number | null
  court_booking_status: 'confirmed' | 'unconfirmed'
  booking_reference?: string | null
  booking_name?: string | null
  booking_phone?: string | null
  booking_notes?: string | null
  host: {
    id: string
    name: string
    auto_accept?: boolean | null
    elo?: number | null
    current_elo?: number | null
    self_assessed_level?: string | null
    skill_label?: string | null
    reliability_score?: number | null
    sessions_joined?: number | null
    no_show_count?: number | null
  }
  slot: {
    id?: string
    start_time: string
    end_time: string
    price: number
    court: {
      id?: string
      name: string
      address: string
      city: string
    }
  }
  session_players: SessionPlayer[]
  has_rated?: boolean
  is_owner_managed?: boolean
  owner_format?: string
  owner_sessions?: any[] | Record<string, any> | null
  sub_court_numbers?: number[]
  is_unlimited?: boolean
  format_metadata?: any
  check_in_completed?: boolean
}

export type RequestStatus = 'none' | 'pending' | 'accepted' | 'rejected'

export type ViewerPlayer = {
  id: string
  elo?: number | null
  current_elo?: number | null
}

export type SessionMatch = {
  id: string
  session_id: string
  team_a_no: number
  team_b_no: number
  score_a: number
  score_b: number
  court_no?: number | null
  status: 'playing' | 'finished' | 'cancelled'
  players_snapshot?: {
    team_a: string[]
    team_b: string[]
    rotation?: number
    court?: number
    sitter_id?: string
  } | null
  created_at: string
  updated_at: string
}

type UseSessionDetailOptions = {
  includeMatches?: boolean
  includeViewerExtras?: boolean
  traceLabel?: string
}

export type SessionDetailTiming = {
  trace_label: string | null
  include_matches: boolean
  include_viewer_extras: boolean
  session_detail_ms: number | null
  matches_ms: number | null
  viewer_profile_ms: number | null
  ratings_ms: number | null
  total_ms: number
  measured_at: string
}

export function useSessionDetail(id?: string, userId?: string | null, options: UseSessionDetailOptions = {}) {
  const includeMatches = options.includeMatches ?? true
  const includeViewerExtras = options.includeViewerExtras ?? true
  const traceLabel = options.traceLabel ?? null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [session, setSession] = useState<SessionDetailRecord | null>(null)
  const [viewerPlayer, setViewerPlayer] = useState<ViewerPlayer | null>(null)
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('none')
  const [hostResponseTemplate, setHostResponseTemplate] = useState<string | null>(null)
  const [introNote, setIntroNote] = useState('')
  const [matches, setMatches] = useState<SessionMatch[]>([])
  const [lastTiming, setLastTiming] = useState<SessionDetailTiming | null>(null)

  const fetchSession = useCallback(async () => {
    if (!id) return

    const startedAt = Date.now()
    const measuredAt = new Date().toISOString()
    const nextTiming: SessionDetailTiming = {
      trace_label: traceLabel,
      include_matches: includeMatches,
      include_viewer_extras: includeViewerExtras,
      session_detail_ms: null,
      matches_ms: null,
      viewer_profile_ms: null,
      ratings_ms: null,
      total_ms: 0,
      measured_at: measuredAt,
    }
    const timed = async <T,>(key: keyof Pick<SessionDetailTiming, 'session_detail_ms' | 'matches_ms' | 'viewer_profile_ms' | 'ratings_ms'>, action: () => Promise<T>) => {
      const stepStartedAt = Date.now()
      const result = await action()
      nextTiming[key] = Date.now() - stepStartedAt
      return result
    }

    setError(null)
    const [sessionRes, matchesRes] = await Promise.all([
      timed('session_detail_ms', () => supabase.rpc('get_session_detail_overview', { p_session_id: id })),
      includeMatches
        ? timed('matches_ms', () => supabase.rpc('get_session_matches', { p_session_id: id }))
        : Promise.resolve({ data: [], error: null }),
    ])

    if (sessionRes.error) {
      setError(sessionRes.error.message)
      setSession(null)
      return
    }

    const nextSession = (sessionRes.data?.session ?? null) as SessionDetailRecord | null
    setSession(nextSession)
    setRequestStatus((sessionRes.data?.viewer_request_status as RequestStatus | null) ?? 'none')
    setHostResponseTemplate((sessionRes.data?.viewer_host_response_template as string | null) ?? null)
    setIntroNote((sessionRes.data?.viewer_intro_note as string | null) ?? '')
    
    setMatches((matchesRes.data as SessionMatch[]) ?? [])

    if (userId && includeViewerExtras) {
      const [viewerRes, ratingsRes] = await Promise.all([
        timed('viewer_profile_ms', () => supabase.from('players').select('id, elo, current_elo').eq('id', userId).single()),
        timed('ratings_ms', () =>
          supabase
            .from('ratings')
            .select('id')
            .eq('session_id', id)
            .eq('rater_id', userId)
            .limit(1),
        ),
      ])
      const { data: viewerData } = viewerRes
      setViewerPlayer((viewerData as ViewerPlayer | null) ?? null)

      if (nextSession) {
        nextSession.has_rated = (ratingsRes.data?.length ?? 0) > 0
        setSession({ ...nextSession })
      }
    } else {
      setViewerPlayer(null)
    }
    nextTiming.total_ms = Date.now() - startedAt
    setLastTiming(nextTiming)
    if (__DEV__ && traceLabel) {
      console.log(`[${traceLabel}] session detail timing`, nextTiming)
    }
  }, [id, includeMatches, includeViewerExtras, traceLabel, userId])

  useEffect(() => {
    let mounted = true

    async function run() {
      setLoading(true)
      await fetchSession()
      if (mounted) setLoading(false)
    }

    void run()

    return () => {
      mounted = false
    }
  }, [fetchSession])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchSession()
    setRefreshing(false)
  }, [fetchSession])

  return {
    loading,
    refreshing,
    session,
    viewerPlayer,
    requestStatus,
    setRequestStatus,
    hostResponseTemplate,
    setHostResponseTemplate,
    introNote,
    setIntroNote,
    matches,
    fetchSession,
    onRefresh,
    error,
    lastTiming,
  }
}
