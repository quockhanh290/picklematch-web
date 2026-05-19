import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SecondaryNavbar } from '@/components/design'
import { BORDER, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { buildGroupSummaries, buildGroupAliasMap } from '@/lib/next-round-suggester/fairness/group-audit'
import type { SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { invokeLiveSessionFunction } from './next-round-v2/api'
import { RosterSheet } from './next-round-v2/flow-sheets'
import { refreshBus } from './next-round-v2/refreshBus'
import { useLiveRows } from './next-round-v2/useLiveRows'

function toUserSafeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('Request timed out') || message.includes('Temporary network issue')) return 'Lỗi kết nối mạng. Vui lòng thử lại.'
  if (message.startsWith('Could not ')) return 'Không thể thực hiện: ' + message
  return message || 'Thao tác thất bại. Vui lòng thử lại.'
}

function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('Request timed out') || message.includes('Temporary network issue')
}

export function RosterScreen({ sessionId, players }: { sessionId: string; players: ArrangementPlayer[] }) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupSelection, setGroupSelection] = useState<string[]>([])
  const [activeRoundConfirm, setActiveRoundConfirm] = useState<{ playerId: string; checkedOut: boolean } | null>(null)
  const [swapTarget, setSwapTarget] = useState<string | null>(null)

  const checkoutBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCheckoutTargetsRef = useRef(new Map<string, boolean>())
  const pendingCheckoutPatchesRef = useRef(new Map<string, Partial<SessionPlayerStateRow>>())

  const playersById = useMemo(
    () => new Map(players.map(p => [String(p.id), p])),
    [players],
  )
  const { rows, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, loadLiveState, loading, refreshing } = useLiveRows(sessionId, playersById)

  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const groupSummaries = useMemo(() => buildGroupSummaries(rows.playerRows), [rows.playerRows])
  const groupAliases = useMemo(() => buildGroupAliasMap(groupSummaries), [groupSummaries])

  const activeRoundMatchIds = useMemo(() => {
    const activeRound = rows.roundRows.find(r => r.status === 'active')
    if (!activeRound?.matches?.length) return new Set<string>()
    return new Set(activeRound.matches.flatMap(m => [...(m.team_a ?? []), ...(m.team_b ?? [])].map(String)))
  }, [rows.roundRows])

  const swapCandidates = useMemo(() => {
    if (!swapTarget) return []
    const outRow = rows.playerRows.find(r => r.player_id === swapTarget)
    const outPvna = outRow?.players?.pvna ?? 3.0
    return rows.playerRows
      .filter(r => r.player_id !== swapTarget && r.checked_out_at === null && !activeRoundMatchIds.has(r.player_id))
      .sort((a, b) => Math.abs((a.players?.pvna ?? 3.0) - outPvna) - Math.abs((b.players?.pvna ?? 3.0) - outPvna))
  }, [swapTarget, rows.playerRows, activeRoundMatchIds])

  useEffect(() => () => {
    if (checkoutBatchTimerRef.current) clearTimeout(checkoutBatchTimerRef.current)
  }, [])

  const flushPendingCheckout = useCallback(async () => {
    const targets = new Map(pendingCheckoutTargetsRef.current)
    const patches = new Map(pendingCheckoutPatchesRef.current)
    pendingCheckoutTargetsRef.current.clear()
    pendingCheckoutPatchesRef.current.clear()
    checkoutBatchTimerRef.current = null

    const checkoutIds = [...targets.entries()].filter(([, out]) => out).map(([id]) => id)
    const checkinIds = [...targets.entries()].filter(([, out]) => !out).map(([id]) => id)

    try {
      if (checkoutIds.length > 0) await invokeLiveSessionFunction('session-checkout', sessionId, { player_ids: checkoutIds })
      if (checkinIds.length > 0) await invokeLiveSessionFunction('session-checkin', sessionId, { player_ids: checkinIds })
      targets.forEach((_, playerId) => {
        const patch = patches.get(playerId)
        if (patch) settlePlayerPatch(playerId, patch)
      })
    } catch (err) {
      targets.forEach((_, playerId) => clearPlayerPatch(playerId))
      if (!isTimeoutError(err)) {
        const msg = toUserSafeError(err)
        setError(msg)
        Alert.alert('Lỗi', msg)
      }
      await loadLiveState()
    }
  }, [sessionId, settlePlayerPatch, clearPlayerPatch, loadLiveState])

  const scheduleCheckoutFlush = useCallback(() => {
    if (checkoutBatchTimerRef.current) clearTimeout(checkoutBatchTimerRef.current)
    checkoutBatchTimerRef.current = setTimeout(() => { void flushPendingCheckout() }, 350)
  }, [flushPendingCheckout])

  const doCheckout = useCallback((playerId: string, checkedOut: boolean) => {
    const targetCheckedOut = !checkedOut
    const patch: Partial<SessionPlayerStateRow> = {
      checked_out_at: targetCheckedOut ? new Date().toISOString() : null,
      opted_rest: false,
    }
    patchPlayerRow(playerId, patch)
    setError(null)
    pendingCheckoutTargetsRef.current.set(playerId, targetCheckedOut)
    pendingCheckoutPatchesRef.current.set(playerId, patch)
    scheduleCheckoutFlush()
  }, [patchPlayerRow, scheduleCheckoutFlush])

  const toggleCheckout = useCallback((playerId: string, checkedOut: boolean) => {
    const targetCheckedOut = !checkedOut
    if (targetCheckedOut && activeRoundMatchIds.has(String(playerId))) {
      setActiveRoundConfirm({ playerId, checkedOut })
      return
    }
    doCheckout(playerId, checkedOut)
  }, [activeRoundMatchIds, doCheckout])

  const openSwap = useCallback((playerId: string) => {
    if (!activeRoundMatchIds.has(String(playerId))) return
    setActiveRoundConfirm(null)
    setSwapTarget(playerId)
  }, [activeRoundMatchIds])

  const doSwap = useCallback(async (inPlayerId: string) => {
    const outPlayerId = swapTarget
    if (!outPlayerId) return
    setSwapTarget(null)
    setBusy(`swap-${outPlayerId}`)
    setError(null)
    try {
      await invokeLiveSessionFunction('session-rounds-swap-player', sessionId, { out_player_id: outPlayerId, in_player_id: inPlayerId })
    } catch (err) {
      if (!isTimeoutError(err)) {
        setError(toUserSafeError(err))
      }
    } finally {
      await loadLiveState()
      setBusy(null)
    }
  }, [swapTarget, sessionId, loadLiveState])

  const toggleRest = useCallback(async (playerId: string, optedRest: boolean) => {
    const patch: Partial<SessionPlayerStateRow> = { opted_rest: !optedRest }
    patchPlayerRow(playerId, patch)
    setError(null)
    try {
      await invokeLiveSessionFunction('session-request-rest', sessionId, { player_id: playerId, opted_rest: !optedRest })
      settlePlayerPatch(playerId, patch)
    } catch (err) {
      clearPlayerPatch(playerId)
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    }
  }, [sessionId, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, loadLiveState])

  const setGroupForPlayers = useCallback(async (playerIds: string[]) => {
    if (playerIds.length < 2) return
    const tempGroupId = `temp-${Date.now()}`
    const patch: Partial<SessionPlayerStateRow> = { group_id: tempGroupId }
    playerIds.forEach(id => patchPlayerRow(id, patch))
    setBusy(`group-${playerIds.join('-')}`)
    try {
      await invokeLiveSessionFunction('session-set-group', sessionId, { player_ids: playerIds })
      playerIds.forEach(id => settlePlayerPatch(id, patch))
    } catch (err) {
      playerIds.forEach(id => clearPlayerPatch(id))
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    } finally {
      setBusy(null)
    }
  }, [sessionId, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, loadLiveState])

  const clearGroup = useCallback(async (playerId: string) => {
    const patch: Partial<SessionPlayerStateRow> = { group_id: null }
    patchPlayerRow(playerId, patch)
    try {
      await invokeLiveSessionFunction('session-set-group', sessionId, { clear_player_id: playerId })
      settlePlayerPatch(playerId, patch)
    } catch (err) {
      clearPlayerPatch(playerId)
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    }
  }, [sessionId, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, loadLiveState])

  const clearWholeGroup = useCallback(async (groupId: string) => {
    const groupPlayerIds = rowsRef.current.playerRows.filter(r => r.group_id === groupId).map(r => r.player_id)
    const patch: Partial<SessionPlayerStateRow> = { group_id: null }
    groupPlayerIds.forEach(id => patchPlayerRow(id, patch))
    setBusy(`group-clear-${groupId}`)
    try {
      await invokeLiveSessionFunction('session-set-group', sessionId, { clear_group_id: groupId })
      groupPlayerIds.forEach(id => settlePlayerPatch(id, patch))
    } catch (err) {
      groupPlayerIds.forEach(id => clearPlayerPatch(id))
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    } finally {
      setBusy(null)
    }
  }, [sessionId, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, loadLiveState])

  const createGroupFromSelection = useCallback(async () => {
    if (groupSelection.length < 2) return
    await setGroupForPlayers(groupSelection)
    setGroupSelection([])
  }, [groupSelection, setGroupForPlayers])

  const toggleGroupSelection = useCallback((playerId: string) => {
    setGroupSelection(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId])
  }, [])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="NGƯỜI CHƠI" onBackPress={() => {
        refreshBus.emit()
        router.replace({ pathname: '/host/session/[id]/next-round', params: { id: sessionId } } as any)
      }} />
      {error ? (
        <View style={{ marginHorizontal: 16, marginTop: 8, borderRadius: RADIUS.md, backgroundColor: theme.errorContainer, padding: 10 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onErrorContainer }}>{error}</Text>
        </View>
      ) : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
      >
        <RosterSheet
          rows={rows.playerRows}
          playersById={playersById}
          busy={busy}
          onToggleCheckout={toggleCheckout}
          onToggleRest={toggleRest}
          activeRoundIds={activeRoundMatchIds}
          onSwap={openSwap}
          onRefreshRoster={loadLiveState}
          groupSelection={groupSelection}
          groupSummaries={groupSummaries}
          groupAliases={groupAliases}
          onToggleGroupSelection={toggleGroupSelection}
          onCreateGroup={createGroupFromSelection}
          onClearGroup={clearGroup}
          onClearWholeGroup={clearWholeGroup}
          onClearGroupSelection={() => setGroupSelection([])}
        />
        <TouchableOpacity
          onPress={() => router.push(`/register/${sessionId}?drop_in=true` as any)}
          style={{
            marginTop: 16,
            height: 52,
            borderRadius: RADIUS.md,
            borderWidth: BORDER.hairline,
            borderColor: theme.outlineVariant,
            borderStyle: 'dashed',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.primary }}>+ Thêm người chơi mới</Text>
        </TouchableOpacity>
      </ScrollView>
      <Modal transparent visible={activeRoundConfirm !== null} animationType="fade" onRequestClose={() => setActiveRoundConfirm(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 }} onPress={() => setActiveRoundConfirm(null)}>
          <Pressable style={{ backgroundColor: theme.surface, borderRadius: RADIUS.lg, padding: 24, width: '100%' }} onPress={() => {}}>
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 16, color: theme.onSurface, marginBottom: 8 }}>Người đang trong vòng đấu</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant, marginBottom: 24 }}>
              Người này cần rời sớm. Bạn muốn đổi người thay thế hay để họ check-out?
            </Text>
            <View style={{ gap: 10 }}>
              <TouchableOpacity
                onPress={() => activeRoundConfirm && openSwap(activeRoundConfirm.playerId)}
                style={{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: theme.primary, borderRadius: RADIUS.md, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, color: theme.onPrimary }}>Đổi người thay thế</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => setActiveRoundConfirm(null)} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, color: theme.onSurfaceVariant }}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const confirm = activeRoundConfirm
                    setActiveRoundConfirm(null)
                    if (confirm) doCheckout(confirm.playerId, confirm.checkedOut)
                  }}
                  style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: theme.errorContainer, borderRadius: RADIUS.md }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, color: theme.onErrorContainer }}>Check-out thôi</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal transparent visible={swapTarget !== null} animationType="slide" onRequestClose={() => setSwapTarget(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setSwapTarget(null)}>
          <Pressable style={{ backgroundColor: theme.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, maxHeight: '70%' }} onPress={() => {}}>
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 16, color: theme.onSurface, marginBottom: 4 }}>Chọn người vào thay</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginBottom: 16 }}>
              Sắp xếp theo PVNA gần nhất với người rời trận.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {swapCandidates.length === 0 ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant, textAlign: 'center', paddingVertical: 24 }}>
                  Không có người nào đang nghỉ để thay thế.
                </Text>
              ) : swapCandidates.map(candidate => {
                const name = playersById.get(candidate.player_id)?.name ?? 'Người chơi'
                const pvna = candidate.players?.pvna ?? 3.0
                const outRow = rows.playerRows.find(r => r.player_id === swapTarget)
                const outPvna = outRow?.players?.pvna ?? 3.0
                const diff = Math.abs(pvna - outPvna)
                return (
                  <TouchableOpacity
                    key={candidate.player_id}
                    onPress={() => void doSwap(candidate.player_id)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant, gap: 12 }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, color: theme.onSurface }}>{name}</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline, marginTop: 2 }}>
                        PVNA {pvna.toFixed(2)} · chênh {diff.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.primary }}>Chọn</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
