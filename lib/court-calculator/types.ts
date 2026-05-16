export type CourtPreset = 'play_more' | 'balanced' | 'relaxed'

export type Feasibility = 'optimal' | 'tight' | 'oversupply' | 'infeasible'
export type CourtWarningSeverity = 'info' | 'warning' | 'critical'
export type CourtWarningType =
  | 'small_group_long_session'
  | 'repeat_unavoidable'
  | 'low_rotation'
  | 'high_rotation'
  | 'all_play_pressure'
  | 'target_unreachable'
export type CourtWarningActionType =
  | 'set_duration'
  | 'set_preset'
  | 'set_courts'
  | 'accept_tradeoff'

export type CourtCalculatorInput = {
  n_players: number
  session_duration_min: number
  match_duration_min?: number
  preset?: CourtPreset
}

export type CourtOption = {
  courts: number
  total_rounds: number
  avg_matches_per_player: number
  min_matches_per_player: number
  max_matches_per_player: number
  resting_per_round: number
  estimated_rest_per_player: number
  feasibility: Feasibility
  warnings: string[]
  play_ratio: number
  quality_score: number
  quality_notes: string[]
}

export type CourtWarningPreview = {
  n_players: number
  duration_min: number
  match_duration_min: number
  preset: CourtPreset
  courts: number
  rounds: number
  avg_matches_per_player: number
  play_ratio: number
  risk_level: 'low' | 'medium' | 'high'
}

export type CourtWarningAlternative = {
  action: CourtWarningActionType
  label: string
  expected_effect: string
  tradeoff: string
  duration_min?: number
  preset?: CourtPreset
  courts?: number
  preview: CourtWarningPreview
}

export type CourtWarning = {
  severity: CourtWarningSeverity
  type: CourtWarningType
  message: string
  why: string
  alternatives: CourtWarningAlternative[]
}

export type CourtCalculatorOutput = {
  recommended: CourtOption
  alternatives: CourtOption[]
  reasoning: string
  setup_warnings: CourtWarning[]
}
