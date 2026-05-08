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
  } | null
  created_at: string
  updated_at: string
}

export function useSessionDetail(id?: string, userId?: string | null) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [session, setSession] = useState<SessionDetailRecord | null>(null)
  const [viewerPlayer, setViewerPlayer] = useState<ViewerPlayer | null>(null)
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('none')
  const [hostResponseTemplate, setHostResponseTemplate] = useState<string | null>(null)
  const [introNote, setIntroNote] = useState('')
  const [matches, setMatches] = useState<SessionMatch[]>([])

  const fetchSession = useCallback(async () => {
    if (!id) return

    setError(null)
    const [sessionRes, matchesRes] = await Promise.all([
      supabase.rpc('get_session_detail_overview', { p_session_id: id }),
      supabase.rpc('get_session_matches', { p_session_id: id })
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

    if (userId) {
      const { data: viewerData } = await supabase.from('players').select('id, elo, current_elo').eq('id', userId).single()
      setViewerPlayer((viewerData as ViewerPlayer | null) ?? null)

      // Check if user has rated this session
      const { data: ratingsData } = await supabase
        .from('ratings')
        .select('id')
        .eq('session_id', id)
        .eq('rater_id', userId)
        .limit(1)
      
      if (nextSession) {
        nextSession.has_rated = (ratingsData?.length ?? 0) > 0
        setSession({ ...nextSession })
      }
    } else {
      setViewerPlayer(null)
    }
  }, [id, userId])

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
  }
}
