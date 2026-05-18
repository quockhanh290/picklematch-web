import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { AlertTriangle, CheckCircle2, Play, RefreshCcw, Star, UserMinus, UserPlus, X } from 'lucide-react-native'

import { AppLoading } from '@/components/design'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { calculateOptimalCourts, PRESETS, type CourtPreset, type CourtWarningAlternative } from '@/lib/court-calculator'
import { buildSuggestedRoundActions, type SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import { scoreMatch } from '@/lib/next-round-suggester/score'
import { auditManualSwap, buildSwappedAlternative, type ManualSwapAudit } from '@/lib/next-round-suggester/manual-swap'
import { previewStateAfterAlternative, rebuildStateThroughRound } from '@/lib/next-round-suggester/history'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues, type FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  buildFairnessPreview,
  buildLatestFairnessAudit,
  buildMatchCountConsistencyRows,
  type FairnessAudit,
  type FairnessPreview,
  type MatchCountConsistencyRow,
} from '@/lib/next-round-suggester/fairness/audit'
import { buildGroupAliasMap, buildGroupAuditRows, buildGroupSummaries, type GroupAuditRow, type GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
  type SessionFairnessScore,
} from '@/lib/next-round-suggester/fairness/metrics'
import { computeRepeatPressure } from '@/lib/next-round-suggester/fairness/pressure'
import { sanitizeSummaryForHost, sanitizeWarningsForHost } from '@/lib/next-round-suggester/fairness/sanitize'
import { buildSessionSummary, type SessionSummary } from '@/lib/next-round-suggester/fairness/summary'
import { buildSessionStateFingerprint } from '@/lib/next-round-suggester/state-version'
import type {
  Match,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { eloToPvna } from '@/lib/skillAssessment'
import { STRINGS } from '@/constants/strings'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { loadLatestSyncablePlayerIds } from './next-round-v2/api'

const UI_THEME = {
  primary: '#0F6E56',
  secondary: '#1A2E2A',
  accent: '#E1F5EE',
  warning: '#FFF7D6',
  danger: '#FAECE7',
  success: '#E1F5EE',
  background: '#F1F1F1',
  cardBg: '#FFFFFF',
  textMain: '#1A2E2A',
  textSub: '#596864',
  textMuted: '#A3ADAA',
  border: '#E5E3DC',
}

const DASHBOARD_RADIUS = 24
const DASHBOARD_SHADOW = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
}

type Props = {
  sessionId: string
  players: ArrangementPlayer[]
  courts: number
}

type LiveRows = {
  playerRows: SessionPlayerStateRow[]
  pairRows: SessionPairHistoryRow[]
  roundRows: SessionRoundRow[]
}

type RoundSelectionSnapshot = {
  selectedAlternative: number
  manualAlternative: SuggestionAlternative | null
  pvnaTolerance: number
  courtCount: number
  reason: string
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

function playerName(playerId: string, playersById: Map<string, ArrangementPlayer>) {
  return playersById.get(playerId)?.name ?? 'Người chơi'
}

function getPlayerPvna(player?: ArrangementPlayer | null) {
  if (player?.pvna != null) return Number(player.pvna)
  if (player?.elo != null) return eloToPvna(Number(player.elo))
  return 0
}

function getTeamPvna(team: [string, string], state: SessionState) {
  return team.reduce((sum, id) => sum + (state.players.get(id)?.pvna ?? 3.0), 0) / 2
}

function getMatchLabel(match: Match, playersById: Map<string, ArrangementPlayer>) {
  const teamA = match.team_a.map(id => playerName(id, playersById)).join(' / ')
  const teamB = match.team_b.map(id => playerName(id, playersById)).join(' / ')
  return `${teamA}  vs  ${teamB}`
}

function formatGender(value?: string | null) {
  const gender = String(value || '').toLowerCase()
  if (gender === 'm' || gender === 'male' || gender === 'nam') return 'M'
  if (gender === 'f' || gender === 'female' || gender === 'nữ' || gender === 'nu') return 'F'
  return '-'
}

function formatPref(value: unknown) {
  const pref = String(value || 'any').toLowerCase()
  if (pref === 'm' || pref === 'male' || pref === 'nam') return 'M'
  if (pref === 'f' || pref === 'female' || pref === 'nữ' || pref === 'nu') return 'F'
  return 'any'
}

function formatGroupLabel(groupId?: string | null) {
  if (!groupId) return '-'
  const parts = groupId.split(':').filter(Boolean)
  return parts.slice(-2).map(part => part.slice(0, 4)).join('-') || 'group'
}

function formatPlayerPreference(playerId: string, playersById: Map<string, ArrangementPlayer>, state: SessionState) {
  const player = playersById.get(playerId)
  const livePlayer = state.players.get(playerId)
  return `${playerName(playerId, playersById)} (${formatGender(player?.gender)} · P:${formatPref(player?.metadata?.partner_gender_pref)} · O:${formatPref(player?.metadata?.opponent_gender_pref)} · G:${formatGroupLabel(livePlayer?.group_id)})`
}

function formatWarning(code: string) {
  switch (code) {
    case 'NOT_ENOUGH_PRESENT':
      return STRINGS.host_flow.suggester.warning_not_enough_present
    case 'MUST_PLAY_OVER_CAPACITY':
      return STRINGS.host_flow.suggester.warning_over_capacity
    case 'NO_VALID_MATCH':
      return STRINGS.host_flow.suggester.warning_no_valid_match
    case 'PARTIAL_COURTS':
      return STRINGS.host_flow.suggester.warning_partial_courts
    case 'MANUAL_SWAP':
      return STRINGS.host_flow.suggester.warning_manual_swap
    default:
      return code.replace(/_/g, ' ').toLowerCase()
  }
}

function shortGroupId(groupId: string | null | undefined) {
  if (!groupId) return STRINGS.host_flow.suggester.no_group
  const parts = groupId.split(':')
  return `Group ${parts.slice(-2).map(part => part.slice(0, 4)).join('-')}`
}

function normalizeRoundRow(row: any): SessionRoundRow {
  return {
    id: row.id,
    session_id: row.session_id,
    round_no: row.round_no,
    status: row.status,
    matches: row.matches ?? [],
    resting: row.resting ?? [],
    started_at: row.started_at,
    ended_at: row.ended_at,
  }
}

function isRosterSyncEligible(player: ArrangementPlayer) {
  if (player.status && player.status !== 'confirmed') return false
  if (player.checkInStatus === 'no_show') return false

  return player.checkInStatus === 'present' || player.checkInStatus === 'checked_in' || !player.checkInStatus
}

function isConfirmedNonNoShow(player: ArrangementPlayer) {
  if (player.status && player.status !== 'confirmed') return false
  return player.checkInStatus !== 'no_show'
}

function withWeights(state: SessionState, weights: SessionState['config']['weights']): SessionState {
  return {
    ...state,
    config: {
      ...state.config,
      weights,
    },
  }
}

function fairnessLabel(score: SessionFairnessScore) {
  if (score.grade === 'excellent') return 'Rất đều'
  if (score.grade === 'good') return 'Đều'
  if (score.grade === 'acceptable') return 'Tạm ổn'
  return 'Cần chỉnh'
}

function warningTone(severity: FairnessWarning['severity']) {
  if (severity === 'critical') return { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B' }
  if (severity === 'warning') return { bg: '#FFF7D6', border: '#E5B94E', text: '#92400E' }
  return { bg: '#EAF4FF', border: '#9CC7F2', text: '#1D4E89' }
}

function severityRank(severity: FairnessWarning['severity']) {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function buildFairnessWarningsForBanner(
  currentWarnings: FairnessWarning[],
  projectedWarnings: FairnessWarning[],
): FairnessWarning[] {
  const current = sanitizeWarningsForHost(currentWarnings)
  const currentKeys = new Set(current.map(warningIdentity))
  const projected = sanitizeWarningsForHost(projectedWarnings)
    .filter(warning => !currentKeys.has(warningIdentity(warning)))
    .map(toProjectedWarning)

  return [...current, ...projected].sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity)
    if (severityDiff !== 0) return severityDiff
    return warningIdentity(a).localeCompare(warningIdentity(b))
  })
}

function warningIdentity(warning: FairnessWarning): string {
  return `${warning.type}:${[...warning.affected_players].sort().join(',')}`
}

function toProjectedWarning(warning: FairnessWarning): FairnessWarning {
  return {
    ...warning,
    message: `Nếu bắt đầu phương án này: ${projectWarningMessage(warning.message)}`,
    suggested_action: projectSuggestedAction(warning.suggested_action),
  }
}

function projectWarningMessage(message: string): string {
  return message
    .replace(' đã đối đầu ', ' sẽ đối đầu ')
    .replace(' đã đánh chung ', ' sẽ đánh chung ')
    .replace(' đã nghỉ ', ' sẽ nghỉ ')
}

function projectSuggestedAction(action: string): string {
  return action.replace('Engine sẽ ', 'Engine đang ')
}

const COURT_PRESET_OPTIONS: CourtPreset[] = ['play_more', 'balanced', 'relaxed']
const COURT_DURATION_OPTIONS = [90, 120, 150]

export function NextRoundSuggesterScreen({ sessionId, players, courts }: Props) {
  const theme = useAppTheme()
  const autoSyncAttemptedRef = React.useRef(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rows, setRows] = useState<LiveRows>({ playerRows: [], pairRows: [], roundRows: [] })
  const [selectedAlternative, setSelectedAlternative] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pvnaTolerance, setPvnaTolerance] = useState(0.5)
  const [courtCount, setCourtCount] = useState(Math.max(1, Math.min(4, courts)))
  const [courtPreset, setCourtPreset] = useState<CourtPreset>('balanced')
  const [courtDurationMin, setCourtDurationMin] = useState(120)
  const [targetRounds, setTargetRounds] = useState<number | null>(null)
  const [showSessionReport, setShowSessionReport] = useState(false)
  const [swapFromPlayerId, setSwapFromPlayerId] = useState<string | null>(null)
  const [manualAlternative, setManualAlternative] = useState<SuggestionAlternative | null>(null)
  const [selectionUndo, setSelectionUndo] = useState<RoundSelectionSnapshot | null>(null)
  const [groupSelection, setGroupSelection] = useState<string[]>([])

  const confirmedPlayers = useMemo(
    () => players.filter(player => player.status === 'confirmed' || !player.status),
    [players],
  )
  const checkedInPlayers = useMemo(
    () => {
      const explicitlyPresent = confirmedPlayers.filter(isRosterSyncEligible)
      return explicitlyPresent.length > 0 ? explicitlyPresent : confirmedPlayers.filter(isConfirmedNonNoShow)
    },
    [confirmedPlayers],
  )
  const playersById = useMemo(
    () => new Map(players.map(player => [String(player.id), player])),
    [players],
  )

  const loadLiveState = useCallback(async () => {
    setError(null)
    const [playerRes, pairRes, roundRes] = await Promise.all([
      supabase
        .from('session_player_state')
        .select('*')
        .eq('session_id', sessionId)
        .order('checked_in_at', { ascending: true }),
      supabase
        .from('session_pair_history')
        .select('*')
        .eq('session_id', sessionId)
        .order('player_a', { ascending: true }),
      supabase
        .from('session_rounds')
        .select('*')
        .eq('session_id', sessionId)
        .order('round_no', { ascending: true }),
    ])

    const nextError = playerRes.error ?? pairRes.error ?? roundRes.error
    if (nextError) {
      setError(nextError.message)
      return
    }

    setRows({
      playerRows: ((playerRes.data ?? []) as any[]).map(row => ({
        ...row,
        players: {
          pvna: getPlayerPvna(playersById.get(row.player_id)),
          elo: playersById.get(row.player_id)?.elo,
          gender: playersById.get(row.player_id)?.gender,
          partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref,
          opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref,
        },
        session_players: {
          metadata: playersById.get(row.player_id)?.metadata ?? null,
        },
      })),
      pairRows: (pairRes.data ?? []) as SessionPairHistoryRow[],
      roundRows: ((roundRes.data ?? []) as any[]).map(normalizeRoundRow),
    })
  }, [playersById, sessionId])

  React.useEffect(() => {
    let mounted = true
    async function run() {
      setLoading(true)
      await loadLiveState()
      if (mounted) setLoading(false)
    }
    void run()
    return () => {
      mounted = false
    }
  }, [loadLiveState])

  const rawState = useMemo(() => mapRowsToSessionState({
    sessionId,
    playerRows: rows.playerRows.map(row => ({
      ...row,
      players: {
        pvna: getPlayerPvna(playersById.get(row.player_id)) || row.players?.pvna || 0,
        elo: row.players?.elo,
        gender: playersById.get(row.player_id)?.gender ?? row.players?.gender,
        partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref ?? row.players?.partner_gender_pref,
        opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref ?? row.players?.opponent_gender_pref,
      },
      session_players: {
        metadata: playersById.get(row.player_id)?.metadata ?? row.session_players?.metadata ?? null,
      },
    })),
    pairRows: rows.pairRows,
    roundRows: rows.roundRows,
    courts: courtCount,
    pvnaTolerance,
  }), [courtCount, playersById, pvnaTolerance, rows, sessionId])

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

  const suggestion = useMemo(
    () => suggestNextRound(state, { tier_overrides: fairnessAdjustment.tier_overrides }),
    [fairnessAdjustment.tier_overrides, state],
  )
  const selected = suggestion.alternatives[selectedAlternative] ?? suggestion.alternatives[0]
  const workingAlternative = manualAlternative ?? selected
  const hasManualSwapHardGuard = Boolean(workingAlternative?.warnings.includes('MANUAL_SWAP_HARD_GUARD'))
  const fairnessScore = useMemo(() => computeSessionFairness(state), [state])
  const fairnessPreview = useMemo(
    () => buildFairnessPreview(state, workingAlternative),
    [state, workingAlternative],
  )
  const fairnessAudit = useMemo(() => buildLatestFairnessAudit(state), [state])
  const fairnessWarnings = useMemo(
    () => {
      const currentWarnings = detectFairnessIssues(state)
      const projectedState = workingAlternative
        ? previewStateAfterAlternative(state, workingAlternative)
        : null
      const projectedWarnings = projectedState ? detectFairnessIssues(projectedState) : []

      return buildFairnessWarningsForBanner(currentWarnings, projectedWarnings)
    },
    [state, workingAlternative],
  )
  const suggestedRoundActions = useMemo(
    () => buildSuggestedRoundActions({
      state,
      alternatives: suggestion.alternatives,
      selectedIndex: selectedAlternative,
      pvnaTolerance,
      courtCount,
    }),
    [courtCount, pvnaTolerance, selectedAlternative, state, suggestion.alternatives],
  )

  const rememberRoundSelection = (reason: string) => {
    setSelectionUndo({
      selectedAlternative,
      manualAlternative,
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
    setCourtCount(selectionUndo.courtCount)
    setSwapFromPlayerId(null)
    setSelectionUndo(null)
  }

  const selectAlternativeForRound = (index: number, reason = `ALT ${index + 1}`) => {
    if (selectedAlternative === index && manualAlternative === null) return
    rememberRoundSelection(reason)
    setSelectedAlternative(index)
    setManualAlternative(null)
    setSwapFromPlayerId(null)
  }

  const applySuggestedRoundAction = (action: SuggestedRoundAction) => {
    if (action.type === 'select_alternative') {
      rememberRoundSelection(action.label)
      setSelectedAlternative(action.alternative_index)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
      return
    }

    if (action.type === 'set_pvna_tolerance') {
      rememberRoundSelection(action.label)
      setPvnaTolerance(action.pvna_tolerance)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
      return
    }

    if (action.type === 'set_courts') {
      rememberRoundSelection(action.label)
      setCourtCount(action.courts)
      setSelectedAlternative(0)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
    }
  }
  const activeRound = useMemo(
    () => rows.roundRows.find(row => row.status === 'active') ?? null,
    [rows.roundRows],
  )
  const presentCount = rows.playerRows.filter(row => !row.checked_out_at).length
  const calculatorPlayerCount = presentCount || checkedInPlayers.length || confirmedPlayers.length
  const maxSelectableCourts = Math.max(1, Math.floor(Math.max(calculatorPlayerCount, presentCount) / 4), courts)
  const courtCalculator = useMemo(() => calculateOptimalCourts({
    n_players: calculatorPlayerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [calculatorPlayerCount, courtDurationMin, courtPreset])

  const effectiveTargetRounds = targetRounds ?? courtCalculator.recommended.total_rounds
  const applyCourtWarningAlternative = (alternative: CourtWarningAlternative) => {
    if (alternative.action === 'set_duration' && alternative.duration_min) {
      setCourtDurationMin(alternative.duration_min)
      setTargetRounds(alternative.preview.rounds)
      setShowSessionReport(false)
      return
    }

    if (alternative.action === 'set_preset' && alternative.preset) {
      setCourtPreset(alternative.preset)
      setShowSessionReport(false)
      return
    }

    if (alternative.action === 'set_courts' && alternative.courts) {
      setCourtCount(alternative.courts)
      setShowSessionReport(false)
      return
    }
  }
  const optedRestCount = rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length
  const completedRounds = rows.roundRows.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no)
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
  const groupSummaries = useMemo(() => buildGroupSummaries(rows.playerRows), [rows.playerRows])
  const groupAliases = useMemo(() => buildGroupAliasMap(groupSummaries), [groupSummaries])

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
      await loadLiveState()
    } catch (err: any) {
      setError(err?.message ?? 'Thao tác thất bại')
      Alert.alert('Lỗi', err?.message ?? 'Không thể thực hiện thao tác')
    } finally {
      setBusy(null)
    }
  }

  const syncRoster = async () => {
    await runAction('sync', async () => {
      const playerIds = await loadLatestSyncablePlayerIds(
        sessionId,
        checkedInPlayers.map(player => String(player.id)),
      )
      if (playerIds.length === 0) {
        throw new Error('Không có người chơi đã xác nhận để cập nhật danh sách. Vui lòng xác nhận ít nhất một người chơi trước khi cập nhật.')
      }

      await invokeLiveSessionFunction('session-sync-roster', sessionId, {
        player_ids: playerIds,
      })
    })
  }

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
  }, [activeRound, checkedInPlayers, loading, rows.playerRows])

  const setGroupForPlayers = async (playerIds: string[]) => {
    if (playerIds.length < 2) return

    await runAction(`group-${playerIds.join('-')}`, async () => {
      await invokeLiveSessionFunction('session-set-group', sessionId, {
        player_ids: playerIds,
      })
    })
  }

  const clearGroup = async (playerId: string) => {
    await runAction(`group-clear-${playerId}`, async () => {
      await invokeLiveSessionFunction('session-set-group', sessionId, {
        clear_player_id: playerId,
      })
    })
  }

  const clearWholeGroup = async (groupId: string) => {
    await runAction(`group-clear-${groupId}`, async () => {
      await invokeLiveSessionFunction('session-set-group', sessionId, {
        clear_group_id: groupId,
      })
    })
  }

  const toggleGroupSelection = (playerId: string) => {
    setGroupSelection(current => (
      current.includes(playerId)
        ? current.filter(id => id !== playerId)
        : [...current, playerId]
    ))
  }

  const createGroupFromSelection = async () => {
    if (groupSelection.length < 2) return
    await setGroupForPlayers(groupSelection)
    setGroupSelection([])
  }

  const toggleCheckout = async (playerId: string, checkedOut: boolean) => {
    await runAction(`checkout-${playerId}`, async () => {
      await invokeLiveSessionFunction(
        checkedOut ? 'session-checkin' : 'session-checkout',
        sessionId,
        { player_id: playerId },
      )
    })
  }

  const toggleRest = async (playerId: string, optedRest: boolean) => {
    await runAction(`rest-${playerId}`, async () => {
      await invokeLiveSessionFunction('session-request-rest', sessionId, {
        player_id: playerId,
        opted_rest: !optedRest,
      })
    })
  }

  const startRound = async (alternative: SuggestionAlternative) => {
    await runAction('start', async () => {
      if (activeRound) throw new Error('Đang có vòng active. Hãy end vòng hiện tại trước.')

      await invokeLiveSessionFunction('session-rounds-start', sessionId, {
        suggestion_idx: selectedAlternative,
        manual: alternative.matches,
        expected_state_fingerprint: buildSessionStateFingerprint(state),
        courts: courtCount,
        pvna_tolerance: pvnaTolerance,
        decision_context: {
          selected_alternative_index: selectedAlternative,
          manual_swap_applied: manualAlternative !== null,
          last_host_action: selectionUndo?.reason ?? null,
          setup: {
            court_count: courtCount,
            pvna_tolerance: pvnaTolerance,
            court_preset: courtPreset,
            court_duration_min: courtDurationMin,
            target_rounds: effectiveTargetRounds,
          },
          selected_alternative: {
            score: alternative.score,
            stats: alternative.stats,
            warnings: alternative.warnings,
          },
          fairness_preview: fairnessPreview,
          fairness_warnings: fairnessWarnings.map(warning => ({
            severity: warning.severity,
            type: warning.type,
            affected_players: warning.affected_players,
            message: warning.message,
            suggested_action: warning.suggested_action,
          })),
          available_actions: suggestedRoundActions.map(action => ({
            type: action.type,
            label: action.label,
            detail: action.detail,
          })),
        },
      })
    })
  }

  const endActiveRound = async () => {
    await runAction('end', async () => {
      if (!activeRound) throw new Error('Không có vòng active.')

      const payload = await invokeLiveSessionFunction('session-rounds-end', sessionId, {}, { round_no: activeRound.round_no })
      const invalidDeltas = payload?.commit_audit?.deltas?.filter((row: any) =>
        row?.played ? row?.delta !== 1 : row?.delta !== 0
      ) ?? []
      if (invalidDeltas.length > 0) {
        throw new Error(`Commit audit mismatch: ${invalidDeltas.length} player counts changed unexpectedly.`)
      }
    })
  }

  React.useEffect(() => {
    setManualAlternative(null)
    setSwapFromPlayerId(null)
  }, [selectedAlternative, suggestion])

  const swapPlayersInWorkingAlternative = (fromId: string, toId: string) => {
    const base = manualAlternative ?? suggestion.alternatives[selectedAlternative]
    if (!base || fromId === toId) return

    const result = buildSwappedAlternative(base, state, fromId, toId)
    if (!result.alternative) {
      if (result.error) setError(result.error)
      return
    }

    rememberRoundSelection(`Swap ${fromId}`)
    setManualAlternative(result.alternative)
    setSwapFromPlayerId(null)
  }

  if (loading) return <AppLoading fullScreen />

    return (
    <ScrollView
      style={{ flex: 1, backgroundColor: UI_THEME.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. HEADER & SESSION STATUS */}
      <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginBottom: 16, ...DASHBOARD_SHADOW.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.primary, fontWeight: '900', letterSpacing: 1, marginBottom: 4 }}>
              NEXT ROUND SUGGESTER
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 24, color: UI_THEME.textMain, fontWeight: '900' }}>
              Dashboard
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity 
              onPress={loadLiveState}
              disabled={busy === 'sync'}
              style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: UI_THEME.background, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: UI_THEME.border }}
            >
              {busy === 'sync' ? <ActivityIndicator size="small" color={UI_THEME.primary} /> : <RefreshCcw size={18} color={UI_THEME.textMain} />}
            </TouchableOpacity>
            <View style={{ backgroundColor: UI_THEME.accent, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: UI_THEME.primary, fontWeight: '900' }}>
                VÒNG {state.current_round}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          {[
            { label: 'CÓ MẶT', value: `${presentCount}/${checkedInPlayers.length}`, color: UI_THEME.primary },
            { label: 'XIN NGHỈ', value: optedRestCount, color: '#A05A16' },
            { label: 'SÂN', value: courtCount, color: UI_THEME.secondary },
          ].map((item, idx) => (
            <View key={idx} style={{ flex: 1, backgroundColor: UI_THEME.background, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: UI_THEME.border }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 4 }}>{item.label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: item.color, fontWeight: '900' }}>{item.value}</Text>
            </View>
          ))}
        </View>

        {error && (
          <View style={{ backgroundColor: UI_THEME.danger, borderRadius: 12, padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="#B91C1C" />
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#B91C1C', fontWeight: '700' }}>{error}</Text>
          </View>
        )}
      </View>

      {/* 2. OPTIMIZATION SETTINGS */}
      <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginBottom: 16, ...DASHBOARD_SHADOW.sm }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: UI_THEME.textMain, fontWeight: '900', marginBottom: 16 }}>
          Cài đặt tối ưu
        </Text>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 10 }}>SỐ SÂN VÒNG NÀY</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Array.from({ length: maxSelectableCourts }, (_, index) => index + 1).map(value => {
              const active = courtCount === value
              const disabled = value > Math.max(1, Math.floor(calculatorPlayerCount / 4))
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setCourtCount(value)}
                  disabled={disabled}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? UI_THEME.primary : '#F8F3E8',
                    borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border,
                    opacity: disabled ? 0.35 : 1,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>{value}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 10 }}>CHẾ ĐỘ (PRESET)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {COURT_PRESET_OPTIONS.map(preset => {
              const active = courtPreset === preset
              return (
                <TouchableOpacity
                  key={preset}
                  onPress={() => setCourtPreset(preset)}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? UI_THEME.secondary : '#F8F3E8',
                    borderWidth: 1, borderColor: active ? UI_THEME.secondary : UI_THEME.border,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>{PRESETS[preset].label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 10 }}>DUNG SAI PVNA (TOLERANCE)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0.3, 0.5, 0.8, 1.0].map(value => {
              const active = pvnaTolerance === value
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setPvnaTolerance(value)}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? UI_THEME.primary : '#F8F3E8',
                    borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>±{value.toFixed(1)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 10 }}>THỜI LƯỢNG SESSION (PHÚT)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {COURT_DURATION_OPTIONS.map(value => {
              const active = courtDurationMin === value
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setCourtDurationMin(value)}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? UI_THEME.primary : '#F8F3E8',
                    borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>{value}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 10 }}>MỤC TIÊU SỐ VÒNG (TARGET)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(() => {
              const rec = courtCalculator.recommended.total_rounds
              const options = [rec - 2, rec - 1, rec, rec + 1, rec + 2].filter(v => v > 0)
              return options.map(value => {
                const active = effectiveTargetRounds === value
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setTargetRounds(value)}
                    style={{
                      flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: active ? UI_THEME.primary : '#F8F3E8',
                      borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border,
                    }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>{value}</Text>
                  </TouchableOpacity>
                )
              })
            })()}
          </View>
        </View>

        <View style={{ backgroundColor: UI_THEME.accent, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.primary, fontWeight: '900', marginBottom: 4 }}>💡 GỢI Ý TỪ ENGINE</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textSub, lineHeight: 16 }}>
            Nên dùng {courtCalculator.recommended.courts} sân. {courtCalculator.reasoning}
          </Text>
          <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
              Repeat pressure: {courtCalculator.recommended.repeat_pressure.risk.toUpperCase()} | avg {courtCalculator.recommended.repeat_pressure.avg_matches_per_player.toFixed(1)} matches/player | opponent pressure {courtCalculator.recommended.repeat_pressure.opponent_pressure.toFixed(2)}
            </Text>
            {(courtCalculator.recommended.repeat_pressure.risk === 'high' || courtCalculator.recommended.repeat_pressure.risk === 'extreme') && (
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#92400E', lineHeight: 15, marginTop: 4, fontWeight: '700' }}>
                {STRINGS.host_flow.suggester.repeat_warning}
              </Text>
            )}
          </View>
        </View>

        {courtCalculator.setup_warnings.length > 0 && (
          <View style={{ gap: 10, marginBottom: 16 }}>
            {courtCalculator.setup_warnings.map((warning, idx) => (
              <View key={idx} style={{ backgroundColor: warning.severity === 'critical' ? UI_THEME.danger : UI_THEME.warning, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: warning.severity === 'critical' ? '#FCA5A5' : '#F3C979' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <AlertTriangle size={18} color={warning.severity === 'critical' ? '#B91C1C' : '#92400E'} />
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900' }}>{warning.message}</Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 6, lineHeight: 15 }}>{warning.why}</Text>
                
                {/* Keep existing action buttons for setup warnings */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {warning.alternatives.map((alt, aidx) => (
                    <TouchableOpacity
                      key={aidx}
                      disabled={alt.action === 'accept_tradeoff'}
                      onPress={() => applyCourtWarningAlternative(alt as any)}
                      style={{
                        backgroundColor: 'white', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                        borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
                        opacity: alt.action === 'accept_tradeoff' ? 0.5 : 1
                      }}
                    >
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: UI_THEME.primary, fontWeight: '900' }}>{alt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 12, borderTopWidth: 1, borderTopColor: UI_THEME.border, paddingTop: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 8 }}>MỤC TIÊU SESSION</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[Math.max(1, courtCalculator.recommended.total_rounds - 2), courtCalculator.recommended.total_rounds, courtCalculator.recommended.total_rounds + 2]
                .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
                .map(v => {
                  const active = targetRounds === v
                  return (
                    <TouchableOpacity
                      key={v}
                      onPress={() => { setTargetRounds(v); setShowSessionReport(false); }}
                      style={{ flex: 1, height: 36, borderRadius: 8, backgroundColor: active ? UI_THEME.primary : '#FFFCF5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border }}
                    >
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: active ? 'white' : UI_THEME.textSub, fontWeight: '900' }}>{v} VÒNG</Text>
                    </TouchableOpacity>
                  )
                })}
            </View>
          </View>
          <View style={{ width: 80, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: UI_THEME.textMuted, fontWeight: '900' }}>TIẾN ĐỘ</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: UI_THEME.textMain, fontWeight: '900' }}>{completedRoundCount}/{targetRounds}</Text>
          </View>
        </View>

        <TouchableOpacity 
          onPress={syncRoster} 
          disabled={busy === 'sync'}
          style={{ 
            marginTop: 16, backgroundColor: UI_THEME.secondary, height: 48, borderRadius: 14, 
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: busy === 'sync' ? 0.7 : 1
          }}
        >
          {busy === 'sync' ? <ActivityIndicator color="white" /> : <RefreshCcw size={18} color="white" />}
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: 'white', fontWeight: '900' }}>{STRINGS.host_flow.suggester.sync_list}</Text>
        </TouchableOpacity>
      </View>

        <FairnessBanner
          score={fairnessScore}
          warnings={fairnessWarnings}
          playersById={playersById}
          adjustmentReasons={fairnessAdjustment.applied_for_warnings}
          actions={suggestedRoundActions}
          onAction={applySuggestedRoundAction}
        />

      <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, ...DASHBOARD_SHADOW.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: UI_THEME.textMain, fontWeight: '900' }}>
              Gợi ý vòng kế tiếp
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 4 }}>
              {suggestion.should_end ? 'Kết thúc session' : `Tìm thấy ${suggestion.alternatives.length} phương án tối ưu`}
            </Text>
          </View>
          {suggestion.warnings.length > 0 && (
            <View style={{ backgroundColor: UI_THEME.warning, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 9, color: '#92400E', fontWeight: '900' }}>
                {suggestion.warnings.map(formatWarning).join(' · ')}
              </Text>
            </View>
          )}
        </View>

        {suggestion.alternatives.length === 0 ? (
          <View style={{ backgroundColor: UI_THEME.background, borderRadius: 12, padding: 20, alignItems: 'center' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: UI_THEME.textSub, textAlign: 'center', lineHeight: 18 }}>
              {suggestion.should_end 
                ? 'Không đủ người chơi hợp lệ. Cần ít nhất 4 người đang có mặt (In) và không nghỉ (Play).' 
                : 'Không tìm thấy phương án phù hợp. Thử tăng Dung sai (Tolerance) hoặc giảm số sân.'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {suggestion.alternatives.map((alt, idx) => {
                const active = selectedAlternative === idx
                return (
                  <TouchableOpacity
                    key={`alt-${idx}`}
                    onPress={() => selectAlternativeForRound(idx)}
                    style={{
                      flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: active ? UI_THEME.primary : UI_THEME.background,
                      borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border,
                      ...DASHBOARD_SHADOW.sm,
                    }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>
                      ALT {idx + 1} · {alt.score.toFixed(1)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {selectionUndo && (
              <View style={{ backgroundColor: UI_THEME.background, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: UI_THEME.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
                  {STRINGS.host_flow.suggester.undo_reason.replace('{reason}', selectionUndo.reason)}
                </Text>
                <MiniButton
                  label="Undo"
                  icon={<RefreshCcw size={13} color={UI_THEME.textMain} />}
                  muted
                  onPress={undoRoundSelection}
                />
              </View>
            )}

            {workingAlternative && (
              <View style={{ gap: 16 }}>
                <SuggestionStatsCard alternative={workingAlternative} />
                
                {fairnessPreview && <FairnessPreviewCard preview={fairnessPreview} />}
                
                <View style={{ gap: 12 }}>
                  {workingAlternative.matches.map(match => (
                    <MatchCard key={`suggest-${match.court_idx}`} match={match} state={state} playersById={playersById} />
                  ))}
                </View>

                <View style={{ backgroundColor: UI_THEME.background, borderRadius: 12, padding: 12 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
                    <Text style={{ fontWeight: '900' }}>NGƯỜI NGHỈ: </Text>
                    {workingAlternative.resting.map(id => playerName(id, playersById)).join(', ') || 'Không có'}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: UI_THEME.textMuted, marginTop: 4 }}>
                    Runtime: {workingAlternative.runtime_ms ?? 0}ms · Iter: {workingAlternative.iterations ?? '-'}
                  </Text>
                </View>

                {hasManualSwapHardGuard && (
                  <View style={{ backgroundColor: UI_THEME.danger, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={16} color="#B91C1C" />
                    <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#B91C1C', fontWeight: '700' }}>
                      Swap hiện tại vi phạm Hard Guard (PVNA/Team). Hãy chọn phương án khác.
                    </Text>
                  </View>
                )}

                <ManualSwapPanel
                  alternative={workingAlternative}
                  state={state}
                  playersById={playersById}
                  selectedPlayerId={swapFromPlayerId}
                  onSelectPlayer={setSwapFromPlayerId}
                  onSwap={swapPlayersInWorkingAlternative}
                  onReset={() => { setManualAlternative(null); setSwapFromPlayerId(null); }}
                />

                <ActionButton
                  label={targetReached ? 'CHẠY THÊM VÒNG' : 'BẮT ĐẦU VÒNG ĐÃ CHỌN'}
                  icon={<Play size={18} color="white" />}
                  loading={busy === 'start'}
                  disabled={Boolean(activeRound) || hasManualSwapHardGuard}
                  onPress={() => startRound(workingAlternative)}
                />
              </View>
            )}
          </View>
        )}
      </View>

      {targetReached && !activeRound && (
        <View style={{ backgroundColor: UI_THEME.accent, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, borderWidth: 1, borderColor: UI_THEME.primary, ...DASHBOARD_SHADOW.sm }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: UI_THEME.primary, fontWeight: '900' }}>
            🎉 ĐÃ ĐẠT MỤC TIÊU {effectiveTargetRounds} VÒNG
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: UI_THEME.textSub, marginTop: 8, lineHeight: 18 }}>
            Bạn đã hoàn thành đủ số vòng mục tiêu. Nên kết thúc session và xem báo cáo tổng kết Fairness.
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            <ActionButton
              label={showSessionReport ? 'ẨN REPORT' : 'XEM TỔNG KẾT'}
              icon={<Star size={18} color="white" />}
              onPress={() => setShowSessionReport(current => !current)}
            />
            {workingAlternative && (
              <ActionButton
                label="CHƠI THÊM VÒNG"
                icon={<Play size={18} color="white" />}
                loading={busy === 'start'}
                disabled={Boolean(activeRound)}
                onPress={() => startRound(workingAlternative)}
                danger={false}
              />
            )}
          </View>
        </View>
      )}

      {activeRound && (
        <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, borderWidth: 2, borderColor: UI_THEME.primary, ...DASHBOARD_SHADOW.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: UI_THEME.primary, fontWeight: '900' }}>
              VÒNG {activeRound.round_no} ĐANG DIỄN RA
            </Text>
            <ActivityIndicator size="small" color={UI_THEME.primary} />
          </View>
          <View style={{ gap: 12, marginBottom: 20 }}>
            {activeRound.matches.map(match => (
              <MatchCard key={`active-${match.court_idx}`} match={match} state={state} playersById={playersById} />
            ))}
          </View>
          <ActionButton
            label="KẾT THÚC & LƯU VÒNG"
            icon={<CheckCircle2 size={18} color="white" />}
            loading={busy === 'end'}
            onPress={endActiveRound}
            danger={false}
          />
        </View>
      )}

      <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, ...DASHBOARD_SHADOW.sm }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: UI_THEME.textMain, fontWeight: '900', marginBottom: 16 }}>
          Người chơi Live ({rows.playerRows.length})
        </Text>
        <View style={{ gap: 10 }}>
          {rows.playerRows.length === 0 ? (
            <View style={{ backgroundColor: UI_THEME.background, borderRadius: 12, padding: 20, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: UI_THEME.border }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: UI_THEME.textMuted, textAlign: 'center' }}>
                {STRINGS.host_flow.suggester.sync_required_hint}
              </Text>
            </View>
          ) : rows.playerRows.map(row => {
            const player = playersById.get(row.player_id)
            const checkedOut = Boolean(row.checked_out_at)
            const isSelected = groupSelection.includes(row.player_id)
            return (
              <View key={row.player_id} style={{ backgroundColor: checkedOut ? '#F9FAFB' : 'white', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: isSelected ? UI_THEME.primary : UI_THEME.border, opacity: checkedOut ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: UI_THEME.textMain, fontWeight: '900' }}>
                      {player?.name ?? row.player_id}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {row.group_id && (
                        <View style={{ backgroundColor: UI_THEME.accent, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: UI_THEME.primary, fontWeight: '900' }}>
                            {groupAliases.get(row.group_id) ?? shortGroupId(row.group_id)}
                          </Text>
                        </View>
                      )}
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub }}>
                        PVNA {getPlayerPvna(player).toFixed(2)} · Trận {row.matches_played} · Nghỉ {row.consecutive_rest}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <MiniButton
                      label={isSelected ? 'PICKED' : 'GROUP'}
                      loading={busy?.startsWith('group-')}
                      onPress={() => toggleGroupSelection(row.player_id)}
                      muted={isSelected}
                    />
                    {row.group_id && (
                      <MiniButton
                        label="CLEAR"
                        loading={busy === `group-clear-${row.player_id}`}
                        onPress={() => clearGroup(row.player_id)}
                        muted
                      />
                    )}
                    <MiniButton
                      label={checkedOut ? 'IN' : 'OUT'}
                      loading={busy === `checkout-${row.player_id}`}
                      onPress={() => toggleCheckout(row.player_id, checkedOut)}
                      muted={checkedOut}
                    />
                    <MiniButton
                      label={row.opted_rest ? 'PLAY' : 'REST'}
                      loading={busy === `rest-${row.player_id}`}
                      onPress={() => toggleRest(row.player_id, row.opted_rest)}
                      muted={row.opted_rest}
                    />
                  </View>
                </View>
              </View>
            )
          })} 
        </View>

        {rows.playerRows.length > 0 && (
          <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: UI_THEME.border }}>
            {groupSummaries.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 10 }}>NHÓM HIỆN TẠI</Text>
                <View style={{ gap: 8 }}>
                  {groupSummaries.map(group => (
                    <View key={group.group_id} style={{ backgroundColor: UI_THEME.background, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: UI_THEME.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: UI_THEME.textMain, fontWeight: '900' }} numberOfLines={1}>
                        {group.label}: {group.player_ids.map(id => playerName(id, playersById)).join(', ')}
                      </Text>
                      <MiniButton label="XÓA NHÓM" loading={busy === `group-clear-${group.group_id}`} onPress={() => clearWholeGroup(group.group_id)} muted />
                    </View>
                  ))}
                </View>
              </View>
            )}
            
            <View style={{ backgroundColor: UI_THEME.background, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
                💡 Chọn 2+ người chơi để tạo Nhóm bạn bè. Engine sẽ ưu tiên xếp họ cùng team hoặc cùng sân nhưng không bắt buộc.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ActionButton
                label={`TẠO NHÓM (${groupSelection.length})`}
                loading={busy?.startsWith('group-')}
                disabled={groupSelection.length < 2}
                onPress={createGroupFromSelection}
              />
              {groupSelection.length > 0 && (
                <TouchableOpacity 
                  onPress={() => setGroupSelection([])}
                  style={{ width: 44, height: 52, borderRadius: 16, backgroundColor: UI_THEME.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={20} color={UI_THEME.textMain} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>

      {completedRounds.length > 0 && showSessionReport && (
        <SessionFairnessSummaryCard
          summary={sessionSummary}
          state={reportState}
          matchCountConsistencyRows={matchCountConsistencyRows}
          playersById={playersById}
          durationMinutes={courtDurationMin}
          groupSummaries={groupSummaries}
        />
      )}
      {fairnessAudit && (
        <FairnessAuditCard audit={fairnessAudit} />
      )}
      {completedRounds.length > 0 && (
        <CompletedRoundsRecap rounds={completedRounds} state={state} playersById={playersById} />
      )}
    </ScrollView>
  )
}

async function invokeLiveSessionFunction(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown> = {},
  extraQuery: Record<string, string | number> = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Thiếu cấu hình hàm dịch vụ Supabase')
  }

  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Phiên đăng nhập Host đã hết hạn')
  }

  const query = new URLSearchParams({ session_id: sessionId })
  Object.entries(extraQuery).forEach(([key, value]) => query.set(key, String(value)))

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Edge Function ${functionName} failed`)
  }

  return payload
}

function FairnessBanner({
  score,
  warnings,
  playersById,
  adjustmentReasons,
  actions,
  onAction,
}: {
  score: SessionFairnessScore
  warnings: FairnessWarning[]
  playersById: Map<string, ArrangementPlayer>
  adjustmentReasons: string[]
  actions: SuggestedRoundAction[]
  onAction: (action: SuggestedRoundAction) => void
}) {
  const primaryWarning = warnings.find(warning => warning.severity === 'critical') ?? warnings[0]
  const primaryAction = actions[0]
  const tone = primaryWarning
    ? warningTone(primaryWarning.severity)
    : primaryAction
      ? warningTone('info')
      : { bg: '#E1F5EE', border: '#88D4B5', text: '#0F6E56' }

  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, borderWidth: 1, borderColor: tone.border, ...DASHBOARD_SHADOW.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 8 }}>
          {primaryWarning || primaryAction ? <AlertTriangle size={20} color={tone.text} /> : <CheckCircle2 size={20} color={tone.text} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: tone.text, fontWeight: '900' }}>
            Fairness {score.total}/100
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: tone.text, opacity: 0.8, fontWeight: '700' }}>
            {fairnessLabel(score).toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 16, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 16, padding: 12 }}>
        {primaryWarning ? (
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: tone.text, fontWeight: '600', lineHeight: 18 }}>
            {primaryWarning.message} {formatAffectedPlayers(primaryWarning.affected_players, playersById)}
          </Text>
        ) : primaryAction ? (
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: tone.text, fontWeight: '600', lineHeight: 18 }}>
            Có phương án một chạm để tối ưu repeat/range trước khi bắt đầu.
          </Text>
        ) : (
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: tone.text, fontWeight: '600' }}>
            Hệ thống đang ở trạng thái cân bằng tốt.
          </Text>
        )}
      </View>

      {primaryWarning && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: tone.text, fontWeight: '900' }}>GỢI Ý:</Text>
          <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: tone.text, lineHeight: 16 }}>{primaryWarning.suggested_action}</Text>
        </View>
      )}

      {adjustmentReasons.length > 0 && (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900' }}>
            ENGINE TỰ HIỆU CHỈNH: <Text style={{ color: UI_THEME.textMain }}>{adjustmentReasons.join(', ').replace(/_/g, ' ')}</Text>
          </Text>
        </View>
      )}

      {actions.length > 0 && (
        <View style={{ gap: 10, marginTop: 16 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: tone.text, fontWeight: '900', letterSpacing: 0.5 }}>
            ONE-TAP ALTERNATIVES (TRADEOFFS)
          </Text>
          <View style={{ gap: 8 }}>
            {actions.map((action, index) => {
              const actionTone = suggestedActionTone(action, tone.border)
              return (
                <TouchableOpacity
                  key={`${action.type}-${index}`}
                  disabled={action.type === 'accept_tradeoff'}
                  onPress={() => onAction(action)}
                  style={{
                    borderRadius: 14,
                    padding: 12,
                    backgroundColor: actionTone.bg,
                    borderWidth: 1,
                    borderColor: actionTone.border,
                    ...DASHBOARD_SHADOW.sm,
                    opacity: action.type === 'accept_tradeoff' ? 0.75 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: actionTone.text, fontWeight: '900' }}>
                      {action.label}
                    </Text>
                    {action.type !== 'accept_tradeoff' && <Play size={12} color={actionTone.text} />}
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
                    {action.detail}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}
    </View>
  )
}

function suggestedActionTone(action: SuggestedRoundAction, defaultBorder: string) {
  if (action.type === 'accept_tradeoff') {
    return { bg: '#FFFCF5', border: defaultBorder, text: '#596864' }
  }

  const after = 'after' in action ? action.after : undefined
  if (!after) return { bg: '#FFFFFF', border: defaultBorder, text: '#0F6E56' }

  const fairnessDelta = after.fairness_total - action.before.fairness_total
  const rangeDelta = after.match_range - action.before.match_range
  const repeatDelta =
    after.opponent_repeat_pairs +
    after.partner_repeat_pairs -
    action.before.opponent_repeat_pairs -
    action.before.partner_repeat_pairs

  if (rangeDelta > 0 || fairnessDelta < -2) {
    return { bg: '#FFF7D6', border: '#E5B94E', text: '#92400E' }
  }

  if (fairnessDelta > 0 || repeatDelta < 0) {
    return { bg: '#E1F5EE', border: '#88D4B5', text: '#0F6E56' }
  }

  return { bg: '#FFFFFF', border: defaultBorder, text: '#0F6E56' }
}

function SessionFairnessSummaryCard({
  summary,
  state,
  matchCountConsistencyRows,
  playersById,
  durationMinutes,
  groupSummaries,
}: {
  summary: SessionSummary
  state: SessionState
  matchCountConsistencyRows: MatchCountConsistencyRow[]
  playersById: Map<string, ArrangementPlayer>
  durationMinutes?: number
  groupSummaries: GroupSummary[]
}) {
  const maxMatches = Math.max(1, ...summary.per_player.map(player => player.matches_played))
  const matchCounts = summary.per_player.map(player => player.matches_played)
  const matchRange = matchCounts.length === 0 ? 0 : Math.max(...matchCounts) - Math.min(...matchCounts)
  const displayedDuration = durationMinutes ?? summary.duration_minutes
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const gender = computeGenderPrefSatisfaction(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const repeatPressure = computeRepeatPressure(state)
  const groupAuditRows = buildGroupAuditRows(state, groupSummaries)
  const breakdown = summary.fairness_score.breakdown
  const partnerRepeats = partner.repeat_pairs.filter(pair => pair.count > 1)
  const opponentRepeats = opponent.repeat_pairs.filter(pair => pair.count > 1)
  const breakdownRows = [
    ['Số trận', breakdown.match_count, 25, `chênh lệch ${matchRange}, TB ${averageNumber(matchCounts).toFixed(1)}`],
    ['Đồng đội', breakdown.partner_diversity, 20, `tỉ lệ ${(partner.avg_diversity_ratio * 100).toFixed(0)}%, gốc ${(20 * partner.avg_diversity_ratio).toFixed(1)}/20, áp lực lặp ${repeatPressure.repeat_risk === 'low' ? 'thấp' : repeatPressure.repeat_risk === 'medium' ? 'vừa' : 'cao'} x${repeatPressure.penalty_multiplier.toFixed(2)}, số cặp lặp ${partnerRepeats.length}`],
    ['Đối thủ', breakdown.opponent_diversity, 15, `tỉ lệ ${(opponent.avg_diversity_ratio * 100).toFixed(0)}%, gốc ${(15 * opponent.avg_diversity_ratio).toFixed(1)}/15, áp lực lặp ${repeatPressure.repeat_risk === 'low' ? 'thấp' : repeatPressure.repeat_risk === 'medium' ? 'vừa' : 'cao'} x${repeatPressure.penalty_multiplier.toFixed(2)}, cặp lặp đối thủ ${opponentRepeats.length}, tải lặp đối thủ tối đa ${opponentBurden.max_repeated_opponents}`],
    ['Nghỉ', breakdown.rest, 20, `vi phạm nghỉ ${rest.violations.length}`],
    ['Sở thích giới tính', breakdown.gender_prefs, 20, `${gender.satisfied_count}/${gender.total_pref_opportunities} thỏa mãn (${Math.round(gender.satisfaction_rate * 100)}%)`],
  ] as const
  const lines = [
    `Chênh tối đa ${matchRange} trận`,
    `Trung bình ${averageNumber(summary.per_player.map(player => player.unique_partners)).toFixed(1)} đồng đội khác/người`,
    `${Math.round(summary.overall_pref_satisfaction_rate * 100)}% sở thích được đáp ứng`,
  ]

  return (
    <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, borderWidth: 1, borderColor: UI_THEME.border, ...DASHBOARD_SHADOW.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: UI_THEME.textMain, fontWeight: '900' }}>
            Tổng kết Fairness
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textSub, marginTop: 4 }}>
            {summary.total_rounds} vòng · {summary.total_players} người · {displayedDuration} phút
          </Text>
        </View>
        <View style={{ backgroundColor: UI_THEME.accent, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', ...DASHBOARD_SHADOW.sm }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 22, color: UI_THEME.primary, fontWeight: '900' }}>
            {summary.fairness_score.total}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.primary, fontWeight: '900', letterSpacing: 0.5 }}>
            {fairnessLabel(summary.fairness_score).toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={{ gap: 10, marginBottom: 20 }}>
        {summary.per_player.map(player => (
          <View key={`fairness-player-${player.player_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ width: 100, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900' }} numberOfLines={1}>
              {playerName(player.player_id, playersById)}
            </Text>
            <View style={{ flex: 1, height: 8, backgroundColor: UI_THEME.background, borderRadius: 999, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(8, (player.matches_played / maxMatches) * 100)}%`, height: '100%', backgroundColor: UI_THEME.primary }} />
            </View>
            <Text style={{ width: 20, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900', textAlign: 'right' }}>
              {player.matches_played}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 16, marginBottom: 20 }}>
        {lines.map((line, idx) => (
          <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <CheckCircle2 size={12} color={UI_THEME.primary} />
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textSub, lineHeight: 18 }}>
              {line}
            </Text>
          </View>
        ))}
        {summary.highlights.flagged_issues.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <AlertTriangle size={12} color={UI_THEME.warning} />
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#92400E', fontWeight: '700' }}>
              {summary.highlights.flagged_issues.length} cảnh báo fairness cần theo dõi
            </Text>
          </View>
        )}
      </View>

      <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: UI_THEME.border, ...DASHBOARD_SHADOW.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.textMain, fontWeight: '900' }}>
            REPEAT PRESSURE
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: repeatPressure.repeat_risk === 'extreme' || repeatPressure.repeat_risk === 'high' ? '#A05A16' : UI_THEME.primary, fontWeight: '900' }}>
            {repeatPressure.repeat_risk.toUpperCase()} x{repeatPressure.penalty_multiplier.toFixed(2)}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
          Setup: {repeatPressure.active_players} players, {repeatPressure.courts} courts, {repeatPressure.rounds_completed} rounds. Avg {repeatPressure.avg_matches_per_player.toFixed(1)} matches/player, play ratio {Math.round(repeatPressure.play_ratio * 100)}%, opponent pressure {repeatPressure.opponent_pressure.toFixed(2)}.
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textMuted, lineHeight: 15, marginTop: 6 }}>
          Raw repeat is still shown below; fairness score reduces repeat penalty when setup makes repeat unavoidable.
        </Text>
      </View>

      <View style={{ gap: 12, marginBottom: 20 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', letterSpacing: 0.5 }}>CHI TIẾT ĐIỂM SỐ</Text>
        {breakdownRows.map(([label, value, max, detail]) => (
          <View key={`breakdown-${label}`} style={{ backgroundColor: 'white', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: UI_THEME.border, ...DASHBOARD_SHADOW.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Text style={{ width: 80, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900' }}>
                {label}
              </Text>
              <View style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: UI_THEME.background, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(4, (value / max) * 100)}%`, height: '100%', backgroundColor: value === max ? UI_THEME.primary : UI_THEME.secondary }} />
              </View>
              <Text style={{ width: 44, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: UI_THEME.textMain, fontWeight: '900' }}>
                {value}/{max}
              </Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textMuted, lineHeight: 14 }}>
              {detail}
            </Text>
          </View>
        ))}
      </View>

      {matchCountConsistencyRows.length > 0 && (
        <View style={{ backgroundColor: UI_THEME.danger, borderRadius: 16, padding: 16, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={16} color="#B91C1C" />
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#B91C1C', fontWeight: '900' }}>
              CẢNH BÁO DỮ LIỆU
            </Text>
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B91C1C', marginBottom: 8, opacity: 0.8 }}>
            Live state khác replay từ lịch sử. Report đang dùng dữ liệu Replay.
          </Text>
          <View style={{ gap: 4 }}>
            {matchCountConsistencyRows.slice(0, 8).map(row => (
              <Text key={`mismatch-${row.player_id}`} style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B91C1C', fontWeight: '700' }}>
                • {playerName(row.player_id, playersById)}: live {row.live}, replay {row.replay}
              </Text>
            ))}
          </View>
        </View>
      )}

      <View style={{ gap: 12, marginBottom: 20 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', letterSpacing: 0.5 }}>THỐNG KÊ LẶP</Text>
        <RepeatPairsBlock title="Partner lặp" pairs={partnerRepeats} playersById={playersById} emptyText="Không có cặp partner lặp 2+ lần." />
        <RepeatPairsBlock title="Đối thủ lặp" pairs={opponentRepeats} playersById={playersById} emptyText="Không có cặp đối thủ lặp 2+ lần." />
        <OpponentBurdenBlock burden={opponentBurden} playersById={playersById} />
      </View>

      <View style={{ gap: 12, marginBottom: 20 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', letterSpacing: 0.5 }}>AUDIT NHÓM</Text>
        <GroupAuditBlock rows={groupAuditRows} playersById={playersById} />
      </View>

      {summary.fairness_evolution.length > 0 && (
        <View style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 16 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 12 }}>DIỄN BIẾN FAIRNESS</Text>
          <View style={{ gap: 8 }}>
            {summary.fairness_evolution.slice(-6).map(point => (
              <View key={`evolution-${point.round}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ width: 50, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textMuted, fontWeight: '900' }}>
                  VÒNG {point.round}
                </Text>
                <View style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: 'white', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.max(4, point.score)}%`, height: '100%', backgroundColor: UI_THEME.primary }} />
                </View>
                <Text style={{ width: 24, fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: UI_THEME.textMain, fontWeight: '900', textAlign: 'right' }}>
                  {point.score}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

function RepeatPairsBlock({
  title,
  pairs,
  playersById,
  emptyText,
}: {
  title: string
  pairs: Array<{ player_a: string; player_b: string; count: number }>
  playersById: Map<string, ArrangementPlayer>
  emptyText: string
}) {
  return (
    <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.textMain, fontWeight: '900', marginBottom: 10 }}>
        {title.toUpperCase()}
      </Text>
      {pairs.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textMuted }}>
          {emptyText}
        </Text>
      ) : (
        <View style={{ gap: 6 }}>
          {pairs.map(pair => (
            <View key={`${title}-${pair.player_a}-${pair.player_b}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textSub }}>
                {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: pair.count >= 3 ? '#A05A16' : UI_THEME.primary, fontWeight: '900' }}>
                {pair.count} lần
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function OpponentBurdenBlock({
  burden,
  playersById,
}: {
  burden: ReturnType<typeof computeOpponentRepeatBurden>
  playersById: Map<string, ArrangementPlayer>
}) {
  const rows = burden.per_player
    .filter(player => player.repeated_opponents > 0)
    .sort((a, b) => b.repeated_opponents - a.repeated_opponents)

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.textMain, fontWeight: '900', marginBottom: 10 }}>
        GÁNH NẶNG ĐỐI THỦ
      </Text>
      {rows.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textMuted }}>
          Không có ai bị lặp đối thủ.
        </Text>
      ) : (
        <View style={{ gap: 6 }}>
          {rows.map(row => (
            <View key={`burden-${row.player_id}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textSub }}>
                {playerName(row.player_id, playersById)}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: row.repeated_opponents >= 4 ? '#A05A16' : UI_THEME.primary, fontWeight: '900' }}>
                {row.repeated_opponents} đối thủ lặp
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function GroupAuditBlock({
  rows,
  playersById,
}: {
  rows: GroupAuditRow[]
  playersById: Map<string, ArrangementPlayer>
}) {
  if (rows.length === 0) {
    return (
      <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: UI_THEME.textMuted }}>
          Chưa có group nào được tạo.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ gap: 10 }}>
      {rows.map(row => (
        <View key={`group-audit-${row.group_id}`} style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.textMain, fontWeight: '900', marginBottom: 4 }}>
            {row.label}: {row.player_ids.map(id => playerName(id, playersById)).join(', ')}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginBottom: 8 }}>
            Cùng xuất hiện trong {row.shared_matches} trận.
          </Text>
          <View style={{ gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' }}>
            {row.pair_counts.map(pair => (
              <View key={`pair-${pair.player_a}-${pair.player_b}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textMuted }}>
                  {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: pair.count > 0 ? UI_THEME.primary : '#A05A16', fontWeight: '900' }}>
                  {pair.count} trận cùng team
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

function FairnessAuditCard({ audit }: { audit: FairnessAudit }) {
  return (
    <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, borderWidth: 1, borderColor: UI_THEME.border, ...DASHBOARD_SHADOW.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: UI_THEME.textMain, fontWeight: '900' }}>
            Audit điểm Fairness
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 4 }}>
            Sau vòng {audit.round_no}: {audit.before_total} → {audit.after_total}
          </Text>
        </View>
        <View style={{ backgroundColor: audit.delta_total >= 0 ? UI_THEME.accent : UI_THEME.warning, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: audit.delta_total >= 0 ? UI_THEME.primary : '#B45309', fontWeight: '900' }}>
            {audit.delta_total > 0 ? '+' : ''}{audit.delta_total}
          </Text>
        </View>
      </View>

      <View style={{ gap: 10, marginTop: 16 }}>
        <View style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: UI_THEME.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.textMain, fontWeight: '900' }}>
              Repeat pressure
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: audit.pressure_after.repeat_risk === 'extreme' || audit.pressure_after.repeat_risk === 'high' ? '#A05A16' : UI_THEME.primary, fontWeight: '900' }}>
              {audit.pressure_before.repeat_risk.toUpperCase()} {'->'} {audit.pressure_after.repeat_risk.toUpperCase()}
            </Text>
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 6, lineHeight: 15 }}>
            Multiplier {audit.pressure_before.penalty_multiplier.toFixed(2)} {'->'} {audit.pressure_after.penalty_multiplier.toFixed(2)}. Opponent pressure {audit.pressure_before.opponent_pressure.toFixed(2)} {'->'} {audit.pressure_after.opponent_pressure.toFixed(2)}.
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 4, lineHeight: 15 }}>
            Availability {audit.availability_before.churn_level.toUpperCase()} {'->'} {audit.availability_after.churn_level.toUpperCase()}, churn {(audit.availability_before.avg_churn_ratio * 100).toFixed(0)}% {'->'} {(audit.availability_after.avg_churn_ratio * 100).toFixed(0)}%, multiplier {audit.availability_before.penalty_multiplier.toFixed(2)} {'->'} {audit.availability_after.penalty_multiplier.toFixed(2)}.
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textMuted, marginTop: 4, lineHeight: 15 }}>
            Raw repeat stays visible; score impact is adjusted only when setup makes repeat hard to avoid.
          </Text>
        </View>

        {audit.rows.map(row => (
          <View key={row.key} style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: UI_THEME.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: UI_THEME.textMain, fontWeight: '900' }}>
                {row.label}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub }}>
                  {row.before} → {row.after}
                </Text>
                <Text style={{ width: 40, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: row.delta >= 0 ? UI_THEME.primary : '#B45309', fontWeight: '900' }}>
                  {row.delta > 0 ? '+' : ''}{row.delta}
                </Text>
              </View>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 6, lineHeight: 15 }}>
              {row.detail}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function FairnessPreviewCard({ preview }: { preview: FairnessPreview }) {
  const tone = preview.delta_total >= 0 ? UI_THEME.primary : '#B45309'

  return (
    <View style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: UI_THEME.textMain, fontWeight: '900' }}>
            Preview Fairness nếu bắt đầu
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, marginTop: 4 }}>
            Dự kiến: {preview.before_total} → {preview.after_total}
          </Text>
        </View>
        <View style={{ backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: tone, fontWeight: '900' }}>
            {preview.delta_total > 0 ? '+' : ''}{preview.delta_total}
          </Text>
        </View>
      </View>

      <View style={{ gap: 8, marginTop: 12 }}>
        <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)', ...DASHBOARD_SHADOW.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900' }}>
              Repeat pressure
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: preview.pressure_after.repeat_risk === 'extreme' || preview.pressure_after.repeat_risk === 'high' ? '#A05A16' : UI_THEME.primary, fontWeight: '900' }}>
              {preview.pressure_before.repeat_risk.toUpperCase()} {'->'} {preview.pressure_after.repeat_risk.toUpperCase()}
            </Text>
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: UI_THEME.textMuted, marginTop: 4, lineHeight: 13 }}>
            Multiplier {preview.pressure_before.penalty_multiplier.toFixed(2)} {'->'} {preview.pressure_after.penalty_multiplier.toFixed(2)}, opponent pressure {preview.pressure_before.opponent_pressure.toFixed(2)} {'->'} {preview.pressure_after.opponent_pressure.toFixed(2)}.
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: UI_THEME.textMuted, marginTop: 4, lineHeight: 13 }}>
            Availability {preview.availability_before.churn_level.toUpperCase()} {'->'} {preview.availability_after.churn_level.toUpperCase()}, churn {(preview.availability_before.avg_churn_ratio * 100).toFixed(0)}% {'->'} {(preview.availability_after.avg_churn_ratio * 100).toFixed(0)}%.
          </Text>
        </View>

        {preview.rows.map(row => (
          <View key={`preview-${row.key}`} style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)', ...DASHBOARD_SHADOW.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900' }}>
                {row.label}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub }}>
                  {row.before} → {row.after}
                </Text>
                <Text style={{ width: 34, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: row.delta >= 0 ? UI_THEME.primary : '#B45309', fontWeight: '900' }}>
                  {row.delta > 0 ? '+' : ''}{row.delta}
                </Text>
              </View>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: UI_THEME.textMuted, marginTop: 4, lineHeight: 13 }}>
              {row.detail}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function formatAffectedPlayers(playerIds: string[], playersById: Map<string, ArrangementPlayer>) {
  if (playerIds.length === 0) return ''
  return `(${playerIds.map(id => playerName(id, playersById)).join(', ')})`
}

function describeManualSwapImpact(audit: ManualSwapAudit) {
  const sign = audit.delta_fairness > 0 ? '+' : ''
  const parts = [
    `fairness ${sign}${audit.delta_fairness}`,
    `range ${audit.before.match_range}->${audit.after.match_range}`,
    `burden ${audit.before.max_opponent_burden}->${audit.after.max_opponent_burden}`,
    `opp max ${audit.before.max_opponent_pair}->${audit.after.max_opponent_pair}`,
    `partner max ${audit.before.max_partner_pair}->${audit.after.max_partner_pair}`,
  ]
  if (audit.invalid_matches > 0) parts.push(`${audit.invalid_matches} hard guard`)
  return parts.join(' · ')
}

function averageNumber(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function ManualSwapPanel({
  alternative,
  state,
  playersById,
  selectedPlayerId,
  onSelectPlayer,
  onSwap,
  onReset,
}: {
  alternative: SuggestionAlternative
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  selectedPlayerId: string | null
  onSelectPlayer: (playerId: string | null) => void
  onSwap: (fromId: string, toId: string) => void
  onReset: () => void
}) {
  const playingIds = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
  const targetIds = [...new Set([...playingIds, ...alternative.resting])].filter(id => id !== selectedPlayerId)
  const targetAuditRows = useMemo(() => {
    if (!selectedPlayerId) return targetIds.map(playerId => ({ playerId, audit: null }))

    return targetIds
      .map(playerId => ({ playerId, audit: auditManualSwap(state, alternative, selectedPlayerId, playerId) }))
      .sort((a, b) => {
        const aInvalid = a.audit ? a.audit.invalid_matches > 0 : true
        const bInvalid = b.audit ? b.audit.invalid_matches > 0 : true
        if (aInvalid !== bInvalid) return aInvalid ? 1 : -1
        const aDelta = a.audit?.delta_fairness ?? -999
        const bDelta = b.audit?.delta_fairness ?? -999
        if (aDelta !== bDelta) return bDelta - aDelta
        const aBurden = a.audit?.after.max_opponent_burden ?? 999
        const bBurden = b.audit?.after.max_opponent_burden ?? 999
        if (aBurden !== bBurden) return aBurden - bBurden
        return playerName(a.playerId, playersById).localeCompare(playerName(b.playerId, playersById))
      })
  }, [alternative, playersById, selectedPlayerId, state, targetIds])

  return (
    <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900' }}>
          SWAP TAY: CHỌN 1 NGƯỜI ĐANG ĐÁNH, RỒI CHỌN ĐỐI TƯỢNG ĐỔI CHỖ.
        </Text>
        <MiniButton label="Reset" onPress={onReset} muted />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {playingIds.map(playerId => {
          const active = selectedPlayerId === playerId
          return (
            <TouchableOpacity
              key={`swap-from-${playerId}`}
              onPress={() => onSelectPlayer(active ? null : playerId)}
              style={{
                borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
                backgroundColor: active ? UI_THEME.primary : UI_THEME.background,
                borderWidth: 1, borderColor: active ? UI_THEME.primary : UI_THEME.border,
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : UI_THEME.textMain, fontWeight: '900' }}>
                {playerName(playerId, playersById)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {selectedPlayerId && (
        <View style={{ gap: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900' }}>
            ĐỔI {playerName(selectedPlayerId, playersById).toUpperCase()} VỚI:
          </Text>
          <View style={{ gap: 6 }}>
            {targetAuditRows.map(({ playerId, audit }) => {
              const isResting = alternative.resting.includes(playerId)
              const isInvalid = Boolean(audit && audit.invalid_matches > 0)
              const isBetter = Boolean(audit && audit.delta_fairness > 0)
              const borderColor = isInvalid ? '#DC2626' : isBetter ? UI_THEME.primary : isResting ? '#E5B94E' : UI_THEME.border
              const backgroundColor = isInvalid ? '#FEF2F2' : isBetter ? UI_THEME.accent : isResting ? '#FFF7D6' : 'white'
              
              return (
                <TouchableOpacity
                  key={`swap-to-${playerId}`}
                  onPress={() => onSwap(selectedPlayerId, playerId)}
                  disabled={isInvalid}
                  style={{
                    borderRadius: 12, padding: 12,
                    backgroundColor, borderWidth: 1, borderColor,
                    opacity: isInvalid ? 0.6 : 1,
                    ...DASHBOARD_SHADOW.sm,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: UI_THEME.textMain, fontWeight: '900' }}>
                      {playerName(playerId, playersById)}{isResting ? ' (đang nghỉ)' : ''}
                    </Text>
                    {isBetter && <Star size={12} color={UI_THEME.primary} fill={UI_THEME.primary} />}
                  </View>
                  {audit && (
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: isInvalid ? '#B91C1C' : UI_THEME.textSub, marginTop: 4, lineHeight: 13 }}>
                      {describeManualSwapImpact(audit)}
                    </Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}
    </View>
  )
}

function CompletedRoundsRecap({
  rounds,
  state,
  playersById,
}: {
  rounds: SessionRoundRow[]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
}) {
  return (
    <View style={{ backgroundColor: UI_THEME.cardBg, borderRadius: DASHBOARD_RADIUS, padding: 20, marginTop: 16, ...DASHBOARD_SHADOW.sm }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: UI_THEME.textMain, fontWeight: '900', marginBottom: 16 }}>
        Lịch sử các vòng đã xong
      </Text>
      <View style={{ gap: 12 }}>
        {rounds.map(round => (
          <View key={round.id ?? `${round.session_id}-${round.round_no}`} style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: UI_THEME.border, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: UI_THEME.primary, fontWeight: '900' }}>
                VÒNG {round.round_no}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textMuted }}>
                {round.ended_at ? new Date(round.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </Text>
            </View>
            <View style={{ gap: 8 }}>
              {round.matches.map(match => (
                <MatchCard key={`completed-${round.round_no}-${match.court_idx}`} match={match} state={state} playersById={playersById} />
              ))}
            </View>
            <View style={{ marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 14 }}>
                <Text style={{ fontWeight: '900' }}>NGHỈ: </Text>
                {round.resting.map(id => playerName(id, playersById)).join(', ') || 'Không có'}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

function SuggestionStatsCard({ alternative }: { alternative: SuggestionAlternative }) {
  const metrics = [
    { label: 'CHÊNH LỆCH PVNA TỔNG', value: alternative.stats.pvna_diff.toFixed(2), tone: UI_THEME.primary },
    { label: 'ĐỒNG ĐỘI LẶP', value: String(alternative.stats.partner_repeats), tone: '#A05A16' },
    { label: 'ĐỐI THỦ LẶP', value: String(alternative.stats.opponent_repeats), tone: '#7C3AED' },
    { label: 'ĐIỂM NHÓM', value: String(alternative.stats.group_bonus), tone: '#2563EB' },
    { label: 'SỞ THÍCH GIỚI TÍNH', value: alternative.stats.gender_pref_penalty.toFixed(1), tone: '#BE185D' },
    { label: 'ĐIỂM TỔNG', value: alternative.score.toFixed(1), tone: UI_THEME.secondary },
  ]

  return (
    <View style={{ backgroundColor: UI_THEME.background, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: UI_THEME.border }}>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '900', marginBottom: 12, letterSpacing: 0.5 }}>
        LÝ DO PHƯƠNG ÁN NÀY ĐƯỢC CHỌN
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {metrics.map(metric => (
          <View key={metric.label} style={{ width: '31%', backgroundColor: 'white', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)', ...DASHBOARD_SHADOW.sm }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: UI_THEME.textMuted, fontWeight: '900' }}>{metric.label}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: metric.tone, fontWeight: '900', marginTop: 4 }}>{metric.value}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 14, backgroundColor: 'white', borderRadius: 10, padding: 8 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, lineHeight: 15 }}>
          💡 Engine ưu tiên: Không để ai nghỉ lâu, cân bằng PVNA, giảm lặp partner/đối thủ và tối ưu nhóm bạn.
        </Text>
      </View>
    </View>
  )
}

function MatchCard({ match, state, playersById }: { match: Match; state: SessionState; playersById: Map<string, ArrangementPlayer> }) {
  const diff = Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state))
  const scored = match.stats && match.score != null ? { score: match.score, stats: match.stats } : scoreMatch(match.team_a, match.team_b, state)
  const metrics = [
    ['SCORE', Number.isFinite(scored.score) ? scored.score.toFixed(1) : '-'],
    ['DIFF', scored.stats.pvna_diff.toFixed(2)],
    ['PARTNER', String(scored.stats.partner_repeats)],
    ['OPPONENT', String(scored.stats.opponent_repeats)],
  ]

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: UI_THEME.border, ...DASHBOARD_SHADOW.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ backgroundColor: UI_THEME.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: UI_THEME.primary, fontWeight: '900' }}>
            SÂN {match.court_idx + 1}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: UI_THEME.textSub, fontWeight: '700' }}>
          PVNA DIFF {diff.toFixed(2)}
        </Text>
      </View>

      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: UI_THEME.textMain, fontWeight: '900', lineHeight: 20 }}>
        {getMatchLabel(match, playersById)}
      </Text>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
        {metrics.map(([label, value]) => (
          <View key={`${match.court_idx}-${label}`} style={{ flex: 1, backgroundColor: UI_THEME.background, borderRadius: 8, paddingVertical: 6, alignItems: 'center' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 7, color: UI_THEME.textMuted, fontWeight: '900' }}>{label}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: UI_THEME.textMain, fontWeight: '900', marginTop: 2 }}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function ActionButton({
  label,
  icon,
  loading,
  onPress,
  disabled,
  danger,
}: {
  label: string
  icon?: React.ReactNode
  loading?: boolean
  onPress: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        flex: 1,
        height: 52,
        backgroundColor: danger ? '#B91C1C' : UI_THEME.primary,
        opacity: disabled ? 0.45 : loading ? 0.7 : 1,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 10,
        ...DASHBOARD_SHADOW.sm,
      }}
    >
      {loading ? <ActivityIndicator color="white" /> : icon}
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: 'white', fontWeight: '900' }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function MiniButton({
  label,
  icon,
  loading,
  onPress,
  muted,
}: {
  label: string
  icon?: React.ReactNode
  loading?: boolean
  onPress: () => void
  muted?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      style={{
        height: 34,
        backgroundColor: muted ? UI_THEME.border : UI_THEME.primary,
        opacity: loading ? 0.7 : 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
      }}
    >
      {loading ? <ActivityIndicator color={muted ? UI_THEME.textMain : 'white'} size="small" /> : icon}
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: muted ? UI_THEME.textMain : 'white', fontWeight: '900' }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}
