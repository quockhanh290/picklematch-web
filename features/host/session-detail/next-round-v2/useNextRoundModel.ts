import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { buildSuggestedRoundActions, buildSuggestedRoundActionsCache, type SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import { buildMatchCountConsistencyRows, buildFairnessPreview, buildLatestFairnessAudit } from '@/lib/next-round-suggester/fairness/audit'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { buildGroupAliasMap, buildGroupSummaries } from '@/lib/next-round-suggester/fairness/group-audit'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { sanitizeSummaryForHost } from '@/lib/next-round-suggester/fairness/sanitize'
import { buildSessionSummary } from '@/lib/next-round-suggester/fairness/summary'
import { rebuildStateThroughRound } from '@/lib/next-round-suggester/history'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { SuggestionAlternative } from '@/lib/next-round-suggester/types'
import {
  getPlayerPvna,
  isConfirmedNonNoShow,
  isRosterSyncEligible,
  withWeights,
} from './helpers'
import { buildFairnessWarningsForBanner } from './fairness-warnings'
import type { NextRoundSuggesterV2Props, RoundSelectionSnapshot, SheetKey } from './types'
import { useLiveRows } from './useLiveRows'

function cloneSuggestionAlternative(alternative: SuggestionAlternative | null): SuggestionAlternative | null {
  if (!alternative) return null
  return {
    matches: alternative.matches.map(match => ({
      ...match,
      team_a: [...match.team_a],
      team_b: [...match.team_b],
      stats: match.stats ? { ...match.stats } : undefined,
    })),
    resting: [...alternative.resting],
    score: alternative.score,
    warnings: [...alternative.warnings],
    stats: { ...alternative.stats },
    runtime_ms: alternative.runtime_ms,
    iterations: alternative.iterations,
  }
}

function normalizeCourtCount(value: number) {
  return Math.max(1, Math.floor(value || 1))
}

export function useNextRoundModel({ sessionId, players, courts }: NextRoundSuggesterV2Props) {
  const [selectedAlternative, setSelectedAlternative] = useState(0)
  const [manualAlternative, setManualAlternative] = useState<SuggestionAlternative | null>(null)
  const [selectionUndo, setSelectionUndo] = useState<RoundSelectionSnapshot | null>(null)
  const [swapFromPlayerId, setSwapFromPlayerId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetKey>(null)
  const [pvnaTolerance, setPvnaTolerance] = useState(0.5)
  const [courtCountOverride, setCourtCountOverride] = useState<number | null>(null)
  const [courtPreset, setCourtPreset] = useState<CourtPreset>('balanced')
  const [courtDurationMin, setCourtDurationMin] = useState(120)
  const [targetRounds, setTargetRounds] = useState<number | null>(null)
  const [groupSelection, setGroupSelection] = useState<string[]>([])
  const [showEngineStats, setShowEngineStats] = useState(false)
  const [showSessionReport, setShowSessionReport] = useState(false)

  const confirmedPlayers = useMemo(
    () => players.filter(player => player.status === 'confirmed' || !player.status),
    [players],
  )
  const checkedInPlayers = useMemo(() => {
    const explicitlyPresent = confirmedPlayers.filter(isRosterSyncEligible)
    return explicitlyPresent.length > 0 ? explicitlyPresent : confirmedPlayers.filter(isConfirmedNonNoShow)
  }, [confirmedPlayers])
  const playersById = useMemo(() => new Map(players.map(player => [String(player.id), player])), [players])
  const liveRows = useLiveRows(sessionId, playersById)
  const deferredRows = useDeferredValue(liveRows.rows)

  // Đóng băng player rows cho engine khi sheet roster đang mở.
  // User không nhìn thấy gợi ý → không cần recompute suggestNextRound,
  // correctForFairness, computeSessionFairness trong lúc thao tác roster.
  const frozenEnginePlayerRowsRef = useRef(deferredRows.playerRows)
  const enginePlayerRows = useMemo(() => {
    if (sheet !== 'roster' && sheet !== 'late-arrivals') frozenEnginePlayerRowsRef.current = deferredRows.playerRows
    return frozenEnginePlayerRowsRef.current
  }, [sheet, deferredRows.playerRows])

  const rosterSheetOpen = sheet === 'roster' || sheet === 'late-arrivals'

  const frozenPresentRowsRef = useRef(liveRows.rows.playerRows.filter(row => !row.checked_out_at))
  const presentRows = useMemo(() => {
    if (!rosterSheetOpen) frozenPresentRowsRef.current = liveRows.rows.playerRows.filter(row => !row.checked_out_at)
    return frozenPresentRowsRef.current
  }, [rosterSheetOpen, liveRows.rows.playerRows])
  const presentCount = presentRows.length
  const calculatorPlayerCount = presentCount || checkedInPlayers.length || confirmedPlayers.length
  const courtCalculator = useMemo(() => calculateOptimalCourts({
    n_players: calculatorPlayerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [calculatorPlayerCount, courtDurationMin, courtPreset])
  const courtCount = courtCountOverride ?? courtCalculator.recommended.courts
  const setCourtCount = useCallback((value: number) => {
    setCourtCountOverride(normalizeCourtCount(value))
  }, [])
  const frozenEngineCourtCountRef = useRef(courtCount)
  const engineCourtCount = useMemo(() => {
    if (!rosterSheetOpen) frozenEngineCourtCountRef.current = courtCount
    return frozenEngineCourtCountRef.current
  }, [rosterSheetOpen, courtCount])

  const enrichedPlayerRows = useMemo(() => enginePlayerRows.map(row => ({
    ...row,
    players: {
      pvna: getPlayerPvna(playersById.get(row.player_id)) ?? row.players?.pvna ?? 0,
      elo: row.players?.elo,
      gender: playersById.get(row.player_id)?.gender ?? row.players?.gender,
      partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref ?? row.players?.partner_gender_pref,
      opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref ?? row.players?.opponent_gender_pref,
    },
    session_players: {
      metadata: playersById.get(row.player_id)?.metadata ?? row.session_players?.metadata ?? null,
    },
  })), [enginePlayerRows, playersById])

  const rawState = useMemo(() => mapRowsToSessionState({
    sessionId,
    playerRows: enrichedPlayerRows,
    pairRows: deferredRows.pairRows,
    roundRows: deferredRows.roundRows,
    courts: engineCourtCount,
    pvnaTolerance,
  }), [engineCourtCount, deferredRows.pairRows, deferredRows.roundRows, enrichedPlayerRows, pvnaTolerance, sessionId])

  const baseWeights = useMemo(() => ({
    ...rawState.config.weights,
    pvna: 1,
  }), [rawState.config.weights])
  const baseState = useMemo(() => withWeights(rawState, baseWeights), [baseWeights, rawState])
  const fairnessAdjustment = useMemo(() => correctForFairness(baseState), [baseState])
  const state = useMemo(
    () => applyFairnessAdjustment(baseState, fairnessAdjustment),
    [baseState, fairnessAdjustment],
  )
  const deferredState = useDeferredValue(state)
  const deferredTierOverrides = useDeferredValue(fairnessAdjustment.tier_overrides)
  const deferredCourtCount = useDeferredValue(courtCount)
  const deferredPvnaTolerance = useDeferredValue(pvnaTolerance)
  const suggestionIsUpdating = deferredState !== state
    || deferredTierOverrides !== fairnessAdjustment.tier_overrides
    || engineCourtCount !== courtCount
    || deferredPvnaTolerance !== pvnaTolerance
    || deferredRows !== liveRows.rows
  const suggestion = useMemo(
    () => suggestNextRound(deferredState, { tier_overrides: deferredTierOverrides }),
    [deferredState, deferredTierOverrides],
  )
  const selected = suggestion.alternatives[selectedAlternative] ?? suggestion.alternatives[0]
  const workingAlternative = manualAlternative ?? selected
  const hasManualSwapHardGuard = Boolean(workingAlternative?.warnings.includes('MANUAL_SWAP_HARD_GUARD'))
  const fairnessScore = useMemo(() => computeSessionFairness(state), [state])
  const fairnessAudit = useMemo(() => buildLatestFairnessAudit(state), [state])

  // Pre-compute cho tất cả alternatives — chỉ chạy khi engine tạo suggestion mới,
  // không chạy lại khi user chỉ đổi selectedAlternative.
  const suggestedRoundActionsCache = useMemo(
    () => buildSuggestedRoundActionsCache(deferredState, suggestion.alternatives, deferredCourtCount),
    [deferredCourtCount, deferredState, suggestion.alternatives],
  )
  const alternativeFairnessPreviews = useMemo(
    () => suggestion.alternatives.map(alt => buildFairnessPreview(deferredState, alt)),
    [deferredState, suggestion.alternatives],
  )
  const alternativeFairnessWarnings = useMemo(
    () => suggestion.alternatives.map(alt => buildFairnessWarningsForBanner(deferredState, alt)),
    [deferredState, suggestion.alternatives],
  )

  // manualAlternative cần tính riêng vì không nằm trong suggestion.alternatives
  const manualFairnessPreview = useMemo(
    () => manualAlternative ? buildFairnessPreview(deferredState, manualAlternative) : null,
    [deferredState, manualAlternative],
  )
  const manualFairnessWarnings = useMemo(
    () => manualAlternative ? buildFairnessWarningsForBanner(deferredState, manualAlternative) : null,
    [deferredState, manualAlternative],
  )

  // Đổi ALT chỉ là đổi index — không tính gì thêm
  const fairnessPreview = manualFairnessPreview ?? alternativeFairnessPreviews[selectedAlternative] ?? alternativeFairnessPreviews[0] ?? null
  const fairnessWarnings = manualFairnessWarnings ?? alternativeFairnessWarnings[selectedAlternative] ?? alternativeFairnessWarnings[0] ?? []

  const suggestedRoundActions = useMemo(
    () => buildSuggestedRoundActions({
      state: deferredState,
      alternatives: suggestion.alternatives,
      cache: suggestedRoundActionsCache,
      selectedIndex: selectedAlternative,
      pvnaTolerance: deferredPvnaTolerance,
      courtCount: deferredCourtCount,
    }),
    [deferredCourtCount, deferredPvnaTolerance, deferredState, selectedAlternative, suggestedRoundActionsCache, suggestion.alternatives],
  )

  const activeRound = useMemo(() => liveRows.rows.roundRows.find(row => row.status === 'active') ?? null, [liveRows.rows.roundRows])
  const effectiveTargetRounds = targetRounds ?? courtCalculator.recommended.total_rounds
  const completedRounds = useMemo(
    () => liveRows.rows.roundRows.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no),
    [liveRows.rows.roundRows],
  )
  const completedRoundCount = completedRounds.length
  const targetReached = effectiveTargetRounds > 0 && completedRoundCount >= effectiveTargetRounds
  const reportState = useMemo(
    () => (completedRoundCount > 0 ? rebuildStateThroughRound(state, completedRounds[0].round_no) : state),
    [completedRoundCount, completedRounds, state],
  )
  const sessionSummary = useMemo(() => sanitizeSummaryForHost(buildSessionSummary(reportState)), [reportState])
  const matchCountConsistencyRows = useMemo(
    () => buildMatchCountConsistencyRows(state, reportState),
    [reportState, state],
  )
  const groupSummaries = useMemo(() => buildGroupSummaries(deferredRows.playerRows), [deferredRows.playerRows])
  const groupAliases = useMemo(() => buildGroupAliasMap(groupSummaries), [groupSummaries])
  const phase: 'plan' | 'active' | 'recap' = showSessionReport && targetReached && !activeRound ? 'recap' : activeRound ? 'active' : 'plan'

  const rememberRoundSelection = (reason: string) => {
    setSelectionUndo({
      selectedAlternative,
      manualAlternative: cloneSuggestionAlternative(manualAlternative),
      pvnaTolerance,
      courtCount,
      reason,
    })
  }

  const undoRoundSelection = () => {
    if (!selectionUndo) return
    setSelectedAlternative(selectionUndo.selectedAlternative)
    setManualAlternative(selectionUndo.manualAlternative)
    setPvnaTolerance(selectionUndo.pvnaTolerance)
    setCourtCountOverride(selectionUndo.courtCount)
    setSwapFromPlayerId(null)
    setSelectionUndo(null)
  }

  const selectAlternativeForRound = (index: number, reason = `ALT ${index + 1}`) => {
    if (selectedAlternative === index && manualAlternative === null) return
    rememberRoundSelection(reason)
    setSelectedAlternative(index)
    setManualAlternative(null)
    setSwapFromPlayerId(null)
    setShowSessionReport(false)
  }

  const applySuggestedRoundAction = (action: SuggestedRoundAction) => {
    rememberRoundSelection(action.label)
    if (action.type === 'select_alternative') {
      setSelectedAlternative(action.alternative_index)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
      return
    }
    if (action.type === 'set_pvna_tolerance') {
      setPvnaTolerance(action.pvna_tolerance)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
      return
    }
    if (action.type === 'set_courts') {
      setCourtCount(action.courts)
      setSelectedAlternative(0)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
    }
  }

  const toggleGroupSelection = useCallback((playerId: string) => {
    setGroupSelection(current => (
      current.includes(playerId)
        ? current.filter(id => id !== playerId)
        : [...current, playerId]
    ))
  }, [])

  return {
    activeRound,
    applySuggestedRoundAction,
    checkedInPlayers,
    completedRoundCount,
    completedRounds,
    calculatorPlayerCount,
    courtCalculator,
    courtCount,
    courtDurationMin,
    courtPreset,
    effectiveTargetRounds,
    fairnessAudit,
    fairnessPreview,
    fairnessScore,
    fairnessWarnings,
    groupAliases,
    groupSelection,
    groupSummaries,
    hasManualSwapHardGuard,
    manualAlternative,
    matchCountConsistencyRows,
    phase,
    playersById,
    presentCount,
    pvnaTolerance,
    reportState,
    rows: liveRows.rows,
    addPlayerRow: liveRows.addPlayerRow,
    clearPlayerPatch: liveRows.clearPlayerPatch,
    clearPlayerRow: liveRows.clearPlayerRow,
    patchPlayerRow: liveRows.patchPlayerRow,
    selectAlternativeForRound,
    selectedAlternative,
    selectionUndo,
    sessionSummary,
    setCourtCount,
    setCourtDurationMin,
    setCourtPreset,
    setError: liveRows.setError,
    setGroupSelection,
    setManualAlternative,
    setPvnaTolerance,
    setSheet,
    setShowEngineStats,
    setShowSessionReport,
    setSwapFromPlayerId,
    setTargetRounds,
    sheet,
    showEngineStats,
    settlePlayerPatch: liveRows.settlePlayerPatch,
    settlePlayerRow: liveRows.settlePlayerRow,
    state,
    suggestedRoundActions,
    suggestionIsUpdating,
    suggestion,
    swapFromPlayerId,
    targetReached,
    targetRounds,
    toggleGroupSelection,
    undoRoundSelection,
    workingAlternative,
    error: liveRows.error,
    loadLiveState: liveRows.loadLiveState,
    loading: liveRows.loading,
    refreshing: liveRows.refreshing,
    rememberRoundSelection,
  }
}
