import type {
  SessionPairHistoryRow,
  SessionLiveMatchRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'

export type NextRoundSuggesterV2Props = {
  sessionId: string
  players: ArrangementPlayer[]
  courts: number
  bootstrapTelemetry?: Record<string, unknown> | null
  initialShowReport?: boolean
}

export type LiveRows = {
  playerRows: SessionPlayerStateRow[]
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
