import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  History,
  MoreHorizontal,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  UserMinus,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react-native'

import { SecondaryNavbar } from '@/components/design'
import { BORDER, RADIUS, SHADOW, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { calculateOptimalCourts, PRESETS, type CourtPreset } from '@/lib/court-calculator'
import { buildSuggestedRoundActions, type SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import { auditManualSwap, buildSwappedAlternative } from '@/lib/next-round-suggester/manual-swap'
import { previewStateAfterAlternative, rebuildStateThroughRound } from '@/lib/next-round-suggester/history'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import { scoreMatch } from '@/lib/next-round-suggester/score'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues, type FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  buildFairnessPreview,
  type FairnessPreview,
} from '@/lib/next-round-suggester/fairness/audit'
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
import { buildSessionSummary } from '@/lib/next-round-suggester/fairness/summary'
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
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'

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

type SheetKey = 'settings' | 'swap' | 'fairness' | 'roster' | 'history' | 'more' | null

type RoundSelectionSnapshot = {
  selectedAlternative: number
  manualAlternative: SuggestionAlternative | null
  pvnaTolerance: number
  courtCount: number
  reason: string
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const COURT_PRESET_OPTIONS: CourtPreset[] = ['play_more', 'balanced', 'relaxed']
const COURT_DURATION_OPTIONS = [90, 120, 150]
const PVNA_TOLERANCE_OPTIONS = [0.3, 0.5, 0.8, 1.0]

function formatNumber(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

function getPlayerPvna(player?: ArrangementPlayer | null) {
  if (player?.pvna != null) return Number(player.pvna)
  if (player?.elo != null) return eloToPvna(Number(player.elo))
  return 0
}

function playerName(playerId: string, playersById: Map<string, ArrangementPlayer>) {
  return playersById.get(playerId)?.name ?? 'Người chơi'
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'P'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function getTeamPvna(team: [string, string], state: SessionState) {
  return team.reduce((sum, id) => sum + (state.players.get(id)?.pvna ?? 3.0), 0) / 2
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

function warningTone(theme: ReturnType<typeof useAppTheme>, severity: FairnessWarning['severity'] | 'ok') {
  if (severity === 'critical') return { bg: theme.dangerBg, border: theme.dangerText, text: theme.dangerText }
  if (severity === 'warning') return { bg: theme.warningBg, border: theme.warningStrong, text: theme.warningText }
  if (severity === 'info') return { bg: theme.infoBg, border: theme.outlineVariant, text: theme.infoText }
  return { bg: theme.successBg, border: theme.secondaryContainer, text: theme.successText }
}

function severityRank(severity: FairnessWarning['severity']) {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function warningIdentity(warning: FairnessWarning): string {
  return `${warning.type}:${[...warning.affected_players].sort().join(',')}`
}

function toProjectedWarning(warning: FairnessWarning): FairnessWarning {
  return {
    ...warning,
    message: `Nếu start phương án này: ${warning.message}`,
    suggested_action: warning.suggested_action.replace('Engine sẽ ', 'Engine đang '),
  }
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

async function invokeLiveSessionFunction(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown> = {},
  extraQuery: Record<string, string | number> = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase function configuration')
  }

  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Host login expired')
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

function ctaTextStyle(color: string, size = 15) {
  return {
    fontFamily: SCREEN_FONTS.cta,
    fontSize: size,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    color,
  }
}

function eyebrowStyle(color: string, size = 10) {
  return {
    fontFamily: SCREEN_FONTS.label,
    fontSize: size,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    color,
  }
}

export function NextRoundSuggesterScreenV2({ sessionId, players, courts }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rows, setRows] = useState<LiveRows>({ playerRows: [], pairRows: [], roundRows: [] })
  const [selectedAlternative, setSelectedAlternative] = useState(0)
  const [manualAlternative, setManualAlternative] = useState<SuggestionAlternative | null>(null)
  const [selectionUndo, setSelectionUndo] = useState<RoundSelectionSnapshot | null>(null)
  const [swapFromPlayerId, setSwapFromPlayerId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetKey>(null)
  const [error, setError] = useState<string | null>(null)
  const [pvnaTolerance, setPvnaTolerance] = useState(0.5)
  const [courtCount, setCourtCount] = useState(Math.max(1, Math.min(4, courts)))
  const [courtPreset, setCourtPreset] = useState<CourtPreset>('balanced')
  const [courtDurationMin, setCourtDurationMin] = useState(120)
  const [targetRounds, setTargetRounds] = useState<number | null>(null)
  const [expandedRosterPlayer, setExpandedRosterPlayer] = useState<string | null>(null)
  const [showEngineStats, setShowEngineStats] = useState(false)

  const confirmedPlayers = useMemo(
    () => players.filter(player => player.status === 'confirmed' || !player.status),
    [players],
  )
  const checkedInPlayers = useMemo(() => {
    const explicitlyPresent = confirmedPlayers.filter(isRosterSyncEligible)
    return explicitlyPresent.length > 0 ? explicitlyPresent : confirmedPlayers.filter(isConfirmedNonNoShow)
  }, [confirmedPlayers])
  const playersById = useMemo(() => new Map(players.map(player => [String(player.id), player])), [players])

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
  const fairnessScore = useMemo(() => computeSessionFairness(state), [state])
  const fairnessPreview = useMemo(
    () => buildFairnessPreview(state, workingAlternative),
    [state, workingAlternative],
  )
  const fairnessWarnings = useMemo(() => {
    const currentWarnings = detectFairnessIssues(state)
    const projectedState = workingAlternative ? previewStateAfterAlternative(state, workingAlternative) : null
    const projectedWarnings = projectedState ? detectFairnessIssues(projectedState) : []
    return buildFairnessWarningsForBanner(currentWarnings, projectedWarnings)
  }, [state, workingAlternative])

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

  const activeRound = useMemo(() => rows.roundRows.find(row => row.status === 'active') ?? null, [rows.roundRows])
  const presentRows = rows.playerRows.filter(row => !row.checked_out_at)
  const presentCount = presentRows.length
  const calculatorPlayerCount = presentCount || checkedInPlayers.length || confirmedPlayers.length
  const courtCalculator = useMemo(() => calculateOptimalCourts({
    n_players: calculatorPlayerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [calculatorPlayerCount, courtDurationMin, courtPreset])
  const effectiveTargetRounds = targetRounds ?? courtCalculator.recommended.total_rounds
  const completedRounds = rows.roundRows.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no)
  const completedRoundCount = completedRounds.length
  const targetReached = effectiveTargetRounds > 0 && completedRoundCount >= effectiveTargetRounds
  const reportState = useMemo(
    () => (completedRoundCount > 0 ? rebuildStateThroughRound(state, completedRounds[0].round_no) : state),
    [completedRoundCount, completedRounds, state],
  )
  const sessionSummary = useMemo(() => sanitizeSummaryForHost(buildSessionSummary(reportState)), [reportState])
  const phase: 'plan' | 'active' | 'recap' = targetReached && !activeRound ? 'recap' : activeRound ? 'active' : 'plan'

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

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
      await loadLiveState()
    } catch (err: any) {
      setError(err?.message ?? 'Action failed')
      Alert.alert('Lỗi', err?.message ?? 'Không thể thực hiện thao tác')
    } finally {
      setBusy(null)
    }
  }

  const syncRoster = async () => {
    await runAction('sync', async () => {
      const playerIds = checkedInPlayers.map(player => String(player.id))
      if (playerIds.length === 0) {
        throw new Error('Không có người chơi đã xác nhận để sync.')
      }
      await invokeLiveSessionFunction('session-sync-roster', sessionId, { player_ids: playerIds })
    })
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
      if (activeRound) throw new Error('Đang có vòng active. Hãy kết thúc vòng hiện tại trước.')
      await invokeLiveSessionFunction('session-rounds-start', sessionId, {
        suggestion_idx: selectedAlternative,
        manual: alternative.matches,
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
        throw new Error(`Commit audit mismatch: ${invalidDeltas.length} người bị đổi số trận sai.`)
      }
    })
  }

  const openSwapForPlayer = (playerId: string) => {
    setSwapFromPlayerId(playerId)
    setSheet('swap')
  }

  const swapPlayersInWorkingAlternative = (fromId: string, toId: string) => {
    const base = manualAlternative ?? suggestion.alternatives[selectedAlternative]
    if (!base || fromId === toId) return
    const result = buildSwappedAlternative(base, state, fromId, toId)
    if (!result.alternative) {
      if (result.error) setError(result.error)
      return
    }
    rememberRoundSelection(`Swap ${playerName(fromId, playersById)}`)
    setManualAlternative(result.alternative)
    setSwapFromPlayerId(null)
    setSheet(null)
  }

  const refreshButton = (
    <Pressable
      onPress={loadLiveState}
      style={{
        height: 36,
        width: 36,
        borderRadius: RADIUS.full,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        backgroundColor: theme.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <RefreshCcw size={16} color={theme.onSurface} />
    </Pressable>
  )

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="NEXT ROUND" rightSlot={refreshButton} />
      {phase === 'recap' ? (
        <RecapView
          summary={sessionSummary}
          playersById={playersById}
          onOpenHistory={() => setSheet('history')}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 126 + insets.bottom }}
        >
          <SessionHeroCard
            phase={phase}
            roundNo={activeRound?.round_no ?? state.current_round}
            presentCount={presentCount}
            courtCount={courtCount}
            completedRounds={completedRoundCount}
            targetRounds={effectiveTargetRounds}
          />

          <StatusChipRow
            fairnessScore={fairnessScore}
            courtCount={courtCount}
            courtPreset={courtPreset}
            onFairnessPress={() => setSheet('fairness')}
            onSettingsPress={() => setSheet('settings')}
          />

          {phase === 'plan' && (
            <>
              <AlternativeTabs
                alternatives={suggestion.alternatives}
                selectedIndex={selectedAlternative}
                onSelect={selectAlternativeForRound}
                onOpenHistory={() => setSheet('history')}
                onOpenRoster={() => setSheet('roster')}
                targetReachedLabel={`${Math.min(completedRoundCount, effectiveTargetRounds)}/${effectiveTargetRounds} vòng`}
              />
              {workingAlternative ? (
                <>
                  <FairnessPreviewCard preview={fairnessPreview} onPress={() => setSheet('fairness')} />
                  <EngineExplainCard
                    alternative={workingAlternative}
                    actions={suggestedRoundActions}
                    expanded={showEngineStats}
                    onToggle={() => setShowEngineStats(value => !value)}
                    onApplyAction={applySuggestedRoundAction}
                  />
                  <WarningsBlock
                    warnings={fairnessWarnings}
                    actions={suggestedRoundActions}
                    onOpenSwap={() => setSheet('swap')}
                    onApplyAction={applySuggestedRoundAction}
                  />
                  <MatchList
                    title={`${workingAlternative.matches.length} trận · ${workingAlternative.matches.length * 4} người chơi`}
                    matches={workingAlternative.matches}
                    state={state}
                    playersById={playersById}
                    onPlayerPress={openSwapForPlayer}
                  />
                  <RestingRow resting={workingAlternative.resting} playersById={playersById} />
                </>
              ) : (
                <EmptyPlanCard onSyncRoster={syncRoster} busy={busy === 'sync'} />
              )}
            </>
          )}

          {phase === 'active' && activeRound && (
            <>
              <WarningsBlock warnings={fairnessWarnings} actions={[]} onOpenSwap={() => setSheet('swap')} onApplyAction={applySuggestedRoundAction} />
              <MatchList
                title={`${activeRound.matches.length} trận đang diễn ra`}
                matches={activeRound.matches}
                state={state}
                playersById={playersById}
                onPlayerPress={openSwapForPlayer}
              />
              <RestingRow resting={activeRound.resting} playersById={playersById} />
            </>
          )}

          {selectionUndo && (
            <TouchableOpacity
              onPress={undoRoundSelection}
              style={{
                marginTop: 12,
                height: 44,
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: theme.outlineVariant,
                backgroundColor: theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={ctaTextStyle(theme.primary, 13)}>Hoàn tác: {selectionUndo.reason}</Text>
            </TouchableOpacity>
          )}

          {error ? (
            <View style={{ marginTop: 12, backgroundColor: theme.dangerBg, borderRadius: RADIUS.md, padding: 12, borderWidth: BORDER.hairline, borderColor: theme.dangerText }}>
              <Text style={{ fontFamily: SCREEN_FONTS.body, color: theme.dangerText, fontSize: 12 }}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {phase !== 'recap' && (
        <StickyRoundCta
          busy={busy}
          primaryLabel={phase === 'active' ? 'Kết thúc & lưu vòng' : 'Bắt đầu vòng kế'}
          onPrimary={() => {
            if (phase === 'active') void endActiveRound()
            else if (workingAlternative) void startRound(workingAlternative)
          }}
          disabled={phase === 'plan' && !workingAlternative}
          onMore={() => setSheet('more')}
        />
      )}

      <NextRoundSheet visible={sheet === 'settings'} snap="88" onClose={() => setSheet(null)}>
        <SettingsSheet
          courtCount={courtCount}
          setCourtCount={setCourtCount}
          courtPreset={courtPreset}
          setCourtPreset={setCourtPreset}
          pvnaTolerance={pvnaTolerance}
          setPvnaTolerance={setPvnaTolerance}
          courtDurationMin={courtDurationMin}
          setCourtDurationMin={setCourtDurationMin}
          targetRounds={effectiveTargetRounds}
          setTargetRounds={setTargetRounds}
          calculatorRounds={courtCalculator.recommended.total_rounds}
          onApply={() => setSheet(null)}
        />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'fairness'} snap="88" onClose={() => setSheet(null)}>
        <FairnessSheet score={fairnessScore} state={state} warnings={fairnessWarnings} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'swap'} snap="88" onClose={() => setSheet(null)}>
        <SwapSheet
          state={state}
          alternative={workingAlternative}
          playersById={playersById}
          swapFromPlayerId={swapFromPlayerId}
          setSwapFromPlayerId={setSwapFromPlayerId}
          onSwap={swapPlayersInWorkingAlternative}
        />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'roster'} snap="88" onClose={() => setSheet(null)}>
        <RosterSheet
          rows={rows.playerRows}
          playersById={playersById}
          expandedPlayerId={expandedRosterPlayer}
          setExpandedPlayerId={setExpandedRosterPlayer}
          busy={busy}
          onToggleCheckout={toggleCheckout}
          onToggleRest={toggleRest}
          onSwap={openSwapForPlayer}
          onSyncRoster={syncRoster}
        />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'history'} snap="88" onClose={() => setSheet(null)}>
        <HistorySheet rounds={completedRounds} playersById={playersById} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'more'} snap="50" onClose={() => setSheet(null)}>
        <MoreSheet
          onSyncRoster={syncRoster}
          onOpenRoster={() => setSheet('roster')}
          onOpenHistory={() => setSheet('history')}
          onOpenFairness={() => setSheet('fairness')}
          busy={busy}
        />
      </NextRoundSheet>
    </View>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const theme = useAppTheme()
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: RADIUS.lg,
          borderWidth: BORDER.hairline,
          borderColor: theme.outlineVariant,
          ...SHADOW.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

function PlayerAvatar({ name, size = 30 }: { name: string; size?: number }) {
  const theme = useAppTheme()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS.full,
        backgroundColor: theme.secondaryContainer,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: Math.max(10, size * 0.34), color: theme.primary }}>
        {initials(name)}
      </Text>
    </View>
  )
}

function SessionHeroCard({
  phase,
  roundNo,
  presentCount,
  courtCount,
  completedRounds,
  targetRounds,
}: {
  phase: 'plan' | 'active'
  roundNo: number
  presentCount: number
  courtCount: number
  completedRounds: number
  targetRounds: number
}) {
  const theme = useAppTheme()
  const remaining = Math.max(0, targetRounds - completedRounds)
  return (
    <LinearGradient
      colors={[theme.heroGradientStart, theme.primaryContainer]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: RADIUS.lg, padding: 16, minHeight: 134 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.heroLiveDot }} />
            <Text style={eyebrowStyle(theme.heroBodyMuted, 10)}>
              {phase === 'active' ? 'Đang diễn ra · Live' : 'Vòng kế tiếp · Đề xuất'}
            </Text>
          </View>
          <Text style={{ marginTop: 10, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 32, color: theme.surface }}>
            Vòng {roundNo}
          </Text>
          <Text style={{ marginTop: 7, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
            {presentCount} có mặt · {courtCount} sân · {completedRounds}/{targetRounds} vòng
          </Text>
        </View>
        <View
          style={{
            backgroundColor: theme.heroPillBg,
            borderRadius: RADIUS.full,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={ctaTextStyle(theme.heroCountdownText, 12)}>
            {phase === 'active' ? 'LIVE' : `Còn ${remaining} vòng`}
          </Text>
        </View>
      </View>
    </LinearGradient>
  )
}

function StatusChipRow({
  fairnessScore,
  courtCount,
  courtPreset,
  onFairnessPress,
  onSettingsPress,
}: {
  fairnessScore: SessionFairnessScore
  courtCount: number
  courtPreset: CourtPreset
  onFairnessPress: () => void
  onSettingsPress: () => void
}) {
  const theme = useAppTheme()
  const preset = PRESETS[courtPreset]
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
      <TouchableOpacity onPress={onFairnessPress} activeOpacity={0.9} style={{ flex: 1 }}>
        <Card style={{ borderRadius: RADIUS.lg, padding: 12, minHeight: 72 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={18} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={eyebrowStyle(theme.outline)}>Fairness</Text>
              <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
                {fairnessScore.total} {fairnessLabel(fairnessScore)}
              </Text>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSettingsPress} activeOpacity={0.9} style={{ flex: 1 }}>
        <Card style={{ borderRadius: RADIUS.lg, padding: 12, minHeight: 72 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Settings size={18} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={eyebrowStyle(theme.outline)}>Cài đặt</Text>
              <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
                {courtCount} sân · {preset.label}
              </Text>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    </View>
  )
}

function AlternativeTabs({
  alternatives,
  selectedIndex,
  onSelect,
  onOpenHistory,
  onOpenRoster,
  targetReachedLabel,
}: {
  alternatives: SuggestionAlternative[]
  selectedIndex: number
  onSelect: (index: number) => void
  onOpenHistory: () => void
  onOpenRoster: () => void
  targetReachedLabel: string
}) {
  const theme = useAppTheme()
  const bestScore = alternatives[0]?.score ?? 0
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={eyebrowStyle(theme.outline)}>3 phương án · Đề xuất</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={onOpenHistory}>
            <Text style={eyebrowStyle(theme.primary)}>{targetReachedLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenRoster}>
            <Text style={eyebrowStyle(theme.primary)}>Người chơi</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {alternatives.slice(0, 3).map((alternative, index) => {
          const active = selectedIndex === index
          const delta = alternative.score - bestScore
          return (
            <TouchableOpacity
              key={`alt-${index}`}
              onPress={() => onSelect(index)}
              activeOpacity={0.9}
              style={{
                height: 44,
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                backgroundColor: active ? theme.primary : 'transparent',
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={ctaTextStyle(active ? theme.onPrimary : theme.onSurface, 13)}>ALT {index + 1}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    borderRadius: RADIUS.full,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    backgroundColor: active ? 'rgba(255,255,255,0.16)' : theme.secondaryContainer,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? theme.onPrimary : theme.primary }}>
                    {alternative.score.toFixed(1)}
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? theme.onPrimary : theme.outline }}>
                  {index === 0 ? 'Tốt nhất' : `+${delta.toFixed(1)}`}
                </Text>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function FairnessPreviewCard({ preview, onPress }: { preview: FairnessPreview; onPress: () => void }) {
  const theme = useAppTheme()
  const delta = preview.after.total - preview.before.total
  const tone = delta >= 0 ? theme.successText : theme.warningText
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={{ marginTop: 14 }}>
      <Card style={{ borderRadius: RADIUS.md, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: RADIUS.md,
              backgroundColor: delta >= 0 ? theme.successBg : theme.warningBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={18} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={eyebrowStyle(theme.outline)}>Preview fairness vòng kế</Text>
            <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
              {preview.before.total} → {preview.after.total}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline, marginTop: 4 }}>
              Bấm để xem audit chi tiết — partner / đối thủ / nghỉ / pressure
            </Text>
          </View>
          <View style={{ borderRadius: RADIUS.full, backgroundColor: delta >= 0 ? theme.successBg : theme.warningBg, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: tone }}>{delta >= 0 ? `+${delta}` : delta}</Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

function EngineExplainCard({
  alternative,
  actions,
  expanded,
  onToggle,
  onApplyAction,
}: {
  alternative: SuggestionAlternative
  actions: SuggestedRoundAction[]
  expanded: boolean
  onToggle: () => void
  onApplyAction: (action: SuggestedRoundAction) => void
}) {
  const theme = useAppTheme()
  const primaryAction = actions.find(action => action.type !== 'accept_tradeoff')
  return (
    <Card style={{ marginTop: 12, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Sparkles size={18} color={theme.primary} />
        <View style={{ flex: 1 }}>
          <Text style={eyebrowStyle(theme.primary)}>Engine giải thích</Text>
          <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 19, color: theme.onSurface }}>
            Engine đang chọn phương án có tổng score thấp nhất: cân PVNA, hạn chế lặp partner/đối thủ, giữ nhịp nghỉ và tôn trọng group/pref khi có thể.
          </Text>
          {primaryAction ? (
            <TouchableOpacity
              onPress={() => onApplyAction(primaryAction)}
              style={{
                marginTop: 10,
                minHeight: 40,
                borderRadius: RADIUS.md,
                backgroundColor: theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: theme.outlineVariant,
                paddingHorizontal: 12,
                justifyContent: 'center',
              }}
            >
              <Text style={ctaTextStyle(theme.primary, 12)}>{primaryAction.label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline, marginTop: 2 }}>
                {primaryAction.detail}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <TouchableOpacity onPress={onToggle} style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={ctaTextStyle(theme.primary, 12)}>Vì sao chọn ALT này</Text>
        <ChevronDown size={14} color={theme.primary} />
      </TouchableOpacity>
      {expanded ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {[
            ['Chênh PVNA', alternative.stats.pvna_diff.toFixed(2)],
            ['Lặp partner', String(alternative.stats.partner_repeats)],
            ['Lặp đối thủ', String(alternative.stats.opponent_repeats)],
            ['Gender pref', alternative.stats.gender_pref_penalty.toFixed(1)],
          ].map(([label, value]) => (
            <View key={label} style={{ width: '48%', backgroundColor: theme.surface, borderRadius: RADIUS.md, padding: 10, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
              <Text style={eyebrowStyle(theme.outline, 9)}>{label}</Text>
              <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

function WarningsBlock({
  warnings,
  actions,
  onOpenSwap,
  onApplyAction,
}: {
  warnings: FairnessWarning[]
  actions: SuggestedRoundAction[]
  onOpenSwap: () => void
  onApplyAction: (action: SuggestedRoundAction) => void
}) {
  const theme = useAppTheme()
  const warning = warnings[0]
  const action = actions.find(item => item.type !== 'accept_tradeoff')
  if (!warning && !action) return null
  const tone = warning ? warningTone(theme, warning.severity) : warningTone(theme, 'info')
  return (
    <View style={{ marginTop: 12, backgroundColor: tone.bg, borderRadius: RADIUS.md, borderWidth: BORDER.hairline, borderColor: tone.border, padding: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AlertTriangle size={18} color={tone.text} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: tone.text }}>
            {warning ? warning.type.replace(/_/g, ' ') : 'Có phương án thay thế'}
          </Text>
          <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: tone.text }}>
            {warning?.message ?? action?.detail}
          </Text>
        </View>
        <TouchableOpacity
          onPress={action ? () => onApplyAction(action) : onOpenSwap}
          style={{ minHeight: 36, borderRadius: RADIUS.md, backgroundColor: theme.surface, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={ctaTextStyle(tone.text, 11)}>{action ? 'Áp dụng' : 'Mở swap'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function MatchList({
  title,
  matches,
  state,
  playersById,
  onPlayerPress,
}: {
  title: string
  matches: Match[]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
}) {
  const theme = useAppTheme()
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>{title}</Text>
      <View style={{ gap: 10 }}>
        {matches.map(match => (
          <MatchTile
            key={`match-${match.court_idx}-${match.team_a.join('-')}-${match.team_b.join('-')}`}
            match={match}
            state={state}
            playersById={playersById}
            onPlayerPress={onPlayerPress}
          />
        ))}
      </View>
    </View>
  )
}

function MatchTile({
  match,
  state,
  playersById,
  onPlayerPress,
}: {
  match: Match
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
}) {
  const theme = useAppTheme()
  const diff = Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state))
  const scored = match.stats && match.score != null ? { score: match.score, stats: match.stats } : scoreMatch(match.team_a, match.team_b, state)
  return (
    <Card style={{ padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ borderRadius: RADIUS.xs, backgroundColor: theme.secondaryContainer, paddingHorizontal: 8, paddingVertical: 5 }}>
            <Text style={ctaTextStyle(theme.primary, 11)}>{match.court_idx + 1}</Text>
          </View>
          <Text style={eyebrowStyle(theme.outline)}>Sân {match.court_idx + 1}</Text>
        </View>
        <View style={{ borderRadius: RADIUS.full, backgroundColor: diff > 0.5 ? theme.warningBg : theme.secondaryContainer, paddingHorizontal: 9, paddingVertical: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: diff > 0.5 ? theme.warningText : theme.primary }}>
            Chênh {diff.toFixed(2)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TeamBlock team={match.team_a} state={state} playersById={playersById} onPlayerPress={onPlayerPress} align="left" />
        <View style={{ width: 30, height: 26, borderRadius: RADIUS.xs, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={ctaTextStyle(theme.outline, 10)}>VS</Text>
        </View>
        <TeamBlock team={match.team_b} state={state} playersById={playersById} onPlayerPress={onPlayerPress} align="right" />
      </View>
      <Text style={{ marginTop: 10, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
        Score {Number.isFinite(scored.score) ? scored.score.toFixed(1) : '-'} · Partner {scored.stats.partner_repeats} · Đối thủ {scored.stats.opponent_repeats}
      </Text>
    </Card>
  )
}

function TeamBlock({
  team,
  state,
  playersById,
  onPlayerPress,
  align,
}: {
  team: [string, string]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
  align: 'left' | 'right'
}) {
  const theme = useAppTheme()
  const names = team.map(id => playerName(id, playersById))
  return (
    <View style={{ flex: 1, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <View style={{ flexDirection: align === 'right' ? 'row-reverse' : 'row', marginBottom: 6 }}>
        {team.map((id, index) => (
          <TouchableOpacity key={id} onPress={() => onPlayerPress(id)} style={{ marginLeft: align === 'right' ? 0 : index === 0 ? 0 : -8, marginRight: align === 'right' && index > 0 ? -8 : 0 }}>
            <PlayerAvatar name={playerName(id, playersById)} />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: theme.onSurface, textAlign: align }}>
        {names.join(' · ')}
      </Text>
      <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
        TB PVNA {getTeamPvna(team, state).toFixed(2)}
      </Text>
    </View>
  )
}

function RestingRow({ resting, playersById }: { resting: string[]; playersById: Map<string, ArrangementPlayer> }) {
  const theme = useAppTheme()
  const hasRest = resting.length > 0
  return (
    <View style={{ marginTop: 12, borderRadius: RADIUS.md, backgroundColor: hasRest ? theme.rescueSoft : theme.successBg, padding: 12, borderWidth: BORDER.hairline, borderColor: hasRest ? theme.rescueAccent : theme.secondaryContainer }}>
      <Text style={eyebrowStyle(hasRest ? theme.rescueAccent : theme.successText)}>
        {hasRest ? 'Nghỉ vòng này' : 'Không có người nghỉ'}
      </Text>
      {hasRest ? (
        <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurface }}>
          {resting.map(id => playerName(id, playersById)).join(', ')}
        </Text>
      ) : null}
    </View>
  )
}

function EmptyPlanCard({ onSyncRoster, busy }: { onSyncRoster: () => void; busy: boolean }) {
  const theme = useAppTheme()
  return (
    <Card style={{ marginTop: 16, padding: 18, alignItems: 'center' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>Chưa có gợi ý vòng</Text>
      <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline, textAlign: 'center' }}>
        Sync roster trước, sau đó engine sẽ tạo phương án cho vòng kế.
      </Text>
      <TouchableOpacity
        onPress={onSyncRoster}
        disabled={busy}
        style={{ marginTop: 14, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 13)}>Sync roster</Text>}
      </TouchableOpacity>
    </Card>
  )
}

function StickyRoundCta({
  busy,
  primaryLabel,
  onPrimary,
  disabled,
  onMore,
}: {
  busy: string | null
  primaryLabel: string
  onPrimary: () => void
  disabled?: boolean
  onMore: () => void
}) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  return (
    <LinearGradient
      pointerEvents="box-none"
      colors={['rgba(255,251,245,0)', theme.background]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 26, paddingHorizontal: 16, paddingBottom: 16 + insets.bottom }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          onPress={onMore}
          style={{ width: 48, height: 52, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
        >
          <MoreHorizontal size={22} color={theme.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onPrimary}
          disabled={disabled || busy === 'start' || busy === 'end'}
          style={{ flex: 1, height: 52, borderRadius: RADIUS.md, backgroundColor: disabled ? theme.outlineVariant : theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          {busy === 'start' || busy === 'end' ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary)}>{primaryLabel}</Text>}
        </TouchableOpacity>
      </View>
    </LinearGradient>
  )
}

function NextRoundSheet({
  visible,
  onClose,
  children,
  snap,
}: {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
  snap: '50' | '88'
}) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: theme.overlay }} />
      <View
        style={{
          maxHeight: snap === '88' ? '88%' : '54%',
          minHeight: snap === '88' ? '60%' : '40%',
          backgroundColor: theme.background,
          borderTopLeftRadius: RADIUS.hero,
          borderTopRightRadius: RADIUS.hero,
          paddingTop: 10,
          paddingHorizontal: 16,
          paddingBottom: 16 + insets.bottom,
        }}
      >
        <View style={{ width: 44, height: 5, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant, alignSelf: 'center', marginBottom: 12 }} />
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Modal>
  )
}

function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 24, color: theme.onSurface }}>{title}</Text>
      {subtitle ? <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>{subtitle}</Text> : null}
    </View>
  )
}

function SettingsSheet({
  courtCount,
  setCourtCount,
  courtPreset,
  setCourtPreset,
  pvnaTolerance,
  setPvnaTolerance,
  courtDurationMin,
  setCourtDurationMin,
  targetRounds,
  setTargetRounds,
  calculatorRounds,
  onApply,
}: {
  courtCount: number
  setCourtCount: (value: number) => void
  courtPreset: CourtPreset
  setCourtPreset: (value: CourtPreset) => void
  pvnaTolerance: number
  setPvnaTolerance: (value: number) => void
  courtDurationMin: number
  setCourtDurationMin: (value: number) => void
  targetRounds: number
  setTargetRounds: (value: number) => void
  calculatorRounds: number
  onApply: () => void
}) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Cài đặt vòng" subtitle="Điều chỉnh setup trước khi start vòng kế." />
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 14, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Zap size={18} color={theme.heroCountdownText} />
          <View style={{ flex: 1 }}>
            <Text style={eyebrowStyle(theme.heroCountdownText)}>Engine khuyến nghị</Text>
            <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
              Giữ setup gần court calculator, chỉ mở PVNA tolerance khi repeat pressure tăng.
            </Text>
          </View>
        </View>
      </LinearGradient>
      <ChoiceRow label="Sân" options={[1, 2, 3, 4, 5, 6].map(value => ({ label: String(value), value }))} value={courtCount} onChange={setCourtCount} />
      <ChoiceRow
        label="Chế độ"
        options={COURT_PRESET_OPTIONS.map(value => ({ label: PRESETS[value].label, value }))}
        value={courtPreset}
        onChange={setCourtPreset}
      />
      <ChoiceRow label="Dung sai PVNA" options={PVNA_TOLERANCE_OPTIONS.map(value => ({ label: `±${value}`, value }))} value={pvnaTolerance} onChange={setPvnaTolerance} />
      <ChoiceRow label="Thời lượng" options={COURT_DURATION_OPTIONS.map(value => ({ label: `${value}p`, value }))} value={courtDurationMin} onChange={setCourtDurationMin} />
      <ChoiceRow label="Mục tiêu vòng" options={[6, 8, 10, calculatorRounds].filter((value, index, arr) => arr.indexOf(value) === index).map(value => ({ label: `${value}`, value }))} value={targetRounds} onChange={setTargetRounds} />
      <TouchableOpacity onPress={onApply} style={{ height: 52, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
        <Text style={ctaTextStyle(theme.onPrimary)}>Áp dụng</Text>
      </TouchableOpacity>
    </View>
  )
}

function ChoiceRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (value: T) => void
}) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(option => {
          const active = option.value === value
          return (
            <TouchableOpacity
              key={`${label}-${option.value}`}
              onPress={() => onChange(option.value)}
              style={{
                minHeight: 40,
                minWidth: 62,
                borderRadius: RADIUS.md,
                backgroundColor: active ? theme.primary : theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 10,
              }}
            >
              <Text style={ctaTextStyle(active ? theme.onPrimary : theme.onSurface, 12)}>{option.label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function FairnessSheet({ score, state, warnings }: { score: SessionFairnessScore; state: SessionState; warnings: FairnessWarning[] }) {
  const theme = useAppTheme()
  const match = computeMatchCountMetrics(state)
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const gender = computeGenderPrefSatisfaction(state)
  const pressure = computeRepeatPressure(state)
  const burden = computeOpponentRepeatBurden(state)
  const rows = [
    ['Số trận', score.breakdown.match_count, 25, `range ${match.range}, avg ${match.avg.toFixed(1)}`],
    ['Partner', score.breakdown.partner_diversity, 20, `${partner.repeat_pairs.length} cặp lặp`],
    ['Đối thủ', score.breakdown.opponent_diversity, 15, `${opponent.repeat_pairs.length} cặp lặp, burden ${burden.max_repeated_opponents}`],
    ['Nghỉ', score.breakdown.rest, 20, `${rest.violations.length} vi phạm`],
    ['Gender pref', score.breakdown.gender_prefs, 20, `${gender.satisfied_count}/${gender.total_pref_opportunities || 0} satisfied`],
  ] as const
  return (
    <View>
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 16, marginBottom: 14 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 54, color: theme.surface }}>
          {score.total}<Text style={{ fontSize: 20 }}>/100</Text>
        </Text>
        <View style={{ alignSelf: 'flex-start', backgroundColor: theme.heroPillBg, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={ctaTextStyle(theme.heroCountdownText, 12)}>{fairnessLabel(score)}</Text>
        </View>
        <Text style={{ marginTop: 9, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
          Repeat pressure {pressure.repeat_risk} · Avg trận {match.avg.toFixed(1)} · Opp pressure {pressure.opponent_pressure.toFixed(2)}
        </Text>
      </LinearGradient>
      {rows.map(([label, value, max, detail]) => (
        <BreakdownRow key={label} label={label} value={value} max={max} detail={detail} />
      ))}
      {warnings.length > 0 ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {warnings.map((warning, index) => {
            const tone = warningTone(theme, warning.severity)
            return (
              <View key={`${warning.type}-${index}`} style={{ backgroundColor: tone.bg, borderRadius: RADIUS.md, padding: 10, borderWidth: BORDER.hairline, borderColor: tone.border }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: tone.text }}>{warning.type.replace(/_/g, ' ')}</Text>
                <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: tone.text }}>{warning.message}</Text>
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

function BreakdownRow({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const theme = useAppTheme()
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{label}</Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.outline }}>{value}/{max}</Text>
      </View>
      <View style={{ height: 8, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: pct >= 95 ? theme.primary : theme.primaryContainer }} />
      </View>
      <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>{detail}</Text>
    </View>
  )
}

function SwapSheet({
  state,
  alternative,
  playersById,
  swapFromPlayerId,
  setSwapFromPlayerId,
  onSwap,
}: {
  state: SessionState
  alternative?: SuggestionAlternative | null
  playersById: Map<string, ArrangementPlayer>
  swapFromPlayerId: string | null
  setSwapFromPlayerId: (playerId: string) => void
  onSwap: (fromId: string, toId: string) => void
}) {
  const theme = useAppTheme()
  if (!alternative) {
    return <SheetTitle title="Đổi người" subtitle="Chưa có phương án để swap." />
  }
  const playingIds = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
  const targetIds = [...new Set([...playingIds, ...alternative.resting])]
  const candidates = swapFromPlayerId
    ? targetIds
        .filter(playerId => playerId !== swapFromPlayerId)
        .map(playerId => ({ playerId, audit: auditManualSwap(state, alternative, swapFromPlayerId, playerId) }))
        .sort((a, b) => {
          if (a.audit.blocked !== b.audit.blocked) return a.audit.blocked ? 1 : -1
          return b.audit.score_delta - a.audit.score_delta
        })
    : []
  return (
    <View>
      <SheetTitle title="Đổi người" subtitle="Chọn người cần đổi, rồi chọn candidate được sắp theo cải thiện." />
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>1. Đổi ra</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {targetIds.map(playerId => {
          const active = swapFromPlayerId === playerId
          return (
            <TouchableOpacity
              key={playerId}
              onPress={() => setSwapFromPlayerId(playerId)}
              style={{
                height: 44,
                borderRadius: RADIUS.full,
                backgroundColor: active ? theme.primary : theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                paddingHorizontal: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <PlayerAvatar name={playerName(playerId, playersById)} size={24} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: active ? theme.onPrimary : theme.onSurface }}>
                {playerName(playerId, playersById)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
      {swapFromPlayerId ? (
        <>
          <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>2. Đổi với · sắp theo cải thiện</Text>
          <View style={{ gap: 8 }}>
            {candidates.map(({ playerId, audit }) => {
              const better = audit.score_delta > 0 && !audit.blocked
              const borderColor = audit.blocked ? theme.dangerText : better ? theme.primary : theme.outlineVariant
              return (
                <TouchableOpacity
                  key={playerId}
                  onPress={() => !audit.blocked && onSwap(swapFromPlayerId, playerId)}
                  disabled={audit.blocked}
                  style={{
                    minHeight: 58,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.surface,
                    borderWidth: BORDER.hairline,
                    borderColor: theme.outlineVariant,
                    borderLeftWidth: 4,
                    borderLeftColor: borderColor,
                    padding: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <PlayerAvatar name={playerName(playerId, playersById)} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{playerName(playerId, playersById)}</Text>
                    <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                      PVNA {(state.players.get(playerId)?.pvna ?? 0).toFixed(2)}
                    </Text>
                  </View>
                  <Text style={ctaTextStyle(audit.blocked ? theme.dangerText : better ? theme.primary : theme.outline, 12)}>
                    {audit.blocked ? 'Chặn' : audit.score_delta > 0 ? `+${audit.score_delta.toFixed(1)}` : audit.score_delta.toFixed(1)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      ) : null}
    </View>
  )
}

function RosterSheet({
  rows,
  playersById,
  expandedPlayerId,
  setExpandedPlayerId,
  busy,
  onToggleCheckout,
  onToggleRest,
  onSwap,
  onSyncRoster,
}: {
  rows: SessionPlayerStateRow[]
  playersById: Map<string, ArrangementPlayer>
  expandedPlayerId: string | null
  setExpandedPlayerId: (playerId: string | null) => void
  busy: string | null
  onToggleCheckout: (playerId: string, checkedOut: boolean) => void
  onToggleRest: (playerId: string, optedRest: boolean) => void
  onSwap: (playerId: string) => void
  onSyncRoster: () => void
}) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Người chơi" subtitle="Tap từng người để check-out, xin nghỉ, group hoặc swap." />
      <TouchableOpacity onPress={onSyncRoster} style={{ height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        {busy === 'sync' ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 13)}>Sync roster</Text>}
      </TouchableOpacity>
      <View style={{ gap: 8 }}>
        {rows.map(row => {
          const playerId = row.player_id
          const player = playersById.get(playerId)
          const expanded = expandedPlayerId === playerId
          const checkedOut = Boolean(row.checked_out_at)
          return (
            <Card key={playerId} style={{ borderRadius: RADIUS.md, overflow: 'hidden' }}>
              <TouchableOpacity
                onPress={() => setExpandedPlayerId(expanded ? null : playerId)}
                style={{ minHeight: 60, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <PlayerAvatar name={playerName(playerId, playersById)} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{playerName(playerId, playersById)}</Text>
                  <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                    PVNA {getPlayerPvna(player).toFixed(2)} · {row.matches_played} trận · nghỉ {row.consecutive_rest}
                  </Text>
                </View>
                <ChevronDown size={16} color={theme.outline} />
              </TouchableOpacity>
              {expanded ? (
                <View style={{ borderTopWidth: BORDER.hairline, borderTopColor: theme.outlineVariant, padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <MiniAction label={checkedOut ? 'Check-in' : 'Check-out'} icon={checkedOut ? UserPlus : UserMinus} onPress={() => onToggleCheckout(playerId, checkedOut)} tone={checkedOut ? 'good' : 'danger'} />
                  <MiniAction label={row.opted_rest ? 'Bỏ nghỉ' : 'Xin nghỉ'} icon={History} onPress={() => onToggleRest(playerId, row.opted_rest)} tone="neutral" />
                  <MiniAction label="Group+" icon={Users} onPress={() => Alert.alert('Group+', 'Chọn nhiều người trên màn chính để tạo group.')} tone="neutral" />
                  <MiniAction label="Swap" icon={Zap} onPress={() => onSwap(playerId)} tone="good" />
                </View>
              ) : null}
            </Card>
          )
        })}
      </View>
    </View>
  )
}

function MiniAction({
  label,
  icon: Icon,
  onPress,
  tone,
}: {
  label: string
  icon: any
  onPress: () => void
  tone: 'good' | 'danger' | 'neutral'
}) {
  const theme = useAppTheme()
  const color = tone === 'danger' ? theme.dangerText : tone === 'good' ? theme.primary : theme.outline
  const bg = tone === 'danger' ? theme.dangerBg : tone === 'good' ? theme.secondaryContainer : theme.surfaceContainerLow
  return (
    <TouchableOpacity onPress={onPress} style={{ minHeight: 40, borderRadius: RADIUS.md, backgroundColor: bg, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon size={14} color={color} />
      <Text style={ctaTextStyle(color, 11)}>{label}</Text>
    </TouchableOpacity>
  )
}

function HistorySheet({ rounds, playersById }: { rounds: SessionRoundRow[]; playersById: Map<string, ArrangementPlayer> }) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Lịch sử vòng" subtitle="Các vòng đã lưu trong live session." />
      <View style={{ gap: 10 }}>
        {rounds.map(round => (
          <Card key={round.round_no} style={{ borderRadius: RADIUS.md, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>Vòng {round.round_no}</Text>
              <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.successBg, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={ctaTextStyle(theme.successText, 11)}>Đã lưu</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              {round.matches.map(match => (
                <View key={`${round.round_no}-${match.court_idx}`} style={{ borderRadius: RADIUS.xs, backgroundColor: theme.surfaceAlt, padding: 8 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
                    {match.team_a.map(id => playerName(id, playersById)).join(' · ')}  vs  {match.team_b.map(id => playerName(id, playersById)).join(' · ')}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.rescueAccent }}>
              Nghỉ: {round.resting.map(id => playerName(id, playersById)).join(', ') || 'Không có'}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  )
}

function MoreSheet({
  onSyncRoster,
  onOpenRoster,
  onOpenHistory,
  onOpenFairness,
  busy,
}: {
  onSyncRoster: () => void
  onOpenRoster: () => void
  onOpenHistory: () => void
  onOpenFairness: () => void
  busy: string | null
}) {
  return (
    <View>
      <SheetTitle title="Thao tác nhanh" />
      <View style={{ gap: 10 }}>
        <SheetAction label="Sync roster" onPress={onSyncRoster} loading={busy === 'sync'} />
        <SheetAction label="Người chơi" onPress={onOpenRoster} />
        <SheetAction label="Fairness audit" onPress={onOpenFairness} />
        <SheetAction label="Lịch sử vòng" onPress={onOpenHistory} />
      </View>
    </View>
  )
}

function SheetAction({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) {
  const theme = useAppTheme()
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={{ height: 46, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}>
      {loading ? <ActivityIndicator color={theme.primary} /> : <Text style={ctaTextStyle(theme.primary, 13)}>{label}</Text>}
    </TouchableOpacity>
  )
}

function RecapView({
  summary,
  playersById,
  onOpenHistory,
}: {
  summary: ReturnType<typeof sanitizeSummaryForHost>
  playersById: Map<string, ArrangementPlayer>
  onOpenHistory: () => void
}) {
  const theme = useAppTheme()
  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 48 }}>
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 18, marginBottom: 14 }}>
        <Text style={eyebrowStyle(theme.heroCountdownText)}>Session đã hoàn tất</Text>
        <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 36, color: theme.surface }}>
          {summary.total_rounds} vòng
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
          {summary.total_players} người chơi · fairness tổng session
        </Text>
      </LinearGradient>
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 46, color: theme.primary }}>
          {summary.fairness_score.total}<Text style={{ fontSize: 18 }}>/100</Text>
        </Text>
        {Object.entries(summary.fairness_score.breakdown).map(([key, value]) => (
          <BreakdownRow key={key} label={key.replace(/_/g, ' ')} value={Number(value)} max={key === 'match_count' ? 25 : key === 'partner_diversity' ? 20 : key === 'opponent_diversity' ? 15 : 20} detail="" />
        ))}
      </Card>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>Số trận mỗi người</Text>
        {summary.per_player.slice(0, 12).map(player => {
          const max = Math.max(1, ...summary.per_player.map(item => item.matches_played))
          return (
            <View key={player.player_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <PlayerAvatar name={playerName(player.player_id, playersById)} size={26} />
              <Text style={{ width: 76, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurface }} numberOfLines={1}>
                {playerName(player.player_id, playersById)}
              </Text>
              <View style={{ flex: 1, height: 8, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant, overflow: 'hidden' }}>
                <View style={{ width: `${(player.matches_played / max) * 100}%`, height: '100%', backgroundColor: theme.primary }} />
              </View>
              <Text style={{ width: 20, textAlign: 'right', fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface }}>{player.matches_played}</Text>
            </View>
          )
        })}
      </Card>
      <TouchableOpacity onPress={onOpenHistory} style={{ height: 52, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={ctaTextStyle(theme.onPrimary)}>Xem lịch sử vòng</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}
