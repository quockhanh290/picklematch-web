import { Tier } from '@/lib/next-round-suggester/classify'
import {
  INTRA_TEAM_PVNA_GAP_LIMIT,
  getProjectedRepeatSummary,
} from '@/lib/next-round-suggester/score'
import { applyPairIncrement } from './preview-helpers'
import {
  LIVE_PREVIEW_ALGORITHM_VERSION,
} from '@/lib/next-round-suggester/live-preview'
import type {
  SessionLiveMatchRow,
  SessionState,
  SuggestionAlternative,
  SuggestionTradeoff,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId,
} from '@/lib/next-round-suggester/types'

const BALANCED_PVNA_COST_WEIGHT = 10
const BALANCED_INTRA_TEAM_GAP_COST_WEIGHT = 25
const BALANCED_REPEAT_COST_WEIGHT = 3
const BALANCED_AFFECTED_PLAYER_COST_WEIGHT = 1

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
  // Forced-court 3-way decision data (Plan 1 engine), rehydrated from suggestion_metadata by
  // mergePersistedSuggestionMetadata. Present only for a court with no clean lineup (flag-gated).
  forced_tradeoff?: {
    kind?: 'repeat' | 'blowout'
    explanation?: string
    acceptRepeat: { team_a: [string, string]; team_b: [string, string] }
    acceptImbalance: { team_a: [string, string]; team_b: [string, string] }
  }
  wait_rescue_options?: { court_idx: number; started_at: string | null }[]
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

export function getAlternativePvnaGap(alternative: SuggestionAlternative) {
  return Math.max(
    0,
    ...alternative.matches.map(match => match.stats?.pvna_diff ?? 0),
    alternative.stats?.pvna_diff ?? 0,
  )
}

export function getAlternativeRepeatMetrics(alternative: SuggestionAlternative, state: SessionState) {
  return alternative.matches.reduce((summary, match) => {
    const repeat = getProjectedRepeatSummary(match.team_a, match.team_b, state)
    return {
      repeat_over_by: summary.repeat_over_by + repeat.pair_over_by + repeat.player_over_by,
      affected_pairs: summary.affected_pairs + repeat.affected_pairs,
      affected_players: summary.affected_players + repeat.affected_players,
      max_partner_pair: Math.max(summary.max_partner_pair, repeat.max_partner_pair_count),
      max_opponent_pair: Math.max(summary.max_opponent_pair, repeat.max_opponent_pair_count),
    }
  }, {
    repeat_over_by: 0,
    affected_pairs: 0,
    affected_players: 0,
    max_partner_pair: 0,
    max_opponent_pair: 0,
  })
}

export function getAlternativeIntraTeamGap(alternative: SuggestionAlternative, state: SessionState) {
  return Math.max(
    0,
    ...alternative.matches.flatMap(match =>
      [match.team_a, match.team_b].map(team => {
        const first = state.players.get(team[0])
        const second = state.players.get(team[1])
        if (!first || !second) return Number.POSITIVE_INFINITY
        return Math.abs(first.pvna - second.pvna)
      }),
    ),
  )
}

export function getTradeoffChoiceMetrics(
  alternative: SuggestionAlternative,
  state: SessionState,
  configuredPvnaTolerance: number,
): SuggestionTradeoffChoice['metrics'] {
  const pvnaGap = getAlternativePvnaGap(alternative)
  const intraTeamGap = getAlternativeIntraTeamGap(alternative, state)
  const repeat = getAlternativeRepeatMetrics(alternative, state)
  const pvnaOverBy = Math.max(0, pvnaGap - configuredPvnaTolerance)
  const intraTeamOverBy = Math.max(0, intraTeamGap - INTRA_TEAM_PVNA_GAP_LIMIT)
  return {
    pvna_gap: pvnaGap,
    pvna_over_by: pvnaOverBy,
    intra_team_gap: intraTeamGap,
    intra_team_over_by: intraTeamOverBy,
    repeat_over_by: repeat.repeat_over_by,
    affected_pairs: repeat.affected_pairs,
    affected_players: repeat.affected_players,
    max_partner_pair: repeat.max_partner_pair,
    max_opponent_pair: repeat.max_opponent_pair,
    total_cost:
      pvnaOverBy * BALANCED_PVNA_COST_WEIGHT +
      intraTeamOverBy * BALANCED_INTRA_TEAM_GAP_COST_WEIGHT +
      repeat.repeat_over_by * BALANCED_REPEAT_COST_WEIGHT +
      repeat.affected_players * BALANCED_AFFECTED_PLAYER_COST_WEIGHT,
  }
}

function formatNumber(value: number, fractionDigits = 1) {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : '0'
}

function hasTradeoffMetric(metrics: SuggestionTradeoffChoice['metrics']) {
  return metrics.pvna_over_by > 0 || metrics.intra_team_over_by > 0 || metrics.repeat_over_by > 0
}

export function compareByNumber(left: number, right: number) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function compareChoiceMetrics(
  left: SuggestionTradeoffChoice['metrics'],
  right: SuggestionTradeoffChoice['metrics'],
  fields: Array<keyof SuggestionTradeoffChoice['metrics']>,
) {
  for (const field of fields) {
    const diff = compareByNumber(left[field] ?? 0, right[field] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function buildTradeoffChoiceExplanation(
  id: SuggestionTradeoffChoiceId,
  metrics: SuggestionTradeoffChoice['metrics'],
  configuredPvnaTolerance: number,
) {
  const lines: string[] = [
    `PVNA ${formatNumber(metrics.pvna_gap, 2)} / cap ${formatNumber(configuredPvnaTolerance, 2)}`,
  ]
  if (metrics.pvna_over_by > 0) {
    lines.push(`Vượt PVNA +${formatNumber(metrics.pvna_over_by, 2)}`)
  }
  if (metrics.repeat_over_by > 0) {
    lines.push(`Lặp vượt cap ${metrics.repeat_over_by} điểm trên ${metrics.affected_pairs} cặp`)
  } else {
    lines.push('Không vượt cap lặp')
  }
  if (metrics.max_partner_pair > 0 || metrics.max_opponent_pair > 0) {
    lines.push(`Nặng nhất: partner ${metrics.max_partner_pair} lần, đối thủ ${metrics.max_opponent_pair} lần`)
  }
  if (id === 'balanced') {
    lines.push(`Tổng trade-off ${formatNumber(metrics.total_cost, 1)}`)
  }
  return lines
}

export function buildLiveTradeoffChoices(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  configuredPvnaTolerance: number,
): { choices: SuggestionTradeoffChoice[]; recommended: SuggestionTradeoffChoiceId } | null {
  const candidates = alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map(alternative => ({
      alternative,
      metrics: getTradeoffChoiceMetrics(alternative, state, configuredPvnaTolerance),
    }))
  if (candidates.length < 2) return null

  const hasMeaningfulTradeoff = candidates.some(({ metrics }) => hasTradeoffMetric(metrics))
  if (!hasMeaningfulTradeoff) return null

  const pickBest = (
    fields: Array<keyof SuggestionTradeoffChoice['metrics']>,
  ) => [...candidates].sort((left, right) => {
    const metricDiff = compareChoiceMetrics(left.metrics, right.metrics, fields)
    if (metricDiff !== 0) return metricDiff
    return left.alternative.score - right.alternative.score
  })[0]

  const picked = [
    {
      id: 'balanced' as const,
      label: 'Cân bằng',
      item: pickBest(['total_cost', 'intra_team_over_by', 'pvna_over_by', 'repeat_over_by']),
    },
    {
      id: 'keep_pvna' as const,
      label: 'Giữ PVNA',
      item: pickBest(['intra_team_over_by', 'pvna_over_by', 'pvna_gap', 'repeat_over_by']),
    },
    {
      id: 'reduce_repeat' as const,
      label: 'Giảm lặp',
      item: pickBest(['repeat_over_by', 'affected_pairs', 'max_opponent_pair', 'max_partner_pair', 'pvna_over_by']),
    },
  ]

  const seen = new Set<string>()
  const choices = picked.flatMap(({ id, label, item }) => {
    const matchKey = item.alternative.matches
      .map(match => `${match.team_a.join(':')}|${match.team_b.join(':')}`)
      .join(';')
    if (seen.has(matchKey)) return []
    seen.add(matchKey)
    return [{
      id,
      label,
      alternative: item.alternative,
      metrics: item.metrics,
      explanation: buildTradeoffChoiceExplanation(id, item.metrics, configuredPvnaTolerance),
    }]
  })

  if (choices.length < 2) return null
  if (!choices.some(choice => hasTradeoffMetric(choice.metrics))) {
    return null
  }
  const recommended = choices.some(choice => choice.id === 'balanced') ? 'balanced' : choices[0].id
  const recommendedChoice = choices.find(choice => choice.id === recommended) ?? choices[0]
  if (!hasTradeoffMetric(recommendedChoice.metrics)) {
    return null
  }
  return {
    choices,
    recommended,
  }
}

export function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
