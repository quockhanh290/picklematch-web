// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { Tier } from '../classify.ts'
import type { ScoringWeights, SessionState } from '../types'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { detectFairnessIssues, type WarningType } from './detector.ts'

export type AdjustmentType = 'none' | 'fairness_correction'

export type AdjustmentResult = {
  type: AdjustmentType
  config_changes: Partial<SessionState['config']>
  tier_overrides: Record<string, Tier>
  applied_for_warnings: WarningType[]
}

export function correctForFairness(state: SessionState): AdjustmentResult {
  const warnings = detectFairnessIssues(state)

  if (warnings.length === 0) {
    return {
      type: 'none',
      config_changes: {},
      tier_overrides: {},
      applied_for_warnings: [],
    }
  }

  const adjustment: AdjustmentResult = {
    type: 'fairness_correction',
    config_changes: {},
    tier_overrides: {},
    applied_for_warnings: [],
  }

  for (const warning of warnings) {
    switch (warning.type) {
      case 'match_count_imbalance':
      case 'underplayed':
        for (const playerId of warning.affected_players) {
          adjustment.tier_overrides[playerId] = Tier.MUST_PLAY
        }
        adjustment.applied_for_warnings.push(warning.type)
        break

      case 'partner_repeat':
        setAdjustedWeights(adjustment, state, {
          partner_repeat: getCurrentWeights(adjustment, state).partner_repeat * 1.5,
        })
        adjustment.applied_for_warnings.push(warning.type)
        break

      case 'opponent_repeat':
      case 'opponent_repeat_burden':
        setAdjustedWeights(adjustment, state, {
          opponent_repeat: getCurrentWeights(adjustment, state).opponent_repeat * 1.5,
        })
        adjustment.applied_for_warnings.push(warning.type)
        break

      case 'gender_pref_unsatisfied':
        setAdjustedWeights(adjustment, state, {
          partner_gender_pref: getCurrentWeights(adjustment, state).partner_gender_pref * 1.3,
          opponent_gender_pref: getCurrentWeights(adjustment, state).opponent_gender_pref * 1.3,
        })
        adjustment.applied_for_warnings.push(warning.type)
        break

      case 'rest_violation':
        for (const playerId of warning.affected_players) {
          adjustment.tier_overrides[playerId] = Tier.MUST_PLAY
        }
        adjustment.config_changes.pvna_tolerance = (state.config.pvna_tolerance ?? 0.5) + 0.15
        adjustment.applied_for_warnings.push(warning.type)
        break

      case 'gender_pref_impossible':
        break
    }
  }

  adjustment.applied_for_warnings = [...new Set(adjustment.applied_for_warnings)]
  if (
    adjustment.applied_for_warnings.length === 0 &&
    Object.keys(adjustment.tier_overrides).length === 0 &&
    Object.keys(adjustment.config_changes).length === 0
  ) {
    return {
      type: 'none',
      config_changes: {},
      tier_overrides: {},
      applied_for_warnings: [],
    }
  }

  return adjustment
}

export type WeightAdjustment = {
  reason: string
  original_weights: ScoringWeights
  adjusted_weights: ScoringWeights
}

export function getAdjustedWeights(state: SessionState): WeightAdjustment {
  const adjustment = correctForFairness(state)
  const adjustedConfig = applyFairnessAdjustment(state, adjustment).config

  return {
    reason:
      adjustment.applied_for_warnings.length === 0
        ? 'fairness_ok'
        : adjustment.applied_for_warnings.join(','),
    original_weights: { ...state.config.weights },
    adjusted_weights: adjustedConfig.weights,
  }
}

export function applyFairnessAdjustment(
  state: SessionState,
  adjustment: AdjustmentResult,
): SessionState {
  return {
    ...state,
    config: {
      ...state.config,
      ...adjustment.config_changes,
      weights: {
        ...state.config.weights,
        ...(adjustment.config_changes.weights ?? {}),
      },
    },
  }
}

function setAdjustedWeights(
  adjustment: AdjustmentResult,
  state: SessionState,
  patch: Partial<ScoringWeights>,
) {
  const currentWeights = getCurrentWeights(adjustment, state)
  adjustment.config_changes.weights = roundWeights({
    ...currentWeights,
    ...patch,
  })
}

function getCurrentWeights(
  adjustment: AdjustmentResult,
  state: SessionState,
): ScoringWeights {
  return {
    ...state.config.weights,
    ...(adjustment.config_changes.weights ?? {}),
  }
}

function roundWeights(weights: ScoringWeights): ScoringWeights {
  return {
    pvna: round(weights.pvna),
    partner_repeat: round(weights.partner_repeat),
    opponent_repeat: round(weights.opponent_repeat),
    group_bonus: round(weights.group_bonus),
    partner_gender_pref: round(weights.partner_gender_pref),
    opponent_gender_pref: round(weights.opponent_gender_pref),
  }
}

function round(value: number): number {
  return Number(value.toFixed(2))
}
