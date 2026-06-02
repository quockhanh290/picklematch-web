import type {
  SessionPairHistoryRow,
  SessionLiveMatchRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'

export type RegisteredSessionPlayerRow = {
  player_id: string
  team_no?: number | null
  status?: string | null
  check_in_status?: string | null
  metadata?: any
  players?: {
    name?: string | null
    pvna?: number | null
    current_elo?: number | null
    elo?: number | null
    gender?: string | null
    reliability_score?: number | null
    sessions_joined?: number | null
    no_show_count?: number | null
    self_assessed_level?: string | null
    skill_label?: string | null
    partner_gender_pref?: string | null
    opponent_gender_pref?: string | null
  } | null
}

export type NextRoundSuggesterV2Props = {
  sessionId: string
  players?: ArrangementPlayer[]
  courts?: number
  bootstrapTelemetry?: Record<string, unknown> | null
  initialShowReport?: boolean
}

export type LiveRows = {
  playerRows: SessionPlayerStateRow[]
  registeredPlayerRows: RegisteredSessionPlayerRow[]
  pairRows: SessionPairHistoryRow[]
  roundRows: SessionRoundRow[]
  liveMatchRows: SessionLiveMatchRow[]
  liveStateVersion: number | null
}

export type SheetKey = 'settings' | 'swap' | 'fairness' | 'preview' | 'roster' | 'history' | 'late-arrivals' | 'more' | null

export type RoundSelectionSnapshot = {
  selectedAlternative: number
  manualAlternative: SuggestionAlternative | null
  pvnaTolerance: number
  courtCount: number
  reason: string
}
