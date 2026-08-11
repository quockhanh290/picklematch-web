import { getTeamPvnaTotal } from '@/lib/next-round-suggester/state'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  SessionDashboardCard,
  FairnessPreviewSheet,
  CourtLaneLiveMatchBoard,
  RestRiskBanner,
  PlanningRoundCard,
  SettingsSheet,
  FairnessSheet,
  buildLogicalRoundDisplayMap
} from './next-round-v2/components/ScreenComponents'

import { ActivityIndicator, Alert, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SecondaryNavbar } from '@/components/design'
import { BORDER, RADIUS, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { buildSwappedAlternative } from '@/lib/next-round-suggester/manual-swap'
import { getProjectedRepeatSummary } from '@/lib/next-round-suggester/score'
import type {
  SessionLiveMatchRow,
  SessionPlayerStateRow,
  SessionState,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { invokeLiveSessionFunction, loadLatestSyncablePlayerIds, markSessionPlayersPresent } from './next-round-v2/api'
import { Card, NextRoundSheet, PlayerAvatar, SheetTitle } from './next-round-v2/components'
import { swapPlayersInSuggestedMatch } from './next-round-v2/preview-helpers'
import type { SuggestedLiveMatchRow } from './next-round-v2/preview'
import { NavbarRightActions } from './next-round-v2/controls'
import {
  HistorySheet as HistorySheetView,
  LateArrivalsSheet as LateArrivalsSheetView,
  MoreSheet as MoreSheetView,
  RecapView as RecapViewModule,
  SwapSheet as SwapSheetView,
} from './next-round-v2/flow-sheets'
import {
  ctaTextStyle,
  eyebrowStyle,
  getPlayerPvna,
  playerName,
} from './next-round-v2/helpers'
import type { NextRoundSuggesterV2Props } from './next-round-v2/types'
import { useNextRoundModel } from './next-round-v2/useNextRoundModel'
import { useCheckInMutation, useStartMatchMutation, useCompleteMatchMutation } from './next-round-v2/mutations'
import { useScrollDebug } from './next-round-v2/hooks/useScrollDebug'
import { usePreviewTelemetry } from './next-round-v2/hooks/usePreviewTelemetry'
import { useLiveBoard } from './next-round-v2/hooks/useLiveBoard'
import { toUserSafeActionError } from './next-round-v2/action-error'
const EMPTY_ARRANGEMENT_PLAYERS: ArrangementPlayer[] = []
const LiveMatchBoardComponent = CourtLaneLiveMatchBoard







type ActionResult = {
  reload?: boolean
  targetReachedAfterMatch?: boolean
}



export function NextRoundSuggesterScreenV2({ sessionId, players = EMPTY_ARRANGEMENT_PLAYERS, courts, bootstrapTelemetry = null, initialShowReport = false }: NextRoundSuggesterV2Props) {
  const queryClient = useQueryClient()
  const checkInMutation = useCheckInMutation(sessionId)
  const startMatchMutation = useStartMatchMutation(sessionId)
  const completeMatchMutation = useCompleteMatchMutation(sessionId)
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const isWeb = Platform.OS === 'web'
  const { scrollDebugMetrics, updateScrollDebugMetrics, webViewportHeight, scrollDebugEnabled } = useScrollDebug()
  const [busy, setBusy] = useState<string | null>(null)
  const actionInFlightRef = useRef(false)
  const autoSyncAttemptedRef = useRef(false)
  const lateArrivalInFlightRef = useRef(new Set<string>())
  const telemetry = usePreviewTelemetry(sessionId)
  const model = useNextRoundModel({ sessionId, players, courts, initialShowReport })
  const [finishingSession, setFinishingSession] = useState(false)
  const handleFinishSession = useCallback(() => {
    Alert.alert(
      'Kết thúc kèo',
      'Xác nhận kết thúc kèo này? Kèo sẽ chuyển sang lịch sử và không thể thêm vòng mới.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Kết thúc',
          style: 'destructive',
          onPress: async () => {
            setFinishingSession(true)
            const { data, error } = await supabase
              .from('sessions')
              .update({ status: 'done' })
              .eq('id', sessionId)
              .select('id')
            setFinishingSession(false)
            if (error || !data || data.length === 0) {
              Alert.alert('Lỗi', error?.message ?? 'Không thể kết thúc kèo')
              return
            }
            router.replace('/host/dashboard' as any)
          },
        },
      ],
    )
  }, [sessionId])
  const [suggestedSwapMatch, setSuggestedSwapMatch] = useState<SuggestedLiveMatchRow | null>(null)
  const {
    activeRound,
    checkedInPlayers,
    completedRoundCount,
    completedRounds,
    calculatorPlayerCount,
    courtCount,
    courtDurationMin,
    courtPreset,
    effectiveTargetRounds,
    error,
    fairnessAudit,
    fairnessPreview,
    fairnessScore,
    fairnessWarnings,
    groupSummaries,
    loadLiveState,
    loading,
    manualAlternative,
    matchCountConsistencyRows,
    phase,
    playersById,
    presentCount,
    pvnaTolerance,
    refreshing,
    rememberRoundSelection,
    reportState,
    reportReady,
    rosterPlayers,
    rows,
    selectedAlternative,
    selectionUndo,
    sessionSummary,
    settingsHydrated,
    setCourtCount,
    setCourtDurationMin,
    setCourtPreset,
    setError,
    setManualAlternative,
    setPvnaTolerance,
    setSheet,
    setShowSessionReport,
    setSwapFromPlayerId,
    setTargetRounds,
    sheet,
    state,
    suggestionIsUpdating,
    suggestion,
    swapFromPlayerId,
    undoRoundSelection,
    workingAlternative,
  } = model



  const openRoster = useCallback(() => {
    router.push({ pathname: '/host/session/[id]/roster', params: { id: sessionId } } as any)
  }, [sessionId])

  const runAction = useCallback(async (
    key: string,
    action: () => Promise<ActionResult | void>,
    opts?: { alreadyAppliedOnError?: (rows: any) => boolean },
  ) => {
    if (actionInFlightRef.current) {
      if (__DEV__) console.warn('[NextRoundSuggesterV2] action ignored while another action is running', { key, busy })
      setError('Đang xử lý thao tác trước đó, thử lại sau vài giây.')
      return
    }
    actionInFlightRef.current = true
    setBusy(key)
    setError(null)
    try {
      const result = await action()
      if (result?.reload !== false) {
        await loadLiveState()
      }
    } catch (err: any) {
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] action failed', err)
      // Idempotency backstop: a dropped response / second device can make the RPC report a
      // specific error even though the action landed. Reconcile from a fresh snapshot first;
      // if the desired outcome is already in place, treat it as success (no error dialog).
      const reconciledRows = await loadLiveState()
      if (opts?.alreadyAppliedOnError?.(reconciledRows)) {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] action failed but already applied; reconciled', { key, error: err?.message ?? String(err) })
        return
      }
      setError(safeMessage)
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
  }, [busy, loadLiveState])

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

  const {
    suggestedLiveMatches,
    availablePoolPreviews,
    startingPreviewIds,
    endingLiveMatchIds,
    completingLiveMatchIds,
    creatingNextMatchIds,
    isSuggestingPreview,
    courtShortageBreakdown,
    effectiveLiveMatchRows,
    activeLiveMatches,
    completedLiveMatches,
    queueCourtCount,
    setForcedWaitSelection,
    startLiveMatch,
    fetchAvailablePoolPreview,
    confirmStartNow,
    cancelAvailablePool,
    completeLiveMatch,
    cancelLiveMatch,
    swapPlayersInSuggestedLiveMatch,
  } = useLiveBoard({
    sessionId,
    model,
    telemetry,
    queryClient,
    startMatchMutation,
    completeMatchMutation,
    runAction,
    syncRoster,
    suggestedSwapMatch,
    setSuggestedSwapMatch,
    autoSyncAttemptedRef,
  })


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
    try {
      await checkInMutation.mutateAsync({ playerIds: [playerId], optimisticRows: [optimisticRow] })
      void markSessionPlayersPresent(sessionId, [playerId]).catch((error) => {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] late arrival session_players status update failed', error)
      })
    } catch (err: any) {
      
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




  const openSwapForPlayer = useCallback((playerId: string, match?: SuggestedLiveMatchRow) => {
    setSuggestedSwapMatch(match ?? null)
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

  const liveLogicalRoundByMatchId = useMemo(
    () => buildLogicalRoundDisplayMap([...completedLiveMatches, ...activeLiveMatches], queueCourtCount),
    [activeLiveMatches, completedLiveMatches, queueCourtCount],
  )
  const heroRoundNo = useMemo(() => {
    if (activeRound) return activeRound.round_no
    const displayedRoundNos = [
      ...activeLiveMatches.map(match => liveLogicalRoundByMatchId.get(match.id) ?? ((match.round_no ?? 0) + 1)),
      ...suggestedLiveMatches.map(match => (match.round_no ?? 0) + 1),
    ].filter(roundNo => Number.isFinite(roundNo) && roundNo > 0)
    if (displayedRoundNos.length > 0) return Math.max(...displayedRoundNos)
    if (activeLiveMatches.length > 0) {
      return Math.min(
        ...activeLiveMatches.map(match => liveLogicalRoundByMatchId.get(match.id) ?? ((match.round_no ?? 0) + 1)),
      )
    }
    if (suggestedLiveMatches.length > 0) {
      return Math.min(...suggestedLiveMatches.map(match => (match.round_no ?? 0) + 1))
    }
    const countableLiveMatches = effectiveLiveMatchRows.filter(match => match.status !== 'cancelled').length
    return Math.floor(countableLiveMatches / queueCourtCount) + 1
  }, [activeLiveMatches, activeRound, effectiveLiveMatchRows, liveLogicalRoundByMatchId, queueCourtCount, suggestedLiveMatches])
  const liveCompletedRoundCount = useMemo(() => {
    const countableLiveMatches = effectiveLiveMatchRows
      .filter(match => match.status !== 'cancelled')
      .length
    const completedByLiveMatches = countableLiveMatches === 0
      ? completedRoundCount
      : Math.floor(countableLiveMatches / queueCourtCount)
    return Math.max(completedRoundCount, completedByLiveMatches)
  }, [completedRoundCount, effectiveLiveMatchRows, queueCourtCount])
  const heroPlayerCount = plannedPlayerCount
  const { rosterTotalCount, checkedOutCount, requestedRestCount } = useMemo(() => ({
    rosterTotalCount: rows.playerRows.length,
    checkedOutCount: rows.playerRows.filter(row => Boolean(row.checked_out_at)).length,
    requestedRestCount: rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length,
  }), [rows.playerRows])
  const planningInProgress = phase === 'plan' && !settingsHydrated && (
    !settingsHydrated
    || suggestionIsUpdating
    || busy === 'sync'
    || (rows.playerRows.length === 0 && checkedInPlayers.length > 0 && !autoSyncAttemptedRef.current)
  )
  const lateArrivalPlayers = useMemo(() => {
    const livePlayerIds = new Set(rows.playerRows.map(row => String(row.player_id)))
    return rosterPlayers.filter(player => {
      const playerId = String(player.id)
      if (player.status && player.status !== 'confirmed') return false
      const status = player.checkInStatus
      return (status === 'pending' || status === 'no_show') && (!livePlayerIds.has(playerId) || busy === `late-${playerId}`)
    })
  }, [busy, rows.playerRows, rosterPlayers])

  const navbarRightSlot = <NavbarRightActions onRefresh={loadLiveState} refreshing={refreshing} />

  if (loading) {
    return (
      <View
        testID="nrv2-screen"
        style={{
          flex: 1,
          minHeight: 0,
          backgroundColor: theme.background,
          ...(isWeb
            ? {
                minHeight: webViewportHeight ?? 0,
                overflow: 'visible',
              }
            : null),
        }}
      >
        <SecondaryNavbar title="QUẢN LÝ TRẬN ĐẤU" rightSlot={navbarRightSlot} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </View>
    )
  }

  return (
    <View
      testID="nrv2-screen"
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.background,
        ...(isWeb
          ? {
              minHeight: webViewportHeight ?? 0,
              overflow: 'visible',
            }
          : null),
      }}
    >
      <SecondaryNavbar title={phase === 'recap' ? 'BÁO CÁO TRẬN ĐẤU' : 'QUẢN LÝ TRẬN ĐẤU'} rightSlot={navbarRightSlot} />
      {phase === 'recap' ? (
        <RecapViewModule
          summary={sessionSummary}
          state={reportState}
          matchCountConsistencyRows={matchCountConsistencyRows}
          groupSummaries={groupSummaries}
          playersById={playersById}
          liveMatchRows={rows.liveMatchRows}
          onOpenHistory={() => setSheet('history')}
          onContinue={() => setShowSessionReport(false)}
          onFinish={handleFinishSession}
          finishing={finishingSession}
          hideContinue={initialShowReport}
        />
      ) : (
        <ScrollView
          style={{
            ...(isWeb
              ? {
                  flexGrow: 0,
                  flexShrink: 0,
                  overflow: 'visible',
                  overflowY: 'visible',
                  overflowAnchor: 'none',
                  touchAction: 'pan-y',
                  willChange: 'transform',
                  transform: [{ translateZ: 0 }],
                } as any
              : {
                  flex: 1,
                  minHeight: 0,
                }),
          }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={scrollDebugEnabled ? 100 : undefined}
          onLayout={scrollDebugEnabled ? (event) => {
            updateScrollDebugMetrics({ layoutHeight: Math.round(event.nativeEvent.layout.height) })
          } : undefined}
          onContentSizeChange={scrollDebugEnabled ? (_width, height) => {
            updateScrollDebugMetrics({ contentHeight: Math.round(height) })
          } : undefined}
          onScroll={scrollDebugEnabled ? (event) => {
            const nativeEvent = event.nativeEvent
            updateScrollDebugMetrics({
              scrollY: Math.round(nativeEvent.contentOffset.y),
              layoutHeight: Math.round(nativeEvent.layoutMeasurement.height),
              contentHeight: Math.round(nativeEvent.contentSize.height),
            })
          } : undefined}
          contentContainerStyle={{
            flexGrow: 1,
            padding: SPACING.xl,
            paddingBottom: 126 + insets.bottom,
            ...(isWeb ? { minHeight: webViewportHeight ?? 0 } : null),
          }}
        >
          <SessionDashboardCard
            phase={phase}
            roundNo={heroRoundNo}
            presentCount={heroPlayerCount}
            rosterTotalCount={rosterTotalCount}
            checkedOutCount={checkedOutCount}
            requestedRestCount={requestedRestCount}
            lateCount={lateArrivalPlayers.length}
            groupSummaries={groupSummaries}
            playersById={playersById}
            courtCount={courtCount}
            roundPace={15}
            pvnaTolerance={pvnaTolerance}
            sessionDuration={courtDurationMin}
            fairnessScore={fairnessScore}
            completedRounds={liveCompletedRoundCount}
            targetRounds={effectiveTargetRounds}
            onOpenRoster={openRoster}
            onFairnessPress={() => setSheet('fairness')}
            onSettingsPress={() => setSheet('settings')}
            onLatePress={() => setSheet('late-arrivals')}
          />

          {phase === 'plan' && (
            <>
              {reportReady && !activeRound ? (
                <Card style={{ marginTop: 14, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: theme.primary }}>
                    Đã đủ số vòng mục tiêu
                  </Text>
                  <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
                    Có thể xem report hoặc tạo thêm trận nếu buổi chơi vẫn tiếp tục.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowSessionReport(true)}
                    style={{ marginTop: 12, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={ctaTextStyle(theme.onPrimary, 12)}>Xem report</Text>
                  </TouchableOpacity>
                </Card>
              ) : null}
              <RestRiskBanner
                state={state}
                activeMatches={activeLiveMatches}
                suggestedMatches={suggestedLiveMatches}
                playersById={playersById}
                courtCount={queueCourtCount}
                onSetCourtCount={setCourtCount}
                onOpenSwapForPlayer={openSwapForPlayer}
              />
              <LiveMatchBoardComponent
                liveMatches={activeLiveMatches}
                suggestedMatches={suggestedLiveMatches}
                completedMatches={completedLiveMatches}
                roundSize={queueCourtCount}
                targetRounds={effectiveTargetRounds}
                roundPace={15}
                busy={busy}
                startingPreviewIds={startingPreviewIds}
                endingLiveMatchIds={endingLiveMatchIds}
                completingMatchIds={completingLiveMatchIds}
                creatingNextMatchIds={creatingNextMatchIds}
                isSuggestingPreview={isSuggestingPreview}
                state={state}
                pvnaTolerance={pvnaTolerance}
                playersById={playersById}
                onStartMatch={startLiveMatch}
                onFetchAvailablePool={fetchAvailablePoolPreview}
                onConfirmStartNow={confirmStartNow}
                onCancelAvailablePool={cancelAvailablePool}
                availablePoolPreviews={availablePoolPreviews}
                onCompleteMatch={completeLiveMatch}
                onCancelMatch={cancelLiveMatch}
                onPlayerPress={openSwapForPlayer}
                onOpenSettings={() => setSheet('settings')}
                onOpenSwap={(match) => { setSuggestedSwapMatch(match); setSwapFromPlayerId(null); setSheet('swap') }}
                courtShortageBreakdown={courtShortageBreakdown}
                onForcedWaitSelectionChange={setForcedWaitSelection}
              />
              {planningInProgress ? (
                <PlanningRoundCard syncingRoster={busy === 'sync' || isSuggestingPreview} />
              ) : null}
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

      {scrollDebugEnabled ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8 + insets.bottom,
            zIndex: 9999,
            borderRadius: RADIUS.sm,
            backgroundColor: 'rgba(0,0,0,0.72)',
            paddingHorizontal: 8,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, lineHeight: 13, color: '#fff' }}>
            vh {scrollDebugMetrics.viewportHeight ?? '-'} / vv {scrollDebugMetrics.visualViewportHeight ?? '-'} / in {scrollDebugMetrics.innerHeight ?? '-'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, lineHeight: 13, color: '#fff' }}>
            layout {scrollDebugMetrics.layoutHeight ?? '-'} / content {scrollDebugMetrics.contentHeight ?? '-'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, lineHeight: 13, color: '#fff' }}>
            y {scrollDebugMetrics.scrollY} / bottom {scrollDebugMetrics.distanceToBottom ?? '-'}
          </Text>
        </View>
      ) : null}

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

      <NextRoundSheet visible={sheet === 'swap'} snap="88" onClose={() => {
        setSuggestedSwapMatch(null)
        setSheet(null)
      }}>
        {suggestedSwapMatch ? (
          <SuggestedLiveMatchSwapSheet
            match={suggestedSwapMatch}
            state={state}
            playersById={playersById}
            swapFromPlayerId={swapFromPlayerId}
            setSwapFromPlayerId={setSwapFromPlayerId}
            onSwap={swapPlayersInSuggestedLiveMatch}
          />
        ) : (
          <SwapSheetView
            state={state}
            alternative={workingAlternative}
            playersById={playersById}
            swapFromPlayerId={swapFromPlayerId}
            setSwapFromPlayerId={setSwapFromPlayerId}
            onSwap={swapPlayersInWorkingAlternative}
          />
        )}
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
          onOpenReport={() => {
            setSheet(null)
            setShowSessionReport(true)
          }}
          onOpenHistory={() => setSheet('history')}
          onOpenFairness={() => setSheet('fairness')}
          canOpenReport={reportReady && !activeRound}
          busy={busy}
        />
      </NextRoundSheet>
    </View>
  )
}

function buildSuggestedSwapImpact(match: SuggestedLiveMatchRow, fromId: string, toId: string, state: SessionState) {
  const beforePvnaDiff = Math.abs(getTeamPvnaTotal(match.team_a, state) - getTeamPvnaTotal(match.team_b, state))
  const beforeRepeat = getProjectedRepeatSummary(match.team_a, match.team_b, state)
  const afterMatch = swapPlayersInSuggestedMatch(match, fromId, toId)
  const afterPvnaDiff = Math.abs(getTeamPvnaTotal(afterMatch.team_a, state) - getTeamPvnaTotal(afterMatch.team_b, state))
  const afterRepeat = getProjectedRepeatSummary(afterMatch.team_a, afterMatch.team_b, state)
  const beforeRepeatOver = beforeRepeat.pair_over_by + beforeRepeat.player_over_by
  const afterRepeatOver = afterRepeat.pair_over_by + afterRepeat.player_over_by
  const pvnaDelta = afterPvnaDiff - beforePvnaDiff
  const repeatDelta = afterRepeatOver - beforeRepeatOver
  const qualityDelta = -pvnaDelta - repeatDelta * 0.35
  const label = qualityDelta > 0.08
    ? 'Tốt hơn'
    : qualityDelta < -0.08
      ? 'Giảm chất lượng'
      : 'Ít đổi'

  return {
    label,
    qualityDelta,
    beforePvnaDiff,
    afterPvnaDiff,
    beforeRepeatOver,
    afterRepeatOver,
    beforePartnerMax: beforeRepeat.max_partner_pair_count,
    afterPartnerMax: afterRepeat.max_partner_pair_count,
    beforeOpponentMax: beforeRepeat.max_opponent_pair_count,
    afterOpponentMax: afterRepeat.max_opponent_pair_count,
  }
}

function describeSuggestedMatchRepeats(
  match: SuggestedLiveMatchRow,
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
) {
  const lines: string[] = []
  for (const team of [match.team_a, match.team_b]) {
    const count = (state.players.get(team[0])?.partner_counts.get(team[1]) ?? 0) + 1
    if (count >= 2) {
      lines.push(`${playerName(team[0], playersById)} và ${playerName(team[1], playersById)} làm đồng đội lần thứ ${count}`)
    }
  }

  for (const playerA of match.team_a) {
    for (const playerB of match.team_b) {
      const count = (state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0) + 1
      if (count >= 2) {
        lines.push(`${playerName(playerA, playersById)} gặp lại ${playerName(playerB, playersById)} lần thứ ${count}`)
      }
    }
  }

  if (lines.length === 0) return 'Không lặp lại đối thủ/đồng đội.'
  return lines.slice(0, 4).join('; ') + (lines.length > 4 ? `; +${lines.length - 4} lặp khác` : '.')
}

function SuggestedLiveMatchSwapSheet({
  match,
  state,
  playersById,
  swapFromPlayerId,
  setSwapFromPlayerId,
  onSwap,
}: {
  match: SuggestedLiveMatchRow
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  swapFromPlayerId: string | null
  setSwapFromPlayerId: (playerId: string) => void
  onSwap: (fromId: string, toId: string) => void
}) {
  const theme = useAppTheme()
  const playingIds = [...match.team_a, ...match.team_b]
  const targetIds = [...new Set([...playingIds, ...(match.resting ?? [])])]
  const candidates = swapFromPlayerId
    ? targetIds
        .filter(playerId => playerId !== swapFromPlayerId)
        .map(playerId => ({
          playerId,
          impact: buildSuggestedSwapImpact(match, swapFromPlayerId, playerId, state),
        }))
        .sort((left, right) => {
          const qualityDiff = right.impact.qualityDelta - left.impact.qualityDelta
          if (Math.abs(qualityDiff) > 0.001) return qualityDiff
          const repeatDiff = left.impact.afterRepeatOver - right.impact.afterRepeatOver
          if (repeatDiff !== 0) return repeatDiff
          const pvnaDiff = left.impact.afterPvnaDiff - right.impact.afterPvnaDiff
          if (Math.abs(pvnaDiff) > 0.001) return pvnaDiff
          const leftPlaying = playingIds.includes(left.playerId)
          const rightPlaying = playingIds.includes(right.playerId)
          if (leftPlaying !== rightPlaying) return leftPlaying ? 1 : -1
          return playerName(left.playerId, playersById).localeCompare(playerName(right.playerId, playersById))
        })
    : []

  return (
    <View testID="nrv2-swap-sheet">
      <SheetTitle title="Đổi người trận gợi ý" subtitle={`Sân ${(match.court_idx ?? 0) + 1}: đổi trực tiếp trong suggested live match đang chọn.`} />
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>1. Đổi ra</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {playingIds.map(playerId => {
          const active = swapFromPlayerId === playerId
          return (
            <TouchableOpacity
              key={playerId}
              testID={`nrv2-swap-from-${playerId}`}
              accessibilityState={{ selected: active }}
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
          <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>2. Đổi với</Text>
          <View style={{ gap: 8 }}>
            {candidates.map(({ playerId, impact }) => {
              const impactColor = impact.label === 'Tốt hơn'
                ? theme.primary
                : impact.label === 'Giảm chất lượng'
                  ? theme.dangerText
                  : theme.outline
              const pvnaText = `${impact.beforePvnaDiff.toFixed(2)} -> ${impact.afterPvnaDiff.toFixed(2)}`
              const repeatText = describeSuggestedMatchRepeats(
                swapPlayersInSuggestedMatch(match, swapFromPlayerId, playerId),
                state,
                playersById,
              )
              return (
                <TouchableOpacity
                  key={playerId}
                  testID={`nrv2-swap-to-${playerId}`}
                  onPress={() => onSwap(swapFromPlayerId, playerId)}
                  style={{
                    minHeight: 58,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.surface,
                    borderWidth: BORDER.hairline,
                    borderColor: theme.outlineVariant,
                    borderLeftWidth: 4,
                    borderLeftColor: impactColor,
                    padding: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <PlayerAvatar name={playerName(playerId, playersById)} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{playerName(playerId, playersById)}</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline, fontWeight: '900' }}>
                        PVNA {(state.players.get(playerId)?.pvna ?? 0).toFixed(2)}
                      </Text>
                    </View>
                    <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: impactColor, fontWeight: '900' }}>
                      {impact.label} · chênh PVNA {pvnaText}
                    </Text>
                    <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, lineHeight: 14, color: theme.outline }}>
                      {repeatText}
                    </Text>
                  </View>
                  <Text style={ctaTextStyle(impactColor, 12)}>
                    Đổi
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
