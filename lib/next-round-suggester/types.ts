export type SessionStatus = 'waiting' | 'active' | 'paused' | 'ended'
export type RoundStatus = 'proposed' | 'active' | 'completed'

export type ScoringWeights = {
  elo: number
  partner_repeat: number
  opponent_repeat: number
  group_bonus: number
}

export type PlayerSessionState = {
  player_id: string
  elo: number
  group_id: string | null
  checked_in_at: Date
  checked_out_at: Date | null
  matches_played: number
  last_played_round: number
  consecutive_rest: number
  consecutive_play: number
  partner_counts: Map<string, number>
  opponent_counts: Map<string, number>
  opted_rest: boolean
}

export type Team = [string, string]

export type Match = {
  court_idx: number
  team_a: Team
  team_b: Team
}

export type MatchStats = {
  elo_diff: number
  partner_repeats: number
  opponent_repeats: number
  group_bonus: number
}

export type MatchScore = {
  score: number
  stats: MatchStats
}

export type RoundRecord = {
  id?: string
  session_id: string
  round_no: number
  status: RoundStatus
  matches: Match[]
  resting: string[]
  started_at: Date | null
  ended_at: Date | null
}

export type SessionState = {
  session_id: string
  current_round: number
  status: SessionStatus
  config: {
    courts: number
    elo_tolerance: number
    weights: ScoringWeights
  }
  players: Map<string, PlayerSessionState>
  rounds: RoundRecord[]
}

export type SessionPlayerStateRow = {
  session_id: string
  player_id: string
  group_id: string | null
  checked_in_at: string
  checked_out_at: string | null
  matches_played: number
  last_played_round: number
  consecutive_rest: number
  consecutive_play: number
  opted_rest: boolean
  players?: {
    elo?: number | null
  } | null
}

export type SessionPairHistoryRow = {
  session_id: string
  player_a: string
  player_b: string
  partner_count: number
  opponent_count: number
}

export type SessionRoundRow = {
  id: string
  session_id: string
  round_no: number
  status: RoundStatus
  matches: Match[]
  resting: string[]
  started_at: string | null
  ended_at: string | null
}

export type HostCheckInRequest = {
  player_id: string
  group_with?: string[]
}

export type HostCheckoutRequest = {
  player_id: string
}

export type HostRestRequest = {
  player_id: string
  opted_rest: boolean
}

export type SuggestionAlternative = {
  matches: Match[]
  resting: string[]
  score: number
  warnings: string[]
  stats: MatchStats
  runtime_ms?: number
  iterations?: number
}

export type SuggestionResult = {
  alternatives: SuggestionAlternative[]
  warnings: string[]
  should_end: boolean
}
