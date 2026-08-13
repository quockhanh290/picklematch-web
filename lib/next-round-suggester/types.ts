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
  // Session-wide equivalent of last_played_round; see select.ts for why the per-court value misleads.
  last_played_seq?: number | null
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
  // Session-wide position of the LAST match in this round. round_no counts cycles on one court and
  // courts drift, so it cannot say whether a round came before or after another court's activity; this
  // can. A property of the round itself, unlike anything derived from current player state, which is
  // why the two earlier attempts at this comparison both drifted.
  sequence_no?: number | null
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
    // Session-scoped quality-cost rollout flag, resolved at the request boundary
    // (resolveQualityCostEnabledForSession). Undefined → engine falls back to the global env flag.
    quality_cost_enabled?: boolean
    // Session-scoped board-optimizer rollout flag (resolveBoardOptimizerEnabledForSession).
    // Undefined → OFF; the six-post-pass chain runs unchanged.
    board_optimizer_enabled?: boolean
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
  // Times this player was idle while some match finished, since they last played. A raw count, not
  // rounds — SQL cannot say "a round went by" when courts run out of step, which is what broke the old
  // bookkeeping gate. mapRowsToSessionState divides it by the court count to get consecutive_rest.
  // Optional because the engine deploys separately from the migration that adds the column.
  rest_seat_misses?: number | null
  // Session-wide position of the player's last match, from session_live_matches.sequence_no. Optional
  // because the engine ships separately from the migration that adds it.
  last_played_seq?: number | null
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
  sequence_no?: number | null
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
  suggestion_metadata?: Record<string, unknown> | null
  // Persisted degraded-suggestion hints (see migration 20260803000001) — carried on a suggested row
  // so the host "Cách xử lý" panel survives cold load / snapshot hydration / sticky merge.
  degraded_reason?: 'blowout' | 'repeat' | 'both' | null
  rescue_court_idxs?: number[] | null
  rescue_search_truncated?: boolean | null
  match_explanations?: string[] | null
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
