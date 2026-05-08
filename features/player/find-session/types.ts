import * as Location from 'expo-location'
import { AdvancedFilter } from '@/components/find-session/AdvancedSessionFilterModal'

export type Session = {
  id: string
  host_id: string
  elo_min: number
  elo_max: number
  max_players: number
  status: string
  court_booking_status: 'confirmed' | 'unconfirmed'
  host: {
    id: string
    name: string
    is_provisional?: boolean | null
    current_elo?: number | null
    elo?: number | null
    self_assessed_level?: string | null
    skill_label?: string | null
  } | null
  slot: {
    start_time: string
    end_time: string
    price: number
    court: { id: string; name: string; address: string; city: string; lat?: number | null; lng?: number | null } | null
  } | null
  session_players?: { player_id: string }[]
  player_count: number
  lat?: number | null
  lng?: number | null
}

export type QuickFilterId = 'nearby' | 'recent' | 'level3' | 'rescue'

export type PlayerQueueProfile = {
  id: string
  city?: string | null
  current_elo?: number | null
  elo?: number | null
  self_assessed_level?: string | null
  skill_label?: string | null
  favorite_court_ids?: string[] | null
}

export type FindSessionState = {
  sessions: Session[]
  userLocation: Location.LocationObject | null
  loading: boolean
  refreshing: boolean
  query: string
  sortMode: 'match' | 'time'
  quickFilters: Record<QuickFilterId, boolean>
  preferredCourtFilter: { id?: string; name?: string } | null
  filterModalVisible: boolean
  advancedFilter: AdvancedFilter
  playerProfile: PlayerQueueProfile | null
  smartQueueEnabled: boolean
  smartQueueHydrated: boolean
}
