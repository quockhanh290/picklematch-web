import React, { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
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
import { PRESETS, type CourtCalculatorOutput, type CourtOption, type CourtPreset, type CourtWarningAlternative } from '@/lib/court-calculator'
import type { SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import { auditManualSwap, buildSwappedAlternative } from '@/lib/next-round-suggester/manual-swap'
import { scoreMatch } from '@/lib/next-round-suggester/score'
import { buildSessionStateFingerprint } from '@/lib/next-round-suggester/state-version'
import type { FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  type FairnessAudit,
  type MatchCountConsistencyRow,
  type FairnessPreview,
} from '@/lib/next-round-suggester/fairness/audit'
import { buildGroupAuditRows, type GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
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
  SessionRoundRow,
  SessionState,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'
import { invokeLiveSessionFunction, loadLatestSyncablePlayerIds } from './next-round-v2/api'
import { Card, NextRoundSheet, PlayerAvatar, SheetTitle } from './next-round-v2/components'
import { COURT_DURATION_OPTIONS, COURT_PRESET_OPTIONS, PVNA_TOLERANCE_OPTIONS } from './next-round-v2/constants'
import { ChoiceRow, NavbarRightActions, StickyRoundCta } from './next-round-v2/controls'
import {
  HistorySheet as HistorySheetView,
  MoreSheet as MoreSheetView,
  RecapView as RecapViewModule,
  RosterSheet as RosterSheetView,
  SwapSheet as SwapSheetView,
} from './next-round-v2/flow-sheets'
import {
  ctaTextStyle,
  eyebrowStyle,
  formatNumber,
  getTeamPvna,
} from './next-round-v2/helpers'
import type { NextRoundSuggesterV2Props } from './next-round-v2/types'
import { useNextRoundModel } from './next-round-v2/useNextRoundModel'

function playerName(playerId: string, playersById: Map<string, ArrangementPlayer>) {
  return playersById.get(playerId)?.name ?? 'Người chơi'
}

function fairnessLabel(score: SessionFairnessScore) {
  if (score.grade === 'excellent') return 'Rất đều'
  if (score.grade === 'good') return 'Đều'
  if (score.grade === 'acceptable') return 'Tạm ổn'
  return 'Cần chỉnh'
}

function repeatRiskLabel(risk: string) {
  if (risk === 'low') return 'thấp'
  if (risk === 'medium') return 'vừa'
  if (risk === 'high') return 'cao'
  if (risk === 'extreme') return 'rất cao'
  return risk
}

function churnLevelLabel(level: string) {
  if (level === 'low') return 'thấp'
  if (level === 'medium') return 'vừa'
  if (level === 'high') return 'cao'
  return level
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
  const safeMessages = [
    'A round is already active',
    'A player can only be assigned once per round',
    'Could not read login session. Open in Safari/Chrome or sign in again.',
    'Invalid manual matches',
    'Manual match has invalid court index',
    'Manual matches cannot reuse the same court',
    'Manual matches exceed court count',
    'Manual matches must use checked-in players',
    'Request timed out. Check your connection and try again.',
    'Round commit audit failed. Please refresh before continuing.',
    'Session changed. Refresh and review the swapped round before starting.',
    'Temporary network issue. Please try again.',
  ]

  if (safeMessages.includes(message)) return message
  if (message.startsWith('Could not ')) return message
  return 'Action failed. Please try again.'
}

export function NextRoundSuggesterScreenV2({ sessionId, players, courts }: NextRoundSuggesterV2Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState<string | null>(null)
  const actionInFlightRef = useRef(false)
  const model = useNextRoundModel({ sessionId, players, courts })
  const {
    activeRound,
    applySuggestedRoundAction,
    checkedInPlayers,
    completedRoundCount,
    completedRounds,
    courtCalculator,
    courtCount,
    courtDurationMin,
    courtPreset,
    effectiveTargetRounds,
    error,
    expandedRosterPlayer,
    fairnessAudit,
    fairnessPreview,
    fairnessScore,
    fairnessWarnings,
    groupAliases,
    groupSelection,
    groupSummaries,
    hasManualSwapHardGuard,
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
    rows,
    selectAlternativeForRound,
    selectedAlternative,
    selectionUndo,
    sessionSummary,
    setCourtCount,
    setCourtDurationMin,
    setCourtPreset,
    setError,
    setExpandedRosterPlayer,
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
  } = model
  const runAction = async (key: string, action: () => Promise<void>) => {
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
  }

  const syncRoster = async () => {
    await runAction('sync', async () => {
      const playerIds = await loadLatestSyncablePlayerIds(
        sessionId,
        checkedInPlayers.map(player => String(player.id)),
      )
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

  const createGroupFromSelection = async () => {
    if (groupSelection.length < 2) return
    await setGroupForPlayers(groupSelection)
    setGroupSelection([])
  }

  const startRound = async (alternative: SuggestionAlternative) => {
    await runAction('start', async () => {
      if (activeRound) throw new Error('Đang có vòng active. Hãy kết thúc vòng hiện tại trước.')
      await invokeLiveSessionFunction('session-rounds-start', sessionId, {
        suggestion_idx: selectedAlternative,
        manual: manualAlternative ? alternative.matches : undefined,
        expected_state_fingerprint: manualAlternative ? buildSessionStateFingerprint(state) : undefined,
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
        console.error('[NextRoundSuggesterV2] commit audit mismatch', invalidDeltas)
        throw new Error('Round commit audit failed. Please refresh before continuing.')
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

  const navbarRightSlot = <NavbarRightActions sessionId={sessionId} onRefresh={loadLiveState} refreshing={refreshing} />

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="NEXT ROUND" rightSlot={navbarRightSlot} />
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
                selectedIndex={selectedAlternative}
                onSelect={selectAlternativeForRound}
                onOpenHistory={() => setSheet('history')}
                onOpenRoster={() => setSheet('roster')}
                targetReachedLabel={`${Math.min(completedRoundCount, effectiveTargetRounds)}/${effectiveTargetRounds} vòng`}
              />
              {workingAlternative ? (
                <>
                  <FairnessPreviewCard preview={fairnessPreview} onPress={() => setSheet('preview')} />
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
          primaryLabel={phase === 'active' ? 'Kết thúc & lưu vòng' : targetReached ? 'Chạy thêm vòng' : 'Bắt đầu vòng kế'}
          onPrimary={() => {
            if (phase === 'active') void endActiveRound()
            else if (workingAlternative) void startRound(workingAlternative)
          }}
          disabled={phase === 'plan' && (!workingAlternative || hasManualSwapHardGuard || suggestionIsUpdating)}
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
          calculator={courtCalculator}
          onApply={() => setSheet(null)}
        />
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

      <NextRoundSheet visible={sheet === 'roster'} snap="88" scroll={false} onClose={() => setSheet(null)}>
        <RosterSheetView
          rows={rows.playerRows}
          playersById={playersById}
          expandedPlayerId={expandedRosterPlayer}
          setExpandedPlayerId={setExpandedRosterPlayer}
          busy={busy}
          onToggleCheckout={toggleCheckout}
          onToggleRest={toggleRest}
          onSwap={openSwapForPlayer}
          onSyncRoster={syncRoster}
          groupSelection={groupSelection}
          groupSummaries={groupSummaries}
          groupAliases={groupAliases}
          onToggleGroupSelection={toggleGroupSelection}
          onCreateGroup={createGroupFromSelection}
          onClearGroup={clearGroup}
          onClearWholeGroup={clearWholeGroup}
          onClearGroupSelection={() => setGroupSelection([])}
        />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'history'} snap="88" onClose={() => setSheet(null)}>
        <HistorySheetView rounds={completedRounds} playersById={playersById} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'more'} snap="50" onClose={() => setSheet(null)}>
        <MoreSheetView
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
    return <SheetTitle title="Dự kiến điểm vòng kế" subtitle="Chưa có phương án vòng kế để audit." />
  }

  const tone = preview.delta_total >= 0 ? theme.successText : theme.warningText
  const summaryTone = preview.delta_total >= 0 ? theme.successText : theme.warningText
  const summaryBg = preview.delta_total >= 0 ? theme.successBg : theme.warningBg
  const pressureText = preview.pressure_after.repeat_risk === 'low'
    ? 'Ít nguy cơ lặp partner (đồng đội) hoặc đối thủ.'
    : preview.pressure_after.repeat_risk === 'medium'
      ? 'Có thể bắt đầu lặp một vài partner (đồng đội) hoặc đối thủ.'
      : 'Áp lực lặp partner (đồng đội) hoặc đối thủ đang cao.'
  const availabilityText = preview.availability_after.churn_level === 'low'
    ? 'Danh sách người chơi ổn định.'
    : preview.availability_after.churn_level === 'medium'
      ? 'Có thay đổi người chơi, điểm fairness đã tính nhẹ hơn.'
      : 'Người vào/ra nhiều, nên xem đây là kèo khó giữ đều tuyệt đối.'
  return (
    <View>
      <SheetTitle title="Nếu bắt đầu vòng này" subtitle="Ước tính fairness sau khi lưu phương án đang chọn." />
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
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: summaryTone }}>
          {preview.delta_total >= 0 ? 'Phương án này giữ fairness tốt' : 'Phương án này làm fairness giảm'}
        </Text>
        <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: summaryTone }}>
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
  return humanizeAuditDetail(row.detail)
}

function humanizeAuditDetail(detail: string) {
  return detail
    .replace(/\bexpected delta range\b/g, 'mức lệch hợp lý theo setup')
    .replace(/\bavg unique\b/g, 'trung bình số người khác')
    .replace(/\bopponent pressure\b/g, 'áp lực đối thủ')
    .replace(/\brepeat pairs\b/g, 'cặp bị lặp')
    .replace(/\bmax burden\b/g, 'người bị lặp nhiều nhất')
    .replace(/\badjusted by\b/g, 'đã điều chỉnh theo')
    .replace(/\bavg\b/g, 'trung bình')
    .replace(/\brange\b/g, 'chênh số trận')
    .replace(/\bavailability\b/g, 'biến động người chơi')
    .replace(/\bchurn\b/g, 'người vào/ra')
    .replace(/\bmultiplier\b/g, 'hệ số giảm phạt')
    .replace(/\bpressure\b/g, 'áp lực')
    .replace(/\bburden\b/g, 'người bị lặp nhiều')
    .replace(/\braw\b/g, 'điểm gốc')
    .replace(/\bsatisfied\b/g, 'sở thích được đáp ứng')
    .replace(/\bviolations\b/g, 'vi phạm')
    .replace(/\blow\b/g, 'thấp')
    .replace(/\bmedium\b/g, 'vừa')
    .replace(/\bhigh\b/g, 'cao')
    .replace(/\bextreme\b/g, 'rất cao')
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
            Engine đang chọn phương án có điểm ghép thấp nhất: cân PVNA, hạn chế lặp partner (đồng đội)/đối thủ, giữ nhịp nghỉ và tôn trọng group/sở thích khi có thể.
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
            {warning ? warningTitle(warning.type) : 'Có phương án thay thế'}
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
      {actions.length > 0 ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          {actions.map((item, index) => (
            <TouchableOpacity
              key={`${item.type}-${index}`}
              disabled={item.type === 'accept_tradeoff'}
              onPress={() => onApplyAction(item)}
              style={{
                borderRadius: RADIUS.md,
                backgroundColor: item.type === 'accept_tradeoff' ? theme.surfaceContainerLow : theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: tone.border,
                padding: 10,
                opacity: item.type === 'accept_tradeoff' ? 0.75 : 1,
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: tone.text }}>{item.label}</Text>
              <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, lineHeight: 15, color: theme.outline }}>
                {item.detail}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
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
  calculator,
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
  calculator: CourtCalculatorOutput
  onApply: () => void
}) {
  const theme = useAppTheme()
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
      <ChoiceRow label="Mục tiêu vòng" options={[6, 8, 10, recommended.total_rounds].filter((value, index, arr) => arr.indexOf(value) === index).map(value => ({ label: `${value}`, value }))} value={targetRounds} onChange={setTargetRounds} />
      <TouchableOpacity onPress={onApply} style={{ height: 52, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
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
                    {option.total_rounds} vòng · nghỉ {option.resting_per_round}/vòng · repeat {option.repeat_pressure.risk}
                  </Text>
                  {option.warnings[0] ? (
                    <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.warningText }}>
                      {option.warnings[0]}
                    </Text>
                  ) : null}
                </View>
                <View style={{ borderRadius: RADIUS.full, backgroundColor: recommended ? theme.heroCountdownText : theme.surfaceContainerLow, paddingHorizontal: 9, paddingVertical: 5 }}>
                  <Text style={ctaTextStyle(recommended ? theme.primaryContainer : toneColor, 10)}>
                    {recommended ? 'Đề xuất' : option.feasibility}
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
  const match = computeMatchCountMetrics(state)
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const gender = computeGenderPrefSatisfaction(state)
  const pressure = computeRepeatPressure(state)
  const burden = computeOpponentRepeatBurden(state)
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

function GroupAuditBlock({
  state,
  groupSummaries,
  playersById,
}: {
  state: SessionState
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const rows = buildGroupAuditRows(state, groupSummaries)
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>Group audit</Text>
      {rows.length === 0 ? (
        <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, padding: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Chưa có group nào được tạo.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map(row => (
            <View key={row.group_id} style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>
                {row.label}: {row.player_ids.map(id => playerName(id, playersById)).join(', ')}
              </Text>
              <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>
                Cùng xuất hiện trong {row.shared_matches} trận.
              </Text>
              <View style={{ marginTop: 8, gap: 4 }}>
                {row.pair_counts.map(pair => (
                  <Text key={`${pair.player_a}-${pair.player_b}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
                    {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} trận chung team
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
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
            <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>{humanizeAuditDetail(row.detail)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function RepeatDetailsBlock({
  partnerPairs,
  opponentPairs,
  playersById,
}: {
  partnerPairs: Array<{ player_a: string; player_b: string; count: number }>
  opponentPairs: Array<{ player_a: string; player_b: string; count: number }>
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const renderPairs = (pairs: Array<{ player_a: string; player_b: string; count: number }>) => {
    const repeated = pairs.filter(pair => pair.count > 1)
    if (repeated.length === 0) {
      return <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>Không có cặp lặp.</Text>
    }
    return repeated.map(pair => (
      <Text key={`${pair.player_a}-${pair.player_b}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
        {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} lần
      </Text>
    ))
  }

  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Text style={eyebrowStyle(theme.outline)}>Cặp lặp chi tiết</Text>
      <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, marginBottom: 6 }}>Partner lặp (đồng đội)</Text>
        <View style={{ gap: 3 }}>{renderPairs(partnerPairs)}</View>
      </View>
      <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, marginBottom: 6 }}>Đối thủ lặp</Text>
        <View style={{ gap: 3 }}>{renderPairs(opponentPairs)}</View>
      </View>
    </View>
  )
}

function OpponentBurdenSummary({
  burden,
  playersById,
}: {
  burden: ReturnType<typeof computeOpponentRepeatBurden>
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const rows = burden.per_player
    .filter(player => player.repeated_opponents > 0)
    .sort((a, b) => b.repeated_opponents - a.repeated_opponents)
  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>Người bị lặp đối thủ nhiều</Text>
      {rows.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Không có ai bị lặp đối thủ.</Text>
      ) : (
        <View style={{ gap: 4 }}>
          {rows.map(row => (
            <Text key={`burden-${row.player_id}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
              {playerName(row.player_id, playersById)}: {row.repeated_opponents} đối thủ lặp
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}
