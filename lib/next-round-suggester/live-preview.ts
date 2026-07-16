// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { FairnessWarning } from './fairness/detector.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { applyFairnessAdjustment } from './fairness/corrector.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { AdjustmentResult } from './fairness/corrector.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeAvailabilityMetrics } from './fairness/metrics.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { AvailabilityMetrics } from './fairness/metrics.ts'
import {
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  INTRA_TEAM_PVNA_GAP_LIMIT,
  RECENT_GROUP_REMATCH_BLOCK_ROUNDS,
  getMatchGroupKey,
  getMatchNearRematchKeys,
  getRecentRepeatCost,
  getProjectedRepeatSummary,
  withRecentGroupRematchKeys,
  // @ts-ignore Node's strip-only test runner needs the local .ts extension.
} from './score.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { bestPartitioning } from './pair.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { suggestNextMatch, type EngineInstrumentEvent, type ExhaustiveFallbackDiagnostic } from './suggest.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import {
  chooseRollingHorizonAlternative,
  type RollingPlanTarget,
} from './planner/rolling-horizon.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { reconstructLiveRounds } from './live-rounds.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna } from './state.ts'
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
const LIVE_QUOTA_RESCUE_ALTERNATIVE_LIMIT = 24
const LIVE_CONDITIONAL_RESCUE_ALTERNATIVE_LIMIT = 500
const LIVE_STRICT_RESCUE_ELIGIBLE_LIMIT = 20
const LIVE_STRICT_RESCUE_TIMEOUT_MS = 300
const LIVE_PREVIEW_BATCH_TIMEOUT_MS = 3800
const LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS = 350
const LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS = 900
// Shared force-rescue budget for the whole buildSuggestedMatchPayloads call.
// effectiveCount already prevents engine from running on impossible courts,
// so this only needs to guard legitimately hard search cases.
const FORCE_RESCUE_TOTAL_MS = 1500
export const LIVE_PREVIEW_ALGORITHM_VERSION = 12

const BEAM_K = 3
const BEAM_ACTIVE_PLAYER_LIMIT = 50
const BEAM_PER_CANDIDATE_MAX_MS = 100

export function isLiveRoundFullyCompleted(
  roundNo: number,
  matchesByRound: Map<number, SessionLiveMatchRow[]>,
  courtCapacity: number,
  completingLiveMatchIds: Set<string>,
) {
  const safeCourtCapacity = Math.max(1, Math.floor(courtCapacity || 1))
  const matches = matchesByRound.get(roundNo) ?? []
  if (matches.length < safeCourtCapacity) return false

  const completedLikeMatches = matches.filter(match =>
    match.status === 'completed' || completingLiveMatchIds.has(match.id),
  )
  if (completedLikeMatches.length !== matches.length) return false

  const completedCourtIdxs = new Set(
    completedLikeMatches
      .map(match => match.court_idx)
      .filter((courtIdx): courtIdx is number => courtIdx !== null && courtIdx !== undefined),
  )

  return completedCourtIdxs.size > 0
    ? completedCourtIdxs.size >= safeCourtCapacity
    : completedLikeMatches.length >= safeCourtCapacity
}

export function warnLiveRoundProjectionDrift({
  source,
  sessionId,
  stateCurrentRound,
  projectedRoundNo,
  projectedRoundMatchCount,
  courtCapacity,
  roundCounts,
  courtIdxsByRound,
}: {
  source: 'lib' | 'v2'
  sessionId: string
  stateCurrentRound: number
  projectedRoundNo: number
  projectedRoundMatchCount: number
  courtCapacity: number
  roundCounts: Map<number, number>
  courtIdxsByRound: Map<number, Set<number>>
}) {
  if (roundCounts.size === 0) return

  const maxLogicalRound = Math.max(...roundCounts.keys())
  const maxLogicalRoundMatchCount = roundCounts.get(maxLogicalRound) ?? 0
  const maxLogicalRoundCourtCount = courtIdxsByRound.get(maxLogicalRound)?.size ?? 0
  const currentRoundDrift = stateCurrentRound !== projectedRoundNo
  const significantCurrentRoundDrift = Math.abs(stateCurrentRound - projectedRoundNo) > 1
  const courtCapacityDrift = maxLogicalRoundCourtCount > 0 && maxLogicalRoundCourtCount !== courtCapacity

  if (!significantCurrentRoundDrift && !courtCapacityDrift) return

  console.warn('[next-round-suggester] live round projection drift monitor', {
    source,
    session_id: sessionId,
    state_current_round: stateCurrentRound,
    projected_round_no: projectedRoundNo,
    projected_round_match_count: projectedRoundMatchCount,
    court_capacity: courtCapacity,
    max_logical_round: maxLogicalRound,
    max_logical_round_match_count: maxLogicalRoundMatchCount,
    max_logical_round_court_count: maxLogicalRoundCourtCount,
    current_round_drift: currentRoundDrift,
    significant_current_round_drift: significantCurrentRoundDrift,
    court_capacity_drift: courtCapacityDrift,
  })
}

export function getLivePreviewCourtBudgetMs(remainingBatchMs: number, remainingCourts: number) {
  const safeRemainingCourts = Math.max(1, Math.floor(remainingCourts))
  const reservedForFutureCourts = LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS * Math.max(0, safeRemainingCourts - 1)
  const fairShare = (remainingBatchMs - reservedForFutureCourts) / safeRemainingCourts
  return Math.min(
    LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS,
    Math.max(LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS, fairShare),
  )
}

export function shouldDeferTightPoolSuggestion(input: {
  enabled: boolean
  activeLiveCourtCount: number
  availablePlayerCount: number
  pvnaGap: number
  intraTeamGap: number
  configuredPvnaTolerance: number
}) {
  if (!input.enabled || input.activeLiveCourtCount === 0 || input.availablePlayerCount > 4) return false
  return input.pvnaGap > Math.max(1.25, input.configuredPvnaTolerance + 0.75) || input.intraTeamGap > 2
}

export const TIGHT_POOL_QUALITY_WAIT_MS = 30_000

export function buildTightPoolQualityDeferUntilByCourt(
  liveMatchRows: SessionLiveMatchRow[],
  courtIdxs: number[] | undefined,
  waitMs = TIGHT_POOL_QUALITY_WAIT_MS,
) {
  const requestedCourts = new Set((courtIdxs ?? []).filter(Number.isFinite))
  const latestCompletedAtByCourt = new Map<number, number>()

  for (const row of liveMatchRows) {
    const courtIdx = Number(row.court_idx)
    if (row.status !== 'completed' || !requestedCourts.has(courtIdx) || !row.ended_at) continue
    const endedAtMs = Date.parse(row.ended_at)
    if (!Number.isFinite(endedAtMs)) continue
    latestCompletedAtByCourt.set(
      courtIdx,
      Math.max(latestCompletedAtByCourt.get(courtIdx) ?? 0, endedAtMs),
    )
  }

  return Object.fromEntries(
    [...latestCompletedAtByCourt].map(([courtIdx, endedAtMs]) => [courtIdx, endedAtMs + waitMs]),
  ) as Record<number, number>
}

export function isTightPoolQualityWaitActive(
  deferUntilByCourt: Record<number, number> | undefined,
  courtIdx: number,
  nowMs = Date.now(),
) {
  if (deferUntilByCourt === undefined) return true
  const deferUntilMs = deferUntilByCourt[courtIdx]
  return deferUntilMs !== undefined && nowMs < deferUntilMs
}

const BALANCED_PVNA_COST_WEIGHT = 10
const BALANCED_INTRA_TEAM_GAP_COST_WEIGHT = 8
const BALANCED_REPEAT_COST_WEIGHT = 15
const BALANCED_AFFECTED_PLAYER_COST_WEIGHT = 1
const GUARDED_LIVE_PVNA_OVER_WEIGHT = 90
const GUARDED_LIVE_INTRA_OVER_WEIGHT = 12
const GUARDED_LIVE_RECENT_WEIGHT = 0.9
const GUARDED_LIVE_REPEAT_OVER_WEIGHT = 55
const GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT = 8
const GUARDED_LIVE_PARTNER_REPEAT_SOFT_WEIGHT = 150
const GUARDED_LIVE_QUOTA_OVER_WEIGHT = 35
const GUARDED_LIVE_QUOTA_UNDER_WEIGHT = 5
const GUARDED_LIVE_TRADEOFF_WEIGHT = 20
const GUARDED_LIVE_QUALITY_GATE_MIN_ALTERNATIVES = 8
const GUARDED_LIVE_QUALITY_TIER_A_INTRA_LIMIT = 1.5
const GUARDED_LIVE_QUALITY_TIER_B_PVNA_EXTRA = 0.3
const GUARDED_LIVE_QUALITY_TIER_B_INTRA_LIMIT = 1.75
const GUARDED_LIVE_QUALITY_TIER_C_PVNA_EXTRA = 0.7
const GUARDED_LIVE_QUALITY_TIER_C_INTRA_LIMIT = 2
const LIVE_QUALITY_RESCUE_QUOTA_RELAX_LIMIT = 2
const LIVE_CONDITIONAL_RESCUE_MAX_PVNA_OVER = 0.3
const LIVE_CONDITIONAL_RESCUE_MAX_INTRA_OVER = 0.5
const LIVE_REPEAT_REPAIR_START_ROUND = 6
const LIVE_EARLY_QUALITY_REPAIR_END_ROUND = LIVE_REPEAT_REPAIR_START_ROUND - 1
const LIVE_EARLY_QUALITY_BEAM_WIDTH = 100
const LIVE_EARLY_QUALITY_BEAM_MAX_PLAYERS = 24
const LIVE_ROUND_ONE_CLEAN_BATCH_MAX_PLAYERS = 40
const LIVE_RECYCLE_SOFT_CONSECUTIVE_PLAY_LIMIT = 2
const LIVE_RECYCLE_HARD_CONSECUTIVE_PLAY_LIMIT = 3
const LIVE_RECYCLE_ABSOLUTE_CONSECUTIVE_PLAY_LIMIT = 4
const LIVE_QUOTA_OVERPLAY_MARGIN = 0

export type IncompleteDump = {
  session_id: string
  missing_courts: number[]
  payload: unknown
  chosen_matches: {
    court_idx: number
    team_a: string[]
    team_b: string[]
    is_replacement: boolean
    warnings: string[]
    tradeoffs: SuggestionTradeoff[]
  }[]
  pvna_tolerance: number
  rounds: { round_no: number; status: string; matches: { team_a: string[]; team_b: string[] }[]; resting: string[] }[]
}

export type BuildSuggestedMatchOptions = {
  courtIdx?: number
  courtIdxs?: number[]
  stateOverride?: SessionState
  liveMatchRowsOverride?: SessionLiveMatchRow[]
  liveQualityPolicy?: LiveQualityPolicy
  forcedRequiredPlayerIds?: string[]
  ignoreCapacityLock?: boolean
  deferExtremeTightPool?: boolean
  tightPoolQualityDeferUntilByCourt?: Record<number, number>
  nowMs?: number
  rollingHorizon?: boolean
  rollingPlanTarget?: RollingPlanTarget | null
  onIncompleteDump?: (dump: IncompleteDump) => void
  onInstrumentEvent?: (event: EngineInstrumentEvent) => void
}

export type LiveQualityPolicy =
  | 'current'
  | 'intra_guard'
  | 'partner_repeat_heavy'
  | 'recent_overlap_lite'
  | 'recent_overlap_guarded'
  | 'recent_overlap_heavy'
  | 'pvna_outlier_rescue'
  | 'balanced_late_quality'

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
  live_availability_context?: {
    locked_player_count: number
    live_court_count: number
    locked_beam_quality?: number
    available_pool_quality?: number
  }
  locked_player_ids?: string[]
  available_pool_only?: boolean
}

export type LiveDisplayMatchRow = SessionLiveMatchRow & {
  client_preview_id?: string
}

export type SuggestedPreviewBatch = {
  key: string
  matches: SuggestedLiveMatchRow[]
}

export type SuggestedMatchPayload = Pick<SuggestedLiveMatchRow, 'court_idx' | 'team_a' | 'team_b' | 'resting' | 'round_no' | 'preview_live_state_version' | 'preview_countable_match_count' | 'warnings' | 'tradeoffs' | 'approval_required' | 'configured_pvna_tolerance' | 'effective_pvna_tolerance' | 'fairness_reasons' | 'fairness_reason_details' | 'tradeoff_choices' | 'recommended_tradeoff_choice' | 'live_availability_context' | 'locked_player_ids'>

export type PreviewBoardMode = 'full_board' | 'replace_courts'

export type FinalPreviewBoardResult = {
  final_preview_board: SuggestedMatchPayload[]
  replaced_court_idxs: number[]
  locked_court_idxs: number[]
  quality_rescue_used: boolean
}

export function getPreviewMatchesToPersist({
  mode,
  finalPreviewBoard,
  replacementCourtIdxs,
}: {
  mode: PreviewBoardMode
  finalPreviewBoard: SuggestedMatchPayload[]
  replacementCourtIdxs: number[]
}) {
  if (mode !== 'replace_courts') return finalPreviewBoard
  const replacementSet = new Set(replacementCourtIdxs.map(Number).filter(Number.isFinite))
  return finalPreviewBoard.filter(match => replacementSet.has(Number(match.court_idx)))
}

type CompletedMatchGroup = {
  round_no: number
  team_a: [string, string]
  team_b: [string, string]
}

function normalizePreviewBoardPayload(
  payload: Partial<SuggestedMatchPayload> | null | undefined,
  courtCount: number,
): SuggestedMatchPayload | null {
  if (!payload) return null
  const courtIdx = Number(payload.court_idx)
  if (!Number.isFinite(courtIdx) || courtIdx < 0 || courtIdx >= courtCount) return null
  const teamA = Array.isArray(payload.team_a) ? payload.team_a.map(String) : []
  const teamB = Array.isArray(payload.team_b) ? payload.team_b.map(String) : []
  if (teamA.length !== 2 || teamB.length !== 2) return null
  return {
    ...payload,
    court_idx: courtIdx,
    team_a: [teamA[0], teamA[1]],
    team_b: [teamB[0], teamB[1]],
    resting: Array.isArray(payload.resting) ? payload.resting.map(String) : [],
  } as SuggestedMatchPayload
}

function previewPayloadPlayerIds(payload: Pick<SuggestedMatchPayload, 'team_a' | 'team_b'>) {
  return [...payload.team_a, ...payload.team_b].map(String)
}

function addPreviewPayloadIfValid(
  payload: SuggestedMatchPayload,
  target: SuggestedMatchPayload[],
  usedCourts: Set<number>,
  usedPlayers: Set<string>,
) {
  const courtIdx = Number(payload.court_idx)
  if (!Number.isFinite(courtIdx) || usedCourts.has(courtIdx)) return false
  const playerIds = previewPayloadPlayerIds(payload)
  if (playerIds.some(playerId => usedPlayers.has(playerId))) return false
  usedCourts.add(courtIdx)
  playerIds.forEach(playerId => usedPlayers.add(playerId))
  target.push(payload)
  return true
}

export function buildFinalPreviewBoard({
  mode,
  payloads,
  currentPreviewBoard,
  replacementCourtIdxs,
  courtCount,
}: {
  mode?: PreviewBoardMode
  payloads: Array<Partial<SuggestedMatchPayload>>
  currentPreviewBoard?: Array<Partial<SuggestedMatchPayload>>
  replacementCourtIdxs?: number[]
  courtCount: number
}): FinalPreviewBoardResult {
  const normalizedPayloads = payloads
    .map(payload => normalizePreviewBoardPayload(payload, courtCount))
    .filter((payload): payload is SuggestedMatchPayload => payload !== null)
  const normalizedCurrentBoard = (currentPreviewBoard ?? [])
    .map(payload => normalizePreviewBoardPayload(payload, courtCount))
    .filter((payload): payload is SuggestedMatchPayload => payload !== null)

  const modeName: PreviewBoardMode = mode === 'replace_courts' ? 'replace_courts' : 'full_board'
  if (modeName !== 'replace_courts') {
    const usedCourts = new Set<number>()
    const usedPlayers = new Set<string>()
    const finalBoard: SuggestedMatchPayload[] = []
    normalizedPayloads.forEach(payload => addPreviewPayloadIfValid(payload, finalBoard, usedCourts, usedPlayers))
    return {
      final_preview_board: finalBoard.sort((left, right) => Number(left.court_idx) - Number(right.court_idx)),
      replaced_court_idxs: [...usedCourts].sort((left, right) => left - right),
      locked_court_idxs: [],
      quality_rescue_used: false,
    }
  }

  const replacementSet = new Set(
    (replacementCourtIdxs ?? [])
      .map(Number)
      .filter(courtIdx => Number.isFinite(courtIdx) && courtIdx >= 0 && courtIdx < courtCount),
  )
  const inferredReplacementSet = replacementSet.size > 0
    ? replacementSet
    : new Set(normalizedPayloads.map(payload => Number(payload.court_idx)))

  const usedCourts = new Set<number>()
  const usedPlayers = new Set<string>()
  const finalBoard: SuggestedMatchPayload[] = []
  const replacedCourtIdxs: number[] = []
  normalizedPayloads
    .filter(payload => inferredReplacementSet.has(Number(payload.court_idx)))
    .sort((left, right) => Number(left.court_idx) - Number(right.court_idx))
    .forEach(payload => {
      if (!addPreviewPayloadIfValid(payload, finalBoard, usedCourts, usedPlayers)) return
      replacedCourtIdxs.push(Number(payload.court_idx))
    })

  const lockedCourtIdxs: number[] = []
  normalizedCurrentBoard
    .sort((left, right) => Number(left.court_idx) - Number(right.court_idx))
    .forEach(payload => {
      const courtIdx = Number(payload.court_idx)
      if (inferredReplacementSet.has(courtIdx)) return
      if (!addPreviewPayloadIfValid(payload, finalBoard, usedCourts, usedPlayers)) return
      lockedCourtIdxs.push(courtIdx)
    })

  return {
    final_preview_board: finalBoard.sort((left, right) => Number(left.court_idx) - Number(right.court_idx)),
    replaced_court_idxs: replacedCourtIdxs,
    locked_court_idxs: lockedCourtIdxs,
    quality_rescue_used: false,
  }
}

export function hasFulfilledPreviewBoardReplacements(
  board: Pick<FinalPreviewBoardResult, 'replaced_court_idxs'>,
  replacementCourtIdxs: number[] | undefined,
) {
  const requestedCourts = new Set(
    (replacementCourtIdxs ?? [])
      .map(Number)
      .filter(Number.isFinite),
  )
  if (requestedCourts.size === 0) return true
  const replacedCourts = new Set(board.replaced_court_idxs.map(Number))
  return [...requestedCourts].every(courtIdx => replacedCourts.has(courtIdx))
}

type StrictRescueOptions = {
  busyIds: Set<string>
  courtIdx: number
  configuredPvnaTolerance: number
  tierOverrides: Record<string, Tier>
  warnings?: string[]
  maxEligiblePlayers?: number
  timeoutMs?: number
  seedSalt?: string
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
  liveQualityPolicy: LiveQualityPolicy = 'current',
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
        player.effective_pvna ?? '',
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
        return Math.abs(getEffectivePvna(first) - getEffectivePvna(second))
      }),
    ),
  )
}

function getAlternativeRecentCost(alternative: SuggestionAlternative, state: SessionState) {
  return alternative.matches.reduce((sum, match) => (
    sum + getRecentRepeatCost(match.team_a, match.team_b, state).total
  ), 0)
}

export function getProjectedCountViolation(
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

export function getProjectedTargetRangeAfter(state: SessionState, nextMatchIndex: number) {
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

export function buildLiveSelectionGuard({
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
  // Minimal protection for intra rescue: only absolute recycle + significantly over-quota (+1 margin).
  // Allows recently-rested players with compatible PVNA to rescue courts with bimodal MUST_PLAY pools.
  const intraRescueProtectedIds = new Set([
    ...absoluteRecycleProtectedIds,
    ...playablePlayers
      .filter(p => p.matches_played >= target.max + 1)
      .map(p => p.player_id),
  ])

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
      quotaProtectedIds,
      intraRescueProtectedIds,
      warnings: [] as string[],
      relaxationStages: [] as Array<{ protectedIds: Set<string>; warnings: string[] }>,
    }
  }

  if (canFillWithout(recycleProtectedIds)) {
    return {
      protectedIds: new Set(recycleProtectedIds),
      quotaProtectedIds,
      intraRescueProtectedIds,
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
      quotaProtectedIds,
      intraRescueProtectedIds,
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
  const hasSubstituteOutsideAbsolute = playablePlayers
    .some(player => !absoluteRecycleProtectedIds.includes(player.player_id))

  if (absoluteRecycleProtectedIds.length > 0 && !canFillWithout(absoluteRecycleProtectedIds) && !hasSubstituteOutsideAbsolute) {
    const noSubstituteWarnings = [
      ...absoluteWarnings,
      'LIVE_RECYCLE_ABSOLUTE_RELAXED',
    ]
    return {
      protectedIds: new Set<string>(),
      quotaProtectedIds,
      intraRescueProtectedIds,
      warnings: noSubstituteWarnings,
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
        {
          protectedIds: new Set<string>(),
          warnings: noSubstituteWarnings,
        },
      ],
    }
  }

  return {
    protectedIds: new Set(absoluteRecycleProtectedIds),
    quotaProtectedIds,
    intraRescueProtectedIds,
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

export function pickGuardedLiveAlternative(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  configuredPvnaTolerance: number,
  nextMatchIndex: number,
  policy: LiveQualityPolicy = 'current',
) {
  const { min: targetMinAfter, max: targetMaxAfter } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const courtCount = Math.max(1, Math.floor(state.config.courts || 1))
  const isLateRound = Math.floor(Math.max(0, nextMatchIndex - 1) / courtCount) >= 4
  const policyWeights = (() => {
    if (!isLateRound) {
      return {
        intra: GUARDED_LIVE_INTRA_OVER_WEIGHT,
        recent: GUARDED_LIVE_RECENT_WEIGHT,
        repeatOver: GUARDED_LIVE_REPEAT_OVER_WEIGHT,
        repeatAffected: GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT,
        partnerRepeat: 0,
      }
    }
    switch (policy) {
      case 'intra_guard':
        return {
          intra: 26,
          recent: GUARDED_LIVE_RECENT_WEIGHT,
          repeatOver: GUARDED_LIVE_REPEAT_OVER_WEIGHT,
          repeatAffected: GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT,
          partnerRepeat: 0,
        }
      case 'partner_repeat_heavy':
        return {
          intra: GUARDED_LIVE_INTRA_OVER_WEIGHT,
          recent: GUARDED_LIVE_RECENT_WEIGHT,
          repeatOver: 70,
          repeatAffected: 12,
          partnerRepeat: 35,
        }
      case 'recent_overlap_heavy':
        return {
          intra: GUARDED_LIVE_INTRA_OVER_WEIGHT,
          recent: 1.8,
          repeatOver: GUARDED_LIVE_REPEAT_OVER_WEIGHT,
          repeatAffected: GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT,
          partnerRepeat: 15,
        }
      case 'recent_overlap_lite':
      case 'recent_overlap_guarded':
        return {
          intra: GUARDED_LIVE_INTRA_OVER_WEIGHT,
          recent: 1.25,
          repeatOver: 62,
          repeatAffected: 9,
          partnerRepeat: 10,
        }
      case 'pvna_outlier_rescue':
        return {
          intra: GUARDED_LIVE_INTRA_OVER_WEIGHT,
          recent: GUARDED_LIVE_RECENT_WEIGHT,
          repeatOver: GUARDED_LIVE_REPEAT_OVER_WEIGHT,
          repeatAffected: GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT,
          partnerRepeat: 0,
        }
      case 'balanced_late_quality':
        return {
          intra: 20,
          recent: 1.3,
          repeatOver: 70,
          repeatAffected: 10,
          partnerRepeat: 25,
        }
      case 'current':
      default:
        return {
          intra: GUARDED_LIVE_INTRA_OVER_WEIGHT,
          recent: GUARDED_LIVE_RECENT_WEIGHT,
          repeatOver: GUARDED_LIVE_REPEAT_OVER_WEIGHT,
          repeatAffected: GUARDED_LIVE_REPEAT_AFFECTED_WEIGHT,
          partnerRepeat: GUARDED_LIVE_PARTNER_REPEAT_SOFT_WEIGHT,
        }
    }
  })()
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
          intraOver * policyWeights.intra +
          repeat.repeat_over_by * policyWeights.repeatOver +
          repeat.affected_players * policyWeights.repeatAffected +
          Math.max(0, repeat.max_partner_pair - 1) * policyWeights.partnerRepeat +
          Math.min(recent, 120) * policyWeights.recent +
          quota.over * GUARDED_LIVE_QUOTA_OVER_WEIGHT +
          quota.under * GUARDED_LIVE_QUOTA_UNDER_WEIGHT +
          tradeoffs * GUARDED_LIVE_TRADEOFF_WEIGHT,
      }
    })
  if (scored.length === 0) return null

  const qualityGatePool = (() => {
    if (scored.length < GUARDED_LIVE_QUALITY_GATE_MIN_ALTERNATIVES) return null
    const tiers = [
      {
        pvnaLimit: configuredPvnaTolerance,
        intraLimit: GUARDED_LIVE_QUALITY_TIER_A_INTRA_LIMIT,
        repeatOverLimit: 0,
        recentLimit: 20,
      },
      {
        pvnaLimit: configuredPvnaTolerance + GUARDED_LIVE_QUALITY_TIER_B_PVNA_EXTRA,
        intraLimit: GUARDED_LIVE_QUALITY_TIER_B_INTRA_LIMIT,
        repeatOverLimit: 0,
        recentLimit: 40,
      },
      {
        pvnaLimit: configuredPvnaTolerance + GUARDED_LIVE_QUALITY_TIER_C_PVNA_EXTRA,
        intraLimit: GUARDED_LIVE_QUALITY_TIER_C_INTRA_LIMIT,
        repeatOverLimit: 1,
        recentLimit: 60,
      },
    ]
    for (const tier of tiers) {
      const tierPool = scored.filter(item =>
        item.quota.over === 0 &&
        item.pvnaGap <= tier.pvnaLimit &&
        item.intraTeamGap <= tier.intraLimit &&
        item.repeat.repeat_over_by <= tier.repeatOverLimit &&
        item.recent <= tier.recentLimit
      )
      if (tierPool.length > 0) return tierPool
    }
    return null
  })()

  const cleanEnough = scored.filter(item =>
    item.pvnaGap <= configuredPvnaTolerance + 0.25 &&
    item.recent < 40,
  )
  const sortScored = (items: typeof scored) => [...items].sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score
    if (left.quota.total !== right.quota.total) return left.quota.total - right.quota.total
    if (left.repeat.repeat_over_by !== right.repeat.repeat_over_by) return left.repeat.repeat_over_by - right.repeat.repeat_over_by
    if (left.repeat.max_partner_pair !== right.repeat.max_partner_pair) return left.repeat.max_partner_pair - right.repeat.max_partner_pair
    if (left.repeat.max_opponent_pair !== right.repeat.max_opponent_pair) return left.repeat.max_opponent_pair - right.repeat.max_opponent_pair
    if (left.recent !== right.recent) return left.recent - right.recent
    if (left.pvnaGap !== right.pvnaGap) return left.pvnaGap - right.pvnaGap
    return left.intraTeamGap - right.intraTeamGap
  })
  const baseline = sortScored(cleanEnough.length > 0 ? cleanEnough : scored)[0]
  if (!baseline) return null
  if (policy === 'pvna_outlier_rescue' && isLateRound && baseline.pvnaGap > 1) {
    const rescuePool = scored.filter(item =>
      item.quota.over === 0 &&
      item.pvnaGap < baseline.pvnaGap - 0.25 &&
      item.pvnaGap <= Math.max(configuredPvnaTolerance + 0.4, baseline.pvnaGap * 0.65) &&
      item.repeat.repeat_over_by <= Math.max(1, baseline.repeat.repeat_over_by) &&
      item.recent <= Math.max(60, baseline.recent + 20)
    )
    if (rescuePool.length > 0) {
      return sortScored(rescuePool)[0]?.alternative ?? baseline.alternative
    }
  }
  if (policy === 'recent_overlap_guarded' && isLateRound) {
    const pvnaGuardPool = scored.filter(item =>
      item.quota.over === 0 &&
      item.pvnaGap <= configuredPvnaTolerance &&
      item.repeat.repeat_over_by <= 1
    )
    if (pvnaGuardPool.length > 0) {
      return sortScored(pvnaGuardPool)[0]?.alternative ?? baseline.alternative
    }
  }
  const baselineNeedsQualityRescue =
    baseline.quota.over === 0 &&
    (
      baseline.pvnaGap > configuredPvnaTolerance + GUARDED_LIVE_QUALITY_TIER_B_PVNA_EXTRA ||
      baseline.intraTeamGap > GUARDED_LIVE_QUALITY_TIER_B_INTRA_LIMIT ||
      baseline.repeat.repeat_over_by > 0
    )
  if (baselineNeedsQualityRescue && qualityGatePool) {
    return sortScored(qualityGatePool)[0]?.alternative ?? baseline.alternative
  }
  return baseline.alternative
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

function needsLiveQualityRescue(metrics: SuggestionTradeoffChoice['metrics'], configuredPvnaTolerance: number) {
  return metrics.pvna_gap > configuredPvnaTolerance + GUARDED_LIVE_QUALITY_TIER_B_PVNA_EXTRA ||
    metrics.intra_team_gap > GUARDED_LIVE_QUALITY_TIER_B_INTRA_LIMIT ||
    metrics.repeat_over_by > 0
}

function findQuotaRelaxedQualityRescue(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  configuredPvnaTolerance: number,
  nextMatchIndex: number,
) {
  const { min: targetMinAfter, max: targetMaxAfter } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  return alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map(alternative => ({
      alternative,
      metrics: getTradeoffChoiceMetrics(alternative, state, configuredPvnaTolerance),
      quota: getProjectedCountViolation(alternative, state, targetMaxAfter, targetMinAfter),
      recent: getAlternativeRecentCost(alternative, state),
    }))
    .filter(item =>
      item.metrics.pvna_gap <= configuredPvnaTolerance &&
      item.metrics.intra_team_gap <= GUARDED_LIVE_QUALITY_TIER_B_INTRA_LIMIT &&
      item.metrics.repeat_over_by <= 0 &&
      item.quota.over <= LIVE_QUALITY_RESCUE_QUOTA_RELAX_LIMIT &&
      item.quota.under <= LIVE_QUALITY_RESCUE_QUOTA_RELAX_LIMIT &&
      item.recent <= 40
    )
    .sort((left, right) => {
      if (left.quota.total !== right.quota.total) return left.quota.total - right.quota.total
      if (left.metrics.pvna_gap !== right.metrics.pvna_gap) return left.metrics.pvna_gap - right.metrics.pvna_gap
      if (left.metrics.intra_team_gap !== right.metrics.intra_team_gap) return left.metrics.intra_team_gap - right.metrics.intra_team_gap
      if (left.recent !== right.recent) return left.recent - right.recent
      return left.alternative.score - right.alternative.score
    })[0]?.alternative ?? null
}

function getProjectedSelectionBurden(alternative: SuggestionAlternative, state: SessionState) {
  const selectedIds = new Set(alternative.matches.flatMap(match => [...match.team_a, ...match.team_b]))
  const selectedPlayers = [...selectedIds]
    .map(playerId => state.players.get(playerId))
    .filter((player): player is PlayerSessionState => Boolean(player))
  const projectedStreaks = selectedPlayers.map(player => player.consecutive_play + 1)
  return {
    max_streak: Math.max(0, ...projectedStreaks),
    streak_gte_3: projectedStreaks.filter(streak => streak >= 3).length,
    streak_gte_4: projectedStreaks.filter(streak => streak >= 4).length,
  }
}

function materiallyImprovesLiveQuality(
  candidate: SuggestionTradeoffChoice['metrics'],
  reference: SuggestionTradeoffChoice['metrics'],
) {
  return candidate.pvna_gap < reference.pvna_gap - 0.05
    || candidate.intra_team_gap < reference.intra_team_gap - 0.05
    || candidate.repeat_over_by < reference.repeat_over_by
    || candidate.max_partner_pair < reference.max_partner_pair
    || candidate.max_opponent_pair < reference.max_opponent_pair
}

export function findConditionalLiveQualityRescue(
  alternatives: SuggestionAlternative[],
  reference: SuggestionAlternative,
  state: SessionState,
  configuredPvnaTolerance: number,
  nextMatchIndex: number,
) {
  const referenceMetrics = getTradeoffChoiceMetrics(reference, state, configuredPvnaTolerance)
  const shouldRun = referenceMetrics.intra_team_gap > PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT
    || referenceMetrics.max_partner_pair > 1
    || referenceMetrics.max_opponent_pair > 1
    || referenceMetrics.pvna_gap >= Math.min(configuredPvnaTolerance, 0.4)
  if (!shouldRun) return null

  const referenceBurden = getProjectedSelectionBurden(reference, state)
  const { min: targetMinAfter, max: targetMaxAfter } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const referenceQuota = getProjectedCountViolation(reference, state, targetMaxAfter, targetMinAfter)

  return alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map(alternative => ({
      alternative,
      metrics: getTradeoffChoiceMetrics(alternative, state, configuredPvnaTolerance),
      quota: getProjectedCountViolation(alternative, state, targetMaxAfter, targetMinAfter),
      burden: getProjectedSelectionBurden(alternative, state),
      recent: getAlternativeRecentCost(alternative, state),
    }))
    .filter(item =>
      item.metrics.pvna_over_by <= referenceMetrics.pvna_over_by + 0.001
      && item.metrics.intra_team_gap <= referenceMetrics.intra_team_gap + 0.001
      && item.metrics.intra_team_over_by <= referenceMetrics.intra_team_over_by + 0.001
      && item.metrics.repeat_over_by <= referenceMetrics.repeat_over_by
      && item.metrics.max_partner_pair <= referenceMetrics.max_partner_pair
      && item.metrics.max_opponent_pair <= referenceMetrics.max_opponent_pair
      && item.quota.over <= referenceQuota.over
      && item.quota.under <= referenceQuota.under
      && item.burden.max_streak <= referenceBurden.max_streak
      && item.burden.streak_gte_3 <= referenceBurden.streak_gte_3
      && item.burden.streak_gte_4 <= referenceBurden.streak_gte_4
      && materiallyImprovesLiveQuality(item.metrics, referenceMetrics)
    )
    .sort((left, right) => {
      if (left.metrics.repeat_over_by !== right.metrics.repeat_over_by) return left.metrics.repeat_over_by - right.metrics.repeat_over_by
      if (left.metrics.max_partner_pair !== right.metrics.max_partner_pair) return left.metrics.max_partner_pair - right.metrics.max_partner_pair
      if (left.metrics.max_opponent_pair !== right.metrics.max_opponent_pair) return left.metrics.max_opponent_pair - right.metrics.max_opponent_pair
      if (left.metrics.intra_team_over_by !== right.metrics.intra_team_over_by) return left.metrics.intra_team_over_by - right.metrics.intra_team_over_by
      if (left.metrics.pvna_over_by !== right.metrics.pvna_over_by) return left.metrics.pvna_over_by - right.metrics.pvna_over_by
      if (left.metrics.total_cost !== right.metrics.total_cost) return left.metrics.total_cost - right.metrics.total_cost
      if (left.burden.streak_gte_4 !== right.burden.streak_gte_4) return left.burden.streak_gte_4 - right.burden.streak_gte_4
      if (left.burden.streak_gte_3 !== right.burden.streak_gte_3) return left.burden.streak_gte_3 - right.burden.streak_gte_3
      if (left.recent !== right.recent) return left.recent - right.recent
      if (left.metrics.pvna_gap !== right.metrics.pvna_gap) return left.metrics.pvna_gap - right.metrics.pvna_gap
      return left.alternative.score - right.alternative.score
    })[0]?.alternative ?? null
}

export function findConditionalLiveQualityTradeoff(
  alternatives: SuggestionAlternative[],
  reference: SuggestionAlternative,
  state: SessionState,
  configuredPvnaTolerance: number,
  nextMatchIndex: number,
) {
  const referenceMetrics = getTradeoffChoiceMetrics(reference, state, configuredPvnaTolerance)
  const referenceBurden = getProjectedSelectionBurden(reference, state)
  const referenceRecent = getAlternativeRecentCost(reference, state)
  const { min: targetMinAfter, max: targetMaxAfter } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const referenceQuota = getProjectedCountViolation(reference, state, targetMaxAfter, targetMinAfter)

  return alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map(alternative => ({
      alternative,
      metrics: getTradeoffChoiceMetrics(alternative, state, configuredPvnaTolerance),
      quota: getProjectedCountViolation(alternative, state, targetMaxAfter, targetMinAfter),
      burden: getProjectedSelectionBurden(alternative, state),
      recent: getAlternativeRecentCost(alternative, state),
    }))
    .map(item => ({
      ...item,
      quota_over_delta: Math.max(0, item.quota.over - referenceQuota.over),
      opponent_repeat_delta: Math.max(0, item.metrics.max_opponent_pair - referenceMetrics.max_opponent_pair),
      consecutive_play_delta: Math.max(0, item.burden.max_streak - referenceBurden.max_streak),
    }))
    .filter(item =>
      item.metrics.pvna_over_by <= referenceMetrics.pvna_over_by + 0.001
      && item.metrics.intra_team_over_by <= referenceMetrics.intra_team_over_by + 0.001
      && item.metrics.repeat_over_by <= referenceMetrics.repeat_over_by
      && item.metrics.max_partner_pair <= referenceMetrics.max_partner_pair
      && item.metrics.max_opponent_pair <= referenceMetrics.max_opponent_pair + 1
      && item.quota.over > referenceQuota.over
      && item.quota.over <= referenceQuota.over + LIVE_QUALITY_RESCUE_QUOTA_RELAX_LIMIT
      && item.quota.under <= referenceQuota.under
      && item.burden.max_streak <= referenceBurden.max_streak + 1
      && item.burden.max_streak <= LIVE_RECYCLE_SOFT_CONSECUTIVE_PLAY_LIMIT
      && item.burden.streak_gte_3 <= referenceBurden.streak_gte_3
      && item.burden.streak_gte_4 <= referenceBurden.streak_gte_4
      && item.recent <= referenceRecent
      && materiallyImprovesLiveQuality(item.metrics, referenceMetrics)
    )
    .sort((left, right) => {
      if (left.quota.total !== right.quota.total) return left.quota.total - right.quota.total
      if (left.metrics.repeat_over_by !== right.metrics.repeat_over_by) return left.metrics.repeat_over_by - right.metrics.repeat_over_by
      if (left.metrics.max_partner_pair !== right.metrics.max_partner_pair) return left.metrics.max_partner_pair - right.metrics.max_partner_pair
      if (left.metrics.max_opponent_pair !== right.metrics.max_opponent_pair) return left.metrics.max_opponent_pair - right.metrics.max_opponent_pair
      if (left.metrics.intra_team_over_by !== right.metrics.intra_team_over_by) return left.metrics.intra_team_over_by - right.metrics.intra_team_over_by
      if (left.metrics.pvna_over_by !== right.metrics.pvna_over_by) return left.metrics.pvna_over_by - right.metrics.pvna_over_by
      if (left.burden.streak_gte_4 !== right.burden.streak_gte_4) return left.burden.streak_gte_4 - right.burden.streak_gte_4
      if (left.burden.streak_gte_3 !== right.burden.streak_gte_3) return left.burden.streak_gte_3 - right.burden.streak_gte_3
      return left.metrics.total_cost - right.metrics.total_cost
    })[0] ?? null
}

function buildConditionalLiveQualityTradeoffChoices(
  reference: SuggestionAlternative,
  tradeoff: NonNullable<ReturnType<typeof findConditionalLiveQualityTradeoff>>,
  state: SessionState,
  configuredPvnaTolerance: number,
) {
  const referenceMetrics = getTradeoffChoiceMetrics(reference, state, configuredPvnaTolerance)
  const tradeoffMetrics: SuggestionTradeoffChoice['metrics'] = {
    ...tradeoff.metrics,
    match_count_over_by: tradeoff.quota_over_delta,
    opponent_repeat_over_by: tradeoff.opponent_repeat_delta,
    consecutive_play_over_by: tradeoff.consecutive_play_delta,
  }
  const id: SuggestionTradeoffChoiceId = tradeoffMetrics.max_partner_pair < referenceMetrics.max_partner_pair
    || tradeoffMetrics.max_opponent_pair < referenceMetrics.max_opponent_pair
    ? 'reduce_repeat'
    : tradeoffMetrics.intra_team_gap < referenceMetrics.intra_team_gap - 0.01
      ? 'reduce_intra'
      : 'keep_pvna'

  return {
    recommended: 'balanced' as const,
    choices: [
      {
        id: 'balanced' as const,
        label: 'Tốt nhất tổng thể',
        alternative: reference,
        metrics: referenceMetrics,
        explanation: buildTradeoffChoiceExplanation('balanced', referenceMetrics, configuredPvnaTolerance),
      },
      {
        id,
        label: id === 'reduce_repeat' ? 'Ít lặp hơn' : id === 'reduce_intra' ? 'Cặp trong đội đều hơn' : 'Giữ PVNA',
        alternative: tradeoff.alternative,
        metrics: tradeoffMetrics,
        explanation: [
          ...buildTradeoffChoiceExplanation(id, tradeoffMetrics, configuredPvnaTolerance),
          `Fairness quota tăng ${tradeoff.quota_over_delta} người`,
        ],
      },
    ],
  }
}

function findPvnaOutlierRescue(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  configuredPvnaTolerance: number,
  nextMatchIndex: number,
  referenceMetrics: SuggestionTradeoffChoice['metrics'],
) {
  const { min: targetMinAfter, max: targetMaxAfter } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  return alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map(alternative => ({
      alternative,
      metrics: getTradeoffChoiceMetrics(alternative, state, configuredPvnaTolerance),
      quota: getProjectedCountViolation(alternative, state, targetMaxAfter, targetMinAfter),
      recent: getAlternativeRecentCost(alternative, state),
    }))
    .filter(item =>
      item.quota.over <= 2 &&
      item.quota.under <= 2 &&
      item.metrics.pvna_gap < referenceMetrics.pvna_gap - 0.25 &&
      item.metrics.pvna_gap <= Math.max(configuredPvnaTolerance + 0.6, referenceMetrics.pvna_gap * 0.75) &&
      item.metrics.repeat_over_by <= Math.max(1, referenceMetrics.repeat_over_by + 1) &&
      item.recent <= 100
    )
    .sort((left, right) => {
      if (left.metrics.pvna_gap !== right.metrics.pvna_gap) return left.metrics.pvna_gap - right.metrics.pvna_gap
      if (left.quota.total !== right.quota.total) return left.quota.total - right.quota.total
      if (left.metrics.intra_team_gap !== right.metrics.intra_team_gap) return left.metrics.intra_team_gap - right.metrics.intra_team_gap
      if (left.recent !== right.recent) return left.recent - right.recent
      return left.alternative.score - right.alternative.score
    })[0]?.alternative ?? null
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

function selectRequiredIdsForCourt(
  availableRequiredIds: string[],
  count: number,
  remainingCourtsInRound: number,
  state: SessionState,
) {
  if (count <= 0) return []
  if (remainingCourtsInRound <= 1 || availableRequiredIds.length <= count) {
    return availableRequiredIds.slice(0, count)
  }
  const sortedByPvna = [...availableRequiredIds].sort((left, right) =>
    (state.players.get(right) ? getEffectivePvna(state.players.get(right)!) : 0)
      - (state.players.get(left) ? getEffectivePvna(state.players.get(left)!) : 0) ||
    left.localeCompare(right)
  )
  const buckets = Array.from({ length: remainingCourtsInRound }, () => [] as string[])
  let bucketIndex = 0
  while (sortedByPvna.length > 0) {
    buckets[bucketIndex % remainingCourtsInRound].push(sortedByPvna.shift()!)
    if (sortedByPvna.length > 0) {
      buckets[bucketIndex % remainingCourtsInRound].push(sortedByPvna.pop()!)
    }
    bucketIndex += 1
  }
  const selected = buckets[0].slice(0, count)
  if (selected.length >= count) return selected
  for (const playerId of availableRequiredIds) {
    if (selected.includes(playerId)) continue
    selected.push(playerId)
    if (selected.length >= count) break
  }
  return selected
}

export function deferLowViabilityRequiredIdsForCourt({
  requiredForThisCourt,
  availableRequiredIds,
  busyIds,
  remainingCourtsInRound,
  state,
}: {
  requiredForThisCourt: string[]
  availableRequiredIds: string[]
  busyIds: Set<string>
  remainingCourtsInRound: number
  state: SessionState
}) {
  if (requiredForThisCourt.length === 0 || remainingCourtsInRound <= 1) {
    return requiredForThisCourt
  }

  const tolerance = state.config.pvna_tolerance
  const requiredPvnas = requiredForThisCourt
    .map(playerId => {
      const player = state.players.get(playerId)
      return player ? getEffectivePvna(player) : undefined
    })
    .filter((pvna): pvna is number => typeof pvna === 'number' && Number.isFinite(pvna))
  const spread = requiredPvnas.length === 0 ? 0 : Math.max(...requiredPvnas) - Math.min(...requiredPvnas)
  if (spread <= tolerance) return requiredForThisCourt

  const requiredSet = new Set(availableRequiredIds)
  const activePool = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
    .filter(player => !requiredSet.has(player.player_id))
  const hasNearLevelCandidate = (playerId: string) => {
    const required = state.players.get(playerId)
    if (!required) return false
    return activePool.some(player => Math.abs(getEffectivePvna(player) - getEffectivePvna(required)) <= tolerance)
  }
  const viable = requiredForThisCourt.filter(hasNearLevelCandidate)
  if (viable.length === 0) return requiredForThisCourt.slice(0, 1)
  return viable
}

function getPayloadPlayer(payload: SuggestedMatchPayload, position: number) {
  return position < 2 ? payload.team_a[position] : payload.team_b[position - 2]
}

function setPayloadPlayer(payload: SuggestedMatchPayload, position: number, playerId: string): SuggestedMatchPayload {
  const teamA: [string, string] = [...payload.team_a] as [string, string]
  const teamB: [string, string] = [...payload.team_b] as [string, string]
  if (position < 2) teamA[position] = playerId
  else teamB[position - 2] = playerId
  return { ...payload, team_a: teamA, team_b: teamB }
}

function getPayloadPvnaGap(payload: SuggestedMatchPayload, state: SessionState) {
  const teamSum = (team: [string, string]) => team.reduce(
    (sum, playerId) => {
      const player = state.players.get(playerId)
      return sum + (player ? getEffectivePvna(player) : 0)
    },
    0,
  )
  return Math.abs(teamSum(payload.team_a) - teamSum(payload.team_b))
}

export function getPreviewBoardPvnaRescueScore(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
) {
  const overBy = payloads.map(payload => Math.max(0, getPayloadPvnaGap(payload, state) - pvnaTolerance))
  return {
    overCount: overBy.filter(value => value > 0).length,
    totalOver: overBy.reduce((sum, value) => sum + value, 0),
    maxOver: Math.max(0, ...overBy),
  }
}

export function needsEarlyFullBoardPvnaRescue(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
) {
  return payloads.some((payload) => {
    const overBy = getPayloadPvnaGap(payload, state) - pvnaTolerance
    if (overBy > 1) return true
    return Number(payload.round_no ?? 0) < LIVE_EARLY_QUALITY_REPAIR_END_ROUND
      && overBy > 0.25
  })
}

export function improvesPreviewBoardPvna(
  candidate: SuggestedMatchPayload[],
  reference: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
) {
  const left = getPreviewBoardPvnaRescueScore(candidate, state, pvnaTolerance)
  const right = getPreviewBoardPvnaRescueScore(reference, state, pvnaTolerance)
  if (left.maxOver !== right.maxOver) return left.maxOver < right.maxOver
  if (left.overCount !== right.overCount) return left.overCount < right.overCount
  return left.totalOver < right.totalOver - 0.01
}

function getPayloadIntraTeamGap(payload: SuggestedMatchPayload, state: SessionState) {
  const gap = (team: [string, string]) => Math.abs(
    (state.players.get(team[0]) ? getEffectivePvna(state.players.get(team[0])!) : 0)
      - (state.players.get(team[1]) ? getEffectivePvna(state.players.get(team[1])!) : 0),
  )
  return Math.max(gap(payload.team_a), gap(payload.team_b))
}

function hasPayloadRepeat(payload: SuggestedMatchPayload, state: SessionState) {
  const partnerPairs = [
    [payload.team_a[0], payload.team_a[1]],
    [payload.team_b[0], payload.team_b[1]],
  ] as Array<[string, string]>
  const opponentPairs = payload.team_a.flatMap(playerAId =>
    payload.team_b.map(playerBId => [playerAId, playerBId] as [string, string]),
  )
  const partner = partnerPairs.some(([left, right]) =>
    (state.players.get(left)?.partner_counts.get(right) ?? 0) > 0,
  )
  const opponent = opponentPairs.some(([left, right]) =>
    (state.players.get(left)?.opponent_counts.get(right) ?? 0) > 0,
  )
  return partner || opponent
}

function getPayloadPairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

function getPayloadBatchStats(payloads: SuggestedMatchPayload[], state: SessionState, pvnaTolerance: number) {
  const pvnaValues = payloads.map(payload => getPayloadPvnaGap(payload, state))
  const pvnaOverValues = pvnaValues.map(value => Math.max(0, value - pvnaTolerance))
  const intraValues = payloads.map(payload => getPayloadIntraTeamGap(payload, state))
  return {
    maxPvna: Math.max(0, ...pvnaValues),
    pvnaOver: pvnaOverValues.filter(value => value > 0).length,
    totalPvnaOver: pvnaOverValues.reduce((sum, value) => sum + value, 0),
    maxIntra: Math.max(0, ...intraValues),
    intraOverHard: intraValues.filter(value => value > 1.5).length,
    totalIntraOverPreferred: intraValues.reduce(
      (sum, value) => sum + Math.max(0, value - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT),
      0,
    ),
    repeatMatches: payloads.filter(payload => hasPayloadRepeat(payload, state)).length,
  }
}

function shouldRepairEarlyQualityForPayloadBatch(payloads: SuggestedMatchPayload[]) {
  return payloads.some(payload => {
    const round = Number(payload.round_no ?? 0) + 1
    return round >= 1 && round <= LIVE_EARLY_QUALITY_REPAIR_END_ROUND
  })
}

function hasSeverePayloadPvnaOutlier(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
) {
  return payloads.some(payload => getPayloadPvnaGap(payload, state) > pvnaTolerance + 1)
}

function improvesEarlyBatchQuality(
  candidate: ReturnType<typeof getPayloadBatchStats>,
  reference: ReturnType<typeof getPayloadBatchStats>,
) {
  return scoreEarlyBatchQuality(candidate) < scoreEarlyBatchQuality(reference) - 0.01
}

function scoreEarlyBatchQuality(stats: ReturnType<typeof getPayloadBatchStats>) {
  const severePvnaOutlier = Math.max(0, stats.maxPvna - 1.5)
  return (
    severePvnaOutlier * 250000 +
    stats.pvnaOver * 60000 +
    stats.totalPvnaOver * 250000 +
    stats.intraOverHard * 100000 +
    stats.repeatMatches * 100000 +
    stats.maxIntra * 20000 +
    stats.totalIntraOverPreferred * 3000 +
    stats.maxPvna * 500
  )
}

type EarlyBeamMatch = {
  team_a: [string, string]
  team_b: [string, string]
  mask: number
  pvna: number
  intra: number
  repeat: number
}

type EarlyBeamState = {
  matches: EarlyBeamMatch[]
  mask: number
  maxPvna: number
  pvnaOver: number
  totalPvnaOver: number
  maxIntra: number
  totalIntraOverPreferred: number
  repeatMatches: number
  score: number
}

function getFirstUnusedBeamIndex(mask: number, playerCount: number) {
  for (let index = 0; index < playerCount; index += 1) {
    if ((mask & (1 << index)) === 0) return index
  }
  return -1
}

function buildEarlyBeamMatch(
  teamA: [string, string],
  teamB: [string, string],
  indexByPlayerId: Map<string, number>,
  state: SessionState,
) {
  const payload = {
    team_a: teamA,
    team_b: teamB,
  } as SuggestedMatchPayload
  const mask = [...teamA, ...teamB].reduce((nextMask, playerId) => {
    const index = indexByPlayerId.get(playerId)
    return index === undefined ? nextMask : nextMask | (1 << index)
  }, 0)
  return {
    team_a: teamA,
    team_b: teamB,
    mask,
    pvna: getPayloadPvnaGap(payload, state),
    intra: getPayloadIntraTeamGap(payload, state),
    repeat: hasPayloadRepeat(payload, state) ? 1 : 0,
  }
}

function pushEarlyBeamMatch(
  output: EarlyBeamMatch[],
  teamA: [string, string],
  teamB: [string, string],
  indexByPlayerId: Map<string, number>,
  state: SessionState,
  pvnaTolerance: number,
  maxIntraLimit: number,
) {
  const match = buildEarlyBeamMatch(teamA, teamB, indexByPlayerId, state)
  if (match.pvna > pvnaTolerance + 1e-9) return
  if (match.intra > maxIntraLimit + 1e-9) return
  output.push(match)
}

function getEarlyBeamCandidatesForAnchor(
  playerIds: string[],
  indexByPlayerId: Map<string, number>,
  anchorIndex: number,
  usedMask: number,
  state: SessionState,
  pvnaTolerance: number,
  maxIntraLimit: number,
) {
  const candidates: EarlyBeamMatch[] = []
  const anchor = playerIds[anchorIndex]
  for (let secondIndex = anchorIndex + 1; secondIndex < playerIds.length; secondIndex += 1) {
    if ((usedMask & (1 << secondIndex)) !== 0) continue
    for (let thirdIndex = secondIndex + 1; thirdIndex < playerIds.length; thirdIndex += 1) {
      if ((usedMask & (1 << thirdIndex)) !== 0) continue
      for (let fourthIndex = thirdIndex + 1; fourthIndex < playerIds.length; fourthIndex += 1) {
        if ((usedMask & (1 << fourthIndex)) !== 0) continue
        const second = playerIds[secondIndex]
        const third = playerIds[thirdIndex]
        const fourth = playerIds[fourthIndex]
        pushEarlyBeamMatch(candidates, [anchor, second], [third, fourth], indexByPlayerId, state, pvnaTolerance, maxIntraLimit)
        pushEarlyBeamMatch(candidates, [anchor, third], [second, fourth], indexByPlayerId, state, pvnaTolerance, maxIntraLimit)
        pushEarlyBeamMatch(candidates, [anchor, fourth], [second, third], indexByPlayerId, state, pvnaTolerance, maxIntraLimit)
      }
    }
  }
  return candidates.sort((left, right) => {
    if (left.repeat !== right.repeat) return left.repeat - right.repeat
    if (left.intra !== right.intra) return left.intra - right.intra
    return left.pvna - right.pvna
  })
}

function getEarlyBeamCandidatesForBatch(
  playerIds: string[],
  indexByPlayerId: Map<string, number>,
  state: SessionState,
  pvnaTolerance: number,
) {
  const candidates: EarlyBeamMatch[] = []
  for (let firstIndex = 0; firstIndex < playerIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < playerIds.length; secondIndex += 1) {
      for (let thirdIndex = secondIndex + 1; thirdIndex < playerIds.length; thirdIndex += 1) {
        for (let fourthIndex = thirdIndex + 1; fourthIndex < playerIds.length; fourthIndex += 1) {
          const first = playerIds[firstIndex]
          const second = playerIds[secondIndex]
          const third = playerIds[thirdIndex]
          const fourth = playerIds[fourthIndex]
          pushEarlyBeamMatch(candidates, [first, second], [third, fourth], indexByPlayerId, state, pvnaTolerance, Infinity)
          pushEarlyBeamMatch(candidates, [first, third], [second, fourth], indexByPlayerId, state, pvnaTolerance, Infinity)
          pushEarlyBeamMatch(candidates, [first, fourth], [second, third], indexByPlayerId, state, pvnaTolerance, Infinity)
        }
      }
    }
  }
  return candidates.sort((left, right) => {
    if (left.repeat !== right.repeat) return left.repeat - right.repeat
    if (left.intra !== right.intra) return left.intra - right.intra
    return left.pvna - right.pvna
  })
}

function scoreEarlyBeamState(
  state: Pick<EarlyBeamState, 'maxPvna' | 'pvnaOver' | 'totalPvnaOver' | 'maxIntra' | 'totalIntraOverPreferred' | 'repeatMatches'>,
) {
  return scoreEarlyBatchQuality({
    maxPvna: state.maxPvna,
    pvnaOver: state.pvnaOver,
    totalPvnaOver: state.totalPvnaOver,
    maxIntra: state.maxIntra,
    intraOverHard: state.maxIntra > 1.5 ? 1 : 0,
    totalIntraOverPreferred: state.totalIntraOverPreferred,
    repeatMatches: state.repeatMatches,
  })
}

function repairEarlyPayloadBatchQualityWithBeam(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
) {
  if (payloads.length < 2) return payloads
  const selectedIds = [...new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b]))]
  if (selectedIds.length !== payloads.length * 4) return payloads
  if (selectedIds.length > LIVE_EARLY_QUALITY_BEAM_MAX_PLAYERS) return payloads

  const indexByPlayerId = new Map(selectedIds.map((playerId, index) => [playerId, index]))
  const currentStats = getPayloadBatchStats(payloads, state, pvnaTolerance)
  const fullMask = (1 << selectedIds.length) - 1
  const candidates = getEarlyBeamCandidatesForBatch(selectedIds, indexByPlayerId, state, pvnaTolerance)
  let beam: EarlyBeamState[] = [{
    matches: [],
    mask: 0,
    maxPvna: 0,
    pvnaOver: 0,
    totalPvnaOver: 0,
    maxIntra: 0,
    totalIntraOverPreferred: 0,
    repeatMatches: 0,
    score: 0,
  }]
  for (let depth = 0; depth < payloads.length; depth += 1) {
    const next: EarlyBeamState[] = []
    for (const beamState of beam) {
      for (const candidate of candidates) {
        if ((beamState.mask & candidate.mask) !== 0) continue
        const maxPvna = Math.max(beamState.maxPvna, candidate.pvna)
        const candidatePvnaOver = Math.max(0, candidate.pvna - pvnaTolerance)
        const pvnaOver = beamState.pvnaOver + (candidatePvnaOver > 0 ? 1 : 0)
        const totalPvnaOver = beamState.totalPvnaOver + candidatePvnaOver
        const maxIntra = Math.max(beamState.maxIntra, candidate.intra)
        const totalIntraOverPreferred =
          beamState.totalIntraOverPreferred +
          Math.max(0, candidate.intra - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
        const repeatMatches = beamState.repeatMatches + candidate.repeat
        const score = scoreEarlyBeamState({
          maxPvna,
          pvnaOver,
          totalPvnaOver,
          maxIntra,
          totalIntraOverPreferred,
          repeatMatches,
        })
        next.push({
          matches: [...beamState.matches, candidate],
          mask: beamState.mask | candidate.mask,
          maxPvna,
          pvnaOver,
          totalPvnaOver,
          maxIntra,
          totalIntraOverPreferred,
          repeatMatches,
          score,
        })
      }
    }
    const seenMasks = new Set<number>()
    beam = next
      .sort((left, right) => left.score - right.score)
      .filter((beamState) => {
        if (seenMasks.has(beamState.mask)) return false
        seenMasks.add(beamState.mask)
        return true
      })
      .slice(0, LIVE_EARLY_QUALITY_BEAM_WIDTH)
    if (beam.length === 0) return payloads
  }
  const best = beam
    .filter(beamState => beamState.matches.length === payloads.length && beamState.mask === fullMask)
    .sort((left, right) => left.score - right.score)[0]
  if (!best) return payloads
  const bestStats = {
    maxPvna: best.maxPvna,
    pvnaOver: best.pvnaOver,
    totalPvnaOver: best.totalPvnaOver,
    maxIntra: best.maxIntra,
    intraOverHard: best.matches.filter(match => match.intra > 1.5).length,
    totalIntraOverPreferred: best.totalIntraOverPreferred,
    repeatMatches: best.repeatMatches,
  }
  if (!improvesEarlyBatchQuality(bestStats, currentStats)) return payloads

  return payloads.map((payload, index) => ({
    ...payload,
    team_a: best.matches[index]?.team_a ?? payload.team_a,
    team_b: best.matches[index]?.team_b ?? payload.team_b,
  }))
}

function repairRoundOnePayloadBatchWithCleanPool(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
  isTrueFirstRound: boolean,
) {
  if (payloads.length < 2) return payloads
  if (!isTrueFirstRound) return payloads
  if (!payloads.every(payload => Number(payload.round_no ?? 0) === 0)) return payloads

  const currentStats = getPayloadBatchStats(payloads, state, pvnaTolerance)
  if (currentStats.totalIntraOverPreferred <= 1e-9 && currentStats.intraOverHard === 0) return payloads

  const eligibleIds = [...state.players.values()]
    .filter(player => player.checked_out_at === null)
    .filter(player => !player.opted_rest)
    .sort((left, right) => {
      if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
      if (left.consecutive_rest !== right.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
      if (left.pvna !== right.pvna) return left.pvna - right.pvna
      return left.player_id.localeCompare(right.player_id)
    })
    .map(player => player.player_id)

  const requiredPlayerCount = payloads.length * 4
  if (eligibleIds.length < requiredPlayerCount) return payloads
  if (eligibleIds.length > LIVE_ROUND_ONE_CLEAN_BATCH_MAX_PLAYERS) return payloads

  const indexByPlayerId = new Map(eligibleIds.map((playerId, index) => [playerId, index]))
  const candidates: EarlyBeamMatch[] = []
  for (let firstIndex = 0; firstIndex < eligibleIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < eligibleIds.length; secondIndex += 1) {
      for (let thirdIndex = secondIndex + 1; thirdIndex < eligibleIds.length; thirdIndex += 1) {
        for (let fourthIndex = thirdIndex + 1; fourthIndex < eligibleIds.length; fourthIndex += 1) {
          const first = eligibleIds[firstIndex]
          const second = eligibleIds[secondIndex]
          const third = eligibleIds[thirdIndex]
          const fourth = eligibleIds[fourthIndex]
          pushEarlyBeamMatch(candidates, [first, second], [third, fourth], indexByPlayerId, state, pvnaTolerance, PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
          pushEarlyBeamMatch(candidates, [first, third], [second, fourth], indexByPlayerId, state, pvnaTolerance, PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
          pushEarlyBeamMatch(candidates, [first, fourth], [second, third], indexByPlayerId, state, pvnaTolerance, PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
        }
      }
    }
  }
  if (candidates.length === 0) return payloads
  candidates.sort((left, right) => {
    if (left.repeat !== right.repeat) return left.repeat - right.repeat
    if (left.intra !== right.intra) return left.intra - right.intra
    return left.pvna - right.pvna
  })

  const candidatesByPlayerId = new Map<string, EarlyBeamMatch[]>()
  for (const candidate of candidates) {
    for (const playerId of [...candidate.team_a, ...candidate.team_b]) {
      candidatesByPlayerId.set(playerId, [...(candidatesByPlayerId.get(playerId) ?? []), candidate])
    }
  }
  const restBudget = Math.max(0, eligibleIds.length - requiredPlayerCount)
  const search = (
    chosen: EarlyBeamMatch[],
    usedIds: Set<string>,
    restedIds: Set<string>,
  ): EarlyBeamMatch[] | null => {
    if (chosen.length === payloads.length) return chosen
    const remainingSlots = (payloads.length - chosen.length) * 4
    const availableCount = eligibleIds.filter(playerId => !usedIds.has(playerId) && !restedIds.has(playerId)).length
    if (availableCount < remainingSlots) return null

    const anchor = eligibleIds.find(playerId => !usedIds.has(playerId) && !restedIds.has(playerId))
    if (!anchor) return null
    const options = candidatesByPlayerId.get(anchor) ?? []
    for (const candidate of options) {
      const ids = [...candidate.team_a, ...candidate.team_b]
      if (ids.some(playerId => usedIds.has(playerId) || restedIds.has(playerId))) continue
      const found = search(
        [...chosen, candidate],
        new Set([...usedIds, ...ids]),
        restedIds,
      )
      if (found) return found
    }
    if (restedIds.size < restBudget) {
      const nextRestedIds = new Set(restedIds)
      nextRestedIds.add(anchor)
      return search(chosen, usedIds, nextRestedIds)
    }
    return null
  }
  const bestMatches = search([], new Set(), new Set())
  if (!bestMatches) return payloads

  const usedIds = new Set(bestMatches.flatMap(match => [...match.team_a, ...match.team_b]))
  const resting = eligibleIds.filter(playerId => !usedIds.has(playerId)).sort()
  const repaired = bestMatches.map((match, index) => normalizeRepairedPayload({
    ...payloads[index],
    team_a: match.team_a,
    team_b: match.team_b,
    resting,
  }, state, pvnaTolerance))
  const repairedStats = getPayloadBatchStats(repaired, state, pvnaTolerance)
  return improvesEarlyBatchQuality(repairedStats, currentStats) ? repaired : payloads
}

function repairEarlyPayloadBatchQuality(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
  isTrueFirstRound: boolean,
) {
  let current = repairRoundOnePayloadBatchWithCleanPool(payloads, state, pvnaTolerance, isTrueFirstRound)
  let currentStats = getPayloadBatchStats(current, state, pvnaTolerance)

  for (let pass = 0; pass < 4; pass += 1) {
    let bestPayloads: SuggestedMatchPayload[] | null = null
    let bestStats = currentStats
    const considerCandidate = (candidate: SuggestedMatchPayload[]) => {
      const candidateStats = getPayloadBatchStats(candidate, state, pvnaTolerance)
      if (candidateStats.pvnaOver > currentStats.pvnaOver) return
      if (currentStats.pvnaOver === 0 && candidateStats.maxPvna > pvnaTolerance) return
      if (!improvesEarlyBatchQuality(candidateStats, bestStats)) return
      bestPayloads = candidate
      bestStats = candidateStats
    }
    for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
        for (let leftPos = 0; leftPos < 4; leftPos += 1) {
          for (let rightPos = 0; rightPos < 4; rightPos += 1) {
            const leftPlayer = getPayloadPlayer(current[leftIndex], leftPos)
            const rightPlayer = getPayloadPlayer(current[rightIndex], rightPos)
            if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) continue
            const candidate = [...current]
            candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPos, rightPlayer)
            candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPos, leftPlayer)
            considerCandidate(candidate)
          }
        }
        const needsPairSwap =
          currentStats.intraOverHard > 0 ||
          currentStats.repeatMatches > 0 ||
          currentStats.totalIntraOverPreferred > 0
        if (needsPairSwap) {
          for (let leftPosA = 0; leftPosA < 4; leftPosA += 1) {
            for (let leftPosB = leftPosA + 1; leftPosB < 4; leftPosB += 1) {
              for (let rightPosA = 0; rightPosA < 4; rightPosA += 1) {
                for (let rightPosB = rightPosA + 1; rightPosB < 4; rightPosB += 1) {
                  const leftPlayerA = getPayloadPlayer(current[leftIndex], leftPosA)
                  const leftPlayerB = getPayloadPlayer(current[leftIndex], leftPosB)
                  const rightPlayerA = getPayloadPlayer(current[rightIndex], rightPosA)
                  const rightPlayerB = getPayloadPlayer(current[rightIndex], rightPosB)
                  if (!leftPlayerA || !leftPlayerB || !rightPlayerA || !rightPlayerB) continue
                  const candidate = [...current]
                  candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPosA, rightPlayerA)
                  candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPosB, rightPlayerB)
                  candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPosA, leftPlayerA)
                  candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPosB, leftPlayerB)
                  considerCandidate(candidate)
                }
              }
            }
          }
        }
      }
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
  }
  return repairEarlyPayloadBatchQualityWithBeam(current, state, pvnaTolerance)
}

function getPayloadRepeatExposureStats(payloads: SuggestedMatchPayload[], state: SessionState) {
  const basePlayerRepeat = new Map<string, { partnerEvents: number; opponentEvents: number }>()
  for (const player of state.players.values()) {
    basePlayerRepeat.set(player.player_id, {
      partnerEvents: [...player.partner_counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      opponentEvents: [...player.opponent_counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    })
  }
  const partnerPairs = new Map<string, number>()
  const opponentPairs = new Map<string, number>()
  const perPlayer = new Map<string, {
    partnerMatches: number
    partnerEvents: number
    opponentMatches: number
    opponentEvents: number
    maxSamePartner: number
    maxSameOpponent: number
  }>()
  const ensurePlayer = (playerId: string) => {
    const existing = perPlayer.get(playerId)
    if (existing) return existing
    const next = {
      partnerMatches: 0,
      partnerEvents: 0,
      opponentMatches: 0,
      opponentEvents: 0,
      maxSamePartner: 0,
      maxSameOpponent: 0,
    }
    perPlayer.set(playerId, next)
    return next
  }
  for (const payload of payloads) {
    const partnerPayloadPairs = [
      [payload.team_a[0], payload.team_a[1]],
      [payload.team_b[0], payload.team_b[1]],
    ] as Array<[string, string]>
    for (const [left, right] of partnerPayloadPairs) {
      const before = state.players.get(left)?.partner_counts.get(right) ?? 0
      const key = getPayloadPairKey(left, right)
      partnerPairs.set(key, Math.max(before + 1, partnerPairs.get(key) ?? 0))
      for (const playerId of [left, right]) {
        const player = ensurePlayer(playerId)
        if (before > 0) {
          player.partnerMatches += 1
          player.partnerEvents += before
        }
        player.maxSamePartner = Math.max(player.maxSamePartner, before + 1)
      }
    }
    for (const left of payload.team_a) {
      for (const right of payload.team_b) {
        const before = state.players.get(left)?.opponent_counts.get(right) ?? 0
        const key = getPayloadPairKey(left, right)
        opponentPairs.set(key, Math.max(before + 1, opponentPairs.get(key) ?? 0))
        for (const playerId of [left, right]) {
          const player = ensurePlayer(playerId)
          if (before > 0) {
            player.opponentMatches += 1
            player.opponentEvents += before
          }
          player.maxSameOpponent = Math.max(player.maxSameOpponent, before + 1)
        }
      }
    }
  }
  const playerRows = [...perPlayer.values()]
  const totalPlayerRows = [...perPlayer.entries()].map(([playerId, player]) => ({
    partnerEvents: (basePlayerRepeat.get(playerId)?.partnerEvents ?? 0) + player.partnerEvents,
    opponentEvents: (basePlayerRepeat.get(playerId)?.opponentEvents ?? 0) + player.opponentEvents,
  }))
  return {
    partnerRepeatMatches: playerRows.reduce((sum, player) => sum + player.partnerMatches, 0),
    partnerRepeatEvents: playerRows.reduce((sum, player) => sum + player.partnerEvents, 0),
    opponentRepeatMatches: playerRows.reduce((sum, player) => sum + player.opponentMatches, 0),
    opponentRepeatEvents: playerRows.reduce((sum, player) => sum + player.opponentEvents, 0),
    maxPlayerPartnerMatches: Math.max(0, ...playerRows.map(player => player.partnerMatches)),
    maxPlayerOpponentMatches: Math.max(0, ...playerRows.map(player => player.opponentMatches)),
    maxSamePartner: Math.max(0, ...playerRows.map(player => player.maxSamePartner)),
    maxSameOpponent: Math.max(0, ...playerRows.map(player => player.maxSameOpponent)),
    maxTotalPlayerPartnerEvents: Math.max(0, ...totalPlayerRows.map(player => player.partnerEvents)),
    maxTotalPlayerOpponentEvents: Math.max(0, ...totalPlayerRows.map(player => player.opponentEvents)),
    partnerX3: [...partnerPairs.values()].filter(count => count >= 3).length,
    opponentX3: [...opponentPairs.values()].filter(count => count >= 3).length,
  }
}

function scorePayloadRepeatRepair(payloads: SuggestedMatchPayload[], state: SessionState) {
  const repeat = getPayloadRepeatExposureStats(payloads, state)
  return (
    repeat.partnerX3 * 1000 +
    repeat.maxSamePartner * 180 +
    repeat.maxPlayerPartnerMatches * 120 +
    repeat.partnerRepeatMatches * 60 +
    repeat.partnerRepeatEvents * 30 +
    repeat.maxTotalPlayerPartnerEvents * 80 +
    repeat.opponentX3 * 140 +
    repeat.maxSameOpponent * 80 +
    repeat.maxPlayerOpponentMatches * 50 +
    repeat.maxTotalPlayerOpponentEvents * 35 +
    repeat.opponentRepeatMatches * 18 +
    repeat.opponentRepeatEvents * 8
  )
}

function shouldRepairRepeatForPayloadBatch(payloads: SuggestedMatchPayload[]) {
  return payloads.some(payload =>
    Number(payload.round_no ?? 0) + 1 >= LIVE_REPEAT_REPAIR_START_ROUND,
  )
}

function repairPayloadBatchRepeatExposure(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
) {
  let current = payloads
  let currentStats = getPayloadBatchStats(current, state, pvnaTolerance)
  let currentScore = scorePayloadRepeatRepair(current, state)

  for (let pass = 0; pass < 4; pass += 1) {
    let bestPayloads: SuggestedMatchPayload[] | null = null
    let bestStats = currentStats
    let bestScore = currentScore
    for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
        for (let leftPos = 0; leftPos < 4; leftPos += 1) {
          for (let rightPos = 0; rightPos < 4; rightPos += 1) {
            const leftPlayer = getPayloadPlayer(current[leftIndex], leftPos)
            const rightPlayer = getPayloadPlayer(current[rightIndex], rightPos)
            if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) continue
            const candidate = [...current]
            candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPos, rightPlayer)
            candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPos, leftPlayer)
            const candidateStats = getPayloadBatchStats(candidate, state, pvnaTolerance)
            if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
            if (currentStats.pvnaOver === 0 && candidateStats.maxPvna > pvnaTolerance) continue
            if (candidateStats.maxPvna > currentStats.maxPvna + 0.15) continue
            if (candidateStats.intraOverHard > currentStats.intraOverHard + 1) continue
            if (candidateStats.maxIntra > currentStats.maxIntra + 0.45) continue
            const candidateScore = scorePayloadRepeatRepair(candidate, state)
            if (candidateScore >= bestScore - 0.01) continue
            bestPayloads = candidate
            bestStats = candidateStats
            bestScore = candidateScore
          }
        }
      }
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
    currentScore = bestScore
  }
  return current
}

function normalizeRepairedPayload(
  payload: SuggestedMatchPayload,
  state: SessionState,
  pvnaTolerance: number,
  options: { clearTradeoffChoices?: boolean } = {},
) {
  const pvnaGap = getPayloadPvnaGap(payload, state)
  const intraGap = getPayloadIntraTeamGap(payload, state)
  const pvnaOverBy = Math.max(0, pvnaGap - pvnaTolerance)
  const intraOverBy = Math.max(0, intraGap - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
  const warnings = new Set((payload.warnings ?? []).filter(warning =>
    warning !== 'PVNA_TOLERANCE_RELAXED' &&
    warning !== 'PVNA_TOLERANCE_OPEN' &&
    warning !== 'INTRA_TEAM_GAP_RELAXED' &&
    warning !== 'REPEAT_CAP_REACHED'
  ))
  const tradeoffs = (payload.tradeoffs ?? []).filter(tradeoff =>
    tradeoff.type !== 'pvna_tolerance_relaxed' &&
    tradeoff.type !== 'intra_team_gap_relaxed'
  )
  if (pvnaOverBy > 0) {
    warnings.add('PVNA_TOLERANCE_RELAXED')
    tradeoffs.push({
      type: 'pvna_tolerance_relaxed',
      severity: pvnaOverBy * 10,
      over_by: pvnaOverBy,
    })
  }
  if (intraOverBy > 0) {
    warnings.add('INTRA_TEAM_GAP_RELAXED')
    tradeoffs.push({
      type: 'intra_team_gap_relaxed',
      severity: intraOverBy * 8,
      over_by: intraOverBy,
      affected_pairs: 1,
      affected_players: 2,
    })
  }
  if (hasPayloadRepeat(payload, state)) {
    warnings.add('REPEAT_CAP_REACHED')
  }
  return {
    ...payload,
    warnings: [...warnings],
    tradeoffs,
    approval_required: tradeoffs.length > 0,
    tradeoff_choices: options.clearTradeoffChoices === false ? payload.tradeoff_choices : undefined,
    recommended_tradeoff_choice: options.clearTradeoffChoices === false
      ? payload.recommended_tradeoff_choice
      : undefined,
  }
}

export function repairSuggestedPayloadBatch(
  payloads: SuggestedMatchPayload[],
  state: SessionState,
  pvnaTolerance: number,
  onRepairUsed?: (detail: 'swap' | 'early' | 'repeat') => void,
  options: { isTrueFirstRound?: boolean; allowEarlyQualityRepair?: boolean } = {},
) {
  let current = payloads
  let currentStats = getPayloadBatchStats(current, state, pvnaTolerance)
  let changed = false
  const isTrueFirstRound = options.isTrueFirstRound ?? state.rounds.length === 0
  const allowEarlyQualityRepair = options.allowEarlyQualityRepair ?? true

  for (let pass = 0; pass < 3; pass += 1) {
    let bestPayloads: SuggestedMatchPayload[] | null = null
    let bestStats = currentStats
    for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
        for (let leftPos = 0; leftPos < 4; leftPos += 1) {
          for (let rightPos = 0; rightPos < 4; rightPos += 1) {
            const leftPlayer = getPayloadPlayer(current[leftIndex], leftPos)
            const rightPlayer = getPayloadPlayer(current[rightIndex], rightPos)
            if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) continue
            const candidate = [...current]
            candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPos, rightPlayer)
            candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPos, leftPlayer)
            const candidateStats = getPayloadBatchStats(candidate, state, pvnaTolerance)
            const improvesPvna =
              candidateStats.maxPvna < bestStats.maxPvna - 0.25 ||
              (
                candidateStats.maxPvna < bestStats.maxPvna - 0.05 &&
                candidateStats.pvnaOver < bestStats.pvnaOver
              )
            if (!improvesPvna) continue
            if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
            if (candidateStats.intraOverHard > currentStats.intraOverHard + 1) continue
            if (candidateStats.maxIntra > currentStats.maxIntra + 0.5) continue
            const currentRepeatRatio = current.length > 0 ? currentStats.repeatMatches / current.length : 0
            const candidatePvnaIsComfortable = candidateStats.maxPvna <= 0.8
            if (currentRepeatRatio >= 0.45 && candidateStats.repeatMatches > currentStats.repeatMatches) continue
            if (candidatePvnaIsComfortable && candidateStats.repeatMatches > currentStats.repeatMatches) continue
            if (candidateStats.repeatMatches > currentStats.repeatMatches + 1) continue
            bestPayloads = candidate
            bestStats = candidateStats
          }
        }
      }
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
    if (!changed) { changed = true; try { onRepairUsed?.('swap') } catch { /* noop */ } }
  }

  if (
    (allowEarlyQualityRepair && shouldRepairEarlyQualityForPayloadBatch(current))
    || hasSeverePayloadPvnaOutlier(current, state, pvnaTolerance)
  ) {
    const qualityRepaired = repairEarlyPayloadBatchQuality(current, state, pvnaTolerance, isTrueFirstRound)
    if (qualityRepaired !== current) {
      current = qualityRepaired
      changed = true
      try { onRepairUsed?.('early') } catch { /* noop */ }
    }
  }

  if (shouldRepairRepeatForPayloadBatch(current)) {
    const repeatRepaired = repairPayloadBatchRepeatExposure(current, state, pvnaTolerance)
    if (repeatRepaired !== current) {
      current = repeatRepaired
      changed = true
      try { onRepairUsed?.('repeat') } catch { /* noop */ }
    }
  }

  if (!changed) return payloads
  return current.map(payload => normalizeRepairedPayload(payload, state, pvnaTolerance))
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

function isReasonableTradeoffChoice(
  choice: SuggestionTradeoffChoice,
  reference: SuggestionTradeoffChoice,
) {
  return choice.metrics.pvna_over_by <= Math.max(
    LIVE_CONDITIONAL_RESCUE_MAX_PVNA_OVER,
    reference.metrics.pvna_over_by + LIVE_CONDITIONAL_RESCUE_MAX_PVNA_OVER,
  )
    && choice.metrics.intra_team_over_by <= Math.max(
      LIVE_CONDITIONAL_RESCUE_MAX_INTRA_OVER,
      reference.metrics.intra_team_over_by + LIVE_CONDITIONAL_RESCUE_MAX_INTRA_OVER,
    )
    && choice.metrics.repeat_over_by <= reference.metrics.repeat_over_by + 1
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
  seedSalt?: string,
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
    seedSalt,
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
      warning !== 'PVNA_TOLERANCE_OPEN' &&
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
      options.seedSalt,
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
    choice.id === recommended
      || (
        improvesTradeoffMetric(choice, recommendedChoice)
        && (
          recommendedChoice.metrics.pvna_over_by > 0
          || isReasonableTradeoffChoice(choice, recommendedChoice)
        )
      ),
  )
  if (usefulChoices.length < 2) return null
  return {
    choices: usefulChoices,
    recommended,
  }
}

export function resolveLivePreviewFinalChoice({
  finalAlternatives,
  baselineForConditionalSearch,
  conditionalQualityTradeoff,
  state,
  configuredPvnaTolerance,
  nextMatchIndex,
  policy = 'current',
}: {
  finalAlternatives: SuggestionAlternative[]
  baselineForConditionalSearch: SuggestionAlternative | undefined
  conditionalQualityTradeoff: ReturnType<typeof findConditionalLiveQualityTradeoff> | null
  state: SessionState
  configuredPvnaTolerance: number
  nextMatchIndex: number
  policy?: LiveQualityPolicy
}) {
  const finalGuardedAlternative = pickGuardedLiveAlternative(
    finalAlternatives,
    state,
    configuredPvnaTolerance,
    nextMatchIndex,
    policy,
  ) ?? finalAlternatives[0]
  const canUseConditionalTradeoff = Boolean(
    conditionalQualityTradeoff &&
    baselineForConditionalSearch &&
    finalGuardedAlternative &&
    getAlternativeMatchKey(baselineForConditionalSearch) === getAlternativeMatchKey(finalGuardedAlternative),
  )
  const tradeoffChoices = canUseConditionalTradeoff && conditionalQualityTradeoff
    ? buildConditionalLiveQualityTradeoffChoices(
        finalGuardedAlternative,
        conditionalQualityTradeoff,
        state,
        configuredPvnaTolerance,
      )
    : buildLiveTradeoffChoices(finalAlternatives, state, configuredPvnaTolerance)
  const selectedTradeoffChoice = finalGuardedAlternative
    ? tradeoffChoices?.choices.find(choice =>
        getAlternativeMatchKey(choice.alternative) === getAlternativeMatchKey(finalGuardedAlternative),
      )
    : undefined

  return {
    finalGuardedAlternative,
    tradeoffChoices,
    recommendedTradeoffChoice: selectedTradeoffChoice?.id ?? tradeoffChoices?.recommended,
    usedConditionalTradeoff: canUseConditionalTradeoff,
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

type LiveTierOverrideMap = Record<string, Tier>

export function buildLiveTierOverrides({
  fairnessTierOverrides,
  softOverplayedOverrides,
  softUnderplayedOverrides,
  deferredRequiredIds,
  requiredForThisCourt,
}: {
  fairnessTierOverrides: LiveTierOverrideMap
  softOverplayedOverrides: LiveTierOverrideMap
  softUnderplayedOverrides: LiveTierOverrideMap
  deferredRequiredIds: string[]
  requiredForThisCourt: string[]
}): LiveTierOverrideMap {
  const deferredRequiredOverrides = Object.fromEntries(
    deferredRequiredIds.map(playerId => [playerId, Tier.FLEXIBLE]),
  ) as LiveTierOverrideMap
  const hardRequiredOverrides = Object.fromEntries(
    requiredForThisCourt.map(playerId => [playerId, Tier.MUST_PLAY]),
  ) as LiveTierOverrideMap

  return {
    // Priority is intentional: later layers win, so hard per-court requirements
    // override soft balance hints and deferred required players.
    ...fairnessTierOverrides,
    ...softOverplayedOverrides,
    ...softUnderplayedOverrides,
    ...deferredRequiredOverrides,
    ...hardRequiredOverrides,
  }
}

export type CourtSelectionDebug = {
  court_idx: number
  busy_count: number
  required_for_court: string[]
  eligible_players: Array<{
    id: string
    pvna: number
    consecutive_rest: number
    matches_played: number
    tier: string
  }>
  selected: Array<{ id: string; pvna: number; team: 'A' | 'B' }>
}

export type BuildSuggestedMatchPayloadsParams = {
  count: number
  sessionId: string
  courtCount: number
  state: SessionState
  rows: { liveMatchRows: SessionLiveMatchRow[]; liveStateVersion?: number | null }
  completingLiveMatchIds: Set<string>
  fairnessAdjustment: Pick<AdjustmentResult, 'tier_overrides' | 'applied_for_warnings'> & {
    config_changes?: AdjustmentResult['config_changes']
  }
  fairnessWarnings: FairnessWarning[]
  playersById: Map<string, PreviewPlayerInfo>
  pvnaTolerance: number
  options?: BuildSuggestedMatchOptions
  debugOut?: CourtSelectionDebug[]
}

function pickRollingBeamAlternative(
  candidates: SuggestionAlternative[],
  state: SessionState,
  baseSimBusy: Set<string>,
  liveCommitments: SessionLiveMatchRow[],
  budgetMs: number,
  planTarget?: RollingPlanTarget | null,
): ReturnType<typeof chooseRollingHorizonAlternative> {
  return chooseRollingHorizonAlternative({
    candidates,
    state,
    baseBusyIds: baseSimBusy,
    liveCommitments,
    budgetMs,
    suggestFuture: ({ state: futureState, busyIds, maxRuntimeMs }) => (
      suggestNextMatch(futureState, {
        busy_player_ids: busyIds,
        max_alternatives: 1,
        max_runtime_ms: maxRuntimeMs,
      }).alternatives[0] ?? null
    ),
    projectMatch: buildProjectedStateAfterLiveMatch,
    planTarget,
  })
}

function legacyBeamMatchScore(
  teamA: [string, string],
  teamB: [string, string],
  state: SessionState,
  interWeight: number,
  intraWeight: number,
) {
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  const inter = Math.abs(pvna(teamA[0]) + pvna(teamA[1]) - pvna(teamB[0]) - pvna(teamB[1]))
  const intra = Math.max(
    Math.abs(pvna(teamA[0]) - pvna(teamA[1])),
    Math.abs(pvna(teamB[0]) - pvna(teamB[1])),
  )
  const partnerRepeat =
    ((state.players.get(teamA[0])?.partner_counts.get(teamA[1]) ?? 0) > 0 ? 1 : 0)
    + ((state.players.get(teamB[0])?.partner_counts.get(teamB[1]) ?? 0) > 0 ? 1 : 0)
  const opponentRepeat = teamA.flatMap(playerA => teamB.map(playerB => (
    (state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0) > 0 ? 1 : 0
  ))).reduce((sum, repeat) => sum + repeat, 0)
  return inter * interWeight + intra * intraWeight + partnerRepeat * 4 + opponentRepeat * 2
}

function legacyBeamWeights(busyIds: Set<string>, state: SessionState) {
  const active = [...state.players.values()].filter(player => (
    player.checked_out_at === null && !player.opted_rest
  ))
  if (active.length >= 25) return { inter: 7, intra: 7 }
  const availablePvnas = active
    .filter(player => !busyIds.has(player.player_id))
    .map(getEffectivePvna)
  const spread = availablePvnas.length < 2 ? 0 : Math.max(...availablePvnas) - Math.min(...availablePvnas)
  return { inter: 7 + spread * 3, intra: Math.max(5, 7 - spread) }
}

function pickLegacyBeamAlternative(
  candidates: SuggestionAlternative[],
  futureCourtsCount: number,
  state: SessionState,
  baseSimBusy: Set<string>,
  budgetMs: number,
): SuggestionAlternative | null {
  const validCandidates = candidates.filter(alt => alt.matches.length > 0)
  if (validCandidates.length <= 1) return null
  const weights = legacyBeamWeights(baseSimBusy, state)
  const perCandidateMs = Math.floor(budgetMs / validCandidates.length)
  let bestAlt: SuggestionAlternative | null = null
  let bestScore = Infinity
  for (const alt of validCandidates) {
    const match = alt.matches[0]
    if (!match) continue
    const simBusy = new Set([...baseSimBusy, ...match.team_a, ...match.team_b])
    let totalScore = legacyBeamMatchScore(match.team_a, match.team_b, state, weights.inter, weights.intra)
    const simStart = nowMs()
    let simState = buildProjectedStateAfterLiveMatch(state, {
      id: 'legacy-beam-lookahead', session_id: state.session_id, sequence_no: 0,
      round_no: state.current_round, court_idx: 0, status: 'completed',
      team_a: match.team_a, team_b: match.team_b, resting: [], score_a: 0, score_b: 0,
      suggested_at: new Date().toISOString(), started_at: null, ended_at: null,
    })
    for (let index = 0; index < futureCourtsCount; index += 1) {
      if (nowMs() - simStart >= perCandidateMs) break
      const future = suggestNextMatch(simState, {
        busy_player_ids: simBusy,
        max_alternatives: 1,
        max_runtime_ms: Math.max(20, perCandidateMs - (nowMs() - simStart)),
      }).alternatives[0]
      const futureMatch = future?.matches[0]
      if (!future || !futureMatch) break
      totalScore += legacyBeamMatchScore(
        futureMatch.team_a,
        futureMatch.team_b,
        simState,
        weights.inter,
        weights.intra,
      )
      futureMatch.team_a.forEach(id => simBusy.add(id))
      futureMatch.team_b.forEach(id => simBusy.add(id))
      simState = buildProjectedStateAfterLiveMatch(simState, {
        id: `legacy-beam-lookahead-${index}`, session_id: state.session_id, sequence_no: index + 1,
        round_no: state.current_round, court_idx: index + 1, status: 'completed',
        team_a: futureMatch.team_a, team_b: futureMatch.team_b, resting: [], score_a: 0, score_b: 0,
        suggested_at: new Date().toISOString(), started_at: null, ended_at: null,
      })
    }
    if (totalScore < bestScore) {
      bestScore = totalScore
      bestAlt = alt
    }
  }
  return bestAlt
}

function computeBeamQuality(
  teamA: [string, string],
  teamB: [string, string],
  state: SessionState,
): number {
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  const inter = Math.abs((pvna(teamA[0]) + pvna(teamA[1])) - (pvna(teamB[0]) + pvna(teamB[1])))
  const intra = Math.max(
    Math.abs(pvna(teamA[0]) - pvna(teamA[1])),
    Math.abs(pvna(teamB[0]) - pvna(teamB[1])),
  )
  return inter + intra * 0.4
}

function findBestAvailablePoolQuality(
  availableIds: string[],
  state: SessionState,
  pvnaTolerance: number,
): number | undefined {
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  const n = availableIds.length
  let best: number | undefined
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          const ids = [availableIds[a], availableIds[b], availableIds[c], availableIds[d]]
          const pairings: [[string, string], [string, string]][] = [
            [[ids[0], ids[1]], [ids[2], ids[3]]],
            [[ids[0], ids[2]], [ids[1], ids[3]]],
            [[ids[0], ids[3]], [ids[1], ids[2]]],
          ]
          for (const [teamA, teamB] of pairings) {
            const inter = Math.abs((pvna(teamA[0]) + pvna(teamA[1])) - (pvna(teamB[0]) + pvna(teamB[1])))
            if (inter > pvnaTolerance) continue
            const intra = Math.max(
              Math.abs(pvna(teamA[0]) - pvna(teamA[1])),
              Math.abs(pvna(teamB[0]) - pvna(teamB[1])),
            )
            if (intra > INTRA_TEAM_PVNA_GAP_LIMIT) continue
            const q = inter + intra * 0.4
            if (best === undefined || q < best) best = q
          }
        }
      }
    }
  }
  return best
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
  debugOut,
}: BuildSuggestedMatchPayloadsParams): SuggestedMatchPayload[] {
  const batchStartedAt = nowMs()
  const forceBudgetDeadline = nowMs() + FORCE_RESCUE_TOTAL_MS
  const baseSuggestionState = options.stateOverride ?? state
  let suggestionState = applyFairnessAdjustment(baseSuggestionState, {
    type: fairnessAdjustment.config_changes && Object.keys(fairnessAdjustment.config_changes).length > 0
      ? 'fairness_correction'
      : 'none',
    config_changes: fairnessAdjustment.config_changes ?? {},
    tier_overrides: fairnessAdjustment.tier_overrides,
    applied_for_warnings: fairnessAdjustment.applied_for_warnings,
  })
  // Persisted suggestions are authoritative locks until they are replaced or
  // cancelled. Their age must not make their players available to another court.
  const liveMatchRows = options.liveMatchRowsOverride ?? rows.liveMatchRows
  const previewSeedBase = buildPreviewBatchKey(
    sessionId,
    suggestionState,
    courtCount,
    pvnaTolerance,
    fairnessAdjustment,
    options.liveQualityPolicy ?? 'current',
  )
  const payloads: SuggestedMatchPayload[] = []
  const ignoreCapacityLock = options.ignoreCapacityLock ?? true
  const requestedCourtIdxs = new Set([
    ...(options.courtIdxs ?? []),
    ...(options.courtIdx === undefined ? [] : [options.courtIdx]),
  ].map(Number).filter(Number.isFinite))
  const baseBusyIds = new Set(
    liveMatchRows
      .filter(match =>
        (
          match.status === 'live'
          && !completingLiveMatchIds.has(match.id)
          && (match.court_idx == null || !requestedCourtIdxs.has(Number(match.court_idx)))
        )
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
  const liveLockedPlayerIds = new Set(
    liveMatchRows
      .filter(match => match.status === 'live' && !completingLiveMatchIds.has(match.id))
      .flatMap(match => [...match.team_a, ...match.team_b]),
  )
  const liveLockedPlayerCourtIdxs = new Map<string, number>()
  liveMatchRows
    .filter(match =>
      match.status === 'live'
      && !completingLiveMatchIds.has(match.id)
      && match.court_idx !== null
      && match.court_idx !== undefined,
    )
    .forEach(match => {
      const lockedCourtIdx = Number(match.court_idx)
      if (!Number.isFinite(lockedCourtIdx)) return
      match.team_a.forEach(playerId => liveLockedPlayerCourtIdxs.set(playerId, lockedCourtIdx))
      match.team_b.forEach(playerId => liveLockedPlayerCourtIdxs.set(playerId, lockedCourtIdx))
    })
  const liveAvailabilityContext: {
    locked_player_count: number
    live_court_count: number
    locked_beam_quality?: number
    available_pool_quality?: number
  } | undefined = liveLockedPlayerIds.size > 0
    ? {
        locked_player_count: liveLockedPlayerIds.size,
        live_court_count: liveCourtIdxs.size,
      }
    : undefined
  const courtCapacity = Math.max(1, Math.floor(suggestionState.config.courts || courtCount || 1))
  const roundCounts = new Map<number, number>()
  const courtIdxsByRound = new Map<number, Set<number>>()
  const matchesByRound = new Map<number, SessionLiveMatchRow[]>()
  const lastCompletedRoundByCourtIdx = new Map<number, number>()
  const reconstructedRounds = reconstructLiveRounds(liveMatchRows, courtCapacity)
  const countableMatches = reconstructedRounds.matches
  const previewCountableMatchCount = countableMatches.length
  const logicalRoundByMatchId = reconstructedRounds.roundByMatchId
  countableMatches.forEach((match) => {
    const logicalRoundNo = logicalRoundByMatchId.get(match.id) ?? 0
    roundCounts.set(logicalRoundNo, (roundCounts.get(logicalRoundNo) ?? 0) + 1)
    const roundMatches = matchesByRound.get(logicalRoundNo) ?? []
    roundMatches.push(match)
    matchesByRound.set(logicalRoundNo, roundMatches)
    if (match.court_idx !== null && match.court_idx !== undefined) {
      const idx = Number(match.court_idx)
      const courtIdxs = courtIdxsByRound.get(logicalRoundNo) ?? new Set<number>()
      courtIdxs.add(idx)
      courtIdxsByRound.set(logicalRoundNo, courtIdxs)
      if (match.status === 'completed') {
        const existing = lastCompletedRoundByCourtIdx.get(idx)
        if (existing === undefined || logicalRoundNo > existing) {
          lastCompletedRoundByCourtIdx.set(idx, logicalRoundNo)
        }
      }
    }
  })
  const playerIdsByRound = new Map<number, Set<string>>()
  countableMatches.forEach((match) => {
    const roundNo = logicalRoundByMatchId.get(match.id) ?? match.round_no ?? match.sequence_no
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
  const getPreviousLogicalRoundRestedIds = (roundNo: number) => {
    if (roundNo <= 0) return new Set<string>()
    const previousRoundNo = roundNo - 1
    const previousRoundMatches = matchesByRound.get(previousRoundNo) ?? []
    const previousRoundCourts = courtIdxsByRound.get(previousRoundNo) ?? new Set<number>()
    if (previousRoundMatches.length < courtCapacity || previousRoundCourts.size < courtCapacity) {
      return new Set<string>()
    }
    const previousRoundOpenedAt = Math.min(...previousRoundMatches
      .map(match => Date.parse(match.suggested_at ?? match.started_at ?? match.created_at ?? ''))
      .filter(Number.isFinite))
    if (!Number.isFinite(previousRoundOpenedAt)) return new Set<string>()
    const previousRoundPlayers = playerIdsByRound.get(previousRoundNo) ?? new Set<string>()
    return new Set([...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest)
      .filter(player => player.checked_in_at.getTime() <= previousRoundOpenedAt)
      .filter(player => !previousRoundPlayers.has(player.player_id))
      .map(player => player.player_id))
  }
  const getRoundRequiredIds = (roundNo: number, remainingCourts: number, busyIds: Set<string>) => {
    const remainingRoundSlots = Math.max(0, remainingCourts * 4)
    if (remainingRoundSlots <= 0) return new Set<string>()
    const previousLogicalRoundRestedIds = getPreviousLogicalRoundRestedIds(roundNo)
    const required = [...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
      .filter(player => {
        if (previousLogicalRoundRestedIds.has(player.player_id)) return true
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
    if (isLiveRoundFullyCompleted(roundNo, matchesByRound, courtCapacity, completingLiveMatchIds)) {
      suggestionState = buildProjectedStateAfterCompletedLiveRound(
        suggestionState,
        playerIdsByRound.get(roundNo) ?? new Set<string>(),
      )
    }
  }
  // repairRoundOnePayloadBatchWithCleanPool samples from state.players filtered by
  // checked_out_at === null. Without this, it can re-pick players who are already
  // busy in override rows (e.g. cap-2 partial-fill calls), causing double-booking.
  const repairState = baseBusyIds.size > 0
    ? {
        ...suggestionState,
        players: new Map(
          [...suggestionState.players.entries()].map(([id, player]) => [
            id,
            baseBusyIds.has(id) && player.checked_out_at === null
              ? { ...player, checked_out_at: new Date() }
              : player,
          ])
        ),
      }
    : suggestionState
  const getInitialRoundCourtIdxs = (roundNo: number) => {
    const existingRoundCourtIdxs = courtIdxsByRound.get(roundNo)
    return new Set([
      ...liveCourtIdxs,
      ...(existingRoundCourtIdxs ?? []),
    ])
  }
  const queuedCourtIdxs = new Set(liveCourtIdxs)
  const batchBusyIds = new Set(baseBusyIds)
  // Cap courts to what the available player pool can physically fill.
  // When many courts complete simultaneously, available players drop below courts×4.
  // Running the engine on impossible courts burns CPU to 546 (Supabase worker limit).
  const availableForBatch = [...suggestionState.players.values()].filter(
    p => p.checked_out_at === null && !p.opted_rest && !baseBusyIds.has(p.player_id),
  ).length
  const effectiveCount = Math.min(count, Math.floor(availableForBatch / 4))
  const isRollingLaneRequest = options.rollingHorizon === true && count === 1 && liveMatchRows.some(match => (
    match.status === 'live' && !completingLiveMatchIds.has(match.id)
  ))
  const availabilityMetricsByState = new WeakMap<SessionState, AvailabilityMetrics>()
  const getAvailabilityMetricsForState = (stateForMetrics: SessionState) => {
    const cached = availabilityMetricsByState.get(stateForMetrics)
    if (cached) return cached
    const metrics = computeAvailabilityMetrics(stateForMetrics)
    availabilityMetricsByState.set(stateForMetrics, metrics)
    return metrics
  }
  let projectedRoundNo = 0
  let projectedRoundMatchCount = 0
  if (roundCounts.size > 0) {
    const maxLogicalRound = Math.max(...roundCounts.keys())
    const maxLogicalRoundMatchCount = roundCounts.get(maxLogicalRound) ?? 0
    if (maxLogicalRoundMatchCount >= courtCapacity) {
      projectedRoundNo = maxLogicalRound + 1
    } else {
      projectedRoundNo = maxLogicalRound
      projectedRoundMatchCount = maxLogicalRoundMatchCount
    }
  }
  warnLiveRoundProjectionDrift({
    source: 'lib',
    sessionId,
    stateCurrentRound: state.current_round,
    projectedRoundNo,
    projectedRoundMatchCount,
    courtCapacity,
    roundCounts,
    courtIdxsByRound,
  })
  let roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
  
  for (let index = 0; index < effectiveCount; index += 1) {
    const remainingBatchMs = LIVE_PREVIEW_BATCH_TIMEOUT_MS - (nowMs() - batchStartedAt)
    if (remainingBatchMs <= LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS) break
    const remainingCourtsInBatch = Math.max(1, count - index)
    const courtStartedAt = nowMs()
    const courtBudgetMs = getLivePreviewCourtBudgetMs(remainingBatchMs, remainingCourtsInBatch)
    const getRemainingCourtBudgetMs = (capMs = LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS) => Math.min(
      capMs,
      Math.max(20, courtBudgetMs - (nowMs() - courtStartedAt)),
    )
    if (projectedRoundMatchCount >= courtCapacity) {
      projectedRoundNo += 1
      projectedRoundMatchCount = 0
      roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
    }
    const requestedCourtIdx = options.courtIdxs?.[index] ?? options.courtIdx
    const openCourtIdxs = Array.from({ length: courtCapacity }, (_, idx) => idx)
      .filter(idx => !queuedCourtIdxs.has(idx))
    const nextCourtIdx = openCourtIdxs.find(idx => !roundCourtIdxs.has(idx)) ?? openCourtIdxs[0]
    const courtIdx = requestedCourtIdx ?? nextCourtIdx
    if (courtIdx === undefined) break
    const courtLastCompletedRound = lastCompletedRoundByCourtIdx.get(courtIdx)
    const payloadRoundNo = courtLastCompletedRound !== undefined
      ? courtLastCompletedRound + 1
      : projectedRoundNo
    const previewSeed = `${previewSeedBase}|court:${index}`
    // A logical round is a reporting label, not a synchronization barrier once
    // courts are completing asynchronously. Live commitments remain absolute
    // locks; completed players return to the pool and fairness debt determines
    // whether they should be selected again.
    const courtRoundMatchCount = roundCounts.get(payloadRoundNo) ?? 0
    const courtRoundBusyIds = isRollingLaneRequest
      ? new Set<string>()
      : new Set(playerIdsByRound.get(payloadRoundNo) ?? [])
    const remainingCourtsInRound = Math.max(1, courtCapacity - courtRoundMatchCount)
    const courtRoundRequiredIds = getRoundRequiredIds(
      payloadRoundNo,
      remainingCourtsInRound,
      new Set([...courtRoundBusyIds, ...batchBusyIds]),
    )
    const availableRequiredIds = [...courtRoundRequiredIds]
      .filter(playerId => !courtRoundBusyIds.has(playerId) && !batchBusyIds.has(playerId))
    // Only defer required players into courts this request will actually fill.
    // Rolling lanes can assign future open courts to a later logical cycle.
    const futureBatchSlots = Math.max(0, (effectiveCount - index - 1) * 4)
    const futureRoundSlots = Math.min(
      Math.max(0, (remainingCourtsInRound - 1) * 4),
      futureBatchSlots,
    )
    const minRequiredForThisCourt = Math.min(
      4,
      Math.max(0, availableRequiredIds.length - futureRoundSlots),
    )
    const canLetQuotaGuardPickRequiredPool =
      availableRequiredIds.length >= remainingCourtsInRound * 4
    let requiredForThisCourt = selectRequiredIdsForCourt(
      availableRequiredIds,
      canLetQuotaGuardPickRequiredPool ? 0 : minRequiredForThisCourt,
      remainingCourtsInRound,
      suggestionState,
    )
    requiredForThisCourt = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt,
      availableRequiredIds,
      busyIds: new Set([...batchBusyIds, ...courtRoundBusyIds]),
      remainingCourtsInRound,
      state: suggestionState,
    })
    for (const playerId of options.forcedRequiredPlayerIds ?? []) {
      if (!requiredForThisCourt.includes(playerId)) requiredForThisCourt.push(playerId)
    }
    const requiredForThisCourtIds = new Set(requiredForThisCourt)
    const deferredRequiredIds = availableRequiredIds
      .filter(playerId => !requiredForThisCourtIds.has(playerId))
    const busyIds = new Set([...batchBusyIds, ...courtRoundBusyIds])
    const activePlayersForBias = [...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
    const availabilityForBias = getAvailabilityMetricsForState(suggestionState)
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
    const tierOverrides = buildLiveTierOverrides({
      fairnessTierOverrides: fairnessAdjustment.tier_overrides,
      softOverplayedOverrides: softOverplayedOverrides as LiveTierOverrideMap,
      softUnderplayedOverrides: softUnderplayedOverrides as LiveTierOverrideMap,
      deferredRequiredIds,
      requiredForThisCourt,
    })
    
    const exhaustiveDiag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0,
      combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    const suggestionStateForCourt = withRecentGroupRematchKeys(
      { ...suggestionState, current_round: payloadRoundNo },
      getBlockedRecentGroupRematchKeys(completedMatchGroups, payloadRoundNo),
    )
    const liveSelectionGuard = buildLiveSelectionGuard({
      state: suggestionStateForCourt,
      busyIds,
      nextMatchIndex: previewCountableMatchCount + index + 1,
    })
    liveSelectionGuard.protectedIds.forEach(playerId => busyIds.add(playerId))
    const buildBusyIdsForProtected = (protectedIds: Set<string>) => new Set([
      ...batchBusyIds,
      ...courtRoundBusyIds,
      ...protectedIds,
    ])
    const buildRelaxedTierOverrides = () => {
      const relaxedTierOverrides = { ...tierOverrides }
      for (const playerId of [...requiredForThisCourt, ...deferredRequiredIds]) {
        delete relaxedTierOverrides[playerId]
      }
      return relaxedTierOverrides
    }
    const eligibleCount = [...suggestionStateForCourt.players.values()]
      .filter(p => p.checked_out_at === null && !p.opted_rest && !busyIds.has(p.player_id)).length
    const suggestOptions = {
      tier_overrides: tierOverrides as any,
      busy_player_ids: busyIds,
      court_idx: courtIdx,
      max_alternatives: LIVE_TRADEOFF_ALTERNATIVE_LIMIT,
      exhaustive_fallback: true,
      max_runtime_ms: getRemainingCourtBudgetMs(),
      _exhaustiveDiag: exhaustiveDiag,
      forced_required_player_ids: requiredForThisCourt,
      availability_metrics: getAvailabilityMetricsForState(suggestionStateForCourt),
      preview_seed: previewSeed,
      force_budget_deadline: forceBudgetDeadline,
      onInstrumentEvent: options.onInstrumentEvent,
    }
    const debugEligible = debugOut ? [...suggestionStateForCourt.players.values()]
      .filter(p => p.checked_out_at === null && !p.opted_rest && !busyIds.has(p.player_id))
      .map(p => ({
        id: p.player_id,
        pvna: getEffectivePvna(p),
        consecutive_rest: p.consecutive_rest,
        matches_played: p.matches_played,
        tier: String(tierOverrides[p.player_id] ?? 'FLEXIBLE'),
      }))
      .sort((a, b) => b.consecutive_rest - a.consecutive_rest || a.matches_played - b.matches_played)
      : null
    let result = suggestNextMatch(suggestionStateForCourt, suggestOptions)

    const hasOnlyHardIntraViolations = (alts: SuggestionAlternative[]) =>
      alts.length > 0 && alts.every(
        alt => getAlternativeIntraTeamGap(alt, suggestionStateForCourt) > INTRA_TEAM_PVNA_GAP_LIMIT,
      )
    const relaxedTierOverrides = buildRelaxedTierOverrides()

    if (hasOnlyHardIntraViolations(result.alternatives)) {
      // Intra rescue: all alternatives violate HARD intra cap.
      // Pool is bimodal (e.g. all MUST_PLAY players have incompatible PVNAs among themselves).
      // Bypass relaxationStages entirely — use minimal protection: only absolute recycle (consecutive ≥4)
      // and players significantly over quota (+1 above target.max). This opens recently-played players
      // with compatible PVNA to rescue the court, while protecting true over-quota players.
      const intraRescueDiag: ExhaustiveFallbackDiagnostic = {
        ran: false, timedOut: false, eligibleCount: 0,
        combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
      }
      const intraRescueResult = suggestNextMatch(suggestionStateForCourt, {
        ...suggestOptions,
        busy_player_ids: buildBusyIdsForProtected(liveSelectionGuard.intraRescueProtectedIds),
        tier_overrides: relaxedTierOverrides as any,
        max_alternatives: LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT,
        max_runtime_ms: getRemainingCourtBudgetMs(),
        _exhaustiveDiag: intraRescueDiag,
      })
      if (intraRescueResult.alternatives.length > 0 && !hasOnlyHardIntraViolations(intraRescueResult.alternatives)) {
        result = {
          ...intraRescueResult,
          warnings: [...new Set([
            ...intraRescueResult.warnings.filter(w => w !== 'NO_VALID_MATCH'),
            'LIVE_REPLACEMENT_INTRA_RESCUE',
          ])],
          alternatives: intraRescueResult.alternatives.map(alt => ({
            ...alt,
            warnings: [...new Set([...alt.warnings, 'LIVE_REPLACEMENT_INTRA_RESCUE'])],
          })),
        }
      }
    } else if (result.alternatives.length === 0) {
      const relaxationStages = liveSelectionGuard.relaxationStages.length > 0
        ? liveSelectionGuard.relaxationStages
        : [{ protectedIds: liveSelectionGuard.protectedIds, warnings: liveSelectionGuard.warnings }]
      for (const relaxationStage of relaxationStages) {
        if (result.alternatives.length > 0) break
        const relaxedDiag: ExhaustiveFallbackDiagnostic = {
          ran: false, timedOut: false, eligibleCount: 0,
          combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
        }
        const relaxedResult = suggestNextMatch(suggestionStateForCourt, {
          ...suggestOptions,
          busy_player_ids: buildBusyIdsForProtected(relaxationStage.protectedIds),
          tier_overrides: relaxedTierOverrides as any,
          max_alternatives: LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT,
          max_runtime_ms: getRemainingCourtBudgetMs(),
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
            warnings: [...new Set([...alternative.warnings, ...relaxationStage.warnings])],
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
    let initialSelectedMetrics = result.alternatives[0]
      ? getTradeoffChoiceMetrics(result.alternatives[0], suggestionStateForCourt, configuredPvnaTolerance)
      : null
    if (
      initialSelectedMetrics &&
      needsLiveQualityRescue(initialSelectedMetrics, configuredPvnaTolerance) &&
      liveSelectionGuard.quotaProtectedIds.length > 0
    ) {
      const quotaRelaxedProtectedIds = new Set(
        [...liveSelectionGuard.protectedIds]
          .filter(playerId => !liveSelectionGuard.quotaProtectedIds.includes(playerId)),
      )
      const quotaRelaxedDiag: ExhaustiveFallbackDiagnostic = {
        ran: false, timedOut: false, eligibleCount: 0,
        combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
      }
      const quotaRelaxedResult = suggestNextMatch(suggestionStateForCourt, {
        ...suggestOptions,
        busy_player_ids: buildBusyIdsForProtected(quotaRelaxedProtectedIds),
        max_alternatives: LIVE_QUOTA_RESCUE_ALTERNATIVE_LIMIT,
        max_runtime_ms: getRemainingCourtBudgetMs(500),
        _exhaustiveDiag: quotaRelaxedDiag,
      })
      const quotaRelaxedRescue = findQuotaRelaxedQualityRescue(
        quotaRelaxedResult.alternatives,
        suggestionStateForCourt,
        configuredPvnaTolerance,
        previewCountableMatchCount + index + 1,
      )
      if (quotaRelaxedRescue) {
        try { options.onInstrumentEvent?.({ event: 'rescue', detail: 'quota', court_count: courtCount, available: availableForBatch }) } catch { /* noop */ }
        const rescueKey = getAlternativeMatchKey(quotaRelaxedRescue)
        result = {
          ...result,
          warnings: [...new Set([...result.warnings, 'LIVE_REPLACEMENT_QUOTA_RELAXED'])],
          alternatives: [
            {
              ...quotaRelaxedRescue,
              warnings: [...new Set([...quotaRelaxedRescue.warnings, 'LIVE_REPLACEMENT_QUOTA_RELAXED'])],
            },
            ...result.alternatives.filter(alternative => getAlternativeMatchKey(alternative) !== rescueKey),
          ].slice(0, LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT),
        }
        initialSelectedMetrics = getTradeoffChoiceMetrics(result.alternatives[0], suggestionStateForCourt, configuredPvnaTolerance)
      }
    }
    if (
      options.liveQualityPolicy === 'pvna_outlier_rescue' &&
      initialSelectedMetrics &&
      initialSelectedMetrics.pvna_gap > 1
    ) {
      const protectedWithoutQuota = new Set(
        [...liveSelectionGuard.protectedIds]
          .filter(playerId => !liveSelectionGuard.quotaProtectedIds.includes(playerId)),
      )
      const outlierDiag: ExhaustiveFallbackDiagnostic = {
        ran: false, timedOut: false, eligibleCount: 0,
        combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
      }
      const outlierResult = suggestNextMatch(suggestionStateForCourt, {
        ...suggestOptions,
        busy_player_ids: buildBusyIdsForProtected(protectedWithoutQuota),
        max_alternatives: LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT,
        max_runtime_ms: getRemainingCourtBudgetMs(700),
        _exhaustiveDiag: outlierDiag,
      })
      const outlierRescue = findPvnaOutlierRescue(
        outlierResult.alternatives,
        suggestionStateForCourt,
        configuredPvnaTolerance,
        previewCountableMatchCount + index + 1,
        initialSelectedMetrics,
      )
      if (outlierRescue) {
        try { options.onInstrumentEvent?.({ event: 'rescue', detail: 'pvna_outlier', court_count: courtCount, available: availableForBatch }) } catch { /* noop */ }
        const rescueKey = getAlternativeMatchKey(outlierRescue)
        result = {
          ...result,
          warnings: [...new Set([...result.warnings, 'PVNA_TOLERANCE_RELAXED'])],
          alternatives: [
            outlierRescue,
            ...result.alternatives.filter(alternative => getAlternativeMatchKey(alternative) !== rescueKey),
          ].slice(0, LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT),
        }
        initialSelectedMetrics = getTradeoffChoiceMetrics(result.alternatives[0], suggestionStateForCourt, configuredPvnaTolerance)
      }
    }
    if (
      initialSelectedMetrics &&
      needsLiveQualityRescue(initialSelectedMetrics, configuredPvnaTolerance) &&
      result.alternatives.length < LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT
    ) {
      const deepDiag: ExhaustiveFallbackDiagnostic = {
        ran: false, timedOut: false, eligibleCount: 0,
        combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
      }
      const deepResult = suggestNextMatch(suggestionStateForCourt, {
        ...suggestOptions,
        max_alternatives: LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT,
        max_runtime_ms: getRemainingCourtBudgetMs(),
        _exhaustiveDiag: deepDiag,
      })
      if (deepResult.alternatives.length > result.alternatives.length) {
        result = {
          ...deepResult,
          warnings: [...new Set([...result.warnings, ...deepResult.warnings])],
        }
        initialSelectedMetrics = result.alternatives[0]
          ? getTradeoffChoiceMetrics(result.alternatives[0], suggestionStateForCourt, configuredPvnaTolerance)
          : null
      }
    }
    if (initialSelectedMetrics && hasTradeoffMetric(initialSelectedMetrics)) {
      const containsForcedRequired = (alternative: SuggestionAlternative) => {
        if (requiredForThisCourt.length === 0) return true
        return requiredForThisCourt.every(playerId =>
          alternative.matches.some(match => [...match.team_a, ...match.team_b].includes(playerId)),
        )
      }
      const strictAlternative = findStrictCleanLiveAlternative(suggestionStateForCourt, {
        busyIds,
        courtIdx,
        configuredPvnaTolerance,
        tierOverrides,
        warnings: result.warnings,
        seedSalt: previewSeed,
      })
      if (strictAlternative && containsForcedRequired(strictAlternative)) {
        try { options.onInstrumentEvent?.({ event: 'rescue', detail: 'strict_clean', court_count: courtCount, available: availableForBatch }) } catch { /* noop */ }
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
    const baselineForConditionalSearch = pickGuardedLiveAlternative(
      result.alternatives,
      suggestionStateForCourt,
      configuredPvnaTolerance,
      previewCountableMatchCount + index + 1,
      options.liveQualityPolicy ?? 'current',
    ) ?? result.alternatives[0]
    let conditionalQualityRescue: SuggestionAlternative | null = null
    let conditionalQualityTradeoff: ReturnType<typeof findConditionalLiveQualityTradeoff> | null = null
    if (baselineForConditionalSearch && effectiveCount >= courtCount && remainingBatchMs > LIVE_PREVIEW_MIN_COURT_TIMEOUT_MS + 100) {
      const baselineMetrics = getTradeoffChoiceMetrics(
        baselineForConditionalSearch,
        suggestionStateForCourt,
        configuredPvnaTolerance,
      )
      const shouldSearchConditionalRescue = baselineMetrics.intra_team_gap > PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT
        || baselineMetrics.max_partner_pair > 1
        || baselineMetrics.max_opponent_pair > 1
        || baselineMetrics.pvna_gap >= Math.min(configuredPvnaTolerance, 0.4)
      if (shouldSearchConditionalRescue) {
        const conditionalDiag: ExhaustiveFallbackDiagnostic = {
          ran: false, timedOut: false, eligibleCount: 0,
          combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
        }
        const conditionalBudgetMs = getRemainingCourtBudgetMs(220)
        const conditionalProtectedIds =
          liveSelectionGuard.relaxationStages[liveSelectionGuard.relaxationStages.length - 1]?.protectedIds
          ?? liveSelectionGuard.protectedIds
        const conditionalResult = suggestNextMatch(suggestionStateForCourt, {
          tier_overrides: fairnessAdjustment.tier_overrides as any,
          busy_player_ids: buildBusyIdsForProtected(new Set(conditionalProtectedIds)),
          court_idx: courtIdx,
          max_alternatives: LIVE_CONDITIONAL_RESCUE_ALTERNATIVE_LIMIT,
          exhaustive_fallback: true,
          max_runtime_ms: conditionalBudgetMs,
          _exhaustiveDiag: conditionalDiag,
          forced_required_player_ids: requiredForThisCourt,
          force_budget_deadline: Date.now() + conditionalBudgetMs,
        })
        conditionalQualityRescue = findConditionalLiveQualityRescue(
          conditionalResult.alternatives,
          baselineForConditionalSearch,
          suggestionStateForCourt,
          configuredPvnaTolerance,
          previewCountableMatchCount + index + 1,
        )
        conditionalQualityTradeoff = conditionalQualityRescue
          ? null
          : findConditionalLiveQualityTradeoff(
            conditionalResult.alternatives,
            baselineForConditionalSearch,
            suggestionStateForCourt,
            configuredPvnaTolerance,
            previewCountableMatchCount + index + 1,
          )
        if (conditionalQualityRescue) {
          try { options.onInstrumentEvent?.({ event: 'rescue', detail: 'conditional', court_count: courtCount, available: availableForBatch }) } catch { /* noop */ }
          const rescueKey = getAlternativeMatchKey(conditionalQualityRescue)
          result = {
            ...result,
            alternatives: [
              conditionalQualityRescue,
              ...result.alternatives.filter(alternative => getAlternativeMatchKey(alternative) !== rescueKey),
            ].slice(0, LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT),
          }
        }
      }
    }
    const finalAlternatives = result.alternatives
    const {
      finalGuardedAlternative,
      tradeoffChoices,
      recommendedTradeoffChoice,
    } = resolveLivePreviewFinalChoice({
      finalAlternatives,
      baselineForConditionalSearch,
      conditionalQualityTradeoff,
      state: suggestionStateForCourt,
      configuredPvnaTolerance,
      nextMatchIndex: previewCountableMatchCount + index + 1,
      policy: options.liveQualityPolicy ?? 'current',
    })
    let alternative = finalGuardedAlternative ?? finalAlternatives[0]
    const rollingCommitments = options.rollingHorizon === true && count === 1
      ? liveMatchRows.filter(row => (
          row.status === 'live'
          && !completingLiveMatchIds.has(row.id)
          && row.court_idx !== courtIdx
        ))
      : []
    const beamPlayerCount = [...suggestionStateForCourt.players.values()]
      .filter(p => p.checked_out_at === null && !p.opted_rest).length
    if (rollingCommitments.length > 0 && finalAlternatives.length > 1 && beamPlayerCount <= BEAM_ACTIVE_PLAYER_LIMIT) {
      const beamBudgetMs = Math.min(
        getRemainingCourtBudgetMs(BEAM_PER_CANDIDATE_MAX_MS * BEAM_K),
        BEAM_PER_CANDIDATE_MAX_MS * BEAM_K,
      )
      const beamBaseSimBusy = new Set([
        ...batchBusyIds,
        ...[...courtRoundBusyIds].filter(id => !liveLockedPlayerIds.has(id)),
      ])
      const beamAlt = pickRollingBeamAlternative(
        finalAlternatives.slice(0, BEAM_K),
        suggestionStateForCourt,
        beamBaseSimBusy,
        rollingCommitments,
        beamBudgetMs,
        options.rollingPlanTarget,
      )
      if (beamAlt) {
        alternative = beamAlt.alternative
        try {
          options.onInstrumentEvent?.({
            event: 'rolling_horizon',
            detail: [
              `court=${courtIdx}`,
              `candidates=${beamAlt.diagnostics.candidate_count}`,
              `orders=${beamAlt.diagnostics.completion_orders}`,
              `depth=${beamAlt.diagnostics.horizon_events}`,
              `score=${beamAlt.diagnostics.selected_score.toFixed(2)}`,
              `worst=${beamAlt.diagnostics.selected_worst_path_score.toFixed(2)}`,
              `no_future=${beamAlt.diagnostics.paths_without_future_match}`,
            ].join(';'),
            court_count: courtCount,
            available: beamPlayerCount - beamBaseSimBusy.size,
          })
        } catch { /* noop */ }
      }
    } else if (
      options.rollingHorizon !== true
      && count === 1
      && liveCourtIdxs.size > 0
      && finalAlternatives.length > 1
      && beamPlayerCount <= BEAM_ACTIVE_PLAYER_LIMIT
    ) {
      const legacyAlt = pickLegacyBeamAlternative(
        finalAlternatives.slice(0, BEAM_K),
        liveCourtIdxs.size,
        suggestionStateForCourt,
        new Set([
          ...batchBusyIds,
          ...[...courtRoundBusyIds].filter(id => !liveLockedPlayerIds.has(id)),
        ]),
        Math.min(
          getRemainingCourtBudgetMs(BEAM_PER_CANDIDATE_MAX_MS * BEAM_K),
          BEAM_PER_CANDIDATE_MAX_MS * BEAM_K,
        ),
      )
      if (legacyAlt) alternative = legacyAlt
    }
    const match = alternative?.matches[0]
    if (!alternative || !match) continue
    const effectivePvnaTolerance = suggestionState.config.pvna_tolerance
    const pvnaDiff = match.stats?.pvna_diff ?? 0
    const selectedIntraTeamGap = getAlternativeIntraTeamGap(alternative, suggestionStateForCourt)
    const availablePlayerCount = [...suggestionStateForCourt.players.values()].filter(player =>
      player.checked_out_at === null
      && !player.opted_rest
      && !batchBusyIds.has(player.player_id)
      && !courtRoundBusyIds.has(player.player_id)
    ).length
    const tightPoolDeferUntilMs = options.tightPoolQualityDeferUntilByCourt?.[courtIdx]
    const tightPoolWaitIsActive = isTightPoolQualityWaitActive(
      options.tightPoolQualityDeferUntilByCourt,
      courtIdx,
      options.nowMs,
    )
    if (shouldDeferTightPoolSuggestion({
      enabled: options.deferExtremeTightPool === true && count === 1 && tightPoolWaitIsActive,
      activeLiveCourtCount: liveCourtIdxs.size,
      availablePlayerCount,
      pvnaGap: pvnaDiff,
      intraTeamGap: selectedIntraTeamGap,
      configuredPvnaTolerance,
    })) {
      try {
        options.onInstrumentEvent?.({
          event: 'repair',
          detail: `tight_pool_quality_deferred:court=${courtIdx};available=${availablePlayerCount};pvna=${pvnaDiff.toFixed(2)};intra=${selectedIntraTeamGap.toFixed(2)};until=${tightPoolDeferUntilMs ?? 'unbounded'}`,
          court_count: courtCount,
          available: availablePlayerCount,
        })
      } catch { /* noop */ }
      continue
    }
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
    const matchLockedPlayerIds = liveLockedPlayerIds.size > 0
      ? [...match.team_a, ...match.team_b].filter(id =>
          liveLockedPlayerIds.has(id)
          && liveLockedPlayerCourtIdxs.get(id) !== courtIdx,
        )
      : []
    let perMatchAvailabilityContext = liveAvailabilityContext
    if (matchLockedPlayerIds.length > 0 && liveAvailabilityContext) {
      const lockedBeamQuality = computeBeamQuality(
        match.team_a as [string, string],
        match.team_b as [string, string],
        suggestionStateForCourt,
      )
      const availablePool = [...suggestionStateForCourt.players.values()]
        .filter(p =>
          p.checked_out_at === null &&
          !p.opted_rest &&
          !busyIds.has(p.player_id) &&
          !liveLockedPlayerIds.has(p.player_id),
        )
        .map(p => p.player_id)
      const availablePoolQuality = findBestAvailablePoolQuality(
        availablePool,
        suggestionStateForCourt,
        effectivePvnaTolerance,
      )
      perMatchAvailabilityContext = {
        ...liveAvailabilityContext,
        locked_beam_quality: lockedBeamQuality,
        available_pool_quality: availablePoolQuality,
      }
    }
    payloads.push({
      court_idx: courtIdx,
      team_a: match.team_a,
      team_b: match.team_b,
      resting: alternative.resting,
      round_no: payloadRoundNo,
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
      live_availability_context: perMatchAvailabilityContext,
      locked_player_ids: matchLockedPlayerIds.length > 0 ? matchLockedPlayerIds : undefined,
    })

    if (debugOut && debugEligible) {
      debugOut.push({
        court_idx: courtIdx,
        busy_count: busyIds.size,
        required_for_court: requiredForThisCourt,
        eligible_players: debugEligible,
        selected: [
          ...match.team_a.map(id => {
            const player = suggestionStateForCourt.players.get(id)
            return { id, pvna: player ? getEffectivePvna(player) : 0, team: 'A' as const }
          }),
          ...match.team_b.map(id => {
            const player = suggestionStateForCourt.players.get(id)
            return { id, pvna: player ? getEffectivePvna(player) : 0, team: 'B' as const }
          }),
        ],
      })
    }
    match.team_a.forEach(playerId => busyIds.add(playerId))
    match.team_b.forEach(playerId => busyIds.add(playerId))
    match.team_a.forEach(playerId => batchBusyIds.add(playerId))
    match.team_b.forEach(playerId => batchBusyIds.add(playerId))
    match.team_a.forEach(playerId => courtRoundBusyIds.add(playerId))
    match.team_b.forEach(playerId => courtRoundBusyIds.add(playerId))
    playerIdsByRound.set(payloadRoundNo, courtRoundBusyIds)
    const nextCourtRoundMatchCount = courtRoundMatchCount + 1
    roundCounts.set(payloadRoundNo, nextCourtRoundMatchCount)
    const courtRoundCourtIdxs = courtIdxsByRound.get(payloadRoundNo) ?? new Set<number>()
    courtRoundCourtIdxs.add(courtIdx)
    courtIdxsByRound.set(payloadRoundNo, courtRoundCourtIdxs)
    if (payloadRoundNo === projectedRoundNo) {
      roundCourtIdxs.add(courtIdx)
      projectedRoundMatchCount = nextCourtRoundMatchCount
    }
    queuedCourtIdxs.add(courtIdx)
    
    const projectedMatch: SessionLiveMatchRow = {
      id: `preview-projected-${index}`,
      session_id: sessionId,
      sequence_no: index,
      round_no: payloadRoundNo,
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
    suggestionState = buildProjectedStateAfterLiveMatch(suggestionState, projectedMatch, payloadRoundNo)
    completedMatchGroups.push({
      round_no: payloadRoundNo,
      team_a: projectedMatch.team_a,
      team_b: projectedMatch.team_b,
    })
    if (nextCourtRoundMatchCount >= courtCapacity) {
      suggestionState = buildProjectedStateAfterCompletedLiveRound(suggestionState, courtRoundBusyIds)
    }
  }
  const filledCourtIdxs = new Set(payloads.map(p => p.court_idx))
  const openCourtIdxsForBatch = Array.from({ length: courtCount }, (_, i) => i)
    .filter(idx => !liveCourtIdxs.has(idx))
  const missingCourts = openCourtIdxsForBatch.filter(idx => !filledCourtIdxs.has(idx))
  if (options.onIncompleteDump) {
    options.onIncompleteDump({
      session_id: sessionId,
      missing_courts: missingCourts,
      chosen_matches: payloads.map(p => ({
        court_idx: p.court_idx ?? -1,
        team_a: [...p.team_a],
        team_b: [...p.team_b],
        is_replacement: false,
        warnings: p.warnings ?? [],
        tradeoffs: p.tradeoffs ?? [],
      })),
      pvna_tolerance: pvnaTolerance,
      rounds: state.rounds.map(r => ({
        round_no: r.round_no,
        status: r.status,
        matches: r.matches.map(m => ({ team_a: [...m.team_a], team_b: [...m.team_b] })),
        resting: [...r.resting],
      })),
      payload: {
        players: [...state.players.values()].map(p => ({
          id: p.player_id,
          pvna: p.pvna,
          effective_pvna: p.effective_pvna ?? null,
          gender: p.gender,
          partner_gender_pref: p.partner_gender_pref,
          opponent_gender_pref: p.opponent_gender_pref,
          matches_played: p.matches_played,
          last_played_round: p.last_played_round ?? 0,
          consecutive_rest: p.consecutive_rest,
          consecutive_play: p.consecutive_play,
          rounds_available: p.rounds_available,
          opted_rest: p.opted_rest,
          checked_out: p.checked_out_at !== null,
          group_id: p.group_id ?? null,
          partner_counts: Object.fromEntries(p.partner_counts),
          opponent_counts: Object.fromEntries(p.opponent_counts),
        })),
        avoid_pairs: state.config.avoid_pairs ?? [],
        busy_player_ids: [...baseBusyIds],
        court_count: courtCount,
        current_round: projectedRoundNo,
        missing_courts: missingCourts,
      },
    })
  }
  const onRepairInstrument = options.onInstrumentEvent
    ? (detail: 'swap' | 'early' | 'repeat') => {
        try { options.onInstrumentEvent!({ event: 'repair', detail, court_count: courtCount, available: availableForBatch }) } catch { /* noop */ }
      }
    : undefined
  const hasStartedOrCompletedLiveMatches = countableMatches.some(match =>
    match.status === 'live' || match.status === 'completed',
  )
  const repairedPayloads = repairSuggestedPayloadBatch(payloads, repairState, pvnaTolerance, onRepairInstrument, {
    isTrueFirstRound: state.rounds.length === 0 && !hasStartedOrCompletedLiveMatches,
    allowEarlyQualityRepair: payloads.length >= openCourtIdxsForBatch.length,
  })
  // Derive warnings from the exact lineups returned to persistence. Rescue and
  // repair paths must not leave over-cap quality metadata stale.
  return repairedPayloads.map(payload => normalizeRepairedPayload(
    payload,
    repairState,
    pvnaTolerance,
    { clearTradeoffChoices: false },
  ))
}
