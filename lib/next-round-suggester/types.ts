export type SessionStatus = 'waiting' | 'active' | 'paused' | 'ended'
export type RoundStatus = 'proposed' | 'active' | 'completed'
export type LiveMatchStatus = 'suggested' | 'live' | 'completed' | 'cancelled'
export type Gender = 'M' | 'F' | null
export type GenderPreference = 'any' | 'M' | 'F'

export type ScoringWeights = {
  pvna: number
  partner_repeat: number
  opponent_repeat: number
  group_bonus: number
  partner_gender_pref: number
  opponent_gender_pref: number
  consecutive_play: number
}

export type PlayerSessionState = {
  player_id: string
  pvna: number
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
  gender: Gender
  partner_gender_pref: GenderPreference
  opponent_gender_pref: GenderPreference
  rounds_available: number
  effective_pvna?: number
  avoid_ids?: Set<string>
  last_rest_started_round?: number
}

export type Team = [string, string]

export type Match = {
  court_idx: number
  team_a: Team
  team_b: Team
  score?: number
  stats?: MatchStats
}

export type MatchStats = {
  pvna_diff: number
  partner_repeats: number
  opponent_repeats: number
  group_bonus: number
  gender_pref_penalty: number
  consecutive_play_penalty: number
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

export type AvoidPair = {
  player_a: string
  player_b: string
  reason?: 'conflict' | 'skill_gap' | 'preference'
}

export type SessionState = {
  session_id: string
  current_round: number
  status: SessionStatus
  config: {
    courts: number
    pvna_tolerance: number
    weights: ScoringWeights
    planned_total_rounds?: number
    court_preset?: 'balanced' | 'play_more' | 'relaxed'
    avoid_pairs?: AvoidPair[]
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
    name?: string | null
    pvna?: number | null
    current_elo?: number | null
    elo?: number | null
    gender?: string | null
    partner_gender_pref?: string | null
    opponent_gender_pref?: string | null
  } | null
  session_players?: {
    status?: string | null
    check_in_status?: string | null
    metadata?: Record<string, unknown> | null
  } | null
  effective_pvna?: number | null
}

export type SessionPlayerPreferenceRow = {
  player_id: string
  metadata?: Record<string, unknown> | null
  players?: {
    pvna?: number | null
    current_elo?: number | null
    elo?: number | null
    gender?: string | null
    partner_gender_pref?: string | null
    opponent_gender_pref?: string | null
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

export type SessionLiveMatchRow = {
  id: string
  session_id: string
  sequence_no: number
  round_no: number | null
  cycle_no?: number | null
  court_idx: number | null
  status: LiveMatchStatus
  team_a: Team
  team_b: Team
  resting: string[]
  score_a: number
  score_b: number
  suggested_at: string
  started_at: string | null
  ended_at: string | null
  created_at?: string
  updated_at?: string
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
  reason?: 'voluntary' | 'system'
}

export type HostPvnaOverrideRequest = {
  player_id: string
  effective_pvna: number | null
}

export type SuggestionAlternative = {
  matches: Match[]
  resting: string[]
  score: number
  warnings: string[]
  tradeoffs?: SuggestionTradeoff[]
  approval_required?: boolean
  stats: MatchStats
  runtime_ms?: number
  iterations?: number
}

export type SuggestionTradeoff = {
  type: 'pvna_tolerance_relaxed' | 'repeat_cap_relaxed' | 'intra_team_gap_relaxed'
  severity: number
  over_by?: number
  affected_pairs?: number
  affected_players?: number
  relaxation_level?: 'soft' | 'open'
}

export type SuggestionTradeoffChoiceId = 'balanced' | 'keep_pvna' | 'reduce_intra' | 'reduce_repeat'

export type SuggestionTradeoffChoiceMetrics = {
  pvna_gap: number
  pvna_over_by: number
  intra_team_gap: number
  intra_team_over_by: number
  repeat_over_by: number
  affected_pairs: number
  affected_players: number
  max_partner_pair: number
  max_opponent_pair: number
  total_cost: number
  match_count_over_by?: number
  opponent_repeat_over_by?: number
  consecutive_play_over_by?: number
}

export type SuggestionTradeoffChoice = {
  id: SuggestionTradeoffChoiceId
  label: string
  alternative: SuggestionAlternative
  metrics: SuggestionTradeoffChoiceMetrics
  explanation: string[]
}

export type SuggestionResult = {
  alternatives: SuggestionAlternative[]
  warnings: string[]
  should_end: boolean
}
