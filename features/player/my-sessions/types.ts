import type { SessionRequestStatus } from '@/lib/mySessionsLogic'

export type SessionTab = 'upcoming' | 'history'

export type MySession = {
  id: string
  status: string
  court_booking_status?: 'confirmed' | 'unconfirmed' | null
  host_id?: string | null
  role: 'host' | 'player'
  request_status: SessionRequestStatus
  results_status?: 'not_submitted' | 'pending_confirmation' | 'disputed' | 'finalized' | 'void' | null
  user_result?: 'win' | 'loss' | 'draw' | null
  start_time: string
  end_time: string
  court_name: string
  court_city: string
  court_address: string
  host_name: string
  player_count: number
  max_players: number
  elo_min?: number | null
  elo_max?: number | null
  total_cost?: number | null
  has_rated?: boolean
  is_ranked?: boolean
  format_type?: string | null
  session_players?: unknown[]
}

export type HistorySection = {
  monthKey: string
  monthLabel: string
  items: MySession[]
}

export type SessionRow =
  | { type: 'section-header'; key: string; label: string; count?: number }
  | { type: 'next-session'; key: string; session: MySession }
  | { type: 'month'; key: string; monthKey: string; monthLabel: string; count: number }
  | { type: 'session'; key: string; session: MySession }
