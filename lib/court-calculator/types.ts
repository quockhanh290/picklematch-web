export type CourtPreset = 'play_more' | 'balanced' | 'relaxed'

export type Feasibility = 'optimal' | 'tight' | 'oversupply' | 'infeasible'

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
}

export type CourtCalculatorOutput = {
  recommended: CourtOption
  alternatives: CourtOption[]
  reasoning: string
}

