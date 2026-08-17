import { Tier } from '@/lib/next-round-suggester/classify'
import { applyPairIncrement } from './preview-helpers'
import {
  LIVE_PREVIEW_ALGORITHM_VERSION,
} from '@/lib/next-round-suggester/live-preview'
import type {
  SuggestedMatchPayload,
} from '@/lib/next-round-suggester/live-preview'
import type {
  SessionLiveMatchRow,
  SessionState,
  SuggestionTradeoff,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId,
} from '@/lib/next-round-suggester/types'


export type BuildSuggestedMatchOptions = {
  liveQualityPolicy?: 'current' | 'intra_guard' | 'partner_repeat_heavy' | 'recent_overlap_lite' | 'pvna_outlier_rescue'
}

export type SuggestedLiveMatchRow = SessionLiveMatchRow & {
  preview_source?: 'edge_committed' | 'session_plan' | 'edge_partial' | 'local_fallback' | 'manual_available_pool' | 'forced_tradeoff_manual'
  preview_request_key?: string
  preview_request_serial?: number
  preview_live_state_version?: number | null
  preview_countable_match_count?: number | null
  preview_max_sequence_no?: number | null
  warnings?: string[]
  tradeoffs?: SuggestionTradeoff[]
  approval_required?: boolean
  configured_pvna_tolerance?: number
  effective_pvna_tolerance?: number
  fairness_reasons?: string[]
  fairness_reason_details?: string[]
  tradeoff_choices?: SuggestionTradeoffChoice[]
  recommended_tradeoff_choice?: SuggestionTradeoffChoiceId
  live_availability_context?: {
    locked_player_count: number
    live_court_count: number
    locked_beam_quality?: number
    available_pool_quality?: number
  }
  locked_player_ids?: string[]
  available_pool_only?: boolean
  degraded_reason?: 'blowout' | 'repeat' | 'both'
  rescue_court_idxs?: number[]
  match_explanations?: string[]
  // Forced-court decision data is owned by the engine payload contract.
  forced_tradeoff?: SuggestedMatchPayload['forced_tradeoff']
  wait_rescue_options?: SuggestedMatchPayload['wait_rescue_options']
}

export type LiveDisplayMatchRow = SessionLiveMatchRow & {
  client_preview_id?: string
}

export type SuggestedPreviewBatch = {
  key: string
  matches: SuggestedLiveMatchRow[]
}

export function buildProjectedStateAfterLiveMatch(
  state: SessionState,
  match: SessionLiveMatchRow,
  roundNo?: number,
): SessionState {
  const playedIds = new Set([...match.team_a, ...match.team_b])
  const players = new Map(state.players)
  const effectiveRoundNo = roundNo ?? match.round_no ?? match.sequence_no

  players.forEach((player, playerId) => {
    if (playedIds.has(playerId)) {
      players.set(playerId, {
        ...player,
        matches_played: player.matches_played + 1,
        last_played_round: effectiveRoundNo,
        consecutive_play: player.consecutive_play + 1,
        consecutive_rest: 0,
        opted_rest: false,
      })
      return
    }
  })

  applyPairIncrement(players, match.team_a[0], match.team_a[1], 'partner')
  applyPairIncrement(players, match.team_b[0], match.team_b[1], 'partner')
  for (const playerAId of match.team_a) {
    for (const playerBId of match.team_b) {
      applyPairIncrement(players, playerAId, playerBId, 'opponent')
    }
  }

  const newMatch = {
    court_idx: match.court_idx ?? 0,
    team_a: match.team_a,
    team_b: match.team_b,
  }
  const existingRound = state.rounds.find(r => r.round_no === effectiveRoundNo)
  const rounds = existingRound
    ? state.rounds.map(r =>
        r.round_no === effectiveRoundNo
          ? { ...r, status: 'completed' as const, matches: [...r.matches, newMatch] }
          : r,
      )
    : [
        ...state.rounds,
        {
          session_id: state.session_id,
          round_no: effectiveRoundNo,
          status: 'completed' as const,
          matches: [newMatch],
          resting: [],
          started_at: match.started_at ? new Date(match.started_at) : null,
          ended_at: new Date(),
        },
      ]

  return { ...state, players, rounds }
}

export function buildPreviewBatchKey(
  sessionId: string,
  state: SessionState,
  courtCount: number,
  pvnaTolerance: number,
  fairnessAdjustment: { tier_overrides: Record<string, Tier>; applied_for_warnings: unknown[] },
  liveQualityPolicy: BuildSuggestedMatchOptions['liveQualityPolicy'] = 'current',
  policyFingerprint = '',
) {
  const playersKey = [...state.players.values()]
    .map(player => {
      const partnerKey = [...player.partner_counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([playerId, count]) => `${playerId}:${count}`)
        .join(',')
      const opponentKey = [...player.opponent_counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([playerId, count]) => `${playerId}:${count}`)
        .join(',')
      return [
        player.player_id,
        player.pvna,
        player.group_id ?? '',
        player.checked_out_at ? 'out' : 'in',
        player.opted_rest ? 'rest' : 'play',
        player.matches_played,
        player.last_played_round,
        player.consecutive_rest,
        player.consecutive_play,
        player.gender ?? '',
        player.partner_gender_pref,
        player.opponent_gender_pref,
        partnerKey,
        opponentKey,
      ].join(':')
    })
    .sort()
    .join('|')
  const tierKey = Object.entries(fairnessAdjustment.tier_overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([playerId, tier]) => `${playerId}:${tier}`)
    .join(',')
  return [
    LIVE_PREVIEW_ALGORITHM_VERSION,
    sessionId,
    state.status,
    state.current_round,
    courtCount,
    pvnaTolerance,
    liveQualityPolicy,
    policyFingerprint,
    state.config.pvna_tolerance,
    JSON.stringify(state.config.weights),
    fairnessAdjustment.applied_for_warnings.map(String).sort().join(','),
    tierKey,
    playersKey,
  ].join('||')
}

export function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
