import { Tier } from '@/lib/next-round-suggester/classify'
import type { FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  getProjectedRepeatSummary,
} from '@/lib/next-round-suggester/score'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import type {
  SessionLiveMatchRow,
  SessionState,
  SuggestionAlternative,
  SuggestionTradeoff,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { playerName } from './helpers'

const LIVE_TRADEOFF_ALTERNATIVE_LIMIT = 4
const BALANCED_PVNA_COST_WEIGHT = 10
const BALANCED_REPEAT_COST_WEIGHT = 3
const BALANCED_AFFECTED_PLAYER_COST_WEIGHT = 1

export type BuildSuggestedMatchOptions = {
  courtIdx?: number
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

export function autoPvnaReasonDetails(
  warningTypes: string[],
  warnings: FairnessWarning[],
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
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

export function getTradeoffChoiceMetrics(
  alternative: SuggestionAlternative,
  state: SessionState,
  configuredPvnaTolerance: number,
): SuggestionTradeoffChoice['metrics'] {
  const pvnaGap = getAlternativePvnaGap(alternative)
  const repeat = getAlternativeRepeatMetrics(alternative, state)
  const pvnaOverBy = Math.max(0, pvnaGap - configuredPvnaTolerance)
  return {
    pvna_gap: pvnaGap,
    pvna_over_by: pvnaOverBy,
    repeat_over_by: repeat.repeat_over_by,
    affected_pairs: repeat.affected_pairs,
    affected_players: repeat.affected_players,
    max_partner_pair: repeat.max_partner_pair,
    max_opponent_pair: repeat.max_opponent_pair,
    total_cost:
      pvnaOverBy * BALANCED_PVNA_COST_WEIGHT +
      repeat.repeat_over_by * BALANCED_REPEAT_COST_WEIGHT +
      repeat.affected_players * BALANCED_AFFECTED_PLAYER_COST_WEIGHT,
  }
}

function formatNumber(value: number, fractionDigits = 1) {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : '0'
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

  const hasMeaningfulTradeoff = candidates.some(({ metrics }) =>
    metrics.pvna_over_by > 0 || metrics.repeat_over_by > 0,
  )
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
      item: pickBest(['total_cost', 'pvna_over_by', 'repeat_over_by']),
    },
    {
      id: 'keep_pvna' as const,
      label: 'Giữ PVNA',
      item: pickBest(['pvna_over_by', 'pvna_gap', 'repeat_over_by']),
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
  if (!choices.some(choice => choice.metrics.pvna_over_by > 0 || choice.metrics.repeat_over_by > 0)) {
    return null
  }
  return {
    choices,
    recommended: choices.some(choice => choice.id === 'balanced') ? 'balanced' : choices[0].id,
  }
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
  playersById: Map<string, ArrangementPlayer>
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
}: BuildSuggestedMatchPayloadsParams): Pick<SuggestedLiveMatchRow, 'court_idx' | 'team_a' | 'team_b' | 'resting' | 'round_no' | 'preview_live_state_version' | 'preview_countable_match_count' | 'warnings' | 'tradeoffs' | 'approval_required' | 'configured_pvna_tolerance' | 'effective_pvna_tolerance' | 'fairness_reasons' | 'fairness_reason_details' | 'tradeoff_choices' | 'recommended_tradeoff_choice'>[] {
  const buildT0 = nowMs()
  let suggestMs = 0
  let projectMs = 0
  let suggestionState = options.stateOverride ?? state
  const liveMatchRows = options.liveMatchRowsOverride ?? rows.liveMatchRows
  const payloads: Array<Pick<SuggestedLiveMatchRow, 'court_idx' | 'team_a' | 'team_b' | 'resting' | 'round_no' | 'preview_live_state_version' | 'preview_countable_match_count' | 'warnings' | 'tradeoffs' | 'approval_required' | 'configured_pvna_tolerance' | 'effective_pvna_tolerance' | 'fairness_reasons' | 'fairness_reason_details' | 'tradeoff_choices' | 'recommended_tradeoff_choice'>> = []
  const baseBusyIds = new Set(
    liveMatchRows
      .filter(match =>
        match.status === 'live'
        || match.status === 'suggested'
        || completingLiveMatchIds.has(match.id),
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
    if (required.length > remainingRoundSlots) {
      if (__DEV__) {
        console.log('[build-preview] rolling round required over capacity', {
          sessionId,
          roundNo,
          required: required.length,
          remainingRoundSlots,
        })
      }
      return new Set<string>()
    }
    return new Set(required)
  }
  let roundRequiredIds = new Set<string>()
  const projectedExistingMatches = countableMatches.filter(match =>
    match.status === 'live'
    || match.status === 'suggested'
    || completingLiveMatchIds.has(match.id),
  )
  for (const match of projectedExistingMatches) {
    suggestionState = buildProjectedStateAfterLiveMatch(
      suggestionState,
      match,
      logicalRoundByMatchId.get(match.id) ?? match.round_no ?? match.sequence_no,
    )
  }
  const getInitialRoundCourtIdxs = (roundNo: number) => {
    const existingRoundCourtIdxs = courtIdxsByRound.get(roundNo)
    return new Set([
      ...liveCourtIdxs,
      ...(existingRoundCourtIdxs ?? []),
    ])
  }
  const queuedCourtIdxs = new Set(liveCourtIdxs)
  let projectedRoundNo = Math.floor(countableMatches.length / courtCapacity)
  let projectedRoundMatchCount = countableMatches.length % courtCapacity
  let roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
  let roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
  roundRequiredIds = getRoundRequiredIds(projectedRoundNo, courtCapacity - projectedRoundMatchCount, roundBusyIds)
  
  for (let index = 0; index < count; index += 1) {
    if (projectedRoundMatchCount >= courtCapacity) {
      projectedRoundNo += 1
      projectedRoundMatchCount = 0
      roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
      roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
      roundRequiredIds = getRoundRequiredIds(projectedRoundNo, courtCapacity, roundBusyIds)
    }
    const nextCourtIdx = Array.from({ length: courtCapacity }, (_, idx) => idx)
      .find(idx => !queuedCourtIdxs.has(idx) && !roundCourtIdxs.has(idx))
    const courtIdx = options.courtIdx ?? nextCourtIdx
    if (courtIdx === undefined) break
    const suggestT0 = nowMs()
    const remainingCourtsInRound = Math.max(1, courtCapacity - projectedRoundMatchCount)
    const availableRequiredIds = [...roundRequiredIds]
      .filter(playerId => !roundBusyIds.has(playerId) && !baseBusyIds.has(playerId))
    const minRequiredForThisCourt = availableRequiredIds.length === 0
      ? 0
      : Math.min(4, Math.max(1, availableRequiredIds.length - ((remainingCourtsInRound - 1) * 4)))
    const requiredForThisCourt = availableRequiredIds.slice(0, minRequiredForThisCourt)
    const requiredForThisCourtIds = new Set(requiredForThisCourt)
    const deferredRequiredIds = availableRequiredIds
      .filter(playerId => !requiredForThisCourtIds.has(playerId))
    const busyIds = new Set([...baseBusyIds, ...roundBusyIds])
    const activePlayersForBias = [...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
    const avgMatchesForBias = activePlayersForBias.length === 0
      ? 0
      : activePlayersForBias.reduce((sum, player) => sum + player.matches_played, 0) / activePlayersForBias.length
    const softUnderplayedOverrides = Object.fromEntries(
      activePlayersForBias
        .filter(player => player.matches_played <= avgMatchesForBias - 0.25)
        .filter(player => !requiredForThisCourtIds.has(player.player_id))
        .filter(player => !deferredRequiredIds.includes(player.player_id))
        .filter(player => fairnessAdjustment.tier_overrides[player.player_id] === undefined)
        .map(player => [player.player_id, Tier.SHOULD_PLAY]),
    )
    const softOverplayedOverrides = Object.fromEntries(
      activePlayersForBias
        .filter(player => player.matches_played >= avgMatchesForBias + 0.75)
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
    
    // In build-preview.ts, Tier is imported, we should use Tier.SHOULD_PLAY, etc. but I cast them as Tier here since Tier is an enum.
    // Actually, I can just use the strings if I cast them to any or import Tier. Let me import Tier.
    // Fixed: Tier enum in lib/next-round-suggester/classify.ts has SHOULD_PLAY, SHOULD_REST, FLEXIBLE, MUST_PLAY
    const result = suggestNextMatch(suggestionState, {
      tier_overrides: tierOverrides as any,
      busy_player_ids: busyIds,
      court_idx: courtIdx,
      max_alternatives: __DEV__ ? 8 : LIVE_TRADEOFF_ALTERNATIVE_LIMIT,
    })
    
    suggestMs += nowMs() - suggestT0
    const configuredPvnaTolerance = pvnaTolerance
    const tradeoffChoices = buildLiveTradeoffChoices(result.alternatives, suggestionState, configuredPvnaTolerance)
    const recommendedChoice = tradeoffChoices?.choices.find(choice => choice.id === tradeoffChoices.recommended)
      ?? tradeoffChoices?.choices[0]
    const alternative = recommendedChoice?.alternative ?? result.alternatives[0]
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
      
    if (__DEV__ && match.stats && match.stats.pvna_diff > 0.5) {
      const labels = (team: [string, string]) => team.map(playerId => playersById.get(playerId)?.name ?? playerId.slice(0, 8)).join('+')
      console.log('[build-preview] risky suggested match alternatives', {
        sessionId,
        courtIdx,
        projectedRoundNo,
        courtCapacity,
        liveRows: liveMatchRows.length,
        countableMatches: countableMatches.length,
        projectedExistingMatches: projectedExistingMatches.length,
        busyIds: [...busyIds].map(playerId => playersById.get(playerId)?.name ?? playerId.slice(0, 8)),
        tierOverrides: Object.keys(fairnessAdjustment.tier_overrides).map(playerId => playersById.get(playerId)?.name ?? playerId.slice(0, 8)),
        selected: `${labels(match.team_a as [string, string])} vs ${labels(match.team_b as [string, string])}`,
        alternatives: result.alternatives.slice(0, 8).map((alt, rank) => {
          const altMatch = alt.matches[0]
          return {
            rank: rank + 1,
            match: altMatch ? `${labels(altMatch.team_a as [string, string])} vs ${labels(altMatch.team_b as [string, string])}` : null,
            pvnaDiff: altMatch?.stats?.pvna_diff,
            score: alt.score,
            warnings: alt.warnings,
            tradeoffs: alt.tradeoffs,
            approvalRequired: alt.approval_required,
          }
        }),
      })
    }
    
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
        ? fairnessAdjustment.applied_for_warnings // mapping happens in caller if needed, or we keep it strings
        : [],
      fairness_reason_details: shouldSurfaceAutoPvnaTradeoff
        ? autoPvnaReasonDetails(fairnessAdjustment.applied_for_warnings, fairnessWarnings, suggestionState, playersById)
        : [],
      tradeoff_choices: tradeoffChoices?.choices,
      recommended_tradeoff_choice: tradeoffChoices?.recommended,
    })
    
    match.team_a.forEach(playerId => busyIds.add(playerId))
    match.team_b.forEach(playerId => busyIds.add(playerId))
    match.team_a.forEach(playerId => roundBusyIds.add(playerId))
    match.team_b.forEach(playerId => roundBusyIds.add(playerId))
    match.team_a.forEach(playerId => roundRequiredIds.delete(playerId))
    match.team_b.forEach(playerId => roundRequiredIds.delete(playerId))
    roundCourtIdxs.add(courtIdx)
    queuedCourtIdxs.add(courtIdx)
    projectedRoundMatchCount += 1
    
    const projectT0 = nowMs()
    suggestionState = buildProjectedStateAfterLiveMatch(suggestionState, {
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
    }, projectedRoundNo)
    projectMs += nowMs() - projectT0
  }
  
  if (__DEV__ && count > 0) {
    console.log('[build-preview] build suggested matches timing', {
      requested: count,
      built: payloads.length,
      liveRows: liveMatchRows.length,
      projectedExistingMatches: projectedExistingMatches.length,
      courtCapacity,
      roundNo: projectedRoundNo,
      suggestMs: Math.round(suggestMs),
      projectMs: Math.round(projectMs),
      totalMs: Math.round(nowMs() - buildT0),
    })
  }
  return payloads
}
