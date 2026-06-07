// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { FairnessWarning } from './fairness/detector.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeAvailabilityMetrics } from './fairness/metrics.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import {
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  RECENT_GROUP_REMATCH_BLOCK_ROUNDS,
  getMatchGroupKey,
  getMatchNearRematchKeys,
  getRecentRepeatCost,
  getProjectedRepeatSummary,
  withRecentGroupRematchKeys,
} from './score.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { bestPartitioning } from './pair.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { suggestNextMatch } from './suggest.ts'
import type {
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionState,
  SuggestionAlternative,
  SuggestionTradeoff,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId,
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
} from './types.ts'

const LIVE_TRADEOFF_ALTERNATIVE_LIMIT = 12
const LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT = 80
const LIVE_STRICT_RESCUE_ELIGIBLE_LIMIT = 20
const LIVE_STRICT_RESCUE_TIMEOUT_MS = 300
const LIVE_PREVIEW_BATCH_TIMEOUT_MS = 3800
const LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS = 350
const LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS = 900
const LIVE_PREVIEW_ALGORITHM_VERSION = 4
const BALANCED_PVNA_COST_WEIGHT = 10
const BALANCED_INTRA_TEAM_GAP_COST_WEIGHT = 8
const BALANCED_REPEAT_COST_WEIGHT = 15
const BALANCED_AFFECTED_PLAYER_COST_WEIGHT = 1
const GUARDED_LIVE_PVNA_OVER_WEIGHT = 90
const GUARDED_LIVE_INTRA_OVER_WEIGHT = 12
const GUARDED_LIVE_RECENT_WEIGHT = 0.9
const GUARDED_LIVE_REPEAT_OVER_WEIGHT = 55
const GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT = 8
const GUARDED_LIVE_QUOTA_OVER_WEIGHT = 35
const GUARDED_LIVE_QUOTA_UNDER_WEIGHT = 5
const GUARDED_LIVE_TRADEOFF_WEIGHT = 20
const LIVE_RECYCLE_SOFT_CONSECUTIVE_PLAY_LIMIT = 2
const LIVE_RECYCLE_HARD_CONSECUTIVE_PLAY_LIMIT = 3
const LIVE_RECYCLE_ABSOLUTE_CONSECUTIVE_PLAY_LIMIT = 4
const LIVE_QUOTA_OVERPLAY_MARGIN = 0

export type BuildSuggestedMatchOptions = {
  courtIdx?: number
  courtIdxs?: number[]
  stateOverride?: SessionState
  liveMatchRowsOverride?: SessionLiveMatchRow[]
}

export type SuggestedLiveMatchRow = SessionLiveMatchRow & {
  preview_live_state_version?: number | null
  preview_countable_match_count?: number | null
  warnings?: string[]
  tradeoffs?: SuggestionTradeoff[]
  approval_required?: boolean
  configured_pvna_tolerance?: number
  effective_pvna_tolerance?: number
  fairness_reasons?: string[]
  fairness_reason_details?: string[]
  tradeoff_choices?: SuggestionTradeoffChoice[]
  recommended_tradeoff_choice?: SuggestionTradeoffChoiceId
}

export type LiveDisplayMatchRow = SessionLiveMatchRow & {
  client_preview_id?: string
}

export type SuggestedPreviewBatch = {
  key: string
  matches: SuggestedLiveMatchRow[]
}

type SuggestedMatchPayload = Pick<SuggestedLiveMatchRow, 'court_idx' | 'team_a' | 'team_b' | 'resting' | 'round_no' | 'preview_live_state_version' | 'preview_countable_match_count' | 'warnings' | 'tradeoffs' | 'approval_required' | 'configured_pvna_tolerance' | 'effective_pvna_tolerance' | 'fairness_reasons' | 'fairness_reason_details' | 'tradeoff_choices' | 'recommended_tradeoff_choice'>

type CompletedMatchGroup = {
  round_no: number
  team_a: [string, string]
  team_b: [string, string]
}

type StrictRescueOptions = {
  busyIds: Set<string>
  courtIdx: number
  configuredPvnaTolerance: number
  tierOverrides: Record<string, Tier>
  warnings?: string[]
  maxEligiblePlayers?: number
  timeoutMs?: number
}

export type PreviewPlayerInfo = { name: string }

function playerName(playerId: string, playersById: Map<string, PreviewPlayerInfo>) {
  return playersById.get(playerId)?.name ?? playerId.slice(0, 8)
}

export function autoPvnaReasonDetails(
  warningTypes: string[],
  warnings: FairnessWarning[],
  state: SessionState,
  playersById: Map<string, PreviewPlayerInfo>,
) {
  const warningTypeSet = new Set(warningTypes)
  return warnings
    .filter(warning => warningTypeSet.has(warning.type))
    .flatMap(warning => {
      const lines = [warning.message]
      if (warning.type === 'rest_violation' && warning.affected_players.length > 0) {
        const players = warning.affected_players.slice(0, 6).map(playerId => {
          const consecutiveRest = state.players.get(playerId)?.consecutive_rest ?? 0
          return `${playerName(playerId, playersById)} ${consecutiveRest} vòng`
        })
        const hiddenCount = Math.max(0, warning.affected_players.length - players.length)
        lines.push(`Đang ưu tiên kéo vào sân: ${players.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount} người` : ''}.`)
      } else if (warning.affected_players.length > 0) {
        const players = warning.affected_players.slice(0, 6).map(playerId => playerName(playerId, playersById))
        const hiddenCount = Math.max(0, warning.affected_players.length - players.length)
        lines.push(`Ảnh hưởng: ${players.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount} người` : ''}.`)
      }
      lines.push(warning.suggested_action)
      return lines
    })
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
    .slice(0, 4)
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

  const incrementPair = (playerAId: string, playerBId: string, type: 'partner' | 'opponent') => {
    const playerA = players.get(playerAId)
    const playerB = players.get(playerBId)
    if (playerA) {
      const partnerCounts = new Map(playerA.partner_counts)
      const opponentCounts = new Map(playerA.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerBId, (counts.get(playerBId) ?? 0) + 1)
      players.set(playerAId, { ...playerA, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
    if (playerB) {
      const partnerCounts = new Map(playerB.partner_counts)
      const opponentCounts = new Map(playerB.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerAId, (counts.get(playerAId) ?? 0) + 1)
      players.set(playerBId, { ...playerB, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
  }

  incrementPair(match.team_a[0], match.team_a[1], 'partner')
  incrementPair(match.team_b[0], match.team_b[1], 'partner')
  for (const playerAId of match.team_a) {
    for (const playerBId of match.team_b) {
      incrementPair(playerAId, playerBId, 'opponent')
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
        r.round_no === effectiveRoundNo ? { ...r, matches: [...r.matches, newMatch] } : r,
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

export function buildProjectedStateAfterCompletedLiveRound(
  state: SessionState,
  playedIds: Set<string>,
): SessionState {
  const players = new Map(state.players)

  players.forEach((player, playerId) => {
    if (playedIds.has(playerId) || player.checked_out_at !== null) return
    players.set(playerId, {
      ...player,
      consecutive_rest: player.consecutive_rest + 1,
      consecutive_play: 0,
      opted_rest: false,
    })
  })

  return { ...state, players }
}

export function buildPreviewBatchKey(
  sessionId: string,
  state: SessionState,
  courtCount: number,
  pvnaTolerance: number,
  fairnessAdjustment: { tier_overrides: Record<string, Tier>; applied_for_warnings: unknown[] },
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

function getAlternativeRecentCost(alternative: SuggestionAlternative, state: SessionState) {
  return alternative.matches.reduce((sum, match) => (
    sum + getRecentRepeatCost(match.team_a, match.team_b, state).total
  ), 0)
}

function getProjectedCountViolation(
  alternative: SuggestionAlternative,
  state: SessionState,
  targetMaxAfter: number,
  targetMinAfter: number,
) {
  const selectedIds = new Set(alternative.matches.flatMap(match => [...match.team_a, ...match.team_b]))
  let over = 0
  let under = 0
  for (const player of state.players.values()) {
    if (player.checked_out_at !== null || player.opted_rest) continue
    const projected = player.matches_played + (selectedIds.has(player.player_id) ? 1 : 0)
    over += Math.max(0, projected - targetMaxAfter)
    under += Math.max(0, targetMinAfter - projected)
  }
  return {
    over,
    under,
    total: over * 100 + under,
  }
}

function getActivePlayerCount(state: SessionState) {
  return [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .length
}

function getProjectedTargetRangeAfter(state: SessionState, nextMatchIndex: number) {
  const activePlayerCount = Math.max(1, getActivePlayerCount(state))
  const slotsAfter = Math.max(0, nextMatchIndex) * 4
  return {
    min: Math.floor(slotsAfter / activePlayerCount),
    max: Math.ceil(slotsAfter / activePlayerCount),
  }
}

function getPlayablePlayers(state: SessionState, busyIds: Set<string>) {
  return [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
}

function buildLiveSelectionGuard({
  state,
  busyIds,
  nextMatchIndex,
}: {
  state: SessionState
  busyIds: Set<string>
  nextMatchIndex: number
}) {
  const playablePlayers = getPlayablePlayers(state, busyIds)
  const target = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const absoluteRecycleProtectedIds = playablePlayers
    .filter(player => player.consecutive_play >= LIVE_RECYCLE_ABSOLUTE_CONSECUTIVE_PLAY_LIMIT)
    .map(player => player.player_id)
  const hardRecycleProtectedIds = playablePlayers
    .filter(player =>
      player.consecutive_play >= LIVE_RECYCLE_HARD_CONSECUTIVE_PLAY_LIMIT &&
      player.consecutive_play < LIVE_RECYCLE_ABSOLUTE_CONSECUTIVE_PLAY_LIMIT
    )
    .map(player => player.player_id)
  const softRecycleProtectedIds = playablePlayers
    .filter(player =>
      player.consecutive_play >= LIVE_RECYCLE_SOFT_CONSECUTIVE_PLAY_LIMIT &&
      player.consecutive_play < LIVE_RECYCLE_HARD_CONSECUTIVE_PLAY_LIMIT
    )
    .map(player => player.player_id)
  const quotaProtectedIds = playablePlayers
    .filter(player => !absoluteRecycleProtectedIds.includes(player.player_id))
    .filter(player => !hardRecycleProtectedIds.includes(player.player_id))
    .filter(player => !softRecycleProtectedIds.includes(player.player_id))
    .filter(player => player.matches_played >= target.max + LIVE_QUOTA_OVERPLAY_MARGIN)
    .map(player => player.player_id)

  const canFillWithout = (protectedIds: string[]) => {
    const protectedSet = new Set(protectedIds)
    return playablePlayers.filter(player => !protectedSet.has(player.player_id)).length >= 4
  }

  const strictProtectedIds = [
    ...absoluteRecycleProtectedIds,
    ...hardRecycleProtectedIds,
    ...softRecycleProtectedIds,
    ...quotaProtectedIds,
  ]
  const recycleProtectedIds = [
    ...absoluteRecycleProtectedIds,
    ...hardRecycleProtectedIds,
    ...softRecycleProtectedIds,
  ]
  const hardRecycleIds = [
    ...absoluteRecycleProtectedIds,
    ...hardRecycleProtectedIds,
  ]

  if (canFillWithout(strictProtectedIds)) {
    return {
      protectedIds: new Set(strictProtectedIds),
      warnings: [] as string[],
      relaxationStages: [] as Array<{ protectedIds: Set<string>; warnings: string[] }>,
    }
  }

  if (canFillWithout(recycleProtectedIds)) {
    return {
      protectedIds: new Set(recycleProtectedIds),
      warnings: quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : [] as string[],
      relaxationStages: [
        {
          protectedIds: new Set(recycleProtectedIds),
          warnings: quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : [],
        },
      ],
    }
  }

  if (canFillWithout(hardRecycleIds)) {
    const warnings = [
      ...(quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : []),
      ...(softRecycleProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_RECYCLE_RELAXED'] : []),
    ]
    return {
      protectedIds: new Set(hardRecycleIds),
      warnings,
      relaxationStages: [
        {
          protectedIds: new Set(recycleProtectedIds),
          warnings: quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : [],
        },
        {
          protectedIds: new Set(hardRecycleIds),
          warnings,
        },
      ],
    }
  }

  const absoluteWarnings = [
    ...(quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : []),
    ...(softRecycleProtectedIds.length > 0 || hardRecycleProtectedIds.length > 0
      ? ['LIVE_REPLACEMENT_RECYCLE_RELAXED', 'LIVE_REPLACEMENT_RECYCLE_HARD_RELAXED']
      : []),
  ]
  return {
    protectedIds: new Set(absoluteRecycleProtectedIds),
    warnings: absoluteWarnings,
    relaxationStages: [
      {
        protectedIds: new Set(recycleProtectedIds),
        warnings: quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : [],
      },
      {
        protectedIds: new Set(hardRecycleIds),
        warnings: [
          ...(quotaProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_QUOTA_RELAXED'] : []),
          ...(softRecycleProtectedIds.length > 0 ? ['LIVE_REPLACEMENT_RECYCLE_RELAXED'] : []),
        ],
      },
      {
        protectedIds: new Set(absoluteRecycleProtectedIds),
        warnings: absoluteWarnings,
      },
    ],
  }
}

function pickGuardedLiveAlternative(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  configuredPvnaTolerance: number,
  nextMatchIndex: number,
) {
  const { min: targetMinAfter, max: targetMaxAfter } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const scored = alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map((alternative) => {
      const pvnaGap = getAlternativePvnaGap(alternative)
      const intraTeamGap = getAlternativeIntraTeamGap(alternative, state)
      const recent = getAlternativeRecentCost(alternative, state)
      const repeat = getAlternativeRepeatMetrics(alternative, state)
      const quota = getProjectedCountViolation(alternative, state, targetMaxAfter, targetMinAfter)
      const pvnaOver = Math.max(0, pvnaGap - configuredPvnaTolerance)
      const intraOver = Math.max(0, intraTeamGap - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
      const tradeoffs = alternative.tradeoffs?.length ?? 0
      return {
        alternative,
        pvnaGap,
        intraTeamGap,
        recent,
        repeat,
        quota,
        score:
          pvnaOver * GUARDED_LIVE_PVNA_OVER_WEIGHT +
          intraOver * GUARDED_LIVE_INTRA_OVER_WEIGHT +
          repeat.repeat_over_by * GUARDED_LIVE_REPEAT_OVER_WEIGHT +
          repeat.affected_players * GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT +
          Math.min(recent, 120) * GUARDED_LIVE_RECENT_WEIGHT +
          quota.over * GUARDED_LIVE_QUOTA_OVER_WEIGHT +
          quota.under * GUARDED_LIVE_QUOTA_UNDER_WEIGHT +
          tradeoffs * GUARDED_LIVE_TRADEOFF_WEIGHT,
      }
    })
  if (scored.length === 0) return null

  const cleanEnough = scored.filter(item =>
    item.pvnaGap <= configuredPvnaTolerance + 0.25 &&
    item.recent < 40,
  )
  const pool = cleanEnough.length > 0 ? cleanEnough : scored
  return [...pool].sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score
    if (left.quota.total !== right.quota.total) return left.quota.total - right.quota.total
    if (left.repeat.repeat_over_by !== right.repeat.repeat_over_by) return left.repeat.repeat_over_by - right.repeat.repeat_over_by
    if (left.repeat.max_partner_pair !== right.repeat.max_partner_pair) return left.repeat.max_partner_pair - right.repeat.max_partner_pair
    if (left.repeat.max_opponent_pair !== right.repeat.max_opponent_pair) return left.repeat.max_opponent_pair - right.repeat.max_opponent_pair
    if (left.recent !== right.recent) return left.recent - right.recent
    if (left.pvnaGap !== right.pvnaGap) return left.pvnaGap - right.pvnaGap
    return left.intraTeamGap - right.intraTeamGap
  })[0]?.alternative ?? null
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
  const intraTeamOverBy = Math.max(0, intraTeamGap - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
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

function hasRepeatPressureMetric(metrics: SuggestionTradeoffChoice['metrics']) {
  return metrics.repeat_over_by > 0 || metrics.max_partner_pair > 1 || metrics.max_opponent_pair > 1
}

function hasRecentRepeatPressure(alternative: SuggestionAlternative | undefined, state: SessionState) {
  if (!alternative) return false
  return alternative.matches.some((match) => {
    const cost = getRecentRepeatCost(match.team_a, match.team_b, state)
    return cost.partner > 0 || cost.opponent > 0 || cost.overlap2 > 0 || cost.overlap3 > 0 || cost.exact4 > 0
  })
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
    const diff = compareByNumber(left[field], right[field])
    if (diff !== 0) return diff
  }
  return 0
}

function pickRecommendedTradeoffChoice(choices: SuggestionTradeoffChoice[]): SuggestionTradeoffChoiceId {
  const sortedByPvnaGuard = [...choices].sort((left, right) => {
    const leftWithinPvnaCap = left.metrics.pvna_over_by <= 0
    const rightWithinPvnaCap = right.metrics.pvna_over_by <= 0
    if (leftWithinPvnaCap !== rightWithinPvnaCap) {
      return leftWithinPvnaCap ? -1 : 1
    }

    const fields: Array<keyof SuggestionTradeoffChoice['metrics']> = leftWithinPvnaCap
      ? ['total_cost', 'intra_team_over_by', 'repeat_over_by', 'pvna_gap']
      : ['pvna_over_by', 'pvna_gap', 'total_cost', 'intra_team_over_by', 'repeat_over_by']
    const metricDiff = compareChoiceMetrics(left.metrics, right.metrics, fields)
    if (metricDiff !== 0) return metricDiff

    if (left.id === 'balanced') return -1
    if (right.id === 'balanced') return 1
    return 0
  })
  return sortedByPvnaGuard[0]?.id ?? choices[0]?.id ?? 'balanced'
}

function getAlternativeMatchKey(alternative: SuggestionAlternative) {
  return alternative.matches
    .map(match => `${match.team_a.join(':')}|${match.team_b.join(':')}`)
    .join(';')
}

export function buildTradeoffChoiceExplanation(
  id: SuggestionTradeoffChoiceId,
  metrics: SuggestionTradeoffChoice['metrics'],
  configuredPvnaTolerance: number,
) {
  const lines: string[] = [
    `Trận lệch nhất: ${formatNumber(metrics.pvna_gap, 2)} (chuẩn ${formatNumber(configuredPvnaTolerance, 2)})`,
  ]
  if (metrics.pvna_over_by > 0) {
    lines.push(`Lệch trình quá mức cho phép (+${formatNumber(metrics.pvna_over_by, 2)})`)
  }
  if (metrics.intra_team_over_by > 0) {
    lines.push(`Đồng đội lệch nhau: +${formatNumber(metrics.intra_team_over_by, 2)}`)
  }
  if (metrics.repeat_over_by > 0) {
    lines.push(`Có ${metrics.affected_pairs} cặp bị lặp lại (vượt mức)`)
  }
  if (metrics.max_partner_pair > 1 || metrics.max_opponent_pair > 1) {
    lines.push(`Lặp nhiều nhất: ${metrics.max_partner_pair} lần chung đội, ${metrics.max_opponent_pair} lần chạm trán`)
  }
  return lines
}

function getTradeoffChoiceLabel(
  fallback: string,
  metrics: SuggestionTradeoffChoice['metrics'],
) {
  if (metrics.pvna_over_by > 0 && metrics.intra_team_over_by <= 0) return 'Ưu tiên đồng đội ngang trình'
  if (metrics.intra_team_over_by > 0 && metrics.pvna_over_by <= 0) return 'Ưu tiên cân tài cân sức'
  if (metrics.repeat_over_by > 0) return fallback
  return fallback
}

function improvesTradeoffMetric(
  choice: SuggestionTradeoffChoice,
  reference: SuggestionTradeoffChoice,
) {
  if (reference.metrics.pvna_over_by > 0) {
    if (choice.metrics.pvna_over_by < reference.metrics.pvna_over_by) return true
    if (choice.metrics.pvna_over_by <= reference.metrics.pvna_over_by && choice.metrics.pvna_gap < reference.metrics.pvna_gap - 0.01) return true
  }
  if (reference.metrics.intra_team_over_by > 0) {
    if (choice.metrics.intra_team_over_by < reference.metrics.intra_team_over_by) return true
    if (choice.metrics.intra_team_over_by <= reference.metrics.intra_team_over_by && choice.metrics.intra_team_gap < reference.metrics.intra_team_gap - 0.01) return true
  }
  if (reference.metrics.repeat_over_by > 0) {
    if (choice.metrics.repeat_over_by < reference.metrics.repeat_over_by) return true
    if (choice.metrics.repeat_over_by <= reference.metrics.repeat_over_by && choice.metrics.affected_players < reference.metrics.affected_players) return true
    if (choice.metrics.repeat_over_by <= reference.metrics.repeat_over_by && choice.metrics.max_opponent_pair < reference.metrics.max_opponent_pair) return true
  }
  return false
}

function combinationKey(players: PlayerSessionState[]) {
  return players.map(player => player.player_id).sort().join(':')
}

function getCombinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []

  function walk(start: number, selected: T[]) {
    if (selected.length === size) {
      result.push([...selected])
      return
    }

    for (let index = start; index < items.length; index += 1) {
      selected.push(items[index])
      walk(index + 1, selected)
      selected.pop()
    }
  }

  walk(0, [])
  return result
}

function makeStrictRescueAlternative(
  selected: PlayerSessionState[],
  allPresent: PlayerSessionState[],
  state: SessionState,
  courtIdx: number,
  configuredPvnaTolerance: number,
  warnings: string[],
): SuggestionAlternative | null {
  const strictState: SessionState = {
    ...state,
    config: {
      ...state.config,
      pvna_tolerance: configuredPvnaTolerance,
    },
  }
  const partition = bestPartitioning(selected, strictState, {
    allowRelaxedTolerance: false,
    allowRepeatOverflow: false,
    allowIntraTeamGapOverflow: false,
  })
  const match = partition?.matches[0]
  if (!partition || !match) return null

  const selectedIds = new Set(selected.map(player => player.player_id))
  const resting = allPresent
    .filter(player => !selectedIds.has(player.player_id) && !player.opted_rest)
    .map(player => player.player_id)
    .sort()

  return {
    matches: [{ ...match, court_idx: courtIdx }],
    resting,
    score: partition.score,
    warnings: warnings.filter(warning =>
      warning !== 'PVNA_TOLERANCE_RELAXED' &&
      warning !== 'INTRA_TEAM_GAP_RELAXED' &&
      warning !== 'REPEAT_CAP_RELAXED',
    ),
    tradeoffs: [],
    approval_required: false,
    stats: partition.stats,
    iterations: partition.iterations,
  }
}

export function findStrictCleanLiveAlternative(
  state: SessionState,
  options: StrictRescueOptions,
): SuggestionAlternative | null {
  const maxEligiblePlayers = Math.max(4, Math.floor(options.maxEligiblePlayers ?? LIVE_STRICT_RESCUE_ELIGIBLE_LIMIT))
  const timeoutMs = Math.max(50, Math.floor(options.timeoutMs ?? LIVE_STRICT_RESCUE_TIMEOUT_MS))
  const startedAt = nowMs()
  const allPresent = [...state.players.values()]
    .filter(player => player.checked_out_at === null)
    .sort((left, right) => left.player_id.localeCompare(right.player_id))
  let eligible = allPresent
    .filter(player => !player.opted_rest)
    .filter(player => !options.busyIds.has(player.player_id))
    .filter(player => options.tierOverrides[player.player_id] !== Tier.MUST_REST)

  const withoutSoftRest = eligible.filter(player => options.tierOverrides[player.player_id] !== Tier.SHOULD_REST)
  if (withoutSoftRest.length >= 4) {
    eligible = withoutSoftRest
  }

  if (eligible.length < 4 || eligible.length > maxEligiblePlayers) return null

  const combinations = getCombinations(eligible, 4).sort((left, right) => {
    const matchCountDiff =
      left.reduce((sum, player) => sum + player.matches_played, 0) -
      right.reduce((sum, player) => sum + player.matches_played, 0)
    if (matchCountDiff !== 0) return matchCountDiff

    const restDiff =
      right.reduce((sum, player) => sum + player.consecutive_rest, 0) -
      left.reduce((sum, player) => sum + player.consecutive_rest, 0)
    if (restDiff !== 0) return restDiff

    return combinationKey(left).localeCompare(combinationKey(right))
  })

  let best: SuggestionAlternative | null = null
  const seen = new Set<string>()
  for (const selected of combinations) {
    if (nowMs() - startedAt > timeoutMs) break
    const key = combinationKey(selected)
    if (seen.has(key)) continue
    seen.add(key)

    const alternative = makeStrictRescueAlternative(
      selected,
      allPresent,
      {
        ...state,
        config: {
          ...state.config,
          pvna_tolerance: options.configuredPvnaTolerance,
        },
      },
      options.courtIdx,
      options.configuredPvnaTolerance,
      options.warnings ?? [],
    )
    if (!alternative) continue
    const metrics = getTradeoffChoiceMetrics(alternative, state, options.configuredPvnaTolerance)
    if (hasTradeoffMetric(metrics)) continue
    if (!best || alternative.score < best.score) {
      best = alternative
    }
  }

  return best
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
      label: 'Tốt nhất tổng thể',
      item: pickBest(['total_cost', 'intra_team_over_by', 'pvna_over_by', 'repeat_over_by']),
    },
    {
      id: 'keep_pvna' as const,
      label: 'Ưu tiên cân tài cân sức',
      item: pickBest(['pvna_over_by', 'pvna_gap', 'intra_team_over_by', 'repeat_over_by']),
    },
    {
      id: 'reduce_intra' as const,
      label: 'Ưu tiên đồng đội ngang trình',
      item: pickBest(['intra_team_over_by', 'intra_team_gap', 'pvna_over_by', 'repeat_over_by']),
    },
    {
      id: 'reduce_repeat' as const,
      label: 'Ưu tiên đổi người chơi',
      item: pickBest(['repeat_over_by', 'affected_pairs', 'max_opponent_pair', 'max_partner_pair', 'pvna_over_by']),
    },
  ]

  const seen = new Set<string>()
  const choices = picked.flatMap(({ id, label, item }) => {
    const matchKey = getAlternativeMatchKey(item.alternative)
    if (seen.has(matchKey)) return []
    seen.add(matchKey)
    return [{
      id,
      label: getTradeoffChoiceLabel(label, item.metrics),
      alternative: item.alternative,
      metrics: item.metrics,
      explanation: buildTradeoffChoiceExplanation(id, item.metrics, configuredPvnaTolerance),
    }]
  })

  if (choices.length < 2) return null
  if (!choices.some(choice => hasTradeoffMetric(choice.metrics))) {
    return null
  }
  const recommended = pickRecommendedTradeoffChoice(choices)
  const recommendedChoice = choices.find(choice => choice.id === recommended) ?? choices[0]
  const usefulChoices = choices.filter(choice =>
    choice.id === recommended || improvesTradeoffMetric(choice, recommendedChoice),
  )
  if (usefulChoices.length < 2) return null
  return {
    choices: usefulChoices,
    recommended,
  }
}

function getBlockedRecentGroupRematchKeys(
  completedMatchGroups: CompletedMatchGroup[],
  projectedRoundNo: number,
) {
  const keys = new Set<string>()
  for (const match of completedMatchGroups) {
    if (
      projectedRoundNo <= match.round_no
      || projectedRoundNo > match.round_no + RECENT_GROUP_REMATCH_BLOCK_ROUNDS
    ) {
      continue
    }
    keys.add(getMatchGroupKey(match.team_a, match.team_b))
    getMatchNearRematchKeys(match.team_a, match.team_b).forEach(key => keys.add(key))
  }
  return keys
}

export function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export type BuildSuggestedMatchPayloadsParams = {
  count: number
  sessionId: string
  courtCount: number
  state: SessionState
  rows: { liveMatchRows: SessionLiveMatchRow[]; liveStateVersion?: number | null }
  completingLiveMatchIds: Set<string>
  fairnessAdjustment: { tier_overrides: Record<string, Tier>; applied_for_warnings: string[] }
  fairnessWarnings: FairnessWarning[]
  playersById: Map<string, PreviewPlayerInfo>
  pvnaTolerance: number
  options?: BuildSuggestedMatchOptions
}

export function buildSuggestedMatchPayloads({
  count,
  sessionId,
  courtCount,
  state,
  rows,
  completingLiveMatchIds,
  fairnessAdjustment,
  fairnessWarnings,
  playersById,
  pvnaTolerance,
  options = {},
}: BuildSuggestedMatchPayloadsParams): SuggestedMatchPayload[] {
  const batchStartedAt = nowMs()
  let suggestionState = options.stateOverride ?? state
  const liveMatchRows = options.liveMatchRowsOverride ?? rows.liveMatchRows
  const payloads: SuggestedMatchPayload[] = []
  const baseBusyIds = new Set(
    liveMatchRows
      .filter(match =>
        (match.status === 'live' && !completingLiveMatchIds.has(match.id))
        || match.status === 'suggested',
      )
      .flatMap(match => [...match.team_a, ...match.team_b]),
  )
  const liveCourtIdxs = new Set(
    liveMatchRows
      .filter(match =>
        match.status === 'live'
        && !completingLiveMatchIds.has(match.id)
        && match.court_idx !== null
        && match.court_idx !== undefined,
      )
      .map(match => Number(match.court_idx)),
  )
  const courtCapacity = Math.max(1, Math.floor(suggestionState.config.courts || courtCount || 1))
  const roundCounts = new Map<number, number>()
  const courtIdxsByRound = new Map<number, Set<number>>()
  const countableMatches = liveMatchRows
    .filter(match => match.status !== 'cancelled')
    .sort((left, right) => left.sequence_no - right.sequence_no)
  const previewCountableMatchCount = countableMatches.length
  const logicalRoundByMatchId = new Map<string, number>()
  countableMatches.forEach((match, matchIndex) => {
    const roundNo = Math.floor(matchIndex / courtCapacity)
    logicalRoundByMatchId.set(match.id, match.round_no ?? roundNo)
    roundCounts.set(roundNo, (roundCounts.get(roundNo) ?? 0) + 1)
    if (match.court_idx !== null && match.court_idx !== undefined) {
      const courtIdxs = courtIdxsByRound.get(roundNo) ?? new Set<number>()
      courtIdxs.add(Number(match.court_idx))
      courtIdxsByRound.set(roundNo, courtIdxs)
    }
  })
  const playerIdsByRound = new Map<number, Set<string>>()
  countableMatches.forEach((match, matchIndex) => {
    const roundNo = Math.floor(matchIndex / courtCapacity)
    const playerIds = playerIdsByRound.get(roundNo) ?? new Set<string>()
    match.team_a.forEach(playerId => playerIds.add(playerId))
    match.team_b.forEach(playerId => playerIds.add(playerId))
    playerIdsByRound.set(roundNo, playerIds)
  })
  const completedMatchGroups: CompletedMatchGroup[] = countableMatches
    .filter(match => match.status === 'completed')
    .map((match, matchIndex) => ({
      round_no: logicalRoundByMatchId.get(match.id) ?? match.round_no ?? Math.floor(matchIndex / courtCapacity),
      team_a: match.team_a,
      team_b: match.team_b,
    }))
  const hasCompletedRounds = suggestionState.rounds.some(round => round.status === 'completed')
  const getRoundRequiredIds = (roundNo: number, remainingCourts: number, busyIds: Set<string>) => {
    const remainingRoundSlots = Math.max(0, remainingCourts * 4)
    if (remainingRoundSlots <= 0) return new Set<string>()
    const required = [...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
      .filter(player => {
        const isLateArrival = hasCompletedRounds && player.matches_played === 0
        if (isLateArrival) return player.consecutive_rest >= 2
        return player.consecutive_rest >= 1
      })
      .sort((left, right) => {
        if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
        if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
        if (left.last_played_round !== right.last_played_round) return left.last_played_round - right.last_played_round
        return left.player_id.localeCompare(right.player_id)
      })
      .map(player => player.player_id)
    return new Set(required.slice(0, remainingRoundSlots))
  }
  let roundRequiredIds = new Set<string>()
  const projectedExistingMatches = countableMatches.filter(match =>
    match.status === 'live'
    || match.status === 'suggested'
    || completingLiveMatchIds.has(match.id),
  )
  const projectedExistingRoundNos = new Set<number>()
  for (const match of projectedExistingMatches) {
    const projectedRoundNo = logicalRoundByMatchId.get(match.id) ?? match.round_no ?? match.sequence_no
    projectedExistingRoundNos.add(projectedRoundNo)
    suggestionState = buildProjectedStateAfterLiveMatch(
      suggestionState,
      match,
      projectedRoundNo,
    )
  }
  for (const roundNo of projectedExistingRoundNos) {
    if ((roundCounts.get(roundNo) ?? 0) >= courtCapacity) {
      suggestionState = buildProjectedStateAfterCompletedLiveRound(
        suggestionState,
        playerIdsByRound.get(roundNo) ?? new Set<string>(),
      )
    }
  }
  const getInitialRoundCourtIdxs = (roundNo: number) => {
    const existingRoundCourtIdxs = courtIdxsByRound.get(roundNo)
    return new Set([
      ...liveCourtIdxs,
      ...(existingRoundCourtIdxs ?? []),
    ])
  }
  const queuedCourtIdxs = new Set(liveCourtIdxs)
  const batchBusyIds = new Set(baseBusyIds)
  let projectedRoundNo = Math.floor(countableMatches.length / courtCapacity)
  let projectedRoundMatchCount = countableMatches.length % courtCapacity
  let roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
  let roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
  roundRequiredIds = getRoundRequiredIds(
    projectedRoundNo,
    courtCapacity - projectedRoundMatchCount,
    new Set([...roundBusyIds, ...batchBusyIds]),
  )
  
  for (let index = 0; index < count; index += 1) {
    const remainingBatchMs = LIVE_PREVIEW_BATCH_TIMEOUT_MS - (nowMs() - batchStartedAt)
    if (remainingBatchMs <= LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS) break
    if (projectedRoundMatchCount >= courtCapacity) {
      projectedRoundNo += 1
      projectedRoundMatchCount = 0
      roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
      roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
      roundRequiredIds = getRoundRequiredIds(
        projectedRoundNo,
        courtCapacity,
        new Set([...roundBusyIds, ...batchBusyIds]),
      )
    }
    const requestedCourtIdx = options.courtIdxs?.[index] ?? options.courtIdx
    const nextCourtIdx = Array.from({ length: courtCapacity }, (_, idx) => idx)
      .find(idx => !queuedCourtIdxs.has(idx) && !roundCourtIdxs.has(idx))
    const courtIdx = requestedCourtIdx ?? nextCourtIdx
    if (courtIdx === undefined) break
    const remainingCourtsInRound = Math.max(1, courtCapacity - projectedRoundMatchCount)
    const availableRequiredIds = [...roundRequiredIds]
      .filter(playerId => !roundBusyIds.has(playerId) && !batchBusyIds.has(playerId))
    const minRequiredForThisCourt = availableRequiredIds.length === 0
      ? 0
      : Math.min(4, Math.max(1, availableRequiredIds.length - ((remainingCourtsInRound - 1) * 4)))
    const requiredForThisCourt = availableRequiredIds.slice(0, minRequiredForThisCourt)
    const requiredForThisCourtIds = new Set(requiredForThisCourt)
    const deferredRequiredIds = availableRequiredIds
      .filter(playerId => !requiredForThisCourtIds.has(playerId))
    const busyIds = new Set([...batchBusyIds, ...roundBusyIds])
    const activePlayersForBias = [...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
    const availabilityForBias = computeAvailabilityMetrics(suggestionState)
    const availabilityDeltaByPlayer = new Map(
      availabilityForBias.per_player.map(player => [player.player_id, player.delta_from_expected]),
    )
    const avgMatchesForBias = activePlayersForBias.length === 0
      ? 0
      : activePlayersForBias.reduce((sum, player) => sum + player.matches_played, 0) / activePlayersForBias.length
    const getMatchBalanceForBias = (player: PlayerSessionState) => (
      availabilityForBias.rounds_tracked > 0
        ? (availabilityDeltaByPlayer.get(player.player_id) ?? 0)
        : player.matches_played - avgMatchesForBias
    )
    const softUnderplayedOverrides = Object.fromEntries(
      activePlayersForBias
        .filter(player => getMatchBalanceForBias(player) <= -0.25)
        .filter(player => player.consecutive_play < LIVE_RECYCLE_SOFT_CONSECUTIVE_PLAY_LIMIT)
        .filter(player => !requiredForThisCourtIds.has(player.player_id))
        .filter(player => !deferredRequiredIds.includes(player.player_id))
        .filter(player => fairnessAdjustment.tier_overrides[player.player_id] === undefined)
        .map(player => [player.player_id, Tier.SHOULD_PLAY]),
    )
    const softOverplayedOverrides = Object.fromEntries(
      activePlayersForBias
        .filter(player => getMatchBalanceForBias(player) >= 0.75)
        .filter(player => !requiredForThisCourtIds.has(player.player_id))
        .filter(player => !deferredRequiredIds.includes(player.player_id))
        .filter(player => fairnessAdjustment.tier_overrides[player.player_id] === undefined)
        .map(player => [player.player_id, Tier.SHOULD_REST]),
    )
    const tierOverrides = {
      ...fairnessAdjustment.tier_overrides,
      ...softOverplayedOverrides,
      ...softUnderplayedOverrides,
      ...Object.fromEntries(deferredRequiredIds.map(playerId => [playerId, Tier.FLEXIBLE])),
      ...Object.fromEntries(requiredForThisCourt.map(playerId => [playerId, Tier.MUST_PLAY])),
    }
    
    const exhaustiveDiag: import('./suggest.ts').ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0,
      combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    const suggestionStateForCourt = withRecentGroupRematchKeys(
      { ...suggestionState, current_round: projectedRoundNo },
      getBlockedRecentGroupRematchKeys(completedMatchGroups, projectedRoundNo),
    )
    const liveSelectionGuard = buildLiveSelectionGuard({
      state: suggestionStateForCourt,
      busyIds,
      nextMatchIndex: previewCountableMatchCount + index + 1,
    })
    liveSelectionGuard.protectedIds.forEach(playerId => busyIds.add(playerId))
    const buildBusyIdsForProtected = (protectedIds: Set<string>) => new Set([
      ...batchBusyIds,
      ...roundBusyIds,
      ...protectedIds,
    ])
    const buildRelaxedTierOverrides = () => {
      const relaxedTierOverrides = { ...tierOverrides }
      for (const playerId of [...requiredForThisCourt, ...deferredRequiredIds]) {
        delete relaxedTierOverrides[playerId]
      }
      return relaxedTierOverrides
    }
    const suggestOptions = {
      tier_overrides: tierOverrides as any,
      busy_player_ids: busyIds,
      court_idx: courtIdx,
      max_alternatives: LIVE_TRADEOFF_ALTERNATIVE_LIMIT,
      max_runtime_ms: Math.min(
        LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS,
        Math.max(LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS, remainingBatchMs - 50),
      ),
      _exhaustiveDiag: exhaustiveDiag,
    }
    let result = suggestNextMatch(suggestionStateForCourt, suggestOptions)
    if (result.alternatives.length === 0) {
      const relaxedTierOverrides = buildRelaxedTierOverrides()
      const relaxationStages = liveSelectionGuard.relaxationStages.length > 0
        ? liveSelectionGuard.relaxationStages
        : [{ protectedIds: liveSelectionGuard.protectedIds, warnings: liveSelectionGuard.warnings }]
      for (const relaxationStage of relaxationStages) {
        if (result.alternatives.length > 0) break
        const relaxedDiag: import('./suggest.ts').ExhaustiveFallbackDiagnostic = {
          ran: false, timedOut: false, eligibleCount: 0,
          combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
        }
        const relaxedResult = suggestNextMatch(suggestionStateForCourt, {
          ...suggestOptions,
          busy_player_ids: buildBusyIdsForProtected(relaxationStage.protectedIds),
          tier_overrides: relaxedTierOverrides as any,
          max_alternatives: LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT,
          max_runtime_ms: Math.min(
            LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS,
            Math.max(LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS, remainingBatchMs - 50),
          ),
          _exhaustiveDiag: relaxedDiag,
        })
        if (relaxedResult.alternatives.length === 0) continue
        result = {
          ...relaxedResult,
          warnings: [...new Set([
            ...relaxedResult.warnings.filter(warning => warning !== 'NO_VALID_MATCH'),
            ...relaxationStage.warnings,
          ])],
          alternatives: relaxedResult.alternatives.map(alternative => ({
            ...alternative,
            warnings: [...new Set([
              ...alternative.warnings,
              ...relaxationStage.warnings,
            ])],
          })),
        }
      }
    }
    if (liveSelectionGuard.warnings.length > 0 && result.alternatives.length > 0) {
      result = {
        ...result,
        warnings: [...new Set([...result.warnings, ...liveSelectionGuard.warnings])],
        alternatives: result.alternatives.map(alternative => ({
          ...alternative,
          warnings: [...new Set([...alternative.warnings, ...liveSelectionGuard.warnings])],
        })),
      }
    }
    const configuredPvnaTolerance = pvnaTolerance
    const initialSelectedMetrics = result.alternatives[0]
      ? getTradeoffChoiceMetrics(result.alternatives[0], suggestionStateForCourt, configuredPvnaTolerance)
      : null
    if (initialSelectedMetrics && hasTradeoffMetric(initialSelectedMetrics)) {
      const strictAlternative = findStrictCleanLiveAlternative(suggestionStateForCourt, {
        busyIds,
        courtIdx,
        configuredPvnaTolerance,
        tierOverrides,
        warnings: result.warnings,
      })
      if (strictAlternative) {
        result = {
          ...result,
          alternatives: [
            strictAlternative,
            ...result.alternatives.filter(alternative => {
              const match = alternative.matches[0]
              const strictMatch = strictAlternative.matches[0]
              if (!match || !strictMatch) return true
              const leftKey = [match.team_a.join(':'), match.team_b.join(':')].sort().join('|')
              const rightKey = [strictMatch.team_a.join(':'), strictMatch.team_b.join(':')].sort().join('|')
              return leftKey !== rightKey
            }),
          ].slice(0, LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT),
        }
      }
    }
    const tradeoffChoices = buildLiveTradeoffChoices(result.alternatives, suggestionStateForCourt, configuredPvnaTolerance)
    const guardedAlternative = pickGuardedLiveAlternative(
      result.alternatives,
      suggestionStateForCourt,
      configuredPvnaTolerance,
      previewCountableMatchCount + index + 1,
    )
    const alternative = guardedAlternative ?? result.alternatives[0]
    const selectedTradeoffChoice = tradeoffChoices?.choices.find(choice =>
      getAlternativeMatchKey(choice.alternative) === getAlternativeMatchKey(alternative),
    )
    const recommendedTradeoffChoice = selectedTradeoffChoice?.id ?? tradeoffChoices?.recommended
    const match = alternative?.matches[0]
    if (!alternative || !match) break
    const effectivePvnaTolerance = suggestionState.config.pvna_tolerance
    const pvnaDiff = match.stats?.pvna_diff ?? 0
    const displayPvnaOverBy = Math.max(0, pvnaDiff - configuredPvnaTolerance)
    const hasEnginePvnaTradeoff = alternative.tradeoffs?.some(tradeoff => tradeoff.type === 'pvna_tolerance_relaxed') ?? false
    const shouldSurfaceAutoPvnaTradeoff = displayPvnaOverBy > 0 && effectivePvnaTolerance > configuredPvnaTolerance && !hasEnginePvnaTradeoff
    const visibleTradeoffs = shouldSurfaceAutoPvnaTradeoff
      ? [
          ...(alternative.tradeoffs ?? []),
          {
            type: 'pvna_tolerance_relaxed' as const,
            severity: displayPvnaOverBy,
            over_by: displayPvnaOverBy,
          },
        ]
      : alternative.tradeoffs
    const visibleWarnings = shouldSurfaceAutoPvnaTradeoff
      ? [...new Set([...alternative.warnings, 'PVNA_TOLERANCE_RELAXED'])]
      : alternative.warnings
    payloads.push({
      court_idx: courtIdx,
      team_a: match.team_a,
      team_b: match.team_b,
      resting: alternative.resting,
      round_no: projectedRoundNo,
      preview_live_state_version: rows.liveStateVersion,
      preview_countable_match_count: previewCountableMatchCount,
      warnings: visibleWarnings,
      tradeoffs: visibleTradeoffs,
      approval_required: alternative.approval_required || shouldSurfaceAutoPvnaTradeoff,
      configured_pvna_tolerance: configuredPvnaTolerance,
      effective_pvna_tolerance: effectivePvnaTolerance,
      fairness_reasons: shouldSurfaceAutoPvnaTradeoff
        ? fairnessAdjustment.applied_for_warnings 
        : [],
      fairness_reason_details: shouldSurfaceAutoPvnaTradeoff
        ? autoPvnaReasonDetails(fairnessAdjustment.applied_for_warnings, fairnessWarnings, suggestionState, playersById)
        : [],
      tradeoff_choices: tradeoffChoices?.choices,
      recommended_tradeoff_choice: recommendedTradeoffChoice,
    })
    
    match.team_a.forEach(playerId => busyIds.add(playerId))
    match.team_b.forEach(playerId => busyIds.add(playerId))
    match.team_a.forEach(playerId => batchBusyIds.add(playerId))
    match.team_b.forEach(playerId => batchBusyIds.add(playerId))
    match.team_a.forEach(playerId => roundBusyIds.add(playerId))
    match.team_b.forEach(playerId => roundBusyIds.add(playerId))
    match.team_a.forEach(playerId => roundRequiredIds.delete(playerId))
    match.team_b.forEach(playerId => roundRequiredIds.delete(playerId))
    roundCourtIdxs.add(courtIdx)
    queuedCourtIdxs.add(courtIdx)
    projectedRoundMatchCount += 1
    
    const projectedMatch: SessionLiveMatchRow = {
      id: `preview-projected-${index}`,
      session_id: sessionId,
      sequence_no: index,
      round_no: projectedRoundNo,
      court_idx: courtIdx,
      status: 'completed',
      team_a: match.team_a,
      team_b: match.team_b,
      resting: alternative.resting,
      score_a: 0,
      score_b: 0,
      suggested_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    }
    suggestionState = buildProjectedStateAfterLiveMatch(suggestionState, projectedMatch, projectedRoundNo)
    completedMatchGroups.push({
      round_no: projectedRoundNo,
      team_a: projectedMatch.team_a,
      team_b: projectedMatch.team_b,
    })
    if (projectedRoundMatchCount >= courtCapacity) {
      suggestionState = buildProjectedStateAfterCompletedLiveRound(suggestionState, roundBusyIds)
    }
  }
  return payloads
}
