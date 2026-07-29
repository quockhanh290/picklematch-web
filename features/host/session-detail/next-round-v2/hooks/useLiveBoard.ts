// AUTO-EXTRACTED from NextRoundSuggesterScreenV2.tsx (task E2 / option A).
// Owns the entire preview+mutation state machine AND the interleaved lifecycle
// effects (shell-paint, autoRepair, focus, autoSync, AppState). ALL effects are
// declared here in ORIGINAL SOURCE ORDER so React effect-registration order is
// byte-identical to the pre-refactor component (behavior-preserving). Moved bodies
// are verbatim; deps/return are the only hand-written boundary. See task-E2-report.md.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { buildProjectedStateAfterLiveMatch, buildPreviewBatchKey, type SuggestedLiveMatchRow } from '../preview'
import { buildPreviewPolicyFingerprint } from '../preview-policy'
import { createClientTraceId, fetchLiveMatchesPreview, fetchLiveSessionVersion } from '../api'
import { LIVE_VERSION_POLL_INTERVAL_MS, shouldRefetchForExternalVersion } from '../version-poll'
import { getMissingPreviewCourtIdxs, getRequestedReplacementCourtIdxs, isPreviewBoardComplete } from '../court-lanes'
import { hasReachedCompletedLiveCycleTarget } from '../live-cycle-rows'
import { canRecoverMissingPreviewCourts, computeHasGenuinePreviewQualityViolation, computeShouldRequestFullBoardPreview, getLiveRowsForPreviewMode, getSuggestedPreviewQueueCount, hasHardPreviewQualityViolation, hasMissingRestPriorityPlayer, hasPendingPlanAdoption, isCommittedPreviewMatch, isPreviewBatchCacheCurrent, isPreviewResponseCurrent, isServerPersistedPreviewSource, isStartablePreviewRow, mergePreviewLaneCandidates, shouldRestMissForceFullBoard } from '../preview-consistency'
import { Alert, AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'

import {
} from '@/lib/next-round-suggester/score'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import {
} from '@/lib/next-round-suggester/fairness/audit'
import {
  computeSessionFairness,
} from '@/lib/next-round-suggester/fairness/metrics'
import type {
  SessionLiveMatchRow,
  SessionState,
} from '@/lib/next-round-suggester/types'
import { supabase } from '@/lib/supabase'
import { repairLiveSessionPlayerStateFromRounds } from '../api'
import { getNextRoundTelemetry, markNextRoundStage } from '../telemetry'
import { getSuggestedMatchPvnaGap, getSuggestedMatchSignature, swapPlayersInSuggestedMatch } from '../preview-helpers'
import {
  getPlayerPvna,
} from '../helpers'
import type { LiveRows } from '../types'
import { liveSessionQueryKeys } from '../queries'
import { classifyPersistAssignmentConflict } from '../preview-conflict-recovery'
import { useNextRoundModel } from '../useNextRoundModel'
import { pruneOptimisticLiveMatchesByServerId, withoutRowsById } from '../optimisticLiveMatches'
import { useStartMatchMutation, useCompleteMatchMutation } from '../mutations'
import { getMatchPlayerIds, isSameCourtAndPlayers, shouldInvalidatePreviewAfterStartError, completeAlreadyApplied, cancelAlreadyApplied } from '../../liveMatchGuards'
import { usePreviewTelemetry, STUCK_THRESHOLD_MS } from './usePreviewTelemetry'
import { toUserSafeActionError } from '../action-error'
type ActionResult = {
  reload?: boolean
  reconcileAfterMs?: number
  targetReachedAfterMatch?: boolean
  reconcile?: {
    action: 'start' | 'end'
    expectedLiveStateVersion?: number | null
    expectedRoundNo?: number | null
    expectedRoundStatus?: 'active' | 'completed'
  }
}
type LiveDisplayMatchRow = SessionLiveMatchRow & {
  client_preview_id?: string
}

const LIVE_TRADEOFF_ALTERNATIVE_LIMIT = 4
const LIVE_PREVIEW_REPLACEMENT_MAX_COUNT = 2
const LIVE_PREVIEW_FULL_BOARD_MAX_COUNT = 6
const LIVE_PREVIEW_SOFT_TIMEOUT_MS = 12000
const LIVE_PREVIEW_INCOMPLETE_RETRY_MS = 900
const LIVE_PREVIEW_BLOCKED_RETRY_MS = 6000
const LIVE_PREVIEW_ERROR_RETRY_MS = 1500
const LIVE_PREVIEW_SOFT_TIMEOUT_RETRY_MS = 3500
function compactTraceKey(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(36)}:${value.length}`
}
function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
function waitForUiFrame() {
  return new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    setTimeout(resolve, 0)
  })
}
function createClientRequestId(action: 'match') {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `${action}_${Date.now().toString(36)}_${randomPart}`
}
function withPreviewSoftTimeout<T>(promise: Promise<T>, onSoftTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const softTimeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      onSoftTimeout?.()
      reject(new Error('Preview suggest soft timeout'))
    }, LIVE_PREVIEW_SOFT_TIMEOUT_MS)
  })
  return Promise.race([promise, softTimeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
function isLocalPreviewFallbackEnabled() {
  const isDevRuntime = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'
  if (isDevRuntime) return true
  return process.env.EXPO_PUBLIC_ENABLE_LOCAL_PREVIEW_FALLBACK === '1'
}
type SuggestedPreviewBatch = {
  key: string
  matches: SuggestedLiveMatchRow[]
}
const getSuggestedLaneCourtIdx = (match: Pick<SessionLiveMatchRow, 'court_idx' | 'sequence_no'>): number | null => {
  const courtIdx = Number(match.court_idx ?? match.sequence_no)
  return Number.isFinite(courtIdx) ? courtIdx : null
}


type UseLiveBoardDeps = {
  sessionId: string
  model: ReturnType<typeof useNextRoundModel>
  telemetry: ReturnType<typeof usePreviewTelemetry>
  queryClient: ReturnType<typeof useQueryClient>
  startMatchMutation: ReturnType<typeof useStartMatchMutation>
  completeMatchMutation: ReturnType<typeof useCompleteMatchMutation>
  scheduleReconcile: (result: ActionResult) => void
  runAction: (
    key: string,
    action: () => Promise<ActionResult | void>,
    opts?: { alreadyAppliedOnError?: (rows: any) => boolean },
  ) => Promise<void>
  syncRoster: () => Promise<void>
  suggestedSwapMatch: SuggestedLiveMatchRow | null
  setSuggestedSwapMatch: React.Dispatch<React.SetStateAction<SuggestedLiveMatchRow | null>>
  autoSyncAttemptedRef: React.MutableRefObject<boolean>
  reconcileTimeoutsRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>
}

export function useLiveBoard(deps: UseLiveBoardDeps) {
  const {
    sessionId,
    model,
    telemetry,
    queryClient,
    startMatchMutation,
    completeMatchMutation,
    scheduleReconcile,
    runAction,
    syncRoster,
    suggestedSwapMatch,
    setSuggestedSwapMatch,
    autoSyncAttemptedRef,
    reconcileTimeoutsRef,
  } = deps
  const {
    setError,
    loadLiveState,
    applyLiveMatches,
    applyCompletedLiveMatch,
    phase,
    settingsHydrated,
    rows,
    playersById,
    pvnaTolerance,
    avoidPairs,
    effectiveTargetRounds,
    courtPreset,
    courtCount,
    state,
    activeRound,
    targetRounds,
    fairnessAdjustment,
    setShowSessionReport,
    matchCountConsistencyRows,
    loading,
    checkedInPlayers,
    setSwapFromPlayerId,
    setSheet,
  } = model

  const isFirstFocusRef = useRef(true)
  const autoRepairStateAttemptedRef = useRef(false)
  const completingCleanupTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const completingMatchExpectedPlayedRef = useRef(new Map<string, { playerIds: string[]; expectedPlayed: number }>())
  const liveMatchMutationQueueRef = useRef(Promise.resolve())
  const suggestedPreviewBatchRef = useRef<SuggestedPreviewBatch | null>(null)
  const suggestedLaneCacheRef = useRef(new Map<number, SuggestedLiveMatchRow>())
  const previewRequestInFlightRef = useRef(false)
  const previewRequestInFlightSerialRef = useRef<number | null>(null)
  const previewRequestSerialRef = useRef(0)
  const previewPendingRequestKeysRef = useRef(new Set<string>())
  const previewRetryTimeoutsRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  const previewScheduledRetryKeysRef = useRef(new Set<string>())
  const sessionGenerationRef = useRef(0)
  const activeSessionIdRef = useRef(sessionId)
  const previewBaseKeyRef = useRef<string | null>(null)
  const previewIncompleteRetryRef = useRef<{ key: string; count: number }>({ key: '', count: 0 })
  const previewAssignmentConflictRetryRef = useRef<{ key: string; count: number }>({ key: '', count: 0 })
  const previewBlockedIncompleteKeysRef = useRef(new Set<string>())
  const previewUnblockNonceRef = useRef(0)
  const startingPreviewIdsRef = useRef(new Set<string>())
  const endingLiveMatchIdsRef = useRef(new Set<string>())
  const completedLiveMatchCommitIdsRef = useRef(new Set<string>())
  const cancelingLiveMatchIdsRef = useRef(new Set<string>())
  const [optimisticLiveMatches, setOptimisticLiveMatches] = useState<LiveDisplayMatchRow[]>([])
  const [liveMatchDisplayKeys, setLiveMatchDisplayKeys] = useState<Record<string, string>>({})
  const [availablePoolPreviews, setAvailablePoolPreviews] = useState<Map<number, SuggestedLiveMatchRow | 'loading'>>(() => new Map())
  const [startingPreviewIds, setStartingPreviewIds] = useState<Set<string>>(() => new Set())
  const [startedPreviewIds, setStartedPreviewIds] = useState<Set<string>>(() => new Set())
  const [endingLiveMatchIds, setEndingLiveMatchIds] = useState<Set<string>>(() => new Set())
  const [completingLiveMatchIds, setCompletingLiveMatchIds] = useState<Set<string>>(() => new Set())
  const [creatingNextMatchIds, setCreatingNextMatchIds] = useState<Set<string>>(() => new Set())
  const [completedLiveMatchCommitNonce, setCompletedLiveMatchCommitNonce] = useState(0)
  const [completingLiveMatchPlaceholders, setCompletingLiveMatchPlaceholders] = useState<Map<string, SessionLiveMatchRow>>(() => new Map())
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0)
  const [isSuggestingPreview, setIsSuggestingPreview] = useState(false)
  const [courtShortageBreakdown, setCourtShortageBreakdown] = useState<{ temp: number; real: number } | null>(null)
  // Courts the engine is holding back this pass to avoid a lopsided blowout — waiting for a court to
  // finish (freeing better-matched players), not stuck. Surfaced so the host sees a clear reason.
  const [qualityDeferredCourts, setQualityDeferredCourts] = useState<number[]>([])
  const completingLiveMatchPlaceholdersRef = useRef(completingLiveMatchPlaceholders)
  useEffect(() => {
    markNextRoundStage(sessionId, 'screen_shell_paint', {
      loading,
    })
  }, [loading, sessionId])
  const lastBusRefreshRef = useRef(0)
  const screenFocusedRef = useRef(true)
  const versionPollInFlightRef = useRef(false)
  const liveStateVersionRef = useRef<number | null>(rows.liveStateVersion ?? null)

  React.useEffect(() => {
    const nextVersion = rows.liveStateVersion
    if (nextVersion == null) return
    liveStateVersionRef.current = liveStateVersionRef.current === null
      ? nextVersion
      : Math.max(liveStateVersionRef.current, nextVersion)
  }, [rows.liveStateVersion])
  const previewRecoveryVersionRef = useRef<number | null>(rows.liveStateVersion ?? null)
  React.useEffect(() => {
    const nextVersion = rows.liveStateVersion
    if (nextVersion == null || previewRecoveryVersionRef.current === nextVersion) return
    previewRecoveryVersionRef.current = nextVersion
    previewBlockedIncompleteKeysRef.current.clear()
    previewIncompleteRetryRef.current = { key: '', count: 0 }
    previewAssignmentConflictRetryRef.current = { key: '', count: 0 }
    previewScheduledRetryKeysRef.current.clear()
    previewUnblockNonceRef.current += 1
  }, [rows.liveStateVersion])
  React.useEffect(() => {
    completingLiveMatchPlaceholdersRef.current = completingLiveMatchPlaceholders
  }, [completingLiveMatchPlaceholders])
  React.useEffect(() => {
    const sessionChanged = activeSessionIdRef.current !== sessionId
    activeSessionIdRef.current = sessionId
    sessionGenerationRef.current += 1
    previewRequestSerialRef.current += 1
    previewRequestInFlightRef.current = false
    previewRequestInFlightSerialRef.current = null
    if (sessionChanged) liveStateVersionRef.current = null
    autoRepairStateAttemptedRef.current = false
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current.clear()
    previewBaseKeyRef.current = null
    previewPendingRequestKeysRef.current.clear()
    previewBlockedIncompleteKeysRef.current.clear()
    previewUnblockNonceRef.current = 0
    previewIncompleteRetryRef.current = { key: '', count: 0 }
    previewAssignmentConflictRetryRef.current = { key: '', count: 0 }
    previewRetryTimeoutsRef.current.forEach(clearTimeout)
    previewRetryTimeoutsRef.current.clear()
    previewScheduledRetryKeysRef.current.clear()
    completingMatchExpectedPlayedRef.current.clear()
    completedLiveMatchCommitIdsRef.current.clear()
    completingCleanupTimeoutsRef.current.forEach(clearTimeout)
    completingCleanupTimeoutsRef.current.clear()
    setOptimisticLiveMatches([])
    setStartingPreviewIds(new Set())
    setStartedPreviewIds(new Set())
    setEndingLiveMatchIds(new Set())
    setCompletingLiveMatchIds(new Set())
    setCreatingNextMatchIds(new Set())
    setCompletingLiveMatchPlaceholders(new Map())
    setIsSuggestingPreview(false)
    setLiveMatchDisplayKeys({})
  }, [sessionId])

  // ── Board-stuck tracker (observability only; bookkeeping lives in usePreviewTelemetry) ──
  useEffect(() => {
    if (!isSuggestingPreview) {
      telemetry.resolveStuckTracker(telemetry.stuckTrackerRef.current?.resolvedBy ?? 'auto')
      return
    }
    if (telemetry.stuckTrackerRef.current) return
    const timer = setTimeout(() => {
      const tracker = telemetry.stuckTrackerRef.current
      if (!tracker) return
      const hint = telemetry.lastStuckHintRef.current
      tracker.firedAt = nowMs()
      tracker.kind = hint.kind !== 'unknown'
        ? hint.kind
        : previewBlockedIncompleteKeysRef.current.size > 0
          ? 'incomplete'
          : !previewRequestInFlightRef.current
            ? 'latch'
            : 'unknown'
      tracker.courtIdxs = hint.courtIdxs
    }, STUCK_THRESHOLD_MS)
    telemetry.stuckTrackerRef.current = {
      startedAt: nowMs(),
      firedAt: null,
      kind: 'unknown',
      courtIdxs: [],
      resolvedBy: 'auto',
      timer,
    }
  }, [isSuggestingPreview, telemetry.resolveStuckTracker])

  useEffect(() => {
    if (telemetry.stuckTrackerRef.current) telemetry.stuckTrackerRef.current.resolvedBy = 'complete_match'
  }, [completedLiveMatchCommitNonce])
  // ── end board-stuck tracker ───────────────────────────────────────────────

  React.useEffect(() => {
    if (phase !== 'recap' || matchCountConsistencyRows.length === 0) {
      autoRepairStateAttemptedRef.current = false
      return
    }
    if (activeRound || autoRepairStateAttemptedRef.current) return
    autoRepairStateAttemptedRef.current = true

    void repairLiveSessionPlayerStateFromRounds(sessionId)
      .then(() => loadLiveState())
      .catch(error => {
        console.warn('Could not repair live session player state', error)
      })
  }, [activeRound, loadLiveState, matchCountConsistencyRows.length, phase, sessionId])
  React.useEffect(() => {
    setOptimisticLiveMatches(current => {
      return pruneOptimisticLiveMatchesByServerId(current, rows.liveMatchRows)
    })
  }, [rows.liveMatchRows])
  React.useEffect(() => () => {
    reconcileTimeoutsRef.current.forEach(clearTimeout)
    reconcileTimeoutsRef.current = []
    completingCleanupTimeoutsRef.current.forEach(clearTimeout)
    completingCleanupTimeoutsRef.current.clear()
    previewRetryTimeoutsRef.current.forEach(clearTimeout)
    previewRetryTimeoutsRef.current.clear()
    previewScheduledRetryKeysRef.current.clear()
  }, [])

  // Xóa completing match khỏi busyIds khi state (deferred) đã phản ánh đủ matches_played mới.
  React.useEffect(() => {
    const pending = completingMatchExpectedPlayedRef.current
    if (pending.size === 0) return
    const toRemove: string[] = []
    for (const [matchId, { playerIds, expectedPlayed }] of pending) {
      const player = state.players.get(playerIds[0])
      if (player && player.matches_played >= expectedPlayed) {
        toRemove.push(matchId)
      }
    }
    if (toRemove.length === 0) return
    for (const id of toRemove) pending.delete(id)
    setCompletingLiveMatchIds(current => {
      const next = new Set(current)
      let changed = false
      for (const id of toRemove) {
        if (next.has(id)) { next.delete(id); changed = true }
      }
      return changed ? next : current
    })
  }, [state])
  useFocusEffect(useCallback(() => {
    screenFocusedRef.current = true
    if (isFirstFocusRef.current) {
      isFirstFocusRef.current = false
    } else if (Date.now() - lastBusRefreshRef.current >= 2000) {
      void loadLiveState()
    }
    return () => {
      screenFocusedRef.current = false
    }
  }, [loadLiveState]))

  React.useEffect(() => {
    const poll = async () => {
      if (!screenFocusedRef.current || AppState.currentState !== 'active' || versionPollInFlightRef.current) return
      versionPollInFlightRef.current = true
      try {
        const serverVersion = await fetchLiveSessionVersion(sessionId)
        if (shouldRefetchForExternalVersion(liveStateVersionRef.current, serverVersion)) {
          telemetry.trace('client_external_live_version_advanced', {
            detail: {
              local_live_state_version: liveStateVersionRef.current,
              server_live_state_version: serverVersion,
            },
          })
          suggestedPreviewBatchRef.current = null
          suggestedLaneCacheRef.current.clear()
          await loadLiveState()
        }
      } catch (pollError) {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] live version poll failed', pollError)
      } finally {
        versionPollInFlightRef.current = false
      }
    }
    const interval = setInterval(() => { void poll() }, LIVE_VERSION_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [loadLiveState, sessionId, telemetry.trace])
  React.useEffect(() => {
    if (loading || activeRound || autoSyncAttemptedRef.current) return

    if (rows.playerRows.length > 0) return

    const checkedInIds = checkedInPlayers.map(player => String(player.id))
    if (checkedInIds.length === 0) return

    const livePresentIds = new Set(
      rows.playerRows
        .filter(row => !row.checked_out_at)
        .map(row => String(row.player_id)),
    )
    const missingLiveRows = checkedInIds.some(playerId => !livePresentIds.has(playerId))
    if (!missingLiveRows) return

    autoSyncAttemptedRef.current = true
    void syncRoster()
  }, [activeRound, checkedInPlayers, loading, rows.playerRows, syncRoster])

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void loadLiveState()
    })
    return () => sub.remove()
  }, [loadLiveState])
  // buildSuggestedMatchPayloads has been moved to Edge Function
  const startLiveMatch = async (match: SuggestedLiveMatchRow) => {
    const startT0 = nowMs()
    if (startingPreviewIdsRef.current.has(match.id) || startedPreviewIds.has(match.id)) return
    const startedCourtIdx = getSuggestedLaneCourtIdx(match)
    const blockUntrustedStart = (reason: string, extraDetail?: Record<string, unknown>) => {
      telemetry.trace('client_start_blocked_untrusted_preview', {
        requestId: match.preview_request_key ?? match.id,
        responsePayload: {
          match_id: match.id,
          court_idx: startedCourtIdx,
          preview_source: match.preview_source ?? null,
        },
        detail: {
          reason,
          preview_request_key: match.preview_request_key ?? null,
          preview_request_serial: match.preview_request_serial ?? null,
          live_state_version: liveStateVersionRef.current,
          ...extraDetail,
        },
      })
      if (startedCourtIdx !== null) suggestedLaneCacheRef.current.delete(startedCourtIdx)
      if (match.preview_source !== 'manual_available_pool') {
        setSuggestedLiveMatches(current => current.filter(row => row.id !== match.id))
      }
      suggestedPreviewBatchRef.current = null
      setPreviewRefreshNonce(value => value + 1)
      setError('Gợi ý vừa cũ hoặc chưa được xác nhận từ server. Đang tạo lại gợi ý an toàn hơn.')
    }
    const isManualAvailablePoolStart = match.preview_source === 'manual_available_pool' && match.available_pool_only === true
    const usePersistedMatchStart = isServerPersistedPreviewSource(match.preview_source) && !isManualAvailablePoolStart
    const committedBatch = suggestedPreviewBatchRef.current
    const committedLane = startedCourtIdx === null ? null : suggestedLaneCacheRef.current.get(startedCourtIdx)
    const isCommittedEdgeStart = isCommittedPreviewMatch({
      previewSource: match.preview_source,
      matchId: match.id,
      committedBatchMatchIds: committedBatch?.matches.map(candidate => candidate.id) ?? [],
      committedLaneMatchId: committedLane?.id,
      persistedSuggestedMatchId: persistedSuggestedMatchIds.has(match.id) ? match.id : null,
    })
    if (!isManualAvailablePoolStart && !isCommittedEdgeStart) {
      blockUntrustedStart('preview_not_committed', {
        committed_batch_key: committedBatch?.key ?? null,
        committed_batch_match_count: committedBatch?.matches.length ?? 0,
      })
      return
    }
    if (__DEV__) console.log('[NextRoundSuggesterV2] start live match press', {
      matchId: match.id,
      version: liveStateVersionRef.current,
      courtIdx: match.court_idx,
      roundNo: match.round_no,
      status: match.status,
    })
    const previewVersionNumber = Number(match.preview_live_state_version ?? 0)
    const previewCountableMatchCountNumber = Number(match.preview_countable_match_count ?? -1)
    const previewVersion = Number.isFinite(previewVersionNumber) && previewVersionNumber > 0
      ? previewVersionNumber
      : null
    const previewCountableMatchCount = Number.isFinite(previewCountableMatchCountNumber) && previewCountableMatchCountNumber >= 0
      ? previewCountableMatchCountNumber
      : null
    if (!usePersistedMatchStart && (previewVersion === null || previewCountableMatchCount === null)) {
      startingPreviewIdsRef.current.delete(match.id)
      setError(toUserSafeActionError(new Error('Preview version missing')))
      void loadLiveState()
      return
    }
    const previewMaxSeqNo = typeof match.preview_max_sequence_no === 'number' ? match.preview_max_sequence_no : null
    const previewCountableMatchCountForCompare = previewCountableMatchCount ?? Number.POSITIVE_INFINITY
    const hasCompletedAfterPreview = !usePersistedMatchStart && effectiveLiveMatchRows
      .filter(row => row.status !== 'cancelled')
      .some(row => row.status === 'completed' && (
        previewMaxSeqNo !== null
          ? row.sequence_no > previewMaxSeqNo
          : row.sequence_no >= previewCountableMatchCountForCompare
      ))
    if (!usePersistedMatchStart && hasCompletedAfterPreview) {
      startingPreviewIdsRef.current.delete(match.id)
      if (startedCourtIdx !== null) suggestedLaneCacheRef.current.delete(startedCourtIdx)
      setSuggestedLiveMatches(current => current.filter(row => row.id !== match.id))
      suggestedPreviewBatchRef.current = null
      setPreviewRefreshNonce(value => value + 1)
      setError('Gợi ý vừa cũ sau khi có trận kết thúc. Đang tạo lại trận phù hợp hơn.')
      return
    }
    const activePlayerIds = new Set(activeLiveMatches.flatMap(row => getMatchPlayerIds(row)))
    const matchPlayerIds = getMatchPlayerIds(match)
    const busyPlayerIds = matchPlayerIds.filter(playerId => activePlayerIds.has(playerId))
    if (!usePersistedMatchStart && busyPlayerIds.length > 0) {
      blockUntrustedStart('player_busy', { busy_player_ids: busyPlayerIds })
      return
    }
    const courtIsOccupied = startedCourtIdx !== null && activeLiveMatches.some(row =>
      getSuggestedLaneCourtIdx(row) === startedCourtIdx
    )
    if (!usePersistedMatchStart && courtIsOccupied) {
      blockUntrustedStart('court_occupied')
      return
    }
    startingPreviewIdsRef.current.add(match.id)

    setStartingPreviewIds(current => {
      const next = new Set(current)
      next.add(match.id)
      return next
    })
    await waitForUiFrame()

    const executeStart = async () => {
      const actionT0 = nowMs()

      for (let attempt = 0; attempt <= 1; attempt++) {
        if (attempt > 0) {
          // Refetch latest snapshot and sync version synchronously from cache.
          // Do NOT read liveStateVersionRef here — it may lag behind a render cycle.
          await queryClient.refetchQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
          const cached = queryClient.getQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId))
          const fresh = Number(cached?.liveStateVersion ?? 0)
          if (Number.isFinite(fresh) && fresh > 0) {
            liveStateVersionRef.current = Math.max(liveStateVersionRef.current ?? 0, fresh)
          }
          // Idempotency guard: if the match is already live (e.g. committed by the first
          // attempt despite the 'Session changed' error), treat it as success.
          const alreadyLive = cached?.liveMatchRows.find(
            row => row.status === 'live' && isSameCourtAndPlayers(row, match),
          )
          if (alreadyLive) {
            const reconciledVersion = Number(cached?.liveStateVersion)
            if (Number.isFinite(reconciledVersion)) {
              liveStateVersionRef.current = Math.max(liveStateVersionRef.current ?? 0, reconciledVersion)
            }
            setLiveMatchDisplayKeys(current => ({ ...current, [alreadyLive.id]: match.id }))
            setSuggestedLiveMatches(prev => withoutRowsById(prev, new Set([match.id])))
            setOptimisticLiveMatches(current => [
              ...withoutRowsById(current, new Set([match.id, alreadyLive.id])),
              { ...alreadyLive, client_preview_id: match.id },
            ])
            applyLiveMatches([alreadyLive], cached?.liveStateVersion)
            if (__DEV__) console.log('[NextRoundSuggesterV2] start match already live (idempotency), aborting retry', { matchId: match.id, liveId: alreadyLive.id })
            return { reload: false, reconcileAfterMs: 600 }
          }
        }

        const expectedVersion = liveStateVersionRef.current
        if (expectedVersion === null) throw new Error('Session changed')
        const payloadBuildT0 = nowMs()
        const auditPayload = {
          client_request_id: createClientRequestId('match'),
          source: usePersistedMatchStart ? 'client-preview-start-persisted-live-match' : 'client-preview-start-live-match',
          preview_id: match.id,
          preview_live_state_version: previewVersion,
          preview_countable_match_count: previewCountableMatchCount,
          expected_round_matches: queueCourtCount,
        }
        const persistAndStartPayload = {
          expectedLiveStateVersion: expectedVersion,
          match: {
            court_idx: match.court_idx,
            team_a: match.team_a,
            team_b: match.team_b,
            resting: match.resting ?? [],
            round_no: match.round_no ?? -1,
          },
          auditPayload,
        }
        const edgePayload = {
          expected_live_state_version: expectedVersion,
          match_id: match.id,
          audit_payload: auditPayload,
        }
        const payloadBuildMs = nowMs() - payloadBuildT0
        const rpcT0 = nowMs()
        try {
          const payload = await startMatchMutation.mutateAsync(usePersistedMatchStart ? { edgePayload } : { persistAndStartPayload })
          const rpcMs = nowMs() - rpcT0
          const nextVersion = Number(payload?.live_state_version)
          if (Number.isFinite(nextVersion)) {
            liveStateVersionRef.current = liveStateVersionRef.current === null
              ? nextVersion
              : Math.max(liveStateVersionRef.current, nextVersion)
          }
          if (payload.match) {
            setLiveMatchDisplayKeys(current => ({
              ...current,
              [payload.match.id]: match.id,
            }))
            setStartedPreviewIds(current => {
              const next = new Set(current)
              next.add(match.id)
              return next
            })
            setSuggestedLiveMatches(prev => withoutRowsById(prev, new Set([match.id])))
            setOptimisticLiveMatches(current => [
              ...withoutRowsById(current, new Set([match.id, payload.match.id])),
              {
                ...payload.match,
                client_preview_id: match.id,
              },
            ])
          }
          const applyT0 = nowMs()
          applyLiveMatches(payload.match ? [payload.match] : [], payload.live_state_version)
          const applyMs = nowMs() - applyT0
          if (__DEV__) console.log('[NextRoundSuggesterV2] start live match timing', {
            matchId: match.id,
            courtIdx: match.court_idx,
            roundNo: match.round_no,
            expectedVersion,
            nextVersion: payload?.live_state_version,
            retried: attempt > 0,
            payloadBuildMs: Math.round(payloadBuildMs),
            rpcMs: Math.round(rpcMs),
            applyMs: Math.round(applyMs),
            actionMs: Math.round(nowMs() - actionT0),
            totalMs: Math.round(nowMs() - startT0),
          })
          return {
            reload: false,
            reconcileAfterMs: 600,
          }
        } catch (err: unknown) {
          if (attempt === 0 && String((err as any)?.message ?? '').includes('Session changed')) {
            if (__DEV__) console.log('[NextRoundSuggesterV2] start match Session changed, retrying', { matchId: match.id, expectedVersion })
            continue
          }
          throw err
        }
      }
      throw new Error('Session changed')
    }

    const queuedStart = liveMatchMutationQueueRef.current
      .catch(() => undefined)
      .then(executeStart)
    liveMatchMutationQueueRef.current = queuedStart.then(() => undefined, () => undefined)

    try {
      const result = await queuedStart
      startingPreviewIdsRef.current.delete(match.id)
      setStartingPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      if (result?.reload !== false) {
        await loadLiveState()
      } else {
        scheduleReconcile(result)
      }
    } catch (err: any) {
      startingPreviewIdsRef.current.delete(match.id)
      setStartingPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      const reconciledRows = await loadLiveState()
      const committedMatch = reconciledRows?.liveMatchRows.find(row =>
        row.status === 'live' && isSameCourtAndPlayers(row, match),
      )
      if (committedMatch) {
        const reconciledVersion = Number(reconciledRows?.liveStateVersion)
        if (Number.isFinite(reconciledVersion)) {
          liveStateVersionRef.current = liveStateVersionRef.current === null
            ? reconciledVersion
            : Math.max(liveStateVersionRef.current, reconciledVersion)
        }
        setLiveMatchDisplayKeys(current => ({
          ...current,
          [committedMatch.id]: match.id,
        }))
        setSuggestedLiveMatches(current => withoutRowsById(current, new Set([match.id])))
        setOptimisticLiveMatches(current => [
          ...withoutRowsById(current, new Set([match.id, committedMatch.id])),
          {
            ...committedMatch,
            client_preview_id: match.id,
          },
        ])
        applyLiveMatches([committedMatch], reconciledRows?.liveStateVersion)
        if (__DEV__) console.warn('[NextRoundSuggesterV2] start response failed but match was committed; reconciled', {
          matchId: match.id,
          committedMatchId: committedMatch.id,
          courtIdx: match.court_idx,
          error: err?.message ?? String(err),
        })
        return
      }
      setStartedPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setOptimisticLiveMatches(current => withoutRowsById(current, new Set([match.id])))
      if (shouldInvalidatePreviewAfterStartError(err)) {
        if (startedCourtIdx !== null) suggestedLaneCacheRef.current.delete(startedCourtIdx)
        setSuggestedLiveMatches(current => withoutRowsById(current, new Set([match.id])))
        suggestedPreviewBatchRef.current = null
        setPreviewRefreshNonce(value => value + 1)
        const safeMessage = toUserSafeActionError(err)
        console.warn('[NextRoundSuggesterV2] start match failed (stale preview)', err)
        setError(safeMessage)
        setTimeout(() => setError(null), 3500)
        await loadLiveState()
        return
      } else if (startedCourtIdx !== null) {
        suggestedLaneCacheRef.current.set(startedCourtIdx, match)
      }
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] start match failed', err)
      setError(safeMessage)
      await loadLiveState()
      Alert.alert('Lỗi', safeMessage)
    }
  }
  const fetchAvailablePoolPreview = async (lockedMatch: SuggestedLiveMatchRow) => {
    const courtIdx = getSuggestedLaneCourtIdx(lockedMatch)
    if (courtIdx === null) return
    setAvailablePoolPreviews(prev => new Map(prev).set(courtIdx, 'loading'))
    const snap = previewBodyRef.current
    const snapshotLiveStateVersion = Math.max(
      Number(snap.liveStateVersion ?? 0),
      Number(liveStateVersionRef.current ?? 0),
    )
    const snapshotCountableMatchCount = snap.effectiveLiveMatchRows.filter(match => match.status !== 'cancelled').length
    // Only completed matches — used for invalidation: a suggestion is stale when a completed match
    // has sequence_no >= this value. Must NOT include live matches (their sequence_no is lower than
    // the total count, so completed-check would never fire while they're still running).
    // Use max(completed_seq) + 1 instead of count to correctly handle cancelled matches
    // (a cancelled match at seq=8 would make count=11 equal to max_completed_seq=11, causing
    // immediate invalidation since 11 >= 11 = true).
    const snapshotCompletedMatchCount = snap.effectiveLiveMatchRows
      .filter(match => match.status === 'completed')
      .reduce((max, match) => Math.max(max, (match.sequence_no ?? -1) + 1), 0)
    previewRequestSerialRef.current += 1
    const availablePoolRequestId = createClientTraceId('preview-available-pool')
    telemetry.trace('client_available_pool_preview_start', {
      requestId: availablePoolRequestId,
      detail: {
        court_idx: courtIdx,
        live_state_version: snap.liveStateVersion,
      },
    })
    try {
      const res = await fetchLiveMatchesPreview(snap.sessionId, {
        mode: 'replace_courts',
        count: 1,
        court_count: snap.queueCourtCount,
        pvna_tolerance: snap.pvnaTolerance,
        court_idxs: [courtIdx],
        current_preview_board: [],
        live_match_rows: snap.effectiveLiveMatchRows.filter(
          m => !(m.status === 'suggested' && Number(m.court_idx ?? m.sequence_no) === courtIdx),
        ),
        live_state_version: snap.liveStateVersion,
        completing_live_match_ids: Array.from(snap.completingLiveMatchIds),
        players: Array.from(snap.playersById.entries()).map(([id, p]) => ({ id, name: p.name })),
        player_rows: snap.rows.playerRows,
        pair_rows: snap.rows.pairRows,
        round_rows: snap.rows.roundRows,
        planned_total_rounds: snap.plannedTargetRounds,
        court_preset: snap.courtPreset,
        current_courts: snap.queueCourtCount,
        avoid_pairs: snap.avoidPairs.length > 0 ? snap.avoidPairs : undefined,
        prefer_available_pool: true,
      }, {
        requestId: availablePoolRequestId,
      })
      const responsePayloads = Array.isArray(res.final_preview_board) && res.final_preview_board.length > 0
        ? res.final_preview_board
        : (res.payloads ?? [])
      const rawMatch = responsePayloads.find((m: any) => Number(m.court_idx ?? 0) === courtIdx)
      if (!rawMatch) {
        telemetry.trace('client_available_pool_preview_empty', {
          requestId: availablePoolRequestId,
          responsePayload: {
            payload_count: responsePayloads.length,
          },
          detail: {
            court_idx: courtIdx,
            live_state_version: snap.liveStateVersion,
          },
        })
        setAvailablePoolPreviews(prev => { const next = new Map(prev); next.delete(courtIdx); return next })
        return
      }
      const constrainedMatch: SuggestedLiveMatchRow = {
        ...rawMatch,
        id: `preview-${courtIdx}-now-${rawMatch.team_a.join('-')}-${rawMatch.team_b.join('-')}`,
        session_id: snap.sessionId,
        sequence_no: snapshotCountableMatchCount,
        round_no: rawMatch.round_no,
        court_idx: courtIdx,
        status: 'suggested',
        team_a: rawMatch.team_a,
        team_b: rawMatch.team_b,
        resting: rawMatch.resting ?? [],
        preview_live_state_version: snapshotLiveStateVersion,
        preview_countable_match_count: snapshotCompletedMatchCount,
        preview_source: 'manual_available_pool',
        preview_request_key: `available-pool:${courtIdx}`,
        score_a: 0,
        score_b: 0,
        suggested_at: new Date().toISOString(),
        started_at: null,
        ended_at: null,
        available_pool_only: true,
        locked_player_ids: undefined,
      }
      setAvailablePoolPreviews(prev => new Map(prev).set(courtIdx, constrainedMatch))
      telemetry.trace('client_available_pool_preview_ready', {
        requestId: availablePoolRequestId,
        responsePayload: {
          payload_count: responsePayloads.length,
          selected_court_idx: constrainedMatch.court_idx,
        },
        detail: {
          court_idx: courtIdx,
          live_state_version: snap.liveStateVersion,
        },
      })
    } catch (err) {
      setAvailablePoolPreviews(prev => { const next = new Map(prev); next.delete(courtIdx); return next })
      telemetry.trace('client_available_pool_preview_error', {
        requestId: availablePoolRequestId,
        detail: {
          court_idx: courtIdx,
          live_state_version: snap.liveStateVersion,
          error: err instanceof Error ? err.message : String(err ?? 'Unknown error'),
        },
      })
    }
  }

  const confirmStartNow = async (constrainedMatch: SuggestedLiveMatchRow) => {
    const courtIdx = getSuggestedLaneCourtIdx(constrainedMatch)
    if (courtIdx === null) return
    setAvailablePoolPreviews(prev => { const next = new Map(prev); next.delete(courtIdx); return next })
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current = new Map(suggestedLaneCacheRef.current)
    suggestedLaneCacheRef.current.set(courtIdx, constrainedMatch)
    setSuggestedLiveMatches(prev =>
      prev.map(m => Number(m.court_idx) === courtIdx ? constrainedMatch : m),
    )
    await startLiveMatch(constrainedMatch)
  }

  const cancelAvailablePool = (courtIdx: number) => {
    setAvailablePoolPreviews(prev => { const next = new Map(prev); next.delete(courtIdx); return next })
  }
  const completeLiveMatch = async (match: SessionLiveMatchRow, score: { a: number; b: number }) => {
    const completeT0 = nowMs()
    if (endingLiveMatchIdsRef.current.has(match.id)) return
    endingLiveMatchIdsRef.current.add(match.id)
    const pressedVersion = liveStateVersionRef.current
    if (__DEV__) console.log('[NextRoundSuggesterV2] complete live match press', {
      matchId: match.id,
      version: pressedVersion,
      courtIdx: match.court_idx,
      status: match.status,
    })
    setEndingLiveMatchIds(current => new Set(current).add(match.id))
    setCompletingLiveMatchIds(current => new Set(current).add(match.id))
    setCreatingNextMatchIds(current => new Set(current).add(match.id))
    setCompletingLiveMatchPlaceholders(current => {
      const next = new Map(current)
      next.set(match.id, match)
      return next
    })
    suggestedPreviewBatchRef.current = null
    const playerIds = [...match.team_a, ...match.team_b]
    const expectedPlayed = (state.players.get(match.team_a[0])?.matches_played ?? 0) + 1
    completingMatchExpectedPlayedRef.current.set(match.id, { playerIds, expectedPlayed })
    await waitForUiFrame()

    const executeComplete = async () => {
      const actionT0 = nowMs()

      // Projection is static across attempts (match + state don't change between retries).
      const projectT0 = nowMs()
      const projectedState = buildProjectedStateAfterLiveMatch(state, match)
      const projectMs = nowMs() - projectT0
      const targetT0 = nowMs()
      const projectedLiveMatchRows = effectiveLiveMatchRows.map(row => row.id === match.id
        ? { ...row, status: 'completed' as const, ended_at: new Date().toISOString() }
        : row)
      const targetReachedAfterMatch = hasReachedCompletedLiveCycleTarget({
        liveMatchRows: projectedLiveMatchRows,
        legacyRoundRows: rows.roundRows.filter(row => row.status !== 'active'),
        playerRows: rows.playerRows,
        sessionId,
        courtCount: queueCourtCount,
        targetRounds: typeof targetRounds === 'number' && targetRounds > 0 ? targetRounds : 0,
      })
      const targetMs = nowMs() - targetT0
      const fairnessT0 = nowMs()
      const projectedScore = computeSessionFairness(projectedState).total
      const fairnessMs = nowMs() - fairnessT0

      for (let attempt = 0; attempt <= 1; attempt++) {
        if (attempt > 0) {
          // Refetch latest snapshot and sync version synchronously from cache.
          await queryClient.refetchQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
          const cached = queryClient.getQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId))
          const fresh = Number(cached?.liveStateVersion ?? 0)
          if (Number.isFinite(fresh) && fresh > 0) {
            liveStateVersionRef.current = Math.max(liveStateVersionRef.current ?? 0, fresh)
          }
          // Idempotency guard: if already completed by a concurrent action, treat as success.
          const alreadyCompleted = cached?.liveMatchRows.find(
            row => row.id === match.id && row.status === 'completed',
          )
          if (alreadyCompleted) {
            applyCompletedLiveMatch(alreadyCompleted, [], [], cached?.liveStateVersion)
            completedLiveMatchCommitIdsRef.current.add(match.id)
            setCompletedLiveMatchCommitNonce(value => value + 1)
            setOptimisticLiveMatches(current => current.filter(row => row.id !== alreadyCompleted.id))
            if (__DEV__) console.log('[NextRoundSuggesterV2] complete match already committed (idempotency), aborting retry', { matchId: match.id })
            return { reload: false, reconcileAfterMs: 600, targetReachedAfterMatch }
          }
        }

        const expectedVersion = liveStateVersionRef.current
        if (expectedVersion === null) throw new Error('Session changed')

        const rpcT0 = nowMs()
        try {
          const payload = await completeMatchMutation.mutateAsync({
            rpcPayload: {
              p_session_id: sessionId,
              p_expected_live_state_version: expectedVersion,
              p_match_id: match.id,
              p_score_a: score.a,
              p_score_b: score.b,
              p_score_after: Math.round(projectedScore),
              p_audit_payload: {
                client_request_id: createClientRequestId('match'),
                sequence_no: match.sequence_no,
                expected_round_matches: queueCourtCount,
                source: 'client-direct-complete-live-match',
              },
            },
          })
          const rpcMs = nowMs() - rpcT0
          const nextVersion = Number(payload?.live_state_version)
          if (Number.isFinite(nextVersion)) {
            liveStateVersionRef.current = liveStateVersionRef.current === null
              ? nextVersion
              : Math.max(liveStateVersionRef.current, nextVersion)
          }
          if (__DEV__) console.log('[NextRoundSuggesterV2] complete live match committed', {
            matchId: match.id,
            status: payload?.match?.status,
            liveStateVersion: payload?.live_state_version,
            targetReachedAfterMatch,
            retried: attempt > 0,
            projectMs: Math.round(projectMs),
            fairnessMs: Math.round(fairnessMs),
            rpcMs: Math.round(rpcMs),
            sincePressMs: Math.round(nowMs() - completeT0),
          })
          const applyT0 = nowMs()
          const completedMatch = (payload.match ?? { ...match, status: 'completed', ended_at: new Date().toISOString() }) as SessionLiveMatchRow
          applyCompletedLiveMatch(
            completedMatch,
            payload.changed_player_state ?? [],
            payload.changed_pair_history ?? [],
            payload.live_state_version,
          )
          const applyMs = nowMs() - applyT0
          // Any in-flight preview was built from the pre-completion player/pair state.
          previewRequestSerialRef.current += 1
          previewRequestInFlightRef.current = false
          previewRequestInFlightSerialRef.current = null
          previewRetryTimeoutsRef.current.forEach(clearTimeout)
          previewRetryTimeoutsRef.current.clear()
          previewScheduledRetryKeysRef.current.clear()
          setIsSuggestingPreview(false)
          completedLiveMatchCommitIdsRef.current.add(match.id)
          setCompletedLiveMatchCommitNonce(value => value + 1)
          suggestedPreviewBatchRef.current = null
          setStartedPreviewIds(new Set())
          const freedPlayerIds = new Set([...completedMatch.team_a, ...completedMatch.team_b])
          setSuggestedLiveMatches(current => current.filter(m => {
            if (m.locked_player_ids?.some(id => freedPlayerIds.has(id))) return false
            // Drop a stale availability-context preview only on real imbalance (team-total gap
            // over tolerance) or explicit tradeoffs — never on intra alone, since a balanced-total
            // mixed-strength lane is a valid fill (see hasHardPreviewQualityViolation).
            if (m.live_availability_context != null && (
              getSuggestedMatchPvnaGap(m, state) > pvnaTolerance ||
              (m.tradeoffs?.length ?? 0) > 0
            )) return false
            return true
          }))
          setPreviewRefreshNonce(value => value + 1)
          if (__DEV__) console.log('[NextRoundSuggesterV2] complete live match timing', {
            matchId: match.id,
            courtIdx: match.court_idx,
            completedStatus: completedMatch.status,
            expectedVersion,
            nextVersion: payload.live_state_version,
            targetReachedAfterMatch,
            projectMs: Math.round(projectMs),
            fairnessMs: Math.round(fairnessMs),
            rpcMs: Math.round(rpcMs),
            applyMs: Math.round(applyMs),
            targetMs: Math.round(targetMs),
            actionMs: Math.round(nowMs() - actionT0),
            totalMs: Math.round(nowMs() - completeT0),
          })
          return {
            reload: false,
            reconcileAfterMs: 600,
            targetReachedAfterMatch,
          }
        } catch (err: unknown) {
          if (attempt === 0 && String((err as any)?.message ?? '').includes('Session changed')) {
            if (__DEV__) console.log('[NextRoundSuggesterV2] complete match Session changed, retrying', { matchId: match.id, expectedVersion })
            continue
          }
          throw err
        }
      }
      throw new Error('Session changed')
    }

    const queuedComplete = liveMatchMutationQueueRef.current
      .catch(() => undefined)
      .then(executeComplete)
    liveMatchMutationQueueRef.current = queuedComplete.then(() => undefined, () => undefined)

    try {
      const result = await queuedComplete
      endingLiveMatchIdsRef.current.delete(match.id)
      if (result?.reload !== false) {
        await loadLiveState()
      } else {
        scheduleReconcile(result)
      }
      setEndingLiveMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      if (result?.targetReachedAfterMatch) {
        setShowSessionReport(true)
        setCompletingLiveMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
        setCreatingNextMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
        setCompletingLiveMatchPlaceholders(current => {
          if (!current.has(match.id)) return current
          const next = new Map(current)
          next.delete(match.id)
          return next
        })
        return
      }
      const previousWatchdog = completingCleanupTimeoutsRef.current.get(match.id)
      if (previousWatchdog) clearTimeout(previousWatchdog)
      const cleanupId = setTimeout(() => {
        completingCleanupTimeoutsRef.current.delete(match.id)
        if (!completingLiveMatchPlaceholdersRef.current.has(match.id)) return
        previewBlockedIncompleteKeysRef.current.clear()
        suggestedPreviewBatchRef.current = null
        setCreatingNextMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
        setCompletingLiveMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
        setCompletingLiveMatchPlaceholders(current => {
          if (!current.has(match.id)) return current
          const next = new Map(current)
          next.delete(match.id)
          return next
        })
        setPreviewRefreshNonce(value => value + 1)
        void loadLiveState()
      }, 3000)
      completingCleanupTimeoutsRef.current.set(match.id, cleanupId)
    } catch (err: any) {
      endingLiveMatchIdsRef.current.delete(match.id)
      const watchdog = completingCleanupTimeoutsRef.current.get(match.id)
      if (watchdog) clearTimeout(watchdog)
      completingCleanupTimeoutsRef.current.delete(match.id)
      setEndingLiveMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      completingMatchExpectedPlayedRef.current.delete(match.id)
      setCreatingNextMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setCompletingLiveMatchPlaceholders(current => {
        if (!current.has(match.id)) return current
        const next = new Map(current)
        next.delete(match.id)
        return next
      })
      setCompletingLiveMatchIds(current => {
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setOptimisticLiveMatches(current => current.filter(row => row.id !== match.id))
      // Idempotency backstop: a dropped response (flaky mobile) or a second device can make
      // the RPC report 'Only live matches can be completed' even though the completion landed.
      // Reconcile from a fresh snapshot; if the match is now completed, treat it as success.
      const reconciledRows = await loadLiveState()
      if (completeAlreadyApplied(reconciledRows?.liveMatchRows ?? [], match.id)) {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] complete response failed but match was completed; reconciled', {
          matchId: match.id,
          error: err?.message ?? String(err),
        })
        return
      }
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] complete match failed', err)
      setError(safeMessage)
      Alert.alert('Lỗi', safeMessage)
    }
  }

  const cancelLiveMatch = async (match: SessionLiveMatchRow) => {
    const cancelT0 = nowMs()
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current.clear()
    setStartedPreviewIds(new Set())
    setPreviewRefreshNonce(value => value + 1)
    await runAction(`cancel-match-${match.id}`, async () => {
      const expectedVersion = liveStateVersionRef.current
      if (expectedVersion === null) throw new Error('Session changed')
      const rpcT0 = nowMs()
      const { data: payload, error: rpcError } = await supabase.rpc('cancel_live_session_match_versioned', {
        p_session_id: sessionId,
        p_expected_live_state_version: expectedVersion,
        p_match_id: match.id,
        p_audit_payload: {
          client_request_id: createClientRequestId('match'),
          sequence_no: match.sequence_no,
          source: 'client-direct-cancel-live-match',
        },
      })
      if (rpcError) throw rpcError
      const applyT0 = nowMs()
      applyLiveMatches(payload.match ? [payload.match] : [], payload.live_state_version)
      const applyMs = nowMs() - applyT0
      if (__DEV__) console.log('[NextRoundSuggesterV2] cancel live match timing', {
        matchId: match.id,
        expectedVersion,
        nextVersion: payload?.live_state_version,
        rpcMs: Math.round(nowMs() - rpcT0),
        applyMs: Math.round(applyMs),
        totalMs: Math.round(nowMs() - cancelT0),
      })
      return {
        reload: false,
        reconcileAfterMs: 600,
      }
    }, { alreadyAppliedOnError: (rows: any) => cancelAlreadyApplied(rows?.liveMatchRows ?? [], match.id) })
  }
  const swapPlayersInSuggestedLiveMatch = (fromId: string, toId: string) => {
    if (!suggestedSwapMatch || fromId === toId) return
    const nextMatch = swapPlayersInSuggestedMatch(suggestedSwapMatch, fromId, toId)
    setSuggestedLiveMatches(current => current.map(match => match.id === nextMatch.id ? nextMatch : match))
    if (suggestedPreviewBatchRef.current) {
      suggestedPreviewBatchRef.current = {
        ...suggestedPreviewBatchRef.current,
        matches: suggestedPreviewBatchRef.current.matches.map(match => match.id === nextMatch.id ? nextMatch : match),
      }
    }
    const courtIdx = getSuggestedLaneCourtIdx(nextMatch)
    if (courtIdx !== null) suggestedLaneCacheRef.current.set(courtIdx, nextMatch)
    setSuggestedSwapMatch(null)
    setSwapFromPlayerId(null)
    setSheet(null)
  }
  const effectiveLiveMatchRows = useMemo(() => {
    const byId = new Map<string, LiveDisplayMatchRow>()
    for (const match of rows.liveMatchRows) {
      byId.set(match.id, {
        ...match,
        client_preview_id: liveMatchDisplayKeys[match.id],
      })
    }
    for (const match of optimisticLiveMatches) {
      if (!byId.has(match.id)) byId.set(match.id, match)
    }
    return [...byId.values()].sort((left, right) =>
      (left.court_idx ?? left.sequence_no) - (right.court_idx ?? right.sequence_no)
    )
  }, [liveMatchDisplayKeys, optimisticLiveMatches, rows.liveMatchRows])
  const activeLiveMatches = useMemo(
    () => {
      const matches = effectiveLiveMatchRows.filter(match =>
        match.status === 'live' || completingLiveMatchIds.has(match.id) || creatingNextMatchIds.has(match.id)
      )
      const byId = new Map(matches.map(match => [match.id, match]))
      completingLiveMatchPlaceholders.forEach((match, id) => {
        byId.set(id, match)
      })
      return [...byId.values()]
    },
    [completingLiveMatchIds, completingLiveMatchPlaceholders, creatingNextMatchIds, effectiveLiveMatchRows],
  )

  const capacityOccupyingLiveMatchCount = useMemo(
    () => {
      const effectiveCourtCount = Math.max(1, Math.floor(courtCount || 1))
      return effectiveLiveMatchRows.filter(match => {
        if (match.status !== 'live' || completedLiveMatchCommitIdsRef.current.has(match.id)) return false
        const courtIdx = match.court_idx != null ? Number(match.court_idx) : null
        // Only count matches within the active court range. Out-of-range live courts
        // (from a prior larger-court round) don't occupy a slot in the current round.
        return courtIdx === null || courtIdx < effectiveCourtCount
      }).length
    },
    [completedLiveMatchCommitNonce, courtCount, effectiveLiveMatchRows],
  )
  const completedLiveMatches = useMemo(
    () => effectiveLiveMatchRows.filter(match => match.status === 'completed'),
    [effectiveLiveMatchRows],
  )
  const isPreviewInvalidatedByCompletedMatch = useCallback((match: SuggestedLiveMatchRow) => {
    const previewCountableMatchCount = Number(match.preview_countable_match_count ?? -1)
    if (!Number.isFinite(previewCountableMatchCount) || previewCountableMatchCount < 0) return true
    const previewMaxSeqNo = typeof match.preview_max_sequence_no === 'number' ? match.preview_max_sequence_no : null
    return effectiveLiveMatchRows
      .filter(row => row.status !== 'cancelled')
      .some(row => row.status === 'completed' && (
        previewMaxSeqNo !== null
          ? row.sequence_no > previewMaxSeqNo
          : row.sequence_no >= previewCountableMatchCount
      ))
  }, [effectiveLiveMatchRows])
  const busyLiveMatchPlayerIds = useMemo(() => new Set(
    effectiveLiveMatchRows
      .filter(match => match.status === 'live')
      .flatMap(match => [...match.team_a, ...match.team_b]),
  ), [effectiveLiveMatchRows])
  const [suggestedLiveMatches, setSuggestedLiveMatches] = useState<SuggestedLiveMatchRow[]>([])
  // Mirrors suggestedLiveMatches synchronously every render (assigned here, not in
  // an effect) so effects can read the latest committed value without adding
  // suggestedLiveMatches to their dependency array — see previewBodyRef for the
  // same pattern elsewhere in this hook.
  const suggestedLiveMatchesRef = useRef(suggestedLiveMatches)
  suggestedLiveMatchesRef.current = suggestedLiveMatches
  const [edgeDebug, setEdgeDebug] = useState<any>(null)
  const queueCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const suggestedQueueCount = getSuggestedPreviewQueueCount({
    courtCount: queueCourtCount,
    capacityOccupyingMatchCount: capacityOccupyingLiveMatchCount,
  })
  const persistedSuggestedMatchIds = useMemo(() => new Set(
    rows.liveMatchRows
      .filter(match => match.status === 'suggested')
      .map(match => match.id),
  ), [rows.liveMatchRows])
  const isPersistedSuggestedMatch = useCallback((match: Pick<SessionLiveMatchRow, 'id'>) =>
    persistedSuggestedMatchIds.has(match.id), [persistedSuggestedMatchIds])
  const getReusableSuggestedLaneMatches = useCallback(() => {
    const occupiedCourts = new Set<number>()
    const usedPlayerIds = new Set<string>()
    for (const match of activeLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) occupiedCourts.add(courtIdx)
      getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
    }

    const reusable: SuggestedLiveMatchRow[] = []
    const nextCache = new Map<number, SuggestedLiveMatchRow>()
    const reusableCandidates = mergePreviewLaneCandidates<SuggestedLiveMatchRow>({
      cachedMatches: suggestedLaneCacheRef.current,
      visibleMatches: suggestedLiveMatches,
      persistedMatches: rows.liveMatchRows
        .filter(match => match.status === 'suggested') as SuggestedLiveMatchRow[],
    })
    const cachedMatches = [...reusableCandidates.entries()]
      .sort(([leftCourt], [rightCourt]) => leftCourt - rightCourt)

    for (const [courtIdx, match] of cachedMatches) {
      if (reusable.length >= suggestedQueueCount) break
      if (match.status !== 'suggested') continue
      if (startedPreviewIds.has(match.id) || startingPreviewIds.has(match.id) || startingPreviewIdsRef.current.has(match.id)) continue
      if (!Number.isFinite(courtIdx) || courtIdx < 0 || courtIdx >= queueCourtCount) continue
      if (occupiedCourts.has(courtIdx)) continue
      const isPersisted = isPersistedSuggestedMatch(match)
      if (!isPersisted && (match.preview_live_state_version == null || match.preview_countable_match_count == null)) continue
      if (!isPersisted && isPreviewInvalidatedByCompletedMatch(match)) continue
      if (!isPersisted && !match.available_pool_only && hasHardPreviewQualityViolation(match, state, pvnaTolerance)) continue

      const playerIds = getMatchPlayerIds(match)
      if (playerIds.some(playerId => usedPlayerIds.has(playerId))) continue

      playerIds.forEach(playerId => usedPlayerIds.add(playerId))
      reusable.push(match)
      nextCache.set(courtIdx, match)
    }

    suggestedLaneCacheRef.current = nextCache
    return reusable
  }, [activeLiveMatches, isPersistedSuggestedMatch, isPreviewInvalidatedByCompletedMatch, pvnaTolerance, queueCourtCount, rows.liveMatchRows, startedPreviewIds, startingPreviewIds, state, suggestedLiveMatches, suggestedQueueCount])
  const getCurrentPreviewBoardForEdge = useCallback(() => {
    const occupiedCourts = new Set<number>()
    const usedPlayerIds = new Set<string>()
    for (const match of activeLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) occupiedCourts.add(courtIdx)
      getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
    }

    const candidates = mergePreviewLaneCandidates<SuggestedLiveMatchRow>({
      cachedMatches: suggestedLaneCacheRef.current,
      visibleMatches: suggestedLiveMatches,
      persistedMatches: rows.liveMatchRows
        .filter(match => match.status === 'suggested') as SuggestedLiveMatchRow[],
    })

    const board: SuggestedLiveMatchRow[] = []
    for (const [courtIdx, match] of [...candidates.entries()].sort(([left], [right]) => left - right)) {
      if (match.status !== 'suggested') continue
      if (startedPreviewIds.has(match.id) || startingPreviewIds.has(match.id) || startingPreviewIdsRef.current.has(match.id)) continue
      if (!Number.isFinite(courtIdx) || courtIdx < 0 || courtIdx >= queueCourtCount) continue
      if (occupiedCourts.has(courtIdx)) continue
      const playerIds = getMatchPlayerIds(match)
      if (playerIds.some(playerId => usedPlayerIds.has(playerId))) continue
      playerIds.forEach(playerId => usedPlayerIds.add(playerId))
      board.push(match)
    }
    return board
  }, [activeLiveMatches, queueCourtCount, rows.liveMatchRows, startedPreviewIds, startingPreviewIds, suggestedLiveMatches])
  useEffect(() => {
    if (phase !== 'plan' || !settingsHydrated) return

    const occupiedCourts = new Set<number>()
    const usedPlayerIds = new Set<string>()
    for (const match of activeLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) occupiedCourts.add(courtIdx)
      getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
    }

    const hydrated: SuggestedLiveMatchRow[] = []
    const nextLaneCache = new Map<number, SuggestedLiveMatchRow>()
    const dbSuggestedMatches = rows.liveMatchRows
      .filter(match => match.status === 'suggested')
      .sort((left, right) => {
        const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
        const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
        return leftCourtIdx - rightCourtIdx
      })
    const fallbackPreviewLiveStateVersion = rows.liveStateVersion ?? liveStateVersionRef.current
    const fallbackPreviewCountableMatchCount = effectiveLiveMatchRows
      .filter(match => match.status === 'completed')
      .reduce((max, match) => Math.max(max, (match.sequence_no ?? -1) + 1), 0)

    for (const match of dbSuggestedMatches) {
      const suggestedMatch = match as SuggestedLiveMatchRow
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx === null || courtIdx < 0 || courtIdx >= queueCourtCount) continue
      if (occupiedCourts.has(courtIdx)) continue
      // Keep an in-flight start visible so SuggestedLiveMatchCard can own the
      // transition and show its "starting" spinner until the live row arrives.
      if (startedPreviewIds.has(match.id)) continue
      const hasPreviewStalenessMetadata = suggestedMatch.preview_live_state_version != null
        && suggestedMatch.preview_countable_match_count != null
      if (!isPersistedSuggestedMatch(suggestedMatch) && hasPreviewStalenessMetadata && isPreviewInvalidatedByCompletedMatch(suggestedMatch)) continue

      const playerIds = getMatchPlayerIds(match)
      if (playerIds.some(playerId => usedPlayerIds.has(playerId))) continue
      playerIds.forEach(playerId => usedPlayerIds.add(playerId))

      const hydratedMatch: SuggestedLiveMatchRow = {
        ...suggestedMatch,
        preview_source: suggestedMatch.preview_source ?? 'edge_committed',
        preview_live_state_version: suggestedMatch.preview_live_state_version ?? fallbackPreviewLiveStateVersion,
        preview_countable_match_count: suggestedMatch.preview_countable_match_count ?? fallbackPreviewCountableMatchCount,
      }
      hydrated.push(hydratedMatch)
      nextLaneCache.set(courtIdx, hydratedMatch)
    }

    if (hydrated.length === 0) return

    const laneKeyOf = (match: SuggestedLiveMatchRow) =>
      `${match.id}:${getSuggestedLaneCourtIdx(match) ?? ''}`
    const sortByCourtIdx = (left: SuggestedLiveMatchRow, right: SuggestedLiveMatchRow) =>
      (getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER)
      - (getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER)

    // Merge, don't replace: keep fresh ephemeral (edge_committed) lanes for
    // courts the DB-suggested rebuild doesn't cover, so a mini-recover refill
    // for a just-vacated court survives this effect re-firing. Apply the same
    // guards the hydrate path uses (occupied / out-of-range / started /
    // stale-vs-completed / player-collision) so a stale or overlapping
    // suggestion is never resurfaced. Read the previous value via
    // suggestedLiveMatchesRef (synced every render, see its declaration) rather
    // than the setState updater, so the merge computation and the
    // suggestedLaneCacheRef sync stay plain, side-effect-free steps outside of
    // React's state updater — setSuggestedLiveMatches is only called with the
    // final, already-computed array.
    const current = suggestedLiveMatchesRef.current
    const mergedLaneCache = new Map(nextLaneCache)
    const mergedUsedPlayerIds = new Set(usedPlayerIds)
    const retainedEphemeral: SuggestedLiveMatchRow[] = []
    for (const match of current) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx === null || courtIdx < 0 || courtIdx >= queueCourtCount) continue
      if (occupiedCourts.has(courtIdx)) continue
      if (mergedLaneCache.has(courtIdx)) continue
      if (isPersistedSuggestedMatch(match)) continue
      if (startedPreviewIds.has(match.id)) continue
      if (isPreviewInvalidatedByCompletedMatch(match)) continue
      const playerIds = getMatchPlayerIds(match)
      if (playerIds.some(playerId => mergedUsedPlayerIds.has(playerId))) continue
      playerIds.forEach(playerId => mergedUsedPlayerIds.add(playerId))
      retainedEphemeral.push(match)
      mergedLaneCache.set(courtIdx, match)
    }
    // Keep suggestedLaneCacheRef in sync with the merged result (unconditionally,
    // even when the visible array below turns out unchanged) so the preview
    // effect doesn't treat the lane as missing.
    suggestedLaneCacheRef.current = mergedLaneCache

    const merged = [...hydrated, ...retainedEphemeral].sort(sortByCourtIdx)
    const currentKey = [...current].sort(sortByCourtIdx).map(laneKeyOf).join('|')
    const mergedKey = merged.map(laneKeyOf).join('|')
    if (currentKey !== mergedKey) setSuggestedLiveMatches(merged)
  }, [
    activeLiveMatches,
    effectiveLiveMatchRows,
    isPersistedSuggestedMatch,
    isPreviewInvalidatedByCompletedMatch,
    phase,
    pvnaTolerance,
    queueCourtCount,
    rows.liveMatchRows,
    rows.liveStateVersion,
    settingsHydrated,
    startedPreviewIds,
    startingPreviewIds,
    state,
  ])
  const previewPolicyFingerprint = useMemo(() => buildPreviewPolicyFingerprint({
    courtCount: queueCourtCount,
    pvnaTolerance,
    plannedTotalRounds: effectiveTargetRounds,
    courtPreset,
    avoidPairs,
  }), [avoidPairs, courtPreset, effectiveTargetRounds, pvnaTolerance, queueCourtCount])
  const previewBatchKey = useMemo(
    () => buildPreviewBatchKey(sessionId, state, queueCourtCount, pvnaTolerance, fairnessAdjustment, 'current', previewPolicyFingerprint),
    [fairnessAdjustment, previewPolicyFingerprint, pvnaTolerance, queueCourtCount, sessionId, state],
  )
  const previewLaneCacheKey = useMemo(() => {
    const playerKey = rows.playerRows
      .map(row => {
        const player = playersById.get(String(row.player_id))
        return [
          row.player_id,
          row.group_id ?? '',
          row.checked_out_at ? 'out' : 'in',
          row.opted_rest ? 'rest' : 'play',
          row.players?.pvna ?? getPlayerPvna(player) ?? '',
          row.players?.gender ?? player?.gender ?? '',
          row.players?.partner_gender_pref ?? player?.metadata?.partner_gender_pref ?? '',
          row.players?.opponent_gender_pref ?? player?.metadata?.opponent_gender_pref ?? '',
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
      previewPolicyFingerprint,
      state.status,
      queueCourtCount,
      pvnaTolerance,
      state.config.pvna_tolerance,
      JSON.stringify(state.config.weights),
      fairnessAdjustment.applied_for_warnings.map(String).sort().join(','),
      tierKey,
      playerKey,
    ].join('||')
  }, [fairnessAdjustment, playersById, previewPolicyFingerprint, pvnaTolerance, queueCourtCount, rows.playerRows, sessionId, state.config.pvna_tolerance, state.config.weights, state.status])
  React.useEffect(() => {
    if (previewBaseKeyRef.current === null) {
      previewBaseKeyRef.current = previewLaneCacheKey
      return
    }
    if (previewBaseKeyRef.current === previewLaneCacheKey) return
    previewBaseKeyRef.current = previewLaneCacheKey
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current.clear()
  }, [previewLaneCacheKey])
  const previewRequestKey = useMemo(() => {
    const rowVersionKey = [
      rows.playerRows.length,
      rows.pairRows.length,
      rows.roundRows.length,
      rows.liveStateVersion ?? 'noversion',
    ].join(':')
    const liveRowsKey = effectiveLiveMatchRows
      .map(match => `${match.id}:${match.status}:${match.court_idx ?? ''}:${match.sequence_no}`)
      .join(',')
    return [
      previewBatchKey,
      rowVersionKey,
      liveRowsKey,
      previewRefreshNonce,
    ].join('||')
  }, [
    effectiveLiveMatchRows,
    previewBatchKey,
    previewRefreshNonce,
    rows.liveStateVersion,
    rows.pairRows.length,
    rows.playerRows.length,
    rows.roundRows.length,
  ])
  const previewBodyRef = useRef({
    effectiveLiveMatchRows,
    liveStateVersion: rows.liveStateVersion,
    completingLiveMatchIds,
    playersById,
    rows,
    queueCourtCount,
    pvnaTolerance,
    suggestedQueueCount,
    sessionId,
    avoidPairs,
    effectiveTargetRounds,
    plannedTargetRounds: undefined as number | undefined,
    courtPreset,
  })
  // planned_total_rounds sent to the edge must be the host's EXPLICIT target only. The
  // duration-based recommendation (effectiveTargetRounds' fallback) is advisory; sending it
  // as a hard target makes the edge return should_end once completed rounds reach it, which
  // yields zero suggestions (empty lanes stay stuck) and re-pops the session report every
  // cycle even though the host chose to keep playing.
  const plannedTargetRounds = typeof targetRounds === 'number' && targetRounds > 0 ? targetRounds : undefined
  previewBodyRef.current = { effectiveLiveMatchRows, liveStateVersion: rows.liveStateVersion, completingLiveMatchIds, playersById, rows, queueCourtCount, pvnaTolerance, suggestedQueueCount, sessionId, avoidPairs, effectiveTargetRounds, plannedTargetRounds, courtPreset }
  useEffect(() => {
    const previewReady = phase === 'plan'
      && settingsHydrated
      && rows.playerRows.length > 0

    if (!previewReady) {
      setSuggestedLiveMatches(current => current.length === 0 ? current : [])
      suggestedPreviewBatchRef.current = null
      suggestedLaneCacheRef.current.clear()
      return
    }

    if (previewRequestInFlightRef.current) return

    const pendingPlanAdoption = hasPendingPlanAdoption(effectiveLiveMatchRows)
    if (pendingPlanAdoption) {
      suggestedPreviewBatchRef.current = null
      suggestedLaneCacheRef.current.clear()
    }

    let cachedBatch = suggestedPreviewBatchRef.current
    if (cachedBatch !== null && !isPreviewBatchCacheCurrent(cachedBatch.key, previewLaneCacheKey)) {
      suggestedPreviewBatchRef.current = null
      suggestedLaneCacheRef.current.clear()
      cachedBatch = null
    }
    if (cachedBatch && isPreviewBatchCacheCurrent(cachedBatch.key, previewLaneCacheKey)) {
      const reusableCachedMatches = cachedBatch.matches
        .filter((match: SuggestedLiveMatchRow) => !startedPreviewIds.has(match.id))
        .filter((match: SuggestedLiveMatchRow) => isPersistedSuggestedMatch(match) || !isPreviewInvalidatedByCompletedMatch(match))
      const newMatches = reusableCachedMatches
        .filter((match: SuggestedLiveMatchRow) =>
          isPersistedSuggestedMatch(match)
          || match.available_pool_only
          || !hasHardPreviewQualityViolation(match, state, pvnaTolerance)
        )
        .slice(0, suggestedQueueCount)
      if (newMatches.length < Math.min(reusableCachedMatches.length, suggestedQueueCount)) {
        suggestedPreviewBatchRef.current = null
        suggestedLaneCacheRef.current.clear()
      } else if (newMatches.length === 0 && cachedBatch.matches.length > 0) {
        suggestedPreviewBatchRef.current = null
        suggestedLaneCacheRef.current.clear()
      } else {
        setSuggestedLiveMatches(prev => {
          if (prev.length === newMatches.length && prev.every((m, i) => m.id === newMatches[i].id)) return prev
          return newMatches
        })
        return
      }
    }

    if (suggestedQueueCount === 0) {
      setSuggestedLiveMatches(current => current.length === 0 ? current : [])
      suggestedPreviewBatchRef.current = null
      suggestedLaneCacheRef.current.clear()
      return
    }

    const waitingForCompletionCommit = [...completingLiveMatchPlaceholdersRef.current.keys()].some(matchId =>
      !completedLiveMatchCommitIdsRef.current.has(matchId)
      && effectiveLiveMatchRows.some(match => match.id === matchId && match.status === 'live')
    )
    if (waitingForCompletionCommit) return

    const currentPreviewBoardForEdge = getCurrentPreviewBoardForEdge()
    // Capture the visible board before reusable filtering clears previews made stale
    // by the just-completed match. Edge revalidates and restamps retained lanes.
    const reusableMatches = getReusableSuggestedLaneMatches()
    const assignedPreviewPlayerIds = new Set([
      ...activeLiveMatches.flatMap(match => getMatchPlayerIds(match)),
      ...currentPreviewBoardForEdge.flatMap(match => getMatchPlayerIds(match)),
    ])
    const hasRestPriorityMiss = completedLiveMatches.length > 0 && hasMissingRestPriorityPlayer({
      players: [...state.players.values()].map(player => ({
        player_id: player.player_id,
        consecutive_rest: player.consecutive_rest,
        opted_rest: player.opted_rest,
        checked_out_at: player.checked_out_at,
        pvna: player.pvna ?? 0,
      })),
      assignedPlayerIds: assignedPreviewPlayerIds,
      pvnaTolerance,
    })
    // A PERSISTED (committed) suggestion is a startable board slot the host already has.
    // Its intra-team gap can be structurally unavoidable in a wide-PVNA pool (balancing
    // team totals forces a high+low pairing), so treating it as a "hard violation" would
    // escalate every cycle into a full-board re-suggest that can never converge to an
    // all-clean board — the client then thrashes (retry → block → unblock) and leaves open
    // courts (e.g. the last empty lane) unfilled. Only fresh, not-yet-committed previews
    // (and a genuine rest-priority miss) should force a full-board re-suggest; committed
    // courts are left as-is and missing courts are filled independently via mini-recover.
    const hasGenuinePreviewQualityViolation = computeHasGenuinePreviewQualityViolation({
      previewBoard: currentPreviewBoardForEdge,
      persistedSuggestedMatchIds,
      state,
      pvnaTolerance,
    })
    const hasHardReusableQualityViolation = hasRestPriorityMiss || hasGenuinePreviewQualityViolation
    // When getCurrentPreviewBoardForEdge returns [] (e.g. live-player filter drops all courts),
    // fall back to suggestedLiveMatches so already-suggested courts are still treated as present.
    const effectivePreviewBoard = currentPreviewBoardForEdge.length > 0
      ? currentPreviewBoardForEdge
      : suggestedLiveMatches
          .filter(m => !startedPreviewIds.has(m.id) && !startingPreviewIds.has(m.id) && !startingPreviewIdsRef.current.has(m.id))
          .filter(m => {
            const courtIdx = getSuggestedLaneCourtIdx(m)
            return courtIdx !== null && courtIdx >= 0 && courtIdx < queueCourtCount
          })
    const pendingReplacementCourts = new Set<number>()
    completingLiveMatchPlaceholdersRef.current.forEach(match => {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) pendingReplacementCourts.add(courtIdx)
    })
    const reusableCourts = new Set(reusableMatches.map(match => getSuggestedLaneCourtIdx(match)).filter((courtIdx): courtIdx is number => courtIdx !== null))
    const missingReplacementCourt = [...pendingReplacementCourts].some(courtIdx => !reusableCourts.has(courtIdx))
    const missingPreviewCourtIdxsForRecovery = getMissingPreviewCourtIdxs({
      courtCount: queueCourtCount,
      liveMatches: activeLiveMatches,
      previewMatches: effectivePreviewBoard,
    })
    // A rest-priority miss only forces a full-board re-optimization when the board is already full.
    // If a lane is empty, mini-recover fills it from the unassigned pool — which seats the very
    // rest-priority players that are "missing" — so blocking recovery / forcing a full-board
    // re-suggest there just leaves the lane stuck (the recover that would resolve the miss is
    // exactly what gets blocked). Genuine bad-match violations still force a full re-suggest.
    const restMissForcesFullBoard = shouldRestMissForceFullBoard({
      hasRestPriorityMiss,
      missingPreviewCourtIdxsForRecoveryCount: missingPreviewCourtIdxsForRecovery.length,
    })
    const shouldRecoverMissingPreviewCourts = canRecoverMissingPreviewCourts({
      hasGenuinePreviewQualityViolation,
      missingPreviewCourtIdxsForRecoveryCount: missingPreviewCourtIdxsForRecovery.length,
      reusableMatchCount: reusableMatches.length,
      suggestedQueueCount,
    })
    const hardPreviewQualityCourtIdxs = (hasGenuinePreviewQualityViolation || restMissForcesFullBoard)
      ? currentPreviewBoardForEdge
          .filter(match => restMissForcesFullBoard
            || (!isPersistedSuggestedMatch(match) && hasHardPreviewQualityViolation(match, state, pvnaTolerance)))
          .map(match => getSuggestedLaneCourtIdx(match))
          .filter((courtIdx): courtIdx is number => courtIdx !== null)
      : []
    const queuedPreviewCourtIdxs = [
      ...pendingReplacementCourts,
      ...missingPreviewCourtIdxsForRecovery,
      ...hardPreviewQualityCourtIdxs,
    ].filter((courtIdx, index, courtIdxs) =>
      courtIdx >= 0
      && courtIdx < queueCourtCount
      && courtIdxs.indexOf(courtIdx) === index
    )
    if (!pendingPlanAdoption && !hasHardReusableQualityViolation && !missingReplacementCourt && reusableMatches.length >= suggestedQueueCount) {
      const newMatches = reusableMatches.slice(0, suggestedQueueCount)
      suggestedPreviewBatchRef.current = { key: previewLaneCacheKey, matches: newMatches }
      setSuggestedLiveMatches(prev => {
        if (prev.length === newMatches.length && prev.every((m, i) => m.id === newMatches[i].id)) return prev
        return newMatches
      })
      return
    }
    // If any visible suggestion was invalidated by a just-completed match, remove it
    // from the UI before firing the edge call so the user can't tap a stale match
    // during re-fetch. The state update triggers a re-run that starts the edge call.
    const invalidatedBoardMatches = currentPreviewBoardForEdge.filter(
      match => !isPersistedSuggestedMatch(match) && isPreviewInvalidatedByCompletedMatch(match)
    )
    if (invalidatedBoardMatches.length > 0) {
      const invalidatedIds = new Set(invalidatedBoardMatches.map(m => m.id))
      setSuggestedLiveMatches(prev => prev.filter(m => !invalidatedIds.has(m.id)))
      suggestedPreviewBatchRef.current = null
      return
    }
    const shouldRequestFullBoardPreview = computeShouldRequestFullBoardPreview({
      pendingPlanAdoption,
      hasGenuinePreviewQualityViolation,
      restMissForcesFullBoard,
      reusableMatchCount: reusableMatches.length,
      shouldRecoverMissingPreviewCourts,
      missingPreviewCourtIdxsForRecoveryCount: missingPreviewCourtIdxsForRecovery.length,
      replacementMaxCount: LIVE_PREVIEW_REPLACEMENT_MAX_COUNT,
    })
    const previewEdgeMaxCount = shouldRequestFullBoardPreview
      ? LIVE_PREVIEW_FULL_BOARD_MAX_COUNT
      : LIVE_PREVIEW_REPLACEMENT_MAX_COUNT
    const fetchSuggestedCount = Math.max(
      1,
      Math.min(
        suggestedQueueCount,
        previewEdgeMaxCount,
        shouldRequestFullBoardPreview
          ? suggestedQueueCount
          : queuedPreviewCourtIdxs.length > 0
            ? queuedPreviewCourtIdxs.length
            : 1,
      ),
    )
    const incompleteRequestKey = [
      previewBatchKey,
      previewUnblockNonceRef.current,
      rows.liveStateVersion ?? 'noversion',
      suggestedQueueCount,
      [...pendingReplacementCourts].sort((left, right) => left - right).join(','),
      missingPreviewCourtIdxsForRecovery.join(','),
      hardPreviewQualityCourtIdxs.join(','),
      shouldRequestFullBoardPreview ? 'full-board' : shouldRecoverMissingPreviewCourts ? 'mini-recover' : 'batch',
      reusableMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
      effectiveLiveMatchRows.map(match => `${match.id}:${match.status}:${match.court_idx ?? ''}`).join(','),
    ].join('||')
    const incompleteTraceKey = compactTraceKey(incompleteRequestKey)
    const previewTraceKey = compactTraceKey(previewRequestKey)
    if (previewBlockedIncompleteKeysRef.current.has(incompleteRequestKey)) {
      const blockedRequestId = createClientTraceId('preview-blocked')
      telemetry.trace('client_preview_blocked_before_request', {
        requestId: blockedRequestId,
        detail: {
          incomplete_request_key: incompleteTraceKey,
          incomplete_request_key_bytes: incompleteRequestKey.length,
          missing_courts: missingPreviewCourtIdxsForRecovery,
          effective_preview_courts: effectivePreviewBoard.map(m => getSuggestedLaneCourtIdx(m)),
          suggested_queue_count: suggestedQueueCount,
          live_state_version: rows.liveStateVersion,
        },
      })
      if (__DEV__) console.log('[NextRoundSuggesterV2] preview blocked — edge could not fill courts after retries', {
        missingCourts: missingPreviewCourtIdxsForRecovery,
        effectivePreviewCourts: effectivePreviewBoard.map(m => getSuggestedLaneCourtIdx(m)),
        suggestedQueueCount,
      })
      return
    }
    if (previewPendingRequestKeysRef.current.has(incompleteRequestKey)) {
      const pendingRequestId = createClientTraceId('preview-pending')
      telemetry.trace('client_preview_pending_skip', {
        requestId: pendingRequestId,
        detail: {
          incomplete_request_key: incompleteTraceKey,
          incomplete_request_key_bytes: incompleteRequestKey.length,
          live_state_version: rows.liveStateVersion,
          suggested_queue_count: suggestedQueueCount,
        },
      })
      return
    }
    previewPendingRequestKeysRef.current.add(incompleteRequestKey)
    let cancelledBeforeStart = false
    let requestStarted = false
    let previewAbortController: AbortController | null = null
    let previewAbortReason: 'soft_timeout' | 'cleanup' | null = null
    const previewClientRequestId = createClientTraceId('preview')
    const requestSerial = previewRequestSerialRef.current + 1
    previewRequestSerialRef.current = requestSerial
    const requestSessionGeneration = sessionGenerationRef.current
    const isCurrentPreviewRequest = () =>
      previewRequestSerialRef.current === requestSerial
      && sessionGenerationRef.current === requestSessionGeneration
    previewRequestInFlightRef.current = true
    previewRequestInFlightSerialRef.current = requestSerial
    markNextRoundStage(sessionId, 'preview_request_scheduled', {
      suggested_queue_count: fetchSuggestedCount,
      live_state_version: rows.liveStateVersion,
    })
    telemetry.trace('client_preview_request_scheduled', {
      requestId: previewClientRequestId,
      detail: {
        incomplete_request_key: incompleteTraceKey,
        incomplete_request_key_bytes: incompleteRequestKey.length,
        preview_request_key: previewTraceKey,
        preview_request_key_bytes: previewRequestKey.length,
        preview_policy_fingerprint: previewPolicyFingerprint,
        request_serial: requestSerial,
        suggested_queue_count: fetchSuggestedCount,
        target_suggested_queue_count: suggestedQueueCount,
        full_board_request: shouldRequestFullBoardPreview,
        live_state_version: rows.liveStateVersion,
      },
    })

    const previewT0 = nowMs()
    const schedulePreviewRetry = (retryKey: string, delayMs: number, retry: () => void) => {
      if (previewScheduledRetryKeysRef.current.has(retryKey)) return false
      previewScheduledRetryKeysRef.current.add(retryKey)
      const retryTimeout = setTimeout(() => {
        previewRetryTimeoutsRef.current.delete(retryTimeout)
        previewScheduledRetryKeysRef.current.delete(retryKey)
        if (sessionGenerationRef.current !== requestSessionGeneration) return
        retry()
      }, delayMs)
      previewRetryTimeoutsRef.current.add(retryTimeout)
      return true
    }
    const timer = setTimeout(() => {
      if (cancelledBeforeStart || !isCurrentPreviewRequest()) return
      requestStarted = true
      setIsSuggestingPreview(true)
      markNextRoundStage(sessionId, 'preview_request_start', {
        suggested_queue_count: fetchSuggestedCount,
        live_state_version: rows.liveStateVersion,
      })
      telemetry.trace('client_preview_request_start', {
        requestId: previewClientRequestId,
        detail: {
          incomplete_request_key: incompleteTraceKey,
          incomplete_request_key_bytes: incompleteRequestKey.length,
          request_serial: requestSerial,
          suggested_queue_count: fetchSuggestedCount,
          target_suggested_queue_count: suggestedQueueCount,
          full_board_request: shouldRequestFullBoardPreview,
          live_state_version: rows.liveStateVersion,
        },
      })
      if (__DEV__) console.log('[NextRoundSuggesterV2] preview fetch start', {
        suggestedQueueCount: fetchSuggestedCount,
        targetSuggestedQueueCount: suggestedQueueCount,
        fullBoardRequest: shouldRequestFullBoardPreview,
        liveStateVersion: rows.liveStateVersion,
      })

      const snap = previewBodyRef.current
      const snapshotCountableMatchCount = snap.effectiveLiveMatchRows.filter(match => match.status !== 'cancelled').length
      const snapshotCompletedMatchCount = snap.effectiveLiveMatchRows
        .filter(match => match.status === 'completed')
        .reduce((max, match) => Math.max(max, (match.sequence_no ?? -1) + 1), 0)
      const snapshotLiveStateVersion = Math.max(
        Number(snap.liveStateVersion ?? 0),
        Number(liveStateVersionRef.current ?? 0),
      )
      const missingPreviewCourtIdxs = getMissingPreviewCourtIdxs({
        courtCount: snap.queueCourtCount,
        liveMatches: activeLiveMatches,
        previewMatches: effectivePreviewBoard,
      })
      const snapHardPreviewQualityCourtIdxs = effectivePreviewBoard
        .filter(match => !isPersistedSuggestedMatch(match) && hasHardPreviewQualityViolation(match, state, pvnaTolerance))
        .map(match => getSuggestedLaneCourtIdx(match))
        .filter((courtIdx): courtIdx is number => courtIdx !== null)
      const rawRequestedReplacementCourtIdxs = [
        ...getRequestedReplacementCourtIdxs({
          pendingReplacementCourtIdxs: pendingReplacementCourts,
          missingPreviewCourtIdxs,
          limit: fetchSuggestedCount,
        }),
        ...snapHardPreviewQualityCourtIdxs,
      ].filter((courtIdx, index, courtIdxs) =>
        courtIdx >= 0
        && courtIdx < snap.queueCourtCount
        && courtIdxs.indexOf(courtIdx) === index
      ).slice(0, fetchSuggestedCount)
      const requestedReplacementCourtIdxs = shouldRequestFullBoardPreview
        ? []
        : rawRequestedReplacementCourtIdxs
      const requestedReplacementCourtSet = new Set(requestedReplacementCourtIdxs)
      const retainedPreviewBusyRows = effectivePreviewBoard
        .filter(match => {
          const courtIdx = getSuggestedLaneCourtIdx(match)
          return courtIdx === null || !requestedReplacementCourtSet.has(courtIdx)
        })
        .map((match, index): SessionLiveMatchRow => ({
          ...match,
          id: `retained-preview-busy-${match.id}`,
          sequence_no: snapshotCountableMatchCount + index,
          status: 'suggested',
        }))
      const previewMode: 'full_board' | 'replace_courts' = shouldRequestFullBoardPreview
        ? 'full_board'
        : requestedReplacementCourtIdxs.length > 0
          ? 'replace_courts'
          : 'full_board'
      const body = {
        mode: previewMode,
        count: fetchSuggestedCount,
        court_count: snap.queueCourtCount,
        pvna_tolerance: snap.pvnaTolerance,
        court_idxs: requestedReplacementCourtIdxs,
        current_preview_board: previewMode === 'full_board' ? [] : effectivePreviewBoard,
        live_match_rows: getLiveRowsForPreviewMode(
          previewMode,
          snap.effectiveLiveMatchRows,
          retainedPreviewBusyRows,
        ),
        live_state_version: snapshotLiveStateVersion,
        completing_live_match_ids: Array.from(snap.completingLiveMatchIds),
        players: Array.from(snap.playersById.entries()).map(([id, p]) => ({ id, name: p.name })),
        player_rows: snap.rows.playerRows,
        pair_rows: snap.rows.pairRows,
        round_rows: snap.rows.roundRows,
        planned_total_rounds: snap.plannedTargetRounds,
        court_preset: snap.courtPreset,
        current_courts: snap.queueCourtCount,
        avoid_pairs: snap.avoidPairs.length > 0 ? snap.avoidPairs : undefined,
      }
      const buildLocalFallbackPreview = (): SuggestedLiveMatchRow[] => {
        const fallbackCourtIdx = requestedReplacementCourtIdxs[0]
          ?? missingPreviewCourtIdxs[0]
          ?? effectivePreviewBoard[0]?.court_idx
          ?? 0
        const busyPlayerIds = new Set<string>()
        for (const match of [...snap.effectiveLiveMatchRows, ...effectivePreviewBoard]) {
          if (
            match.status === 'cancelled'
            || (match.status === 'completed' && !snap.completingLiveMatchIds.has(match.id))
          ) {
            continue
          }
          if (Number(match.court_idx ?? -1) === Number(fallbackCourtIdx) && snap.completingLiveMatchIds.has(match.id)) {
            continue
          }
          match.team_a.forEach(playerId => busyPlayerIds.add(String(playerId)))
          match.team_b.forEach(playerId => busyPlayerIds.add(String(playerId)))
        }
        const localResult = suggestNextMatch(state, {
          tier_overrides: fairnessAdjustment.tier_overrides,
          busy_player_ids: busyPlayerIds,
          court_idx: Number(fallbackCourtIdx),
          max_alternatives: LIVE_TRADEOFF_ALTERNATIVE_LIMIT,
        })
        const alternative = localResult.alternatives[0]
        const localMatch = alternative?.matches[0]
        if (!alternative || !localMatch) return []
        const fallbackMatch: SuggestedLiveMatchRow = {
          id: `preview-local-${fallbackCourtIdx}-${localMatch.team_a.join('-')}-${localMatch.team_b.join('-')}`,
          session_id: sessionId,
          sequence_no: snapshotCountableMatchCount,
          round_no: Math.floor(snapshotCountableMatchCount / Math.max(1, snap.queueCourtCount)),
          court_idx: Number(fallbackCourtIdx),
          status: 'suggested',
          team_a: localMatch.team_a,
          team_b: localMatch.team_b,
          resting: alternative.resting ?? [],
          score_a: 0,
          score_b: 0,
          suggested_at: new Date().toISOString(),
          started_at: null,
          ended_at: null,
          preview_live_state_version: snapshotLiveStateVersion,
          preview_countable_match_count: snapshotCompletedMatchCount,
          preview_source: 'local_fallback',
          preview_request_key: incompleteRequestKey,
          preview_request_serial: requestSerial,
          warnings: alternative.warnings,
          tradeoffs: alternative.tradeoffs,
          approval_required: alternative.approval_required,
          configured_pvna_tolerance: snap.pvnaTolerance,
          effective_pvna_tolerance: state.config.pvna_tolerance,
        }
        return [
          ...effectivePreviewBoard.filter(match => Number(match.court_idx) !== Number(fallbackCourtIdx)),
          fallbackMatch,
        ].sort((left, right) => Number(left.court_idx ?? 0) - Number(right.court_idx ?? 0))
      }
      if (__DEV__) console.log('[NextRoundSuggesterV2] preview request board', {
        mode: previewMode,
        effectivePreviewCourts: effectivePreviewBoard.map(match => getSuggestedLaneCourtIdx(match)),
        rawPreviewCourts: currentPreviewBoardForEdge.map(match => getSuggestedLaneCourtIdx(match)),
        pendingReplacementCourts: [...pendingReplacementCourts],
        requestedReplacementCourts: requestedReplacementCourtIdxs,
        missingPreviewCourtIdxs,
        snapHardPreviewQualityCourtIdxs,
        hasHardReusableQualityViolation,
        fullBoardRequest: shouldRequestFullBoardPreview,
        suggestedQueueCount: snap.queueCourtCount,
      })

      previewAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null
      withPreviewSoftTimeout(fetchLiveMatchesPreview(snap.sessionId, body, {
        requestId: previewClientRequestId,
        signal: previewAbortController?.signal,
      }), () => {
        previewAbortReason = 'soft_timeout'
        previewAbortController?.abort()
      })
        .then(res => {
          if (!isCurrentPreviewRequest()) return
          const rawResponseVersion = Number(
            res.live_state_version_used
            ?? res.final_preview_board?.[0]?.preview_live_state_version
            ?? NaN,
          )
          const responseVersion = Number.isFinite(rawResponseVersion) ? rawResponseVersion : null
          const rawCurrentVersion = liveStateVersionRef.current
          const currentVersion = typeof rawCurrentVersion === 'number' && Number.isFinite(rawCurrentVersion)
            ? rawCurrentVersion
            : null
          if (!isPreviewResponseCurrent({
            requestVersion: snapshotLiveStateVersion,
            responseVersion,
            currentVersion,
            allowResponseAdvance: res.persisted_preview === true,
          })) {
            suggestedPreviewBatchRef.current = null
            suggestedLaneCacheRef.current.clear()
            setSuggestedLiveMatches(current => current.length === 0 ? current : [])
            telemetry.trace('client_preview_discarded_state_advanced', {
              requestId: previewClientRequestId,
              responsePayload: {
                request_live_state_version: snapshotLiveStateVersion,
                response_live_state_version: responseVersion,
                current_live_state_version: currentVersion,
              },
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                request_serial: requestSerial,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
            void queryClient.refetchQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
            return
          }
          if (res.persisted_preview === true && responseVersion !== null) {
            liveStateVersionRef.current = liveStateVersionRef.current === null
              ? responseVersion
              : Math.max(liveStateVersionRef.current, responseVersion)
          }
          telemetry.trace('client_preview_edge_response', {
            requestId: previewClientRequestId,
            requestPayload: {
              mode: previewMode,
              count: fetchSuggestedCount,
              court_count: snap.queueCourtCount,
              court_idxs: requestedReplacementCourtIdxs,
              live_state_version: snapshotLiveStateVersion,
            },
            responsePayload: {
              payload_count: Array.isArray(res.payloads) ? res.payloads.length : null,
              final_preview_board_count: Array.isArray(res.final_preview_board) ? res.final_preview_board.length : null,
              quality_rescue_used: res.quality_rescue_used ?? null,
              player_limited_courts: res.player_limited_courts ?? null,
              temp_limited_courts: res.temp_limited_courts ?? null,
              real_limited_courts: res.real_limited_courts ?? null,
              missing_open_courts: Array.isArray(res.missing_open_courts) ? res.missing_open_courts : null,
              missing_target_courts: Array.isArray(res.missing_target_courts) ? res.missing_target_courts : null,
              partial_full_board_request: res.partial_full_board_request ?? null,
              target_count_shortfall: res.target_count_shortfall ?? null,
            },
            detail: {
              total_ms: Math.round(nowMs() - previewT0),
              incomplete_request_key: incompleteTraceKey,
              incomplete_request_key_bytes: incompleteRequestKey.length,
              request_serial: requestSerial,
            },
          })
          setEdgeDebug(res.debug)
          if (res.should_end === true) {
            suggestedPreviewBatchRef.current = null
            suggestedLaneCacheRef.current.clear()
            previewIncompleteRetryRef.current = { key: '', count: 0 }
            previewBlockedIncompleteKeysRef.current.clear()
            previewRetryTimeoutsRef.current.forEach(clearTimeout)
            previewRetryTimeoutsRef.current.clear()
            previewScheduledRetryKeysRef.current.clear()
            setSuggestedLiveMatches(current => current.length === 0 ? current : [])
            setCourtShortageBreakdown(null)
            setQualityDeferredCourts([])
            setShowSessionReport(true)
            telemetry.trace('client_preview_target_reached', {
              requestId: previewClientRequestId,
              responsePayload: {
                should_end: true,
                warnings: Array.isArray(res.warnings) ? res.warnings : null,
              },
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                request_serial: requestSerial,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
            return
          }
          if (__DEV__ && Array.isArray(res.debug?.selection_debug)) {
            res.debug.selection_debug.forEach((court: any) => {
              console.log(`[selection_debug] sân ${court.court_idx + 1} — busy:${court.busy_count} eligible:${court.eligible_players.length} required:${court.required_for_court.length}`, {
                eligible: court.eligible_players.map((p: any) => `${p.id.slice(0,8)} pvna=${p.pvna} rest=${p.consecutive_rest} played=${p.matches_played} tier=${p.tier}`),
                required: court.required_for_court,
                selected: court.selected.map((p: any) => `${p.id.slice(0,8)} pvna=${p.pvna} team=${p.team}`),
              })
            })
          }
          if (__DEV__) {
            const riskyMatches = (res.payloads ?? []).filter((p: any) => p._exhaustive_diag)
            riskyMatches.forEach((p: any) => {
              console.log('[preview] vượt cap PVNA — exhaustive fallback diag', {
                court: p.court_idx,
                pvnaDiff: p._exhaustive_diag.bestPvnaDiff,
                timedOut: p._exhaustive_diag.timedOut,
                combinationsEvaluated: p._exhaustive_diag.combinationsEvaluated,
                eligibleCount: p._exhaustive_diag.eligibleCount,
                bestHasTradeoffs: p._exhaustive_diag.bestHasTradeoffs,
                elapsedMs: p._exhaustive_diag.elapsedMs,
              })
            })
          }
          // Deferred courts must surface even when the edge returns an empty board: the anti-blowout
          // defer produces no lineup, so edgeReturnedFinalBoard is false below and the board branch is
          // skipped. Set this here, before that branch, so the "waiting for a balanced match" banner
          // shows on the exact response it describes instead of only when a board comes back.
          setQualityDeferredCourts(Array.isArray(res.quality_deferred_courts)
            ? res.quality_deferred_courts.filter((court: unknown): court is number => typeof court === 'number')
            : [])
          const edgeReturnedFinalBoard = Array.isArray(res.final_preview_board) && res.final_preview_board.length > 0
          const responsePayloads = edgeReturnedFinalBoard
            ? res.final_preview_board.filter((match: any) => isStartablePreviewRow(match))
            : (res.payloads ?? [])
          if (__DEV__) {
            const fmt = (ids: string[]) => ids.map(id => {
              const p = snap.playersById.get(id)
              return `${p?.name ?? id.slice(0, 6)}(${p?.pvna?.toFixed(1) ?? '?'})`
            }).join('+')
            responsePayloads.forEach((m: any) => {
              console.log(`[PREVIEW] Sân ${(m.court_idx ?? 0) + 1}: ${fmt(m.team_a)} vs ${fmt(m.team_b)}  pvna_gap=${(m.pvna_gap ?? 0).toFixed(2)} intra=${(m.intra_team_gap ?? 0).toFixed(2)}`)
            })
          }
          const rawFetchedCourtIdxs = responsePayloads
            .map((match: any, index: number) => Number(match.court_idx ?? index))
            .filter((courtIdx: number) => Number.isFinite(courtIdx))
          const fetchedCourtIdxsAreOneBased = !edgeReturnedFinalBoard
            && rawFetchedCourtIdxs.length > 0
            && !rawFetchedCourtIdxs.includes(0)
            && Math.min(...rawFetchedCourtIdxs) >= 1
            && Math.max(...rawFetchedCourtIdxs) <= queueCourtCount
          const fetchedMatches: SuggestedLiveMatchRow[] = responsePayloads.map((match: any, index: number): SuggestedLiveMatchRow => {
            const rawCourtIdx = Number(match.court_idx ?? index)
            const zeroBasedCourtIdx = fetchedCourtIdxsAreOneBased ? rawCourtIdx - 1 : rawCourtIdx
            const normalizedCourtIdx = Number.isFinite(zeroBasedCourtIdx)
              ? Math.max(0, Math.min(queueCourtCount - 1, zeroBasedCourtIdx))
              : index
            return {
            ...match,
            id: edgeReturnedFinalBoard && typeof match.id === 'string' && match.id.length > 0
              ? match.id
              : `preview-${normalizedCourtIdx}-${match.team_a.join('-')}-${match.team_b.join('-')}`,
            session_id: sessionId,
            sequence_no: typeof match.sequence_no === 'number' ? match.sequence_no : index,
            round_no: match.round_no,
            court_idx: normalizedCourtIdx,
            status: 'suggested',
            team_a: match.team_a,
            team_b: match.team_b,
            resting: match.resting ?? [],
            preview_live_state_version: responseVersion,
            preview_countable_match_count: snapshotCompletedMatchCount,
            preview_source: edgeReturnedFinalBoard ? 'edge_committed' : 'edge_partial',
            preview_request_key: incompleteRequestKey,
            preview_request_serial: requestSerial,
            score_a: 0,
            score_b: 0,
            suggested_at: new Date().toISOString(),
            started_at: null,
            ended_at: null,
            }
          })
          const replacementCourtIdxs = new Set<number>()
          completingLiveMatchPlaceholdersRef.current.forEach(match => {
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx !== null) replacementCourtIdxs.add(courtIdx)
          })
          if (edgeReturnedFinalBoard) {
            const stampedMatches = fetchedMatches
              .filter(match => match.status === 'suggested')
              .filter(match => !startedPreviewIds.has(match.id))
              .filter(match => !startingPreviewIds.has(match.id))
              .filter(match => !startingPreviewIdsRef.current.has(match.id))
              .map(match => ({
                ...match,
                preview_live_state_version: match.preview_live_state_version ?? snapshotLiveStateVersion,
                preview_countable_match_count: match.preview_countable_match_count ?? snapshotCompletedMatchCount,
              }))
              .sort((left, right) => {
                const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
                const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
                return leftCourtIdx - rightCourtIdx
              })
            const stickyMatches = getReusableSuggestedLaneMatches()
              .filter(match => !startedPreviewIds.has(match.id))
              .filter(match => !startingPreviewIds.has(match.id))
              .filter(match => !startingPreviewIdsRef.current.has(match.id))
              .filter(match =>
                isPersistedSuggestedMatch(match)
                || (!match.available_pool_only && !hasHardPreviewQualityViolation(match, state, pvnaTolerance))
              )
              .sort((left, right) => {
                const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
                const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
                return leftCourtIdx - rightCourtIdx
              })
            const stickyCourtIdxs = new Set<number>()
            const stickyPlayerIds = new Set<string>()
            const stickyMergedMatches: SuggestedLiveMatchRow[] = []
            for (const match of stickyMatches) {
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx === null || stickyCourtIdxs.has(courtIdx)) continue
              stickyCourtIdxs.add(courtIdx)
              getMatchPlayerIds(match).forEach(playerId => stickyPlayerIds.add(playerId))
              stickyMergedMatches.push(match)
            }
            for (const match of stampedMatches) {
              if (stickyMergedMatches.length >= suggestedQueueCount) break
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx === null || stickyCourtIdxs.has(courtIdx)) continue
              const playerIds = getMatchPlayerIds(match)
              if (playerIds.some(playerId => stickyPlayerIds.has(playerId))) continue
              stickyCourtIdxs.add(courtIdx)
              playerIds.forEach(playerId => stickyPlayerIds.add(playerId))
              stickyMergedMatches.push(match)
            }
            const committedCandidateMatches = stickyMergedMatches.sort((left, right) => {
              const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
              const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
              return leftCourtIdx - rightCourtIdx
            })
            const nextLaneCache = new Map<number, SuggestedLiveMatchRow>()
            committedCandidateMatches.forEach(match => {
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx !== null) nextLaneCache.set(courtIdx, match)
            })
            const hasPendingReplacementCourts = replacementCourtIdxs.size > 0
            const edgeReplacedCourtIdxs = new Set(
              Array.isArray(res.replaced_court_idxs)
                ? res.replaced_court_idxs
                    .map((courtIdx: unknown) => Number(courtIdx))
                    .filter((courtIdx: number) => Number.isFinite(courtIdx))
                : [],
            )
            const fulfilledPendingReplacementCourts = requestedReplacementCourtIdxs.every(courtIdx =>
              nextLaneCache.has(courtIdx) && (edgeReplacedCourtIdxs.size === 0 || edgeReplacedCourtIdxs.has(courtIdx)),
            )
            const localPreviewBatchComplete = isPreviewBoardComplete({
              matches: committedCandidateMatches,
              expectedCount: suggestedQueueCount,
              replacementCourtIdxs,
            })
            const edgeMissingTargetCourts = Array.isArray(res.missing_target_courts)
              ? res.missing_target_courts
                  .map((courtIdx: unknown) => Number(courtIdx))
                  .filter((courtIdx: number) => Number.isFinite(courtIdx))
              : null
            const edgeTargetCountShortfall = typeof res.target_count_shortfall === 'number'
              ? Math.max(0, Math.floor(res.target_count_shortfall))
              : null
            const hasEdgeTargetCompleteness = edgeMissingTargetCourts !== null || edgeTargetCountShortfall !== null
            const previewBatchComplete = hasEdgeTargetCompleteness
              ? (edgeMissingTargetCourts?.length ?? 0) === 0 && (edgeTargetCountShortfall ?? 0) === 0
              : localPreviewBatchComplete
            const currentPreviewBatchComplete = isPreviewBoardComplete({
              matches: currentPreviewBoardForEdge,
              expectedCount: suggestedQueueCount,
            })
            const effectiveCurrentBoardComplete = reusableMatches.length >= suggestedQueueCount
            const fullBoardIncompleteNoop = previewMode === 'full_board'
              && !previewBatchComplete
              && effectiveCurrentBoardComplete
            const shouldCommitPreviewBatch = previewBatchComplete
              || (previewMode === 'replace_courts' && (!hasPendingReplacementCourts || fulfilledPendingReplacementCourts))
              || (previewMode === 'full_board' && committedCandidateMatches.length > 0 && !effectiveCurrentBoardComplete)
            if (shouldCommitPreviewBatch) {
              suggestedLaneCacheRef.current = nextLaneCache
              suggestedPreviewBatchRef.current = previewBatchComplete
                ? { key: previewLaneCacheKey, matches: committedCandidateMatches }
                : null
              setSuggestedLiveMatches(committedCandidateMatches)
            } else {
              suggestedPreviewBatchRef.current = null
            }
            const replacementCourts = new Set(
              [...replacementCourtIdxs].filter(courtIdx => nextLaneCache.has(courtIdx)),
            )
            completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
              if (!replacementCourts.has(Number(match.court_idx ?? -1))) return
              const watchdog = completingCleanupTimeoutsRef.current.get(matchId)
              if (watchdog) clearTimeout(watchdog)
              completingCleanupTimeoutsRef.current.delete(matchId)
            })
            setCompletingLiveMatchIds(current => {
              if (current.size === 0 || replacementCourts.size === 0) return current
              const next = new Set(current)
              completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
                if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
              })
              return next
            })
            setCreatingNextMatchIds(current => {
              if (current.size === 0 || replacementCourts.size === 0) return current
              const next = new Set(current)
              completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
                if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
              })
              return next
            })
            setCompletingLiveMatchPlaceholders(current => {
              if (current.size === 0 || replacementCourts.size === 0) return current
              const next = new Map(current)
              current.forEach((match, matchId) => {
                if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
              })
              return next
            })
            markNextRoundStage(sessionId, 'preview_ready', {
              preview_ms: Math.round(nowMs() - previewT0),
              match_count: committedCandidateMatches.length,
              fetched_match_count: fetchedMatches.length,
              retained_preview_count: stickyMatches.length,
              live_state_version: rows.liveStateVersion,
            })
            if (fullBoardIncompleteNoop) {
              previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
              previewIncompleteRetryRef.current = { key: '', count: 0 }
              telemetry.trace('client_preview_blocked_incomplete_noop', {
                requestId: previewClientRequestId,
                responsePayload: {
                  fetched_match_count: fetchedMatches.length,
                  stamped_match_count: committedCandidateMatches.length,
                  missing_target_courts: edgeMissingTargetCourts,
                  target_count_shortfall: edgeTargetCountShortfall,
                },
                detail: {
                  incomplete_request_key: incompleteTraceKey,
                  incomplete_request_key_bytes: incompleteRequestKey.length,
                  mode: previewMode,
                  edge_final_board: true,
                  effective_current_board_complete: effectiveCurrentBoardComplete,
                  suggested_queue_count: suggestedQueueCount,
                },
              })
            } else if (!previewBatchComplete) {
              const retryKey = [
                incompleteRequestKey,
                [...replacementCourtIdxs].sort((left, right) => left - right).join(','),
                fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
                committedCandidateMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
              ].join('||')
              const currentRetry = previewIncompleteRetryRef.current.key === retryKey
                ? previewIncompleteRetryRef.current.count + 1
                : 1
              previewIncompleteRetryRef.current = { key: retryKey, count: currentRetry }
              telemetry.trace(currentRetry < 2 ? 'client_preview_incomplete_retry_scheduled' : 'client_preview_blocked_after_retries', {
                requestId: previewClientRequestId,
                responsePayload: {
                  fetched_match_count: fetchedMatches.length,
                  stamped_match_count: committedCandidateMatches.length,
                  result_courts: committedCandidateMatches.map(match => getSuggestedLaneCourtIdx(match)),
                  missing_target_courts: edgeMissingTargetCourts,
                  target_count_shortfall: edgeTargetCountShortfall,
                },
                detail: {
                  incomplete_request_key: incompleteTraceKey,
                  incomplete_request_key_bytes: incompleteRequestKey.length,
                  retry_key: compactTraceKey(retryKey),
                  retry_key_bytes: retryKey.length,
                  retry_count: currentRetry,
                  mode: previewMode,
                  edge_final_board: true,
                  replacement_courts: [...replacementCourtIdxs],
                  fulfilled_replacement_courts: fulfilledPendingReplacementCourts,
                  fetched_courts: fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)),
                  requested_replacement_courts: requestedReplacementCourtIdxs,
                  suggested_queue_count: suggestedQueueCount,
                  edge_target_completeness: hasEdgeTargetCompleteness,
                },
              })
              if (currentRetry < 2) {
                schedulePreviewRetry(`incomplete:${retryKey}`, LIVE_PREVIEW_INCOMPLETE_RETRY_MS, () => {
                  setPreviewRefreshNonce(value => value + 1)
                })
              } else {
                previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
                schedulePreviewRetry(`blocked:${incompleteRequestKey}`, LIVE_PREVIEW_BLOCKED_RETRY_MS, () => {
                  previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
                  previewUnblockNonceRef.current += 1
                  if (__DEV__) console.log('[NextRoundSuggesterV2] preview unblock — retrying with new nonce', { nonce: previewUnblockNonceRef.current })
                  setPreviewRefreshNonce(value => value + 1)
                })
              }
            } else {
              previewIncompleteRetryRef.current = { key: '', count: 0 }
              previewBlockedIncompleteKeysRef.current.clear()
              previewRetryTimeoutsRef.current.forEach(clearTimeout)
              previewRetryTimeoutsRef.current.clear()
              previewScheduledRetryKeysRef.current.clear()
            }
            if (typeof res.temp_limited_courts === 'number' || typeof res.real_limited_courts === 'number') {
              const temp = typeof res.temp_limited_courts === 'number' ? res.temp_limited_courts : 0
              const real = typeof res.real_limited_courts === 'number' ? res.real_limited_courts : 0
              setCourtShortageBreakdown(temp > 0 || real > 0 ? { temp, real } : null)
            } else if (typeof res.player_limited_courts === 'number' && res.player_limited_courts > 0) {
              // Fallback for older edge function responses
              setCourtShortageBreakdown({ temp: res.player_limited_courts, real: 0 })
            } else {
              setCourtShortageBreakdown(null)
            }
            if (__DEV__) console.log('[NextRoundSuggesterV2] preview fetch done', {
              totalMs: Math.round(nowMs() - previewT0),
              matchCount: committedCandidateMatches.length,
              fetchedMatchCount: fetchedMatches.length,
              retainedPreviewCount: stickyMatches.length,
              edgeFinalBoard: true,
            })
            return
          }
          // A rest-priority miss no longer discards reusable lanes here: mini-recover keeps the
          // existing courts and only fills the empty lane(s). Only a genuine bad-match violation
          // wipes the board for a full re-suggest.
          const retainedMatches = hasGenuinePreviewQualityViolation ? [] : getReusableSuggestedLaneMatches()
          const usedCourts = new Set<number>()
          const usedPlayerIds = new Set<string>()
          const busyCourtIdxs = new Set<number>()
          for (const match of activeLiveMatches) {
            if (
              completingLiveMatchIds.has(match.id)
              || creatingNextMatchIds.has(match.id)
              || completingLiveMatchPlaceholdersRef.current.has(match.id)
            ) {
              continue
            }
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx !== null) {
              usedCourts.add(courtIdx)
              busyCourtIdxs.add(courtIdx)
            }
            getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
          }
          const matches: SuggestedLiveMatchRow[] = []
          const getMatchSignature = getSuggestedMatchSignature
          const buildRetargetedMatch = (match: SuggestedLiveMatchRow, courtIdx: number): SuggestedLiveMatchRow => ({
            ...match,
            id: `preview-${courtIdx}-${match.team_a.join('-')}-${match.team_b.join('-')}`,
            court_idx: courtIdx,
          })
          const addMatchIfValid = (match: SuggestedLiveMatchRow) => {
            if (matches.length >= suggestedQueueCount) return
            if (match.status !== 'suggested') return
            if (startedPreviewIds.has(match.id) || startingPreviewIds.has(match.id) || startingPreviewIdsRef.current.has(match.id)) return
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx === null || courtIdx < 0 || courtIdx >= queueCourtCount) return
            if (matches.some(existing => getSuggestedLaneCourtIdx(existing) === courtIdx)) return
            if (usedCourts.has(courtIdx) && !replacementCourtIdxs.has(courtIdx)) return
            const playerIds = getMatchPlayerIds(match)
            if (playerIds.some(playerId => usedPlayerIds.has(playerId))) return
            usedCourts.add(courtIdx)
            playerIds.forEach(playerId => usedPlayerIds.add(playerId))
            matches.push(match)
          }
          const fillOpenCourtsFromFetched = () => {
            if (matches.length >= suggestedQueueCount) return
            const usedSignatures = new Set(matches.map(getMatchSignature))
            const openCourtIdxs: number[] = []
            for (let courtIdx = 0; courtIdx < queueCourtCount; courtIdx += 1) {
              if (matches.some(match => getSuggestedLaneCourtIdx(match) === courtIdx)) continue
              if (usedCourts.has(courtIdx) && !replacementCourtIdxs.has(courtIdx)) continue
              openCourtIdxs.push(courtIdx)
            }
            for (const courtIdx of openCourtIdxs) {
              if (matches.length >= suggestedQueueCount) break
              const fallbackMatch = fetchedMatches.find(match => {
                const signature = getMatchSignature(match)
                if (usedSignatures.has(signature)) return false
                const playerIds = getMatchPlayerIds(match)
                return !playerIds.some(playerId => usedPlayerIds.has(playerId))
              })
              if (!fallbackMatch) break
              usedSignatures.add(getMatchSignature(fallbackMatch))
              addMatchIfValid(buildRetargetedMatch(fallbackMatch, courtIdx))
            }
          }
          const replacementMatches: SuggestedLiveMatchRow[] = []
          const usedReplacementSignatures = new Set<string>()
          for (const replacementCourtIdx of replacementCourtIdxs) {
            const directMatch = fetchedMatches.find(match => getSuggestedLaneCourtIdx(match) === replacementCourtIdx)
            const fallbackMatch = directMatch
              ?? fetchedMatches.find(match => !usedReplacementSignatures.has(getMatchSignature(match)))
            if (!fallbackMatch) continue
            const replacementMatch = getSuggestedLaneCourtIdx(fallbackMatch) === replacementCourtIdx
              ? fallbackMatch
              : buildRetargetedMatch(fallbackMatch, replacementCourtIdx)
            usedReplacementSignatures.add(getMatchSignature(fallbackMatch))
            replacementMatches.push(replacementMatch)
          }
          replacementMatches.forEach(addMatchIfValid)
          retainedMatches
            .filter(match => !usedReplacementSignatures.has(getMatchSignature(match)))
            .forEach(addMatchIfValid)
          fillOpenCourtsFromFetched()
          const orderedFetchedMatches = [...fetchedMatches].sort((left, right) => {
            const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
            const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
            return leftCourtIdx - rightCourtIdx
          })
          orderedFetchedMatches
            .filter(match => {
              const courtIdx = getSuggestedLaneCourtIdx(match)
              return (courtIdx === null || !replacementCourtIdxs.has(courtIdx))
              && !usedReplacementSignatures.has(getMatchSignature(match))
            })
            .forEach(addMatchIfValid)
          fillOpenCourtsFromFetched()
          if (matches.length < suggestedQueueCount && fetchedMatches.length > matches.length) {
            matches.splice(0, matches.length)
            usedCourts.clear()
            usedPlayerIds.clear()
            busyCourtIdxs.clear()
            for (const match of activeLiveMatches) {
              if (
                completingLiveMatchIds.has(match.id)
                || creatingNextMatchIds.has(match.id)
                || completingLiveMatchPlaceholdersRef.current.has(match.id)
              ) {
                continue
              }
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx !== null) {
                usedCourts.add(courtIdx)
                busyCourtIdxs.add(courtIdx)
              }
              getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
            }
            orderedFetchedMatches.forEach(addMatchIfValid)
            fillOpenCourtsFromFetched()
          }
          const stampedMatches = matches.map(match => ({
            ...match,
            preview_live_state_version: Math.max(match.preview_live_state_version ?? 0, liveStateVersionRef.current ?? 0),
            preview_countable_match_count: match.preview_countable_match_count ?? snapshotCompletedMatchCount,
          }))
          const nextLaneCache = new Map<number, SuggestedLiveMatchRow>()
          stampedMatches.forEach(match => {
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx !== null) nextLaneCache.set(courtIdx, match)
          })
          const hasPendingReplacementCourts = replacementCourtIdxs.size > 0
          const previewBatchComplete = isPreviewBoardComplete({
            matches: stampedMatches,
            expectedCount: suggestedQueueCount,
            replacementCourtIdxs,
          })
          const currentPreviewBatchComplete = isPreviewBoardComplete({
            matches: currentPreviewBoardForEdge,
            expectedCount: suggestedQueueCount,
          })
          const effectiveCurrentBoardComplete = reusableMatches.length >= suggestedQueueCount
          const fullBoardIncompleteNoop = previewMode === 'full_board'
            && !previewBatchComplete
            && effectiveCurrentBoardComplete
          const shouldCommitPreviewBatch = previewBatchComplete
            || (previewMode === 'replace_courts' && (!hasPendingReplacementCourts || requestedReplacementCourtIdxs.every(idx => nextLaneCache.has(idx))))
          if (shouldCommitPreviewBatch) {
            const committedMatches = stampedMatches.map(match => ({
              ...match,
              preview_source: 'edge_committed' as const,
              preview_request_key: incompleteRequestKey,
              preview_request_serial: requestSerial,
            }))
            const committedLaneCache = new Map<number, SuggestedLiveMatchRow>()
            committedMatches.forEach(match => {
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx !== null) committedLaneCache.set(courtIdx, match)
            })
            suggestedLaneCacheRef.current = committedLaneCache
            suggestedPreviewBatchRef.current = previewBatchComplete
              ? { key: previewLaneCacheKey, matches: committedMatches }
              : null
            setSuggestedLiveMatches(committedMatches)
          } else {
            suggestedPreviewBatchRef.current = null
          }
          const replacementCourts = new Set(stampedMatches.map((match: SuggestedLiveMatchRow) => Number(match.court_idx ?? -1)))
          completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
            if (!replacementCourts.has(Number(match.court_idx ?? -1))) return
            const watchdog = completingCleanupTimeoutsRef.current.get(matchId)
            if (watchdog) clearTimeout(watchdog)
            completingCleanupTimeoutsRef.current.delete(matchId)
          })
          setCompletingLiveMatchIds(current => {
            if (current.size === 0 || replacementCourts.size === 0) return current
            const next = new Set(current)
            completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
              if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
            })
            return next
          })
          setCreatingNextMatchIds(current => {
            if (current.size === 0 || replacementCourts.size === 0) return current
            const next = new Set(current)
            completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
              if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
            })
            return next
          })
          setCompletingLiveMatchPlaceholders(current => {
            if (current.size === 0 || replacementCourts.size === 0) return current
            const next = new Map(current)
            current.forEach((match, matchId) => {
              if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
            })
            return next
          })
          markNextRoundStage(sessionId, 'preview_ready', {
            preview_ms: Math.round(nowMs() - previewT0),
            match_count: stampedMatches.length,
            fetched_match_count: fetchedMatches.length,
            retained_preview_count: retainedMatches.length,
            live_state_version: rows.liveStateVersion,
          })
          if (fullBoardIncompleteNoop) {
            previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
            previewIncompleteRetryRef.current = { key: '', count: 0 }
            telemetry.trace('client_preview_blocked_incomplete_noop', {
              requestId: previewClientRequestId,
              responsePayload: {
                fetched_match_count: fetchedMatches.length,
                match_count: matches.length,
              },
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                mode: previewMode,
                edge_final_board: false,
                effective_current_board_complete: effectiveCurrentBoardComplete,
                suggested_queue_count: suggestedQueueCount,
              },
            })
          } else if (!previewBatchComplete) {
            const retryKey = [
              incompleteRequestKey,
              [...replacementCourtIdxs].sort((left, right) => left - right).join(','),
              fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
              matches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
            ].join('||')
            const currentRetry = previewIncompleteRetryRef.current.key === retryKey
              ? previewIncompleteRetryRef.current.count + 1
              : 1
            previewIncompleteRetryRef.current = { key: retryKey, count: currentRetry }
            telemetry.trace(currentRetry < 2 ? 'client_preview_incomplete_retry_scheduled' : 'client_preview_blocked_after_retries', {
              requestId: previewClientRequestId,
              responsePayload: {
                fetched_match_count: fetchedMatches.length,
                match_count: matches.length,
                result_courts: matches.map(match => getSuggestedLaneCourtIdx(match)),
              },
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                retry_key: compactTraceKey(retryKey),
                retry_key_bytes: retryKey.length,
                retry_count: currentRetry,
                mode: previewMode,
                edge_final_board: false,
                replacement_courts: [...replacementCourtIdxs],
                fulfilled_replacement_courts: [...replacementCourtIdxs].every(courtIdx => nextLaneCache.has(courtIdx)),
                fetched_courts: fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)),
                retained_courts: retainedMatches.map(match => getSuggestedLaneCourtIdx(match)),
                requested_replacement_courts: requestedReplacementCourtIdxs,
                suggested_queue_count: suggestedQueueCount,
              },
            })
            if (__DEV__) console.warn('[NextRoundSuggesterV2] preview batch incomplete, retrying', {
              suggestedQueueCount,
              matchCount: matches.length,
              replacementCourts: [...replacementCourtIdxs],
              fulfilledReplacementCourts: [...replacementCourtIdxs].every(courtIdx => nextLaneCache.has(courtIdx)),
              fetchedCourts: fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)),
              retainedCourts: retainedMatches.map(match => getSuggestedLaneCourtIdx(match)),
              resultCourts: matches.map(match => getSuggestedLaneCourtIdx(match)),
              retryCount: currentRetry,
            })
            if (currentRetry < 2) {
              schedulePreviewRetry(`incomplete:${retryKey}`, LIVE_PREVIEW_INCOMPLETE_RETRY_MS, () => {
                setPreviewRefreshNonce(value => value + 1)
              })
            } else {
              previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
              schedulePreviewRetry(`blocked:${incompleteRequestKey}`, LIVE_PREVIEW_BLOCKED_RETRY_MS, () => {
                previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
                setPreviewRefreshNonce(value => value + 1)
              })
            }
          } else {
            previewIncompleteRetryRef.current = { key: '', count: 0 }
            previewBlockedIncompleteKeysRef.current.clear()
            previewRetryTimeoutsRef.current.forEach(clearTimeout)
            previewRetryTimeoutsRef.current.clear()
            previewScheduledRetryKeysRef.current.clear()
          }
          if (__DEV__) console.log('[NextRoundSuggesterV2] browser telemetry', getNextRoundTelemetry(sessionId).stageDurationsMs)
          if (__DEV__) console.log('[NextRoundSuggesterV2] preview fetch done', {
            totalMs: Math.round(nowMs() - previewT0),
            matchCount: matches.length,
            fetchedMatchCount: fetchedMatches.length,
            retainedPreviewCount: retainedMatches.length,
          })
        })
        .catch(async err => {
          if (!isCurrentPreviewRequest()) return
          // Update stuck hint for kind classification
          const errMsg = String(err?.message ?? '')
          if (errMsg.includes('PREVIEW_STATE_CHANGED')) {
            suggestedPreviewBatchRef.current = null
            suggestedLaneCacheRef.current.clear()
            previewBlockedIncompleteKeysRef.current.clear()
            previewIncompleteRetryRef.current = { key: '', count: 0 }
            setSuggestedLiveMatches(current => current.length === 0 ? current : [])
            telemetry.trace('client_preview_state_changed', {
              requestId: previewClientRequestId,
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                request_serial: requestSerial,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
            void queryClient.refetchQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
            return
          }
          if (previewAbortReason === 'cleanup' && errMsg.includes('Request cancelled')) {
            telemetry.trace('client_preview_request_cancelled', {
              requestId: previewClientRequestId,
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                request_serial: requestSerial,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
            return
          }
          const hintKind = errMsg.includes('546') ? '546'
            : (errMsg.includes('Preview is stale') || errMsg.includes('Preview version')) ? 'stale'
            : errMsg.includes('Could not persist live match suggestions') ? 'persist'
            : 'unknown'
          const isPersistAssignmentConflict = errMsg.includes('Could not persist live match suggestions')
            && errMsg.includes('already assigned or already played')
          telemetry.lastStuckHintRef.current = { kind: hintKind, courtIdxs: requestedReplacementCourtIdxs }
          const fallbackMatches = isLocalPreviewFallbackEnabled() ? buildLocalFallbackPreview() : []
          if (fallbackMatches.length > 0) {
            telemetry.trace('client_preview_fallback_not_committed', {
              requestId: previewClientRequestId,
              responsePayload: {
                fallback_match_count: fallbackMatches.length,
                fallback_courts: fallbackMatches.map(match => getSuggestedLaneCourtIdx(match)),
              },
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                error_kind: hintKind,
                error: errMsg,
                requested_replacement_courts: requestedReplacementCourtIdxs,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
            previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
            setEdgeDebug(`LOCAL_FALLBACK_NOT_COMMITTED: ${err.message || 'edge suggest failed'}`)
            if (__DEV__) console.warn('[NextRoundSuggesterV2] edge preview failed; local fallback was not committed', err)
          }
          setIsSuggestingPreview(false)
          previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
          if (isPersistAssignmentConflict) {
            let authoritativeRefetchError: string | null = null
            try {
              await queryClient.refetchQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
            } catch (refetchError) {
              authoritativeRefetchError = String((refetchError as Error)?.message ?? refetchError)
            }
            if (!isCurrentPreviewRequest()) return
            const cached = queryClient.getQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId))
            const classification = classifyPersistAssignmentConflict({
              requestVersion: snapshotLiveStateVersion,
              snapshotVersion: cached?.liveStateVersion,
              liveMatchRows: cached?.liveMatchRows ?? [],
            })
            if (classification.authoritativeVersion !== null) {
              liveStateVersionRef.current = Math.max(
                liveStateVersionRef.current ?? 0,
                classification.authoritativeVersion,
              )
            }
            if (classification.stateAdvanced) {
              previewAssignmentConflictRetryRef.current = { key: '', count: 0 }
              suggestedPreviewBatchRef.current = null
              suggestedLaneCacheRef.current.clear()
              setSuggestedLiveMatches(current => current.length === 0 ? current : [])
              previewUnblockNonceRef.current += 1
              telemetry.trace('client_preview_persist_assignment_conflict_state_advanced', {
                requestId: previewClientRequestId,
                detail: {
                  request_live_state_version: snapshotLiveStateVersion,
                  authoritative_live_state_version: classification.authoritativeVersion,
                  conflicting_match_ids: classification.conflictingMatchIds,
                  conflicting_player_ids: classification.conflictingPlayerIds,
                  conflicting_court_idxs: classification.conflictingCourtIdxs,
                  authoritative_refetch_error: authoritativeRefetchError,
                },
              })
              setPreviewRefreshNonce(value => value + 1)
              return
            }
            const conflictRetryCount = previewAssignmentConflictRetryRef.current.key === incompleteRequestKey
              ? previewAssignmentConflictRetryRef.current.count + 1
              : 1
            previewAssignmentConflictRetryRef.current = { key: incompleteRequestKey, count: conflictRetryCount }
            const retryScheduled = conflictRetryCount < 2
              ? schedulePreviewRetry(`assignment-conflict:${incompleteRequestKey}`, LIVE_PREVIEW_INCOMPLETE_RETRY_MS, () => {
                  setPreviewRefreshNonce(value => value + 1)
                })
              : false
            telemetry.trace(conflictRetryCount < 2
              ? 'client_preview_persist_assignment_conflict_retry_scheduled'
              : 'client_preview_persist_assignment_conflict_terminal', {
              requestId: previewClientRequestId,
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                error_kind: hintKind,
                error: errMsg,
                requested_replacement_courts: requestedReplacementCourtIdxs,
                authoritative_live_state_version: classification.authoritativeVersion,
                conflicting_match_ids: classification.conflictingMatchIds,
                conflicting_player_ids: classification.conflictingPlayerIds,
                conflicting_court_idxs: classification.conflictingCourtIdxs,
                authoritative_refetch_error: authoritativeRefetchError,
                retry_count: conflictRetryCount,
                retry_scheduled: retryScheduled,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
            setEdgeDebug(`PERSIST_ASSIGNMENT_CONFLICT: ${err.message || 'edge persist failed'}`)
            if (conflictRetryCount >= 2) {
              previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
              schedulePreviewRetry(`assignment-conflict-cooldown:${incompleteRequestKey}`, LIVE_PREVIEW_BLOCKED_RETRY_MS, () => {
                previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
                previewAssignmentConflictRetryRef.current = { key: '', count: 0 }
                previewUnblockNonceRef.current += 1
                setPreviewRefreshNonce(value => value + 1)
              })
            }
            if (__DEV__) console.warn('[NextRoundSuggesterV2] preview persist assignment conflict reconciled with authoritative snapshot', err)
            return
          }
          const retryDelayMs = errMsg === 'Preview suggest soft timeout'
            ? LIVE_PREVIEW_SOFT_TIMEOUT_RETRY_MS
            : LIVE_PREVIEW_ERROR_RETRY_MS
          const retryScheduled = schedulePreviewRetry(`error:${incompleteRequestKey}`, retryDelayMs, () => {
            setPreviewRefreshNonce(value => value + 1)
          })
          telemetry.trace('client_preview_edge_error_retry_scheduled', {
            requestId: previewClientRequestId,
            detail: {
              incomplete_request_key: incompleteTraceKey,
              incomplete_request_key_bytes: incompleteRequestKey.length,
              error_kind: hintKind,
              error: errMsg,
              requested_replacement_courts: requestedReplacementCourtIdxs,
              retry_delay_ms: retryDelayMs,
              retry_scheduled: retryScheduled,
              total_ms: Math.round(nowMs() - previewT0),
            },
          })
          setEdgeDebug(`ERROR: ${err.message || 'Unknown error'}`)
          console.warn('[NextRoundSuggesterV2] Live preview fetch failed', err)
          if (errMsg !== 'Preview suggest soft timeout') {
            Alert.alert('Lỗi gợi ý trận đấu', err.message || 'Không thể lấy gợi ý trận đấu từ server')
          }
        })
        .finally(() => {
          const isStillCurrent = isCurrentPreviewRequest()
          const ownsSlot = previewRequestInFlightSerialRef.current === requestSerial
          previewPendingRequestKeysRef.current.delete(incompleteRequestKey)
          if (ownsSlot) {
            previewRequestInFlightRef.current = false
            previewRequestInFlightSerialRef.current = null
            // Always clear spinner when we own the in-flight slot, even if generation
            // changed mid-fetch. Without this, isSuggestingPreview latches true
            // (isCurrentPreviewRequest() returns false → old guard skips the clear).
            setIsSuggestingPreview(false)
          } else if (isStillCurrent) {
            setIsSuggestingPreview(false)
          }
          if (__DEV__) console.log('[NextRoundSuggesterV2] preview finally', {
            isStillCurrent,
            ownsSlot,
            generationChanged: sessionGenerationRef.current !== requestSessionGeneration,
          })
          if (!isStillCurrent) {
            telemetry.trace('client_preview_request_stale_finally', {
              requestId: previewClientRequestId,
              detail: {
                incomplete_request_key: incompleteTraceKey,
                incomplete_request_key_bytes: incompleteRequestKey.length,
                owns_slot: ownsSlot,
                request_serial: requestSerial,
                current_serial: previewRequestSerialRef.current,
                request_generation: requestSessionGeneration,
                current_generation: sessionGenerationRef.current,
                total_ms: Math.round(nowMs() - previewT0),
              },
            })
          }
          // Stale requests are expected when a newer preview or session change supersedes
          // them. The newer state/request owns recovery; retrying here creates request storms.
        })
    }, 80)

    return () => {
      if (!requestStarted) {
        cancelledBeforeStart = true
        clearTimeout(timer)
        previewPendingRequestKeysRef.current.delete(incompleteRequestKey)
        telemetry.trace('client_preview_cancelled_before_start', {
          requestId: previewClientRequestId,
          detail: {
            incomplete_request_key: incompleteTraceKey,
            incomplete_request_key_bytes: incompleteRequestKey.length,
            request_serial: requestSerial,
            request_generation: requestSessionGeneration,
            current_generation: sessionGenerationRef.current,
          },
        })
      }
      if (!requestStarted && isCurrentPreviewRequest()) {
        previewRequestInFlightRef.current = false
        previewRequestInFlightSerialRef.current = null
      }
      if (requestStarted && isCurrentPreviewRequest()) {
        previewAbortReason = 'cleanup'
        previewAbortController?.abort()
      }
    }
  }, [phase, previewLaneCacheKey, previewRequestKey, queryClient, rows.playerRows.length, sessionId, settingsHydrated, suggestedQueueCount, telemetry.trace])

  return {
    suggestedLiveMatches,
    availablePoolPreviews,
    startingPreviewIds,
    endingLiveMatchIds,
    completingLiveMatchIds,
    creatingNextMatchIds,
    isSuggestingPreview,
    courtShortageBreakdown,
    qualityDeferredCourts,
    effectiveLiveMatchRows,
    activeLiveMatches,
    completedLiveMatches,
    queueCourtCount,
    startLiveMatch,
    fetchAvailablePoolPreview,
    confirmStartNow,
    cancelAvailablePool,
    completeLiveMatch,
    cancelLiveMatch,
    swapPlayersInSuggestedLiveMatch,
  }
}
