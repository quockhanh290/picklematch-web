import type { SimulationConfig } from './runner'

export const BASELINE_SCENARIOS: SimulationConfig[] = [
  scenario('small_minimum', 4, 1, 5, 'tight', 0.5, 0, 0, [2, 3]),
  scenario('small_6', 6, 1, 6, 'tight', 0.5, 0.2, 0, [2, 3]),
  scenario('small_8', 8, 2, 6, 'tight', 0.5, 0.2, 0, [2, 3]),
  scenario('odd_9', 9, 2, 8, 'wide', 0.4, 0.3, 1, [2, 2]),
  scenario('medium_12', 12, 3, 8, 'wide', 0.5, 0.25, 2, [2, 3]),
  scenario('medium_16', 16, 4, 10, 'wide', 0.45, 0.3, 2, [3, 4]),
  scenario('large_20', 20, 5, 10, 'wide', 0.5, 0.3, 3, [3, 4]),
  scenario('large_24', 24, 6, 10, 'wide', 0.5, 0.3, 3, [3, 5]),
  scenario('large_32', 32, 8, 12, 'wide', 0.5, 0.3, 4, [3, 5]),
  scenario('large_40', 40, 10, 15, 'wide', 0.5, 0.3, 5, [3, 6]),
  scenario('tight_pvna_8', 8, 2, 6, 'tight', 0.5, 0, 0, [2, 3]),
  scenario('extreme_pvna_12', 12, 3, 8, 'extreme', 0.5, 0.2, 1, [2, 3]),
  scenario('bimodal_16', 16, 4, 8, 'bimodal', 0.5, 0.2, 2, [2, 4]),
  scenario('gender_skewed_12', 12, 3, 8, 'wide', 0.25, 0.5, 1, [2, 3]),
  scenario('gender_impossible_8', 8, 2, 6, 'wide', 0.25, 0.8, 0, [2, 3]),
  scenario('long_session_8', 8, 2, 15, 'tight', 0.5, 0.2, 0, [2, 3]),
  scenario('long_session_20', 20, 5, 20, 'wide', 0.5, 0.3, 2, [3, 4]),
  // 40-50 player profiles
  scenario('bimodal_40', 40, 10, 15, 'bimodal', 0.4, 0.2, 4, [3, 5]),
  scenario('bimodal_40_long', 40, 10, 20, 'bimodal', 0.4, 0.2, 4, [3, 5]),
  scenario('rotate_40_tight', 40, 8, 15, 'tight', 0.4, 0.2, 4, [3, 5]),
  scenario('wide_44', 44, 11, 12, 'wide', 0.4, 0.2, 5, [2, 5]),
  scenario('wide_48', 48, 12, 10, 'wide', 0.35, 0.15, 5, [2, 4]),
  scenario('rotate_50', 50, 12, 15, 'wide', 0.45, 0.2, 6, [2, 5]),
  scenario('extreme_40', 40, 10, 12, 'extreme', 0.4, 0.15, 3, [4, 6]),
]

export const FAIRNESS_TARGETS: Record<string, { min: number; ideal: number }> = {
  small_minimum: { min: 60, ideal: 70 },
  small_6: { min: 40, ideal: 55 },
  small_8: { min: 60, ideal: 72 },
  odd_9: { min: 35, ideal: 55 },
  medium_12: { min: 60, ideal: 72 },
  medium_16: { min: 55, ideal: 68 },
  large_20: { min: 60, ideal: 72 },
  large_24: { min: 55, ideal: 68 },
  large_32: { min: 55, ideal: 68 },
  large_40: { min: 55, ideal: 68 },
  tight_pvna_8: { min: 60, ideal: 72 },
  extreme_pvna_12: { min: 55, ideal: 68 },
  bimodal_16: { min: 60, ideal: 72 },
  gender_skewed_12: { min: 55, ideal: 68 },
  gender_impossible_8: { min: 55, ideal: 68 },
  long_session_8: { min: 60, ideal: 72 },
  long_session_20: { min: 55, ideal: 68 },
  bimodal_40: { min: 55, ideal: 68 },
  bimodal_40_long: { min: 50, ideal: 65 },
  rotate_40_tight: { min: 55, ideal: 68 },
  wide_44: { min: 55, ideal: 68 },
  wide_48: { min: 55, ideal: 68 },
  rotate_50: { min: 50, ideal: 65 },
  extreme_40: { min: 45, ideal: 60 },
}

export const PERFORMANCE_TARGETS = {
  small: { avg_ms: 50, max_ms: 100 },
  medium: { avg_ms: 150, max_ms: 300 },
  large: { avg_ms: 500, max_ms: 1000 },
  xlarge: { avg_ms: 1000, max_ms: 2000 },
}

function scenario(
  scenario_name: string,
  n_players: number,
  courts: number,
  rounds: number,
  pvna_distribution: SimulationConfig['pvna_distribution'],
  gender_ratio: number,
  gender_pref_rate: number,
  group_count: number,
  group_size_range: [number, number],
): SimulationConfig {
  return {
    scenario_name,
    n_players,
    courts,
    rounds,
    pvna_distribution,
    gender_ratio,
    gender_pref_rate,
    group_count,
    group_size_range,
    use_corrector: true,
    seed: 0,
  }
}
