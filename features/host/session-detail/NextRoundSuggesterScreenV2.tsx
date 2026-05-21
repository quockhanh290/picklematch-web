import React, { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, AppState, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertTriangle,
  ChevronDown,
  Settings,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react-native'

import { SecondaryNavbar } from '@/components/design'
import { BORDER, RADIUS, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { calculateOptimalCourts, PRESETS, type CourtOption, type CourtPreset, type CourtWarningAlternative } from '@/lib/court-calculator'
import type { SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import type { AlternativeAudit } from '@/lib/next-round-suggester/alternatives'
import { commitCompletedRound, pairHistoryRowsFromState } from '@/lib/next-round-suggester/commit'
import { auditManualSwap, buildSwappedAlternative } from '@/lib/next-round-suggester/manual-swap'
import { scoreMatch } from '@/lib/next-round-suggester/score'
import { buildSessionStateFingerprint } from '@/lib/next-round-suggester/state-version'
import type { FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  type FairnessAudit,
  type MatchCountConsistencyRow,
  type FairnessPreview,
} from '@/lib/next-round-suggester/fairness/audit'
import type { GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
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
import type {
  Match,
  SessionPairHistoryRow,
  SessionRoundRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'
import { invokeLiveSessionFunction, loadLatestSyncablePlayerIds, markSessionPlayersPresent, prewarmLiveSessionVersionGuard } from './next-round-v2/api'
import { Card, NextRoundSheet, PlayerAvatar, SheetTitle } from './next-round-v2/components'
import { COURT_DURATION_OPTIONS, COURT_PRESET_OPTIONS, PVNA_TOLERANCE_OPTIONS } from './next-round-v2/constants'
import { ChoiceRow, NavbarRightActions, StickyRoundCta } from './next-round-v2/controls'
import {
  BreakdownRow,
  GroupAuditBlock,
  HistorySheet as HistorySheetView,
  LateArrivalsSheet as LateArrivalsSheetView,
  MoreSheet as MoreSheetView,
  RecapView as RecapViewModule,
  RepeatDetailsBlock,
  SwapSheet as SwapSheetView,
} from './next-round-v2/flow-sheets'
import {
  ctaTextStyle,
  eyebrowStyle,
  formatNumber,
  getPlayerPvna,
  getTeamPvna,
  playerName,
  repeatRiskLabel,
} from './next-round-v2/helpers'
import type { NextRoundSuggesterV2Props } from './next-round-v2/types'
import { useNextRoundModel } from './next-round-v2/useNextRoundModel'
import { refreshBus } from './next-round-v2/refreshBus'

function fairnessLabel(score: SessionFairnessScore) {
  if (score.grade === 'excellent') return 'Rất đều'
  if (score.grade === 'good') return 'Đều'
  if (score.grade === 'acceptable') return 'Tạm ổn'
  return 'Cần chỉnh'
}

function churnLevelLabel(level: string) {
  if (level === 'low') return 'thấp'
  if (level === 'medium') return 'vừa'
  if (level === 'high') return 'cao'
  return level
}

function feasibilityLabel(feasibility: string) {
  if (feasibility === 'optimal') return 'Tối ưu'
  if (feasibility === 'tight') return 'Vừa khít'
  if (feasibility === 'infeasible') return 'Không khả thi'
  return feasibility
}

function warningTitle(type: string) {
  if (type === 'match_count_imbalance') return 'Lệch số trận'
  if (type === 'projected_match_count_imbalance') return 'Sắp lệch số trận'
  if (type === 'underplayed') return 'Có người chơi ít hơn'
  if (type === 'partner_repeat') return 'Lặp partner (đồng đội)'
  if (type === 'opponent_repeat') return 'Lặp đối thủ'
  if (type === 'opponent_repeat_burden') return 'Một người gặp lại nhiều đối thủ'
  if (type === 'projected_opponent_repeat_burden') return 'Sắp lặp đối thủ nhiều'
  if (type === 'rest_violation') return 'Nghỉ liên tiếp'
  if (type === 'gender_pref_unsatisfied') return 'Sở thích giới tính chưa tốt'
  if (type === 'gender_pref_impossible') return 'Sở thích giới tính khó đáp ứng'
  return type.replace(/_/g, ' ')
}

function warningTone(theme: ReturnType<typeof useAppTheme>, severity: FairnessWarning['severity'] | 'ok') {
  if (severity === 'critical') return { bg: theme.dangerBg, border: theme.dangerText, text: theme.dangerText }
  if (severity === 'warning') return { bg: theme.warningBg, border: theme.warningStrong, text: theme.warningText }
  if (severity === 'info') return { bg: theme.infoBg, border: theme.outlineVariant, text: theme.infoText }
  return { bg: theme.successBg, border: theme.secondaryContainer, text: theme.successText }
}

function toUserSafeActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  
  if (message.includes('A round is already active')) return 'Đang có vòng đấu đang diễn ra.'
  if (message.includes('A player can only be assigned once per round')) return 'Mỗi người chơi chỉ có thể xếp lịch 1 lần trong mỗi vòng.'
  if (message.includes('Could not read login session')) return 'Không thể đọc phiên đăng nhập. Vui lòng mở bằng Safari/Chrome hoặc đăng nhập lại.'
  if (message.includes('Invalid manual matches')) return 'Các trận đấu tự chọn không hợp lệ.'
  if (message.includes('Manual match has invalid court index')) return 'Trận đấu tự chọn có số sân không hợp lệ.'
  if (message.includes('Manual matches cannot reuse the same court')) return 'Các trận đấu tự chọn không thể trùng sân.'
  if (message.includes('Manual matches exceed court count')) return 'Số trận đấu tự chọn vượt quá số lượng sân.'
  if (message.includes('Manual matches must use checked-in players')) return 'Trận đấu tự chọn phải sử dụng người chơi đã check-in.'
  if (message.includes('Request timed out')) return 'Yêu cầu quá hạn. Vui lòng kiểm tra kết nối mạng và thử lại.'
  if (message.includes('Round commit audit failed')) return 'Đánh giá lưu vòng thất bại. Vui lòng làm mới trước khi tiếp tục.'
  if (message.includes('Session changed')) return 'Buổi chơi đã thay đổi. Vui lòng làm mới và kiểm tra vòng đấu đã đổi trước khi bắt đầu.'
  if (message.includes('Temporary network issue')) return 'Lỗi kết nối mạng tạm thời. Vui lòng thử lại.'
  
  if (message.startsWith('Could not ')) return 'Không thể thực hiện thao tác: ' + message
  return 'Thao tác thất bại. Vui lòng thử lại.'
}

function changedPairHistoryRows(beforeRows: SessionPairHistoryRow[], afterRows: SessionPairHistoryRow[]) {
  const beforeByKey = new Map(beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]))
  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before || before.partner_count !== row.partner_count || before.opponent_count !== row.opponent_count
  })
}

function createClientRequestId(action: 'start' | 'end') {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `${action}_${Date.now().toString(36)}_${randomPart}`
}

export function NextRoundSuggesterScreenV2({ sessionId, players, courts, bootstrapTelemetry = null }: NextRoundSuggesterV2Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const isFirstFocusRef = useRef(true)
  const [busy, setBusy] = useState<string | null>(null)
  const actionInFlightRef = useRef(false)
  const autoSyncAttemptedRef = useRef(false)
  const lateArrivalInFlightRef = useRef(new Set<string>())
  const model = useNextRoundModel({ sessionId, players, courts })
  const {
    activeRound,
    alternativeOrder,
    alternativeAudits,
    addPlayerRow,
    applySuggestedRoundAction,
    checkedInPlayers,
    clearPlayerRow,
    completedRoundCount,
    completedRounds,
    calculatorPlayerCount,
    courtCount,
    courtDurationMin,
    courtPreset,
    effectiveTargetRounds,
    error,
    fairnessAudit,
    fairnessAdjustment,
    fairnessPreview,
    fairnessScore,
    fairnessWarnings,
    groupSummaries,
    hasManualSwapHardGuard,
    loadLiveState,
    loading,
    liveStateVersion,
    manualAlternative,
    matchCountConsistencyRows,
    phase,
    playersById,
    planTelemetry,
    presentCount,
    pvnaTolerance,
    refreshing,
    rememberRoundSelection,
    reportState,
    rows,
    selectAlternativeForRound,
    selectedAlternative,
    selectionUndo,
    sessionSummary,
    setCourtCount,
    setCourtDurationMin,
    setCourtPreset,
    setError,
    setManualAlternative,
    setPvnaTolerance,
    setSheet,
    setShowEngineStats,
    setShowSessionReport,
    setSwapFromPlayerId,
    setTargetRounds,
    settlePlayerRow,
    sheet,
    showEngineStats,
    state,
    suggestedRoundActions,
    suggestionIsUpdating,
    suggestion,
    swapFromPlayerId,
    targetReached,
    targetRounds,
    undoRoundSelection,
    workingAlternative,
  } = model

  const lastBusRefreshRef = useRef(0)
  const prewarmedVersionGuardRef = useRef<string | null>(null)
  React.useEffect(() => {
    refreshBus.register(() => {
      lastBusRefreshRef.current = Date.now()
      void loadLiveState()
    })
    return () => refreshBus.unregister()
  }, [loadLiveState])

  useFocusEffect(useCallback(() => {
    if (isFirstFocusRef.current) { isFirstFocusRef.current = false; return }
    if (Date.now() - lastBusRefreshRef.current < 2000) return
    void loadLiveState()
  }, [loadLiveState]))

  React.useEffect(() => {
    if (loading || liveStateVersion === null || actionInFlightRef.current) return

    const prewarmKey = `${sessionId}:${liveStateVersion}`
    if (prewarmedVersionGuardRef.current === prewarmKey) return
    prewarmedVersionGuardRef.current = prewarmKey

    void prewarmLiveSessionVersionGuard(sessionId).catch((error) => {
      if (__DEV__) console.warn('[NextRoundSuggesterV2] version guard prewarm failed', error)
    })
  }, [loading, liveStateVersion, sessionId])

  const openRoster = useCallback(() => {
    router.push({ pathname: '/host/session/[id]/roster', params: { id: sessionId } } as any)
  }, [router, sessionId])

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    if (actionInFlightRef.current) return
    actionInFlightRef.current = true
    setBusy(key)
    setError(null)
    try {
      await action()
      await loadLiveState()
    } catch (err: any) {
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] action failed', err)
      setError(safeMessage)
      await loadLiveState()
      if (err && typeof err === 'object') {
        try {
          ;(err as { message?: string }).message = safeMessage
        } catch {
          err = new Error(safeMessage)
          // Keep the user-facing fallback below safe when the error object is readonly.
        }
      } else {
        err = new Error(safeMessage)
      }
      Alert.alert('Lỗi', err?.message ?? 'Không thể thực hiện thao tác')
    } finally {
      actionInFlightRef.current = false
      setBusy(null)
    }
  }, [loadLiveState])

  const syncRoster = useCallback(async () => {
    await runAction('sync', async () => {
      const playerIds = await loadLatestSyncablePlayerIds(
        sessionId,
        checkedInPlayers.map(player => String(player.id)),
      )
      if (playerIds.length === 0) {
        throw new Error('Không có người chơi đã xác nhận để cập nhật danh sách.')
      }
      await invokeLiveSessionFunction('session-sync-roster', sessionId, { player_ids: playerIds })
    })
  }, [runAction, sessionId, checkedInPlayers])

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

  const addLateArrivalToRoster = async (playerId: string) => {
    if (lateArrivalInFlightRef.current.has(playerId)) return
    lateArrivalInFlightRef.current.add(playerId)
    setBusy(`late-${playerId}`)
    setError(null)
    const player = playersById.get(playerId)
    const optimisticRow: SessionPlayerStateRow = {
      session_id: sessionId,
      player_id: playerId,
      group_id: null,
      checked_in_at: new Date().toISOString(),
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
      players: {
        pvna: getPlayerPvna(player) ?? 0,
        elo: player?.elo,
        gender: player?.gender,
        partner_gender_pref: player?.metadata?.partner_gender_pref as string | null | undefined,
        opponent_gender_pref: player?.metadata?.opponent_gender_pref as string | null | undefined,
      },
      session_players: {
        metadata: player?.metadata ?? null,
      },
    }
    addPlayerRow(optimisticRow)
    try {
      const [, checkinPayload] = await Promise.all([
        markSessionPlayersPresent(sessionId, [playerId]),
        invokeLiveSessionFunction('session-checkin', sessionId, { player_id: playerId }),
      ])
      const serverRow = checkinPayload?.player as SessionPlayerStateRow | null | undefined
      if (serverRow) {
        const hydratedRow: SessionPlayerStateRow = {
          ...serverRow,
          players: optimisticRow.players,
          session_players: optimisticRow.session_players,
        }
        addPlayerRow(hydratedRow)
        settlePlayerRow(playerId, hydratedRow)
      } else {
        settlePlayerRow(playerId, optimisticRow)
      }
    } catch (err: any) {
      clearPlayerRow(playerId)
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] late arrival failed', err)
      setError(safeMessage)
      await loadLiveState()
      Alert.alert('Lỗi', safeMessage)
    } finally {
      lateArrivalInFlightRef.current.delete(playerId)
      setBusy(null)
    }
  }

  const startRound = async (alternative: SuggestionAlternative) => {
    await runAction('start', async () => {
      if (activeRound) throw new Error('Đang có vòng active. Hãy kết thúc vòng hiện tại trước.')
      const unavailableIds = alternative.matches
        .flatMap(match => [...match.team_a, ...match.team_b])
        .filter(playerId => {
          const player = state.players.get(playerId)
          return !player || player.checked_out_at !== null || player.opted_rest
        })
      if (unavailableIds.length > 0) {
        throw new Error('Manual matches must use checked-in players')
      }
      const clientRequestId = createClientRequestId('start')
      const startAuditPayload = {
        client_request_id: clientRequestId,
        suggestion_idx: selectedAlternative,
        manual: alternative.matches,
        decision_mode: manualAlternative !== null ? 'host_manual_matches' : 'host_selected_alternative',
        expected_state_fingerprint: buildSessionStateFingerprint(state),
        courts: courtCount,
        pvna_tolerance: pvnaTolerance,
        client_telemetry: {
          bootstrap: bootstrapTelemetry,
          ...planTelemetry,
          measured_at: new Date().toISOString(),
          live_state_version: liveStateVersion,
          suggestion_updating: suggestionIsUpdating,
        },
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
      }
      if (liveStateVersion === null) {
        await invokeLiveSessionFunction('session-rounds-start', sessionId, startAuditPayload)
        return
      }
      await invokeLiveSessionFunction('session-rounds-start-versioned', sessionId, {
        expected_live_state_version: liveStateVersion,
        round_no: state.current_round,
        matches: alternative.matches,
        resting: alternative.resting,
        audit_payload: {
          ...startAuditPayload,
          source: 'NextRoundSuggesterScreenV2',
        },
      })
    })
  }

  const endActiveRound = async () => {
    await runAction('end', async () => {
      if (!activeRound) throw new Error('Không có vòng active.')
      const clientRequestId = createClientRequestId('end')
      const validateCommitAudit = (commitAudit: any) => {
        const invalidDeltas = commitAudit?.deltas?.filter((row: any) =>
          row?.played ? row?.delta !== 1 : row?.delta !== 0
        ) ?? []
        if (invalidDeltas.length > 0) {
          console.error('[NextRoundSuggesterV2] commit audit mismatch', invalidDeltas)
          throw new Error('Round commit audit failed. Please refresh before continuing.')
        }
      }
      if (liveStateVersion === null) {
        const payload = await invokeLiveSessionFunction('session-rounds-end', sessionId, {}, { round_no: activeRound.round_no })
        validateCommitAudit(payload?.commit_audit)
        return
      }
      const existingPairs = pairHistoryRowsFromState(state)
      const committed = commitCompletedRound(
        state,
        {
          round_no: activeRound.round_no,
          matches: activeRound.matches,
          resting: activeRound.resting,
        },
        existingPairs,
      )
      const playedIds = new Set(activeRound.matches.flatMap(match => [...match.team_a, ...match.team_b]))
      const commitAudit = {
        deltas: [...committed.players.values()].map((player) => {
          const before = state.players.get(player.player_id)
          return {
            player_id: player.player_id,
            played: playedIds.has(player.player_id),
            before: before?.matches_played ?? 0,
            after: player.matches_played,
            delta: player.matches_played - (before?.matches_played ?? 0),
          }
        }),
      }
      validateCommitAudit(commitAudit)
      const playerStatePayload = [...committed.players.values()].map((player) => ({
        player_id: player.player_id,
        matches_played: player.matches_played,
        last_played_round: player.last_played_round,
        consecutive_rest: player.consecutive_rest,
        consecutive_play: player.consecutive_play,
        opted_rest: player.opted_rest,
      }))
      const pairHistoryPayload = changedPairHistoryRows(existingPairs, committed.pairHistory).map((row) => ({
        player_a: row.player_a,
        player_b: row.player_b,
        partner_count: row.partner_count,
        opponent_count: row.opponent_count,
      }))
      const scoreAfter = computeSessionFairness({
        ...state,
        current_round: Math.max(state.current_round, activeRound.round_no + 1),
        players: committed.players,
        rounds: state.rounds.map((round) =>
          round.round_no === activeRound.round_no
            ? {
                ...round,
                status: 'completed' as const,
                ended_at: new Date(),
              }
            : round,
        ),
      }).total
      await invokeLiveSessionFunction('session-rounds-end-versioned', sessionId, {
        expected_live_state_version: liveStateVersion,
        round_no: activeRound.round_no,
        player_state: playerStatePayload,
        pair_history: pairHistoryPayload,
        score_after: scoreAfter,
        audit_payload: {
          client_request_id: clientRequestId,
          source: 'NextRoundSuggesterScreenV2',
          commit_audit: commitAudit,
        },
      }, { round_no: activeRound.round_no })
    })
  }

  const openSwapForPlayer = useCallback((playerId: string) => {
    setSwapFromPlayerId(playerId)
    setSheet('swap')
  }, [setSwapFromPlayerId, setSheet])

  const swapPlayersInWorkingAlternative = (fromId: string, toId: string) => {
    const base = manualAlternative ?? suggestion.alternatives[selectedAlternative]
    if (!base || fromId === toId) return
    const result = buildSwappedAlternative(base, state, fromId, toId)
    if (!result.alternative) {
      if (result.error) setError(result.error)
      return
    }
    rememberRoundSelection(`Đổi ${playerName(fromId, playersById)}`)
    setManualAlternative(result.alternative)
    setSwapFromPlayerId(null)
    setSheet(null)
  }

  const plannedPlayerCount = useMemo(() => workingAlternative
    ? new Set([
      ...workingAlternative.matches.flatMap(match => [...match.team_a, ...match.team_b]),
      ...workingAlternative.resting,
    ]).size
    : presentCount, [workingAlternative, presentCount])
  const activePlayerCount = useMemo(() => activeRound
    ? new Set([
      ...activeRound.matches.flatMap(match => [...match.team_a, ...match.team_b]),
      ...activeRound.resting,
    ]).size
    : presentCount, [activeRound, presentCount])
  const heroPlayerCount = phase === 'active' ? activePlayerCount : plannedPlayerCount
  const { rosterTotalCount, checkedOutCount, requestedRestCount } = useMemo(() => ({
    rosterTotalCount: rows.playerRows.length,
    checkedOutCount: rows.playerRows.filter(row => Boolean(row.checked_out_at)).length,
    requestedRestCount: rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length,
  }), [rows.playerRows])
  const lateArrivalPlayers = useMemo(() => {
    const livePlayerIds = new Set(rows.playerRows.map(row => String(row.player_id)))
    return players.filter(player => {
      if (player.status && player.status !== 'confirmed') return false
      const status = player.checkInStatus
      return (status === 'pending' || status === 'no_show') && !livePlayerIds.has(String(player.id))
    })
  }, [rows.playerRows, players])

  const navbarRightSlot = <NavbarRightActions sessionId={sessionId} onRefresh={loadLiveState} refreshing={refreshing} />

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  return (
    <View testID="nrv2-screen" style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="VÒNG KẾ TIẾP" rightSlot={navbarRightSlot} />
      {phase === 'recap' ? (
        <RecapViewModule
          summary={sessionSummary}
          state={reportState}
          matchCountConsistencyRows={matchCountConsistencyRows}
          groupSummaries={groupSummaries}
          playersById={playersById}
          onOpenHistory={() => setSheet('history')}
          onContinue={() => setShowSessionReport(false)}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 126 + insets.bottom }}
        >
          <SessionHeroCard
            phase={phase}
            roundNo={activeRound?.round_no ?? state.current_round}
            presentCount={heroPlayerCount}
            rosterTotalCount={rosterTotalCount}
            checkedOutCount={checkedOutCount}
            requestedRestCount={requestedRestCount}
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

          {lateArrivalPlayers.length > 0 ? (
            <LateArrivalsCta count={lateArrivalPlayers.length} onPress={() => setSheet('late-arrivals')} />
          ) : null}

          {targetReached && !activeRound ? (
            <Card style={{ marginTop: 14, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: theme.primary }}>
                Đã đủ số vòng mục tiêu
              </Text>
              <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
                Host có thể xem tổng kết fairness hoặc chạy thêm một vòng nếu kèo vẫn muốn chơi tiếp.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => setShowSessionReport(true)}
                  style={{ flex: 1, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={ctaTextStyle(theme.onPrimary, 12)}>Xem tổng kết</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowSessionReport(false)}
                  style={{ flex: 1, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={ctaTextStyle(theme.primary, 12)}>Chạy thêm vòng</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : null}

          {phase === 'plan' && (
            <>
              <AlternativeTabs
                alternatives={suggestion.alternatives}
                audits={alternativeAudits}
                alternativeOrder={alternativeOrder}
                selectedIndex={selectedAlternative}
                onSelect={selectAlternativeForRound}
                onOpenHistory={() => setSheet('history')}
                onOpenRoster={openRoster}
                targetReachedLabel={`${Math.min(completedRoundCount, effectiveTargetRounds)}/${effectiveTargetRounds} vòng`}
              />
              {workingAlternative ? (
                <>
                  {fairnessPreview ? (
                    <FairnessPreviewCard preview={fairnessPreview} onPress={() => setSheet('preview')} />
                  ) : null}
                  <EngineConstraintNotice
                    state={state}
                    suggestion={suggestion}
                    courtCount={courtCount}
                    tierOverrides={fairnessAdjustment.tier_overrides}
                    onSetCourtCount={setCourtCount}
                    onOpenSettings={() => setSheet('settings')}
                  />
                  <EngineExplainCard
                    alternative={workingAlternative}
                    actions={suggestedRoundActions}
                    alternativeOrder={alternativeOrder}
                    expanded={showEngineStats}
                    onToggle={() => setShowEngineStats(value => !value)}
                    onApplyAction={applySuggestedRoundAction}
                    currentFairness={fairnessScore.total}
                  />
                  <MatchList
                    title={`${workingAlternative.matches.length} trận · ${workingAlternative.matches.length * 4} người chơi`}
                    matches={workingAlternative.matches}
                    state={state}
                    playersById={playersById}
                    onPlayerPress={openSwapForPlayer}
                  />
                  <RestingRow resting={workingAlternative.resting} playersById={playersById} />
                  {hasManualSwapHardGuard ? (
                    <View style={{ marginTop: 12, backgroundColor: theme.dangerBg, borderRadius: RADIUS.md, padding: 12, borderWidth: BORDER.hairline, borderColor: theme.dangerText, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={16} color={theme.dangerText} />
                      <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.dangerText, lineHeight: 17 }}>
                        Swap hiện tại vi phạm hard guard PVNA/team. Hãy hoàn tác hoặc chọn phương án khác trước khi bắt đầu.
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <EmptyPlanCard
                  state={state}
                  suggestion={suggestion}
                  courtCount={courtCount}
                  tierOverrides={fairnessAdjustment.tier_overrides}
                  onSetCourtCount={setCourtCount}
                  onOpenSettings={() => setSheet('settings')}
                  onSyncRoster={syncRoster}
                  busy={busy === 'sync'}
                />
              )}
            </>
          )}

          {phase === 'active' && activeRound && (
            <>
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
              <Text style={ctaTextStyle(theme.primary, 13)}>Hoàn tác đánh đổi: {selectionUndo.reason}</Text>
            </TouchableOpacity>
          )}

          {error ? (
            <View testID="nrv2-error-banner" style={{ marginTop: 12, backgroundColor: theme.dangerBg, borderRadius: RADIUS.md, padding: 12, borderWidth: BORDER.hairline, borderColor: theme.dangerText }}>
              <Text style={{ fontFamily: SCREEN_FONTS.body, color: theme.dangerText, fontSize: 12 }}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {phase !== 'recap' && (
        <StickyRoundCta
          busy={busy}
          primaryLabel={phase === 'active' ? 'Kết thúc & lưu vòng' : targetReached ? 'Chạy thêm vòng' : 'Bắt đầu vòng kế'}
          onPrimary={() => {
            if (phase === 'active') void endActiveRound()
            else if (workingAlternative) void startRound(workingAlternative)
          }}
          disabled={phase === 'plan' && (!workingAlternative || hasManualSwapHardGuard || suggestionIsUpdating)}
          computing={phase === 'plan' && suggestionIsUpdating}
          onMore={() => setSheet('more')}
        />
      )}

      <NextRoundSheet visible={sheet === 'settings'} snap="88" onClose={() => setSheet(null)}>
        {sheet === 'settings' ? (
          <SettingsSheet
            playerCount={calculatorPlayerCount}
            initial={{ courtCount, courtPreset, pvnaTolerance, courtDurationMin, targetRounds: effectiveTargetRounds }}
            onApply={(s) => {
              setCourtCount(s.courtCount)
              setCourtPreset(s.courtPreset)
              setPvnaTolerance(s.pvnaTolerance)
              setCourtDurationMin(s.courtDurationMin)
              setTargetRounds(s.targetRounds)
              setSheet(null)
            }}
          />
        ) : null}
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'fairness'} snap="88" onClose={() => setSheet(null)}>
        <FairnessSheet
          score={fairnessScore}
          state={state}
          warnings={fairnessWarnings}
          latestAudit={fairnessAudit}
          groupSummaries={groupSummaries}
          playersById={playersById}
        />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'preview'} snap="88" onClose={() => setSheet(null)}>
        <FairnessPreviewSheet preview={fairnessPreview} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'swap'} snap="88" onClose={() => setSheet(null)}>
        <SwapSheetView
          state={state}
          alternative={workingAlternative}
          playersById={playersById}
          swapFromPlayerId={swapFromPlayerId}
          setSwapFromPlayerId={setSwapFromPlayerId}
          onSwap={swapPlayersInWorkingAlternative}
        />
      </NextRoundSheet>


<NextRoundSheet visible={sheet === 'history'} snap="88" onClose={() => setSheet(null)}>
        <HistorySheetView rounds={completedRounds} playersById={playersById} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'late-arrivals'} snap="50" onClose={() => setSheet(null)}>
        <LateArrivalsSheetView players={lateArrivalPlayers} busy={busy} onAddPlayer={playerId => { void addLateArrivalToRoster(playerId) }} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'more'} snap="50" onClose={() => setSheet(null)}>
        <MoreSheetView
          onSyncRoster={syncRoster}
          onOpenRoster={openRoster}
          onOpenHistory={() => setSheet('history')}
          onOpenFairness={() => setSheet('fairness')}
          busy={busy}
        />
      </NextRoundSheet>
    </View>
  )
}

function SessionHeroCard({
  phase,
  roundNo,
  presentCount,
  rosterTotalCount,
  checkedOutCount,
  requestedRestCount,
  courtCount,
  completedRounds,
  targetRounds,
}: {
  phase: 'plan' | 'active'
  roundNo: number
  presentCount: number
  rosterTotalCount: number
  checkedOutCount: number
  requestedRestCount: number
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
            {presentCount} {phase === 'active' ? 'trong vòng' : 'trong danh sách'} · {courtCount} sân · {completedRounds}/{targetRounds} vòng
          </Text>
          <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.heroBodyMuted }}>
            Roster {rosterTotalCount} · Check-out {checkedOutCount} · Xin nghỉ {requestedRestCount}
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

function LateArrivalsCta({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useAppTheme()
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        marginTop: 12,
        borderRadius: RADIUS.md,
        backgroundColor: theme.warningBg,
        borderWidth: BORDER.hairline,
        borderColor: theme.warningStrong,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <View style={{ width: 32, height: 32, borderRadius: RADIUS.full, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.warningText }}>{count}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.warningText }}>Có người đến muộn</Text>
        <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.warningText }}>
          Thêm vào roster trước khi gợi ý vòng tiếp theo.
        </Text>
      </View>
      <Text style={ctaTextStyle(theme.warningText, 11)}>Mở</Text>
    </TouchableOpacity>
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
      <TouchableOpacity testID="nrv2-fairness-chip" onPress={onFairnessPress} activeOpacity={0.9} style={{ flex: 1 }}>
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
      <TouchableOpacity testID="nrv2-settings-chip" onPress={onSettingsPress} activeOpacity={0.9} style={{ flex: 1 }}>
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

function auditDeltaLines(best: AlternativeAudit, current: AlternativeAudit): string[] {
  type DeltaEntry = { label: string; delta: number; worse: boolean }
  const entries: DeltaEntry[] = []

  const opponentBurdenDelta = current.max_opponent_burden - best.max_opponent_burden
  if (opponentBurdenDelta !== 0) {
    entries.push({ label: `Lặp đối thủ ${opponentBurdenDelta > 0 ? '+' : ''}${opponentBurdenDelta}`, delta: Math.abs(opponentBurdenDelta), worse: opponentBurdenDelta > 0 })
  }
  const opponentPairDelta = current.opponent_repeat_pairs - best.opponent_repeat_pairs
  if (opponentPairDelta !== 0) {
    entries.push({ label: `Cặp đối thủ lặp ${opponentPairDelta > 0 ? '+' : ''}${opponentPairDelta}`, delta: Math.abs(opponentPairDelta), worse: opponentPairDelta > 0 })
  }
  const partnerPairDelta = current.partner_repeat_pairs - best.partner_repeat_pairs
  if (partnerPairDelta !== 0) {
    entries.push({ label: `Cặp partner lặp ${partnerPairDelta > 0 ? '+' : ''}${partnerPairDelta}`, delta: Math.abs(partnerPairDelta), worse: partnerPairDelta > 0 })
  }
  const matchRangeDelta = current.match_range - best.match_range
  if (matchRangeDelta !== 0) {
    entries.push({ label: `Lệch số trận ${matchRangeDelta > 0 ? '+' : ''}${matchRangeDelta}`, delta: Math.abs(matchRangeDelta), worse: matchRangeDelta > 0 })
  }
  const pvnaDelta = current.pvna_diff - best.pvna_diff
  if (Math.abs(pvnaDelta) >= 0.3) {
    entries.push({ label: `PVNA ${pvnaDelta > 0 ? '+' : ''}${pvnaDelta.toFixed(1)}`, delta: Math.abs(pvnaDelta), worse: pvnaDelta > 0 })
  }

  // 1 stat xấu nhất + 1 stat tốt nhất nếu có cả 2 chiều, ngược lại 2 stat lớn nhất
  const worse = entries.filter(e => e.worse).sort((a, b) => b.delta - a.delta)
  const better = entries.filter(e => !e.worse).sort((a, b) => b.delta - a.delta)
  if (worse.length > 0 && better.length > 0) {
    return [worse[0].label, better[0].label]
  }
  return entries.sort((a, b) => b.delta - a.delta).slice(0, 2).map(e => e.label)
}

function AlternativeTabs({
  alternatives,
  audits,
  alternativeOrder,
  selectedIndex,
  onSelect,
  onOpenHistory,
  onOpenRoster,
  targetReachedLabel,
}: {
  alternatives: SuggestionAlternative[]
  audits: AlternativeAudit[]
  alternativeOrder: number[]
  selectedIndex: number
  onSelect: (index: number) => void
  onOpenHistory: () => void
  onOpenRoster: () => void
  targetReachedLabel: string
}) {
  const theme = useAppTheme()
  const bestOriginalIndex = alternativeOrder[0] ?? 0
  const bestAudit = audits[bestOriginalIndex]
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={eyebrowStyle(theme.outline)}>{alternatives.length} phương án · Đề xuất</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={onOpenHistory}>
            <Text style={eyebrowStyle(theme.primary)}>{targetReachedLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="nrv2-roster-link" onPress={onOpenRoster}>
            <Text style={eyebrowStyle(theme.primary)}>Người chơi</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {alternativeOrder.slice(0, 3).map((originalIndex, displayIndex) => {
          const alternative = alternatives[originalIndex]
          const audit = audits[originalIndex]
          if (!alternative || !audit) return null
          const active = selectedIndex === originalIndex
          const isBest = displayIndex === 0
          const deltaLines = !isBest && bestAudit ? auditDeltaLines(bestAudit, audit) : []
          const hasDelta = deltaLines.length > 0
          return (
            <TouchableOpacity
              key={`alt-${originalIndex}`}
              testID={`nrv2-alt-tab-${originalIndex}`}
              onPress={() => onSelect(originalIndex)}
              activeOpacity={0.9}
              style={{
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                backgroundColor: active ? theme.primary : 'transparent',
                paddingHorizontal: 12,
                paddingVertical: hasDelta ? 8 : 0,
                minHeight: 44,
                flexDirection: 'row',
                alignItems: hasDelta ? 'flex-start' : 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1, justifyContent: 'center', paddingVertical: hasDelta ? 2 : 0 }}>
                <Text style={ctaTextStyle(active ? theme.onPrimary : theme.onSurface, 13)}>
                  ALT {displayIndex + 1}
                </Text>
                {hasDelta ? (
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: active ? 'rgba(255,255,255,0.72)' : theme.outline, marginTop: 2, lineHeight: 14 }}>
                    {deltaLines.join(' · ')}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: hasDelta ? 2 : 0 }}>
                <View
                  style={{
                    borderRadius: RADIUS.full,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    backgroundColor: active ? 'rgba(255,255,255,0.16)' : theme.secondaryContainer,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? theme.onPrimary : theme.primary }}>
                    {audit.fairness_total}
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? theme.onPrimary : theme.outline }}>
                  {isBest ? 'Tốt nhất' : `${(audit.fairness_total - (bestAudit?.fairness_total ?? 0)).toFixed(0)}`}
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
  const beforeTotal = preview.before_total
  const afterTotal = preview.after_total
  const delta = preview.delta_total
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
            <Text style={eyebrowStyle(theme.outline)}>Dự kiến điểm vòng kế</Text>
            <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
              {beforeTotal} → {afterTotal}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline, marginTop: 4 }}>
              Bấm để xem audit chi tiết: partner (đồng đội), đối thủ, nhịp nghỉ và áp lực lặp
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

function FairnessPreviewSheet({ preview }: { preview: FairnessPreview | null }) {
  const theme = useAppTheme()
  if (!preview) {
    return <SheetTitle title="Dự kiến điểm vòng kế" subtitle="Chưa có phương án vòng kế để đánh giá." />
  }

  const tone = preview.delta_total >= 0 ? theme.successText : theme.warningText
  const summaryBg = preview.delta_total >= 0 ? theme.successBg : theme.warningBg
  const pressureText = preview.pressure_after.repeat_risk === 'low'
    ? 'Ít nguy cơ lặp partner (đồng đội) hoặc đối thủ.'
    : preview.pressure_after.repeat_risk === 'medium'
      ? 'Có thể bắt đầu lặp một vài partner (đồng đội) hoặc đối thủ.'
      : 'Áp lực lặp partner (đồng đội) hoặc đối thủ đang cao.'
  const availabilityText = preview.availability_after.churn_level === 'low'
    ? 'Danh sách người chơi ổn định.'
    : preview.availability_after.churn_level === 'medium'
      ? 'Có thay đổi người chơi, điểm độ cân bằng (fairness) đã tính nhẹ hơn.'
      : 'Người vào/ra nhiều, nên xem đây là kèo khó giữ đều tuyệt đối.'
  return (
    <View>
      <SheetTitle title="Nếu bắt đầu vòng này" subtitle="Ước tính độ cân bằng sau khi lưu phương án đang chọn." />
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 16, marginBottom: 14 }}>
        <Text style={eyebrowStyle(theme.heroCountdownText)}>Điểm dự kiến</Text>
        <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 42, color: theme.surface }}>
          {preview.before_total} → {preview.after_total}
        </Text>
        <View style={{ alignSelf: 'flex-start', marginTop: 8, backgroundColor: theme.heroPillBg, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={ctaTextStyle(theme.heroCountdownText, 12)}>
            {preview.delta_total > 0 ? '+' : ''}{preview.delta_total}
          </Text>
        </View>
      </LinearGradient>

      <Card style={{ borderRadius: RADIUS.md, padding: 12, marginBottom: 12, backgroundColor: summaryBg }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: tone }}>
          {preview.delta_total >= 0 ? 'Phương án này giữ độ cân bằng tốt' : 'Phương án này làm giảm độ cân bằng'}
        </Text>
        <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: tone }}>
          Điểm thay đổi {preview.delta_total > 0 ? '+' : ''}{preview.delta_total}. {pressureText} {availabilityText}
        </Text>
      </Card>

      <Card style={{ borderRadius: RADIUS.md, padding: 12, marginBottom: 12, backgroundColor: theme.secondaryContainer }}>
        <Text style={eyebrowStyle(theme.primary)}>Các chỉ số nền</Text>
        <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
          Áp lực lặp partner (đồng đội) hoặc đối thủ: {repeatRiskLabel(preview.pressure_before.repeat_risk)} → {repeatRiskLabel(preview.pressure_after.repeat_risk)}.
        </Text>
        <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
          Hệ số giảm phạt: {preview.pressure_before.penalty_multiplier.toFixed(2)} → {preview.pressure_after.penalty_multiplier.toFixed(2)}. Áp lực đối thủ: {preview.pressure_before.opponent_pressure.toFixed(2)} → {preview.pressure_after.opponent_pressure.toFixed(2)}.
        </Text>
        <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
          Biến động người chơi: {churnLevelLabel(preview.availability_before.churn_level)} → {churnLevelLabel(preview.availability_after.churn_level)}. Tỉ lệ người vào/ra: {(preview.availability_before.avg_churn_ratio * 100).toFixed(0)}% → {(preview.availability_after.avg_churn_ratio * 100).toFixed(0)}%.
        </Text>
      </Card>

      <View style={{ gap: 8 }}>
        {preview.rows.map(row => (
          <Card key={`preview-row-${row.key}`} style={{ borderRadius: RADIUS.md, padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{row.label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline }}>
                {row.before} → {row.after}
              </Text>
              <Text style={{ width: 36, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: row.delta >= 0 ? theme.primary : tone }}>
                {row.delta > 0 ? '+' : ''}{row.delta}
              </Text>
            </View>
            <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 16, color: theme.outline }}>
              {describePreviewRow(row)}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  )
}

function describePreviewRow(row: FairnessPreview['rows'][number]) {
  if (row.key === 'match_count') {
    return row.delta < 0
      ? 'Một số người sẽ lệch số trận sau vòng này. Nếu lệch chỉ 1 trận thì thường vẫn ổn.'
      : 'Số trận giữa người chơi vẫn cân bằng.'
  }
  if (row.key === 'partner_diversity') {
    return row.delta < 0
      ? 'Có thêm cặp đánh chung bị lặp.'
      : 'Không làm xấu độ đa dạng partner (đồng đội).'
  }
  if (row.key === 'opponent_diversity') {
    return row.delta < 0
      ? 'Có thêm đối thủ bị gặp lại.'
      : 'Không làm xấu độ đa dạng đối thủ.'
  }
  if (row.key === 'rest') {
    return row.delta < 0
      ? 'Có người nghỉ liên tiếp hoặc nhịp nghỉ xấu hơn.'
      : 'Nhịp nghỉ vẫn ổn.'
  }
  if (row.key === 'gender_prefs') {
    return row.delta < 0
      ? 'Một số sở thích giới tính không được đáp ứng trong vòng này.'
      : 'Sở thích giới tính vẫn được giữ tốt.'
  }
  return row.detail
}

function EngineExplainCard({
  alternative,
  actions,
  alternativeOrder,
  expanded,
  onToggle,
  onApplyAction,
  currentFairness,
}: {
  alternative: SuggestionAlternative
  actions: SuggestedRoundAction[]
  alternativeOrder: number[]
  expanded: boolean
  onToggle: () => void
  onApplyAction: (action: SuggestedRoundAction) => void
  currentFairness: number
}) {
  const theme = useAppTheme()
  const betterAltAction = actions.find((a): a is Extract<SuggestedRoundAction, { type: 'select_alternative' }> => a.type === 'select_alternative')
  const setupActions = actions.filter((a): a is Extract<SuggestedRoundAction, { type: 'set_pvna_tolerance' | 'set_courts' }> => a.type === 'set_pvna_tolerance' || a.type === 'set_courts')
  const comparisonReasons = betterAltAction?.after ? improvementReasons(betterAltAction.before, betterAltAction.after) : []
  const displayIndexOf = (originalIndex: number) => alternativeOrder.indexOf(originalIndex)

  return (
    <Card style={{ marginTop: 12, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Sparkles size={16} color={theme.primary} />
        <Text style={eyebrowStyle(theme.primary)}>Engine giải thích</Text>
      </View>

      {betterAltAction ? (
        <>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurface }}>
            ALT {displayIndexOf(betterAltAction.alternative_index) + 1} tốt hơn phương án đang chọn
          </Text>
          {comparisonReasons.length > 0 ? (
            <View style={{ marginTop: 8, gap: 4 }}>
              {comparisonReasons.map((reason, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>·</Text>
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurface, lineHeight: 17 }}>
                    {reason}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 19, color: theme.onSurface }}>
          Đây là phương án tối ưu cho vòng này. Engine cân PVNA, hạn chế lặp partner/đối thủ, giữ nhịp nghỉ và tôn trọng group/sở thích.
        </Text>
      )}

      <TouchableOpacity onPress={onToggle} style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={ctaTextStyle(theme.outline, 11)}>Chi tiết điểm ghép</Text>
        <ChevronDown size={14} color={theme.outline} />
      </TouchableOpacity>
      {expanded ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {[
            ['Chênh PVNA', alternative.stats.pvna_diff.toFixed(2)],
            ['Lặp partner', String(alternative.stats.partner_repeats)],
            ['Lặp đối thủ', String(alternative.stats.opponent_repeats)],
            ['Điểm ưu tiên group', String(alternative.stats.group_bonus)],
            ['Sở thích giới tính', alternative.stats.gender_pref_penalty.toFixed(1)],
            ['Điểm ghép tổng', alternative.score.toFixed(1)],
          ].map(([label, value]) => (
            <View key={label} style={{ width: '48%', backgroundColor: theme.surface, borderRadius: RADIUS.md, padding: 10, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
              <Text style={eyebrowStyle(theme.outline, 9)}>{label}</Text>
              <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {betterAltAction ? (
        <TouchableOpacity
          onPress={() => onApplyAction(betterAltAction)}
          style={{
            marginTop: 12,
            minHeight: 42,
            borderRadius: RADIUS.md,
            backgroundColor: theme.primary,
            paddingHorizontal: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={ctaTextStyle(theme.surface, 13)}>
            Chuyển sang ALT {displayIndexOf(betterAltAction.alternative_index) + 1}
          </Text>
        </TouchableOpacity>
      ) : null}

      {setupActions.length > 0 ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {setupActions.map(action => {
            const impactLines = setupActionImpactLines(action, currentFairness)
            return (
              <TouchableOpacity
                key={action.type}
                onPress={() => onApplyAction(action)}
                style={{
                  minHeight: 38,
                  borderRadius: RADIUS.md,
                  backgroundColor: theme.surface,
                  borderWidth: BORDER.hairline,
                  borderColor: theme.outlineVariant,
                  padding: 12,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, lineHeight: 16 }}>
                    {action.label}
                  </Text>
                  <Text style={ctaTextStyle(theme.primary, 11)}>Đánh đổi</Text>
                </View>
                <View style={{ gap: 3 }}>
                  {impactLines.map(line => (
                    <Text key={line} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline, lineHeight: 15 }}>
                      {line}
                    </Text>
                  ))}
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.primary, lineHeight: 14 }}>
                  Có thể hoàn tác sau khi áp dụng.
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}
    </Card>
  )
}

function setupActionImpactLines(
  action: Extract<SuggestedRoundAction, { type: 'set_pvna_tolerance' | 'set_courts' }>,
  currentFairness: number,
): string[] {
  const after = action.after
  if (!after) return [action.detail]

  const before = action.before
  const lines: string[] = []

  // Fairness: hiện tại → sau vòng (không áp) vs sau vòng (áp dụng)
  lines.push(`Fairness: ${currentFairness} → ${before.fairness_total} (không áp) / ${after.fairness_total} (áp dụng)`)

  // Chỉ hiện các stats thực sự thay đổi khi áp đánh đổi
  if (before.pvna_diff !== after.pvna_diff) {
    lines.push(`Chênh PVNA vòng này: ${before.pvna_diff.toFixed(2)} → ${after.pvna_diff.toFixed(2)}`)
  }
  if (before.match_range !== after.match_range) {
    lines.push(`Lệch số trận: ${before.match_range} → ${after.match_range}`)
  }
  if (before.max_opponent_burden !== after.max_opponent_burden) {
    lines.push(`Tải lặp đối thủ tối đa: ${before.max_opponent_burden} → ${after.max_opponent_burden}`)
  }
  const repeatBefore = before.opponent_repeat_pairs + before.partner_repeat_pairs
  const repeatAfter = after.opponent_repeat_pairs + after.partner_repeat_pairs
  if (repeatBefore !== repeatAfter) {
    lines.push(`Cặp lặp tổng: ${repeatBefore} → ${repeatAfter}`)
  }
  if (before.max_opponent_pair !== after.max_opponent_pair) {
    lines.push(`Lặp đối thủ nhiều nhất: ${before.max_opponent_pair} → ${after.max_opponent_pair}`)
  }
  if (before.max_partner_pair !== after.max_partner_pair) {
    lines.push(`Lặp partner nhiều nhất: ${before.max_partner_pair} → ${after.max_partner_pair}`)
  }

  return lines
}

function improvementReasons(before: AlternativeAudit, after: AlternativeAudit): string[] {
  const reasons: string[] = []
  if (after.match_range < before.match_range)
    reasons.push(`Số trận đều hơn: lệch ${before.match_range}→${after.match_range}`)
  if (after.max_opponent_burden < before.max_opponent_burden)
    reasons.push(`Gặp lại đối thủ: tối đa ${before.max_opponent_burden}→${after.max_opponent_burden}`)
  if (after.max_opponent_pair < before.max_opponent_pair)
    reasons.push(`Lặp đối thủ: ${before.max_opponent_pair}→${after.max_opponent_pair} lần`)
  if (after.max_partner_pair < before.max_partner_pair)
    reasons.push(`Lặp đồng đội: ${before.max_partner_pair}→${after.max_partner_pair} lần`)
  if (after.opponent_repeat_pairs < before.opponent_repeat_pairs)
    reasons.push(`Cặp đối thủ lặp: ${before.opponent_repeat_pairs}→${after.opponent_repeat_pairs}`)
  if (after.partner_repeat_pairs < before.partner_repeat_pairs)
    reasons.push(`Cặp đồng đội lặp: ${before.partner_repeat_pairs}→${after.partner_repeat_pairs}`)
  if (after.fairness_total > before.fairness_total + 2)
    reasons.push(`Điểm fairness: ${before.fairness_total}→${after.fairness_total}`)
  return reasons
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
  const diff = useMemo(
    () => Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state)),
    [match.team_a, match.team_b, state],
  )
  const scored = useMemo(
    () => match.stats && match.score != null ? { score: match.score, stats: match.stats } : scoreMatch(match.team_a, match.team_b, state),
    [match, state],
  )
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
        Điểm ghép {Number.isFinite(scored.score) ? scored.score.toFixed(1) : '-'} · Partner lặp {scored.stats.partner_repeats} · Đối thủ lặp {scored.stats.opponent_repeats}
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

const EMPTY_PLAN_TEXT = {
  defaultTitle: 'Ch\u01b0a c\u00f3 g\u1ee3i \u00fd v\u00f2ng',
  blockedTitle: 'Engine \u0111ang b\u1ecb k\u1eb9t r\u00e0ng bu\u1ed9c',
  defaultBody: 'C\u1eadp nh\u1eadt danh s\u00e1ch ng\u01b0\u1eddi ch\u01a1i tr\u01b0\u1edbc, sau \u0111\u00f3 engine s\u1ebd t\u1ea1o ph\u01b0\u01a1ng \u00e1n cho v\u00f2ng k\u1ebf.',
  capacityBody: (mustPlay: number, slots: number, courts: number) =>
    `${mustPlay} ng\u01b0\u1eddi \u0111ang c\u1ea7n \u01b0u ti\u00ean ch\u01a1i, nh\u01b0ng ${courts} s\u00e2n ch\u1ec9 c\u00f3 ${slots} slot. N\u1ebfu b\u1eaft t\u1ea5t c\u1ea3 nh\u00f3m n\u00e0y c\u00f9ng ch\u01a1i th\u00ec kh\u00f4ng c\u00f3 t\u1ed5 h\u1ee3p h\u1ee3p l\u1ec7.`,
  noMatchBody: 'Engine kh\u00f4ng t\u00ecm \u0111\u01b0\u1ee3c t\u1ed5 h\u1ee3p h\u1ee3p l\u1ec7 v\u1edbi roster v\u00e0 c\u00e0i \u0111\u1eb7t hi\u1ec7n t\u1ea1i.',
  notEnoughBody: (eligible: number) =>
    `Ch\u1ec9 c\u00f3 ${eligible} ng\u01b0\u1eddi c\u00f3 th\u1ec3 x\u1ebfp ch\u01a1i. C\u1ea7n t\u1ed1i thi\u1ec3u 4 ng\u01b0\u1eddi \u0111\u1ec3 t\u1ea1o 1 tr\u1eadn.`,
  sectionTitle: 'C\u00e1ch x\u1eed l\u00fd',
  increaseCourt: (courts: number) => `T\u0103ng l\u00ean ${courts} s\u00e2n n\u1ebfu mu\u1ed1n \u0111\u1ea3m b\u1ea3o nh\u00f3m \u01b0u ti\u00ean \u0111\u01b0\u1ee3c ch\u01a1i.`,
  acceptRest: (resting: number) => `Gi\u1eef s\u1ed1 s\u00e2n hi\u1ec7n t\u1ea1i v\u00e0 ch\u1ea5p nh\u1eadn kho\u1ea3ng ${resting} ng\u01b0\u1eddi ngh\u1ec9 v\u00f2ng n\u00e0y.`,
  openSettingsHint: 'M\u1edf c\u00e0i \u0111\u1eb7t \u0111\u1ec3 \u0111\u1ed5i s\u1ed1 s\u00e2n ho\u1eb7c n\u1edbi m\u1ee9c c\u00e2n PVNA.',
  sync: 'C\u1eadp nh\u1eadt danh s\u00e1ch ng\u01b0\u1eddi ch\u01a1i',
  settings: 'M\u1edf c\u00e0i \u0111\u1eb7t',
  applyCourts: (courts: number) => `D\u00f9ng ${courts} s\u00e2n`,
}

function getEngineConstraintDiagnostic(
  state: SessionState,
  suggestion: SuggestionResult,
  courtCount: number,
  tierOverrides: Record<string, number>,
) {
  const eligiblePlayers = [...state.players.values()].filter(player => !player.checked_out_at && !player.opted_rest)
  const eligibleCount = eligiblePlayers.length
  const slots = Math.min(Math.max(1, courtCount) * 4, Math.floor(eligibleCount / 4) * 4)
  const mustPlayIds = new Set(eligiblePlayers.filter(player => player.consecutive_rest >= 1).map(player => player.player_id))
  for (const [playerId, tier] of Object.entries(tierOverrides)) {
    if (tier === 0 && eligiblePlayers.some(player => player.player_id === playerId)) mustPlayIds.add(playerId)
  }
  const mustPlayCount = mustPlayIds.size
  const hasCapacityWarning = suggestion.warnings.includes('MUST_PLAY_OVER_CAPACITY')
  const hasNoMatchWarning = suggestion.warnings.includes('NO_VALID_MATCH')
  const hasNotEnoughWarning = suggestion.warnings.includes('NOT_ENOUGH_PRESENT') || slots < 4
  const requiredCourts = Math.max(courtCount + 1, Math.ceil(Math.max(4, mustPlayCount) / 4))
  const restingCount = Math.max(0, eligibleCount - slots)
  const isBlocked = hasCapacityWarning || hasNoMatchWarning || hasNotEnoughWarning
  const body = hasCapacityWarning
    ? EMPTY_PLAN_TEXT.capacityBody(mustPlayCount, slots, courtCount)
    : hasNotEnoughWarning
      ? EMPTY_PLAN_TEXT.notEnoughBody(eligibleCount)
      : hasNoMatchWarning
        ? EMPTY_PLAN_TEXT.noMatchBody
        : EMPTY_PLAN_TEXT.defaultBody
  const suggestions = hasCapacityWarning
    ? [
        EMPTY_PLAN_TEXT.increaseCourt(requiredCourts),
        EMPTY_PLAN_TEXT.acceptRest(restingCount),
        EMPTY_PLAN_TEXT.openSettingsHint,
      ]
    : hasNoMatchWarning
      ? [EMPTY_PLAN_TEXT.openSettingsHint, EMPTY_PLAN_TEXT.acceptRest(restingCount)]
      : []

  return {
    body,
    hasCapacityWarning,
    hasNoMatchWarning,
    hasNotEnoughWarning,
    isBlocked,
    requiredCourts,
    suggestions,
  }
}

function EngineConstraintNotice({
  state,
  suggestion,
  courtCount,
  tierOverrides,
  onSetCourtCount,
  onOpenSettings,
}: {
  state: SessionState
  suggestion: SuggestionResult
  courtCount: number
  tierOverrides: Record<string, number>
  onSetCourtCount: (courts: number) => void
  onOpenSettings: () => void
}) {
  const theme = useAppTheme()
  const diagnostic = getEngineConstraintDiagnostic(state, suggestion, courtCount, tierOverrides)
  if (!diagnostic.isBlocked) return null

  return (
    <Card style={{ marginTop: 12, padding: 12, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderColor: theme.warningStrong }}>
      <Text style={eyebrowStyle(theme.warningText)}>{EMPTY_PLAN_TEXT.blockedTitle}</Text>
      <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>
        {diagnostic.body}
      </Text>
      {diagnostic.suggestions.length > 0 ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          {diagnostic.suggestions.map((item, index) => (
            <Text key={`engine-constraint-${index}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
              {`\u2022 ${item}`}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {diagnostic.hasCapacityWarning && diagnostic.requiredCourts > courtCount ? (
          <TouchableOpacity
            onPress={() => onSetCourtCount(diagnostic.requiredCourts)}
            style={{ flex: 1, minHeight: 38, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={ctaTextStyle(theme.primary, 11)}>{EMPTY_PLAN_TEXT.applyCourts(diagnostic.requiredCourts)}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onOpenSettings}
          style={{ flex: 1, minHeight: 38, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={ctaTextStyle(theme.primary, 11)}>{EMPTY_PLAN_TEXT.settings}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  )
}

function EmptyPlanCard({
  state,
  suggestion,
  courtCount,
  tierOverrides,
  onSetCourtCount,
  onOpenSettings,
  onSyncRoster,
  busy,
}: {
  state: SessionState
  suggestion: SuggestionResult
  courtCount: number
  tierOverrides: Record<string, number>
  onSetCourtCount: (courts: number) => void
  onOpenSettings: () => void
  onSyncRoster: () => void
  busy: boolean
}) {
  const theme = useAppTheme()
  const diagnostic = getEngineConstraintDiagnostic(state, suggestion, courtCount, tierOverrides)

  return (
    <Card style={{ marginTop: 16, padding: 18, alignItems: 'stretch', borderColor: diagnostic.isBlocked ? theme.warningStrong : theme.outlineVariant }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: diagnostic.isBlocked ? theme.warningText : theme.onSurface, textAlign: 'center' }}>
        {diagnostic.isBlocked ? EMPTY_PLAN_TEXT.blockedTitle : EMPTY_PLAN_TEXT.defaultTitle}
      </Text>
      <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: diagnostic.isBlocked ? theme.warningText : theme.outline, textAlign: 'center' }}>
        {diagnostic.body}
      </Text>

      {diagnostic.suggestions.length > 0 ? (
        <View style={{ marginTop: 14, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, padding: 12 }}>
          <Text style={eyebrowStyle(theme.warningText)}>{EMPTY_PLAN_TEXT.sectionTitle}</Text>
          <View style={{ marginTop: 8, gap: 5 }}>
            {diagnostic.suggestions.map((item, index) => (
              <Text key={`empty-plan-suggestion-${index}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>
                {`\u2022 ${item}`}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        {diagnostic.hasCapacityWarning && diagnostic.requiredCourts > courtCount ? (
          <TouchableOpacity
            onPress={() => onSetCourtCount(diagnostic.requiredCourts)}
            style={{ flex: 1, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={ctaTextStyle(theme.primary, 12)}>{EMPTY_PLAN_TEXT.applyCourts(diagnostic.requiredCourts)}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onOpenSettings}
          style={{ flex: 1, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={ctaTextStyle(theme.primary, 12)}>{EMPTY_PLAN_TEXT.settings}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        testID="nrv2-sync-btn"
        onPress={onSyncRoster}
        disabled={busy}
        style={{ marginTop: 10, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 13)}>{EMPTY_PLAN_TEXT.sync}</Text>}
      </TouchableOpacity>
    </Card>
  )
}

type SettingsSnapshot = {
  courtCount: number
  courtPreset: CourtPreset
  pvnaTolerance: number
  courtDurationMin: number
  targetRounds: number
}

function SettingsSheet({
  playerCount,
  initial,
  onApply,
}: {
  playerCount: number
  initial: SettingsSnapshot
  onApply: (s: SettingsSnapshot) => void
}) {
  const theme = useAppTheme()
  const [courtCount, setCourtCount] = useState(initial.courtCount)
  const [courtPreset, setCourtPreset] = useState(initial.courtPreset)
  const [pvnaTolerance, setPvnaTolerance] = useState(initial.pvnaTolerance)
  const [courtDurationMin, setCourtDurationMin] = useState(initial.courtDurationMin)
  const [targetRounds, setTargetRounds] = useState(initial.targetRounds)

  const calculator = useMemo(() => calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [playerCount, courtDurationMin, courtPreset])

  const recommended = calculator.recommended
  const warning = calculator.setup_warnings[0]

  const applyCourtWarningAlternative = (alternative: CourtWarningAlternative) => {
    if (alternative.action === 'set_duration' && alternative.duration_min) {
      setCourtDurationMin(alternative.duration_min)
      setTargetRounds(alternative.preview.rounds)
      return
    }
    if (alternative.action === 'set_preset' && alternative.preset) {
      setCourtPreset(alternative.preset)
      setTargetRounds(alternative.preview.rounds)
      return
    }
    if (alternative.action === 'set_courts' && alternative.courts) {
      setCourtCount(alternative.courts)
      setTargetRounds(alternative.preview.rounds)
    }
  }

  return (
    <View>
      <SheetTitle title="Cài đặt vòng" subtitle="Điều chỉnh setup trước khi start vòng kế." />
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 14, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Zap size={18} color={theme.heroCountdownText} />
          <View style={{ flex: 1 }}>
            <Text style={eyebrowStyle(theme.heroCountdownText)}>Engine khuyến nghị</Text>
            <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
              Giữ setup gần gợi ý sân, chỉ mở dung sai PVNA khi áp lực lặp partner/đối thủ tăng.
            </Text>
          </View>
        </View>
      </LinearGradient>
      <View style={{ marginBottom: 14, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>
          Gợi ý: {recommended.courts} sân
        </Text>
        <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.onSurface }}>
          {calculator.reasoning}
        </Text>
      </View>
      {warning ? (
        <View style={{ marginBottom: 14, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, padding: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.warningText }}>{warning.message}</Text>
          <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>{warning.why}</Text>
          {warning.alternatives.length > 0 ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              {warning.alternatives.map((alternative, index) => (
                <TouchableOpacity
                  key={`${warning.type}-${alternative.action}-${index}`}
                  onPress={() => applyCourtWarningAlternative(alternative)}
                  style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 10 }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface }}>{alternative.label}</Text>
                  <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>
                    {alternative.expected_effect} · {alternative.tradeoff}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <CourtSuggestionOptions
        options={calculator.alternatives}
        selectedCourts={courtCount}
        recommendedCourts={recommended.courts}
        onSelect={setCourtCount}
      />
      <ChoiceRow label="Sân" options={[1, 2, 3, 4, 5, 6].map(value => ({ label: String(value), value }))} value={courtCount} onChange={setCourtCount} />
      <ChoiceRow
        label="Chế độ"
        options={COURT_PRESET_OPTIONS.map(value => ({ label: PRESETS[value].label, value }))}
        value={courtPreset}
        onChange={setCourtPreset}
      />
      <ChoiceRow label="Dung sai PVNA" options={PVNA_TOLERANCE_OPTIONS.map(value => ({ label: `±${value}`, value }))} value={pvnaTolerance} onChange={setPvnaTolerance} />
      <ChoiceRow label="Thời lượng" options={COURT_DURATION_OPTIONS.map(value => ({ label: `${value}p`, value }))} value={courtDurationMin} onChange={setCourtDurationMin} />
      <ChoiceRow
        label="Mục tiêu vòng"
        options={[6, 8, 10, recommended.total_rounds].filter((v, i, arr) => arr.indexOf(v) === i).map(value => ({ label: `${value}`, value }))}
        value={targetRounds}
        onChange={setTargetRounds}
      />
      <TouchableOpacity
        testID="nrv2-settings-apply"
        onPress={() => onApply({ courtCount, courtPreset, pvnaTolerance, courtDurationMin, targetRounds })}
        style={{ height: 52, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}
      >
        <Text style={ctaTextStyle(theme.onPrimary)}>Áp dụng</Text>
      </TouchableOpacity>
    </View>
  )
}

function CourtSuggestionOptions({
  options,
  selectedCourts,
  recommendedCourts,
  onSelect,
}: {
  options: CourtOption[]
  selectedCourts: number
  recommendedCourts: number
  onSelect: (courts: number) => void
}) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>Gợi ý số sân</Text>
      <View style={{ gap: 8 }}>
        {options.map(option => {
          const selected = option.courts === selectedCourts
          const recommended = option.courts === recommendedCourts
          const disabled = option.feasibility === 'infeasible'
          const toneColor = option.feasibility === 'optimal'
            ? theme.primary
            : option.feasibility === 'tight'
              ? theme.warningText
              : theme.outline
          return (
            <TouchableOpacity
              key={`court-option-${option.courts}`}
              disabled={disabled}
              onPress={() => onSelect(option.courts)}
              style={{
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: selected ? theme.primary : theme.outlineVariant,
                backgroundColor: selected ? theme.secondaryContainer : theme.surface,
                padding: 12,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>
                    {option.courts} sân · {option.avg_matches_per_player.toFixed(1)} trận/người
                  </Text>
                  <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                    {option.total_rounds} vòng · nghỉ {option.resting_per_round}/vòng · lặp {repeatRiskLabel(option.repeat_pressure.risk)}
                  </Text>
                  {option.warnings[0] ? (
                    <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.warningText }}>
                      {option.warnings[0]}
                    </Text>
                  ) : null}
                </View>
                <View style={{ borderRadius: RADIUS.full, backgroundColor: recommended ? theme.heroCountdownText : theme.surfaceContainerLow, paddingHorizontal: 9, paddingVertical: 5 }}>
                  <Text style={ctaTextStyle(recommended ? theme.primaryContainer : toneColor, 10)}>
                    {recommended ? 'Đề xuất' : feasibilityLabel(option.feasibility)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function FairnessSheet({
  score,
  state,
  warnings,
  latestAudit,
  groupSummaries,
  playersById,
}: {
  score: SessionFairnessScore
  state: SessionState
  warnings: FairnessWarning[]
  latestAudit: FairnessAudit | null
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const metrics = useMemo(() => ({
    match: computeMatchCountMetrics(state),
    partner: computePartnerDiversity(state),
    opponent: computeOpponentDiversity(state),
    rest: computeRestFairness(state),
    gender: computeGenderPrefSatisfaction(state),
    pressure: computeRepeatPressure(state),
    burden: computeOpponentRepeatBurden(state),
  }), [state])
  const { match, partner, opponent, rest, gender, pressure, burden } = metrics
  const rows = [
    ['Số trận', score.breakdown.match_count, 25, `Chênh số trận ${match.range} · Trung bình ${match.avg.toFixed(1)} trận/người`],
    ['Partner (đồng đội)', score.breakdown.partner_diversity, 20, `${partner.repeat_pairs.length} cặp lặp`],
    ['Đối thủ', score.breakdown.opponent_diversity, 15, `${opponent.repeat_pairs.length} cặp lặp · Một người bị lặp nhiều nhất ${burden.max_repeated_opponents} đối thủ`],
    ['Nghỉ', score.breakdown.rest, 20, `${rest.violations.length} vi phạm`],
    ['Sở thích giới tính', score.breakdown.gender_prefs, 20, `${gender.satisfied_count}/${gender.total_pref_opportunities || 0} sở thích được đáp ứng`],
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
          Áp lực lặp {repeatRiskLabel(pressure.repeat_risk)} · Trung bình {match.avg.toFixed(1)} trận/người · Áp lực đối thủ {pressure.opponent_pressure.toFixed(2)}
        </Text>
      </LinearGradient>
      {rows.map(([label, value, max, detail]) => (
        <BreakdownRow key={label} label={label} value={value} max={max} detail={detail} />
      ))}
      <LatestFairnessAuditCard audit={latestAudit} />
      <RepeatDetailsBlock
        partnerPairs={partner.repeat_pairs}
        opponentPairs={opponent.repeat_pairs}
        playersById={playersById}
      />
      {warnings.length > 0 ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {warnings.map((warning, index) => {
            const tone = warningTone(theme, warning.severity)
            return (
              <View key={`${warning.type}-${index}`} style={{ backgroundColor: tone.bg, borderRadius: RADIUS.md, padding: 10, borderWidth: BORDER.hairline, borderColor: tone.border }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: tone.text }}>{warningTitle(warning.type)}</Text>
                <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: tone.text }}>{warning.message}</Text>
              </View>
            )
          })}
        </View>
      ) : null}
      <GroupAuditBlock state={state} groupSummaries={groupSummaries} playersById={playersById} />
    </View>
  )
}

function LatestFairnessAuditCard({ audit }: { audit: FairnessAudit | null }) {
  const theme = useAppTheme()
  if (!audit) return null
  const tone = audit.delta_total >= 0 ? theme.successText : theme.warningText
  return (
    <View style={{ marginTop: 12, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>Audit điểm fairness</Text>
          <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>
            Sau vòng {audit.round_no}: {audit.before_total} → {audit.after_total}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: tone }}>
          {audit.delta_total > 0 ? '+' : ''}{audit.delta_total}
        </Text>
      </View>
      <View style={{ marginTop: 10, gap: 6 }}>
        {audit.rows.map(row => (
          <View key={row.key} style={{ borderRadius: RADIUS.xs, backgroundColor: theme.surfaceContainerLow, padding: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 11.5, color: theme.onSurface }}>{row.label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: row.delta < 0 ? theme.warningText : theme.primary }}>
                {row.before} → {row.after} ({row.delta > 0 ? '+' : ''}{row.delta})
              </Text>
            </View>
            <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>{describePreviewRow(row)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
