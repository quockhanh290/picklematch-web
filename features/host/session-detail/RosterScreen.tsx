import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SecondaryNavbar } from '@/components/design'
import { BORDER, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { buildGroupSummaries, buildGroupAliasMap } from '@/lib/next-round-suggester/fairness/group-audit'
import type { SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { invokeLiveSessionFunction, syncLiveRosterFromSessionPlayers } from './next-round-v2/api'
import { RosterSheet } from './next-round-v2/flow-sheets'
import { useQueryClient } from '@tanstack/react-query'
import { liveSessionQueryKeys, useLiveSessionQuery } from './next-round-v2/queries'
import type { LiveRows } from './next-round-v2/types'


function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  if (typeof err === 'object' && err !== null && 'error' in err) {
    const message = (err as { error?: unknown }).error
    if (typeof message === 'string') return message
  }
  return String(err ?? '')
}

function toUserSafeError(err: unknown): string {
  const message = getErrorMessage(err)
  if (message.includes('Request timed out') || message.includes('Temporary network issue')) return 'Lỗi kết nối mạng. Vui lòng thử lại.'
  if (message.startsWith('Could not ')) return 'Không thể thực hiện: ' + message
  return message || 'Thao tác thất bại. Vui lòng thử lại.'
}

function isTimeoutError(err: unknown): boolean {
  const message = getErrorMessage(err)
  return message.includes('Request timed out') || message.includes('Temporary network issue')
}

export function RosterScreen({ sessionId, players }: { sessionId: string; players: ArrangementPlayer[] }) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupSelection, setGroupSelection] = useState<string[]>([])

  const checkoutBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveStateRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCheckoutTargetsRef = useRef(new Map<string, boolean>())
  const pendingCheckoutPatchesRef = useRef(new Map<string, Partial<SessionPlayerStateRow>>())
  const autoSyncAttemptedRef = useRef(false)

  const playersById = useMemo(
    () => new Map(players.map(p => [String(p.id), p])),
    [players],
  )
  const queryClient = useQueryClient()
  const { data: rowsData, isLoading: loading } = useLiveSessionQuery(sessionId, playersById)
  const rows: LiveRows = rowsData || { playerRows: [], pairRows: [], roundRows: [], liveMatchRows: [], liveStateVersion: null }
  const refreshing = loading
  const loadLiveState = useCallback(async () => { await queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) }) }, [queryClient, sessionId])
  const applyLiveStateVersion = useCallback((_version: unknown) => { queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) }) }, [queryClient, sessionId])
  const patchPlayerRow = useCallback((playerId: string, patch: Partial<SessionPlayerStateRow>) => {
    queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), (old: LiveRows | undefined) => {
      if (!old) return old
      return { ...old, playerRows: old.playerRows.map((row: SessionPlayerStateRow) => row.player_id === playerId ? { ...row, ...patch } : row) }
    })
  }, [queryClient, sessionId])
  const settlePlayerPatch = useCallback((_playerId?: string, _patch?: Partial<SessionPlayerStateRow>) => {}, [])
  const clearPlayerPatch = useCallback((_playerId?: string) => { queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) }) }, [queryClient, sessionId])

  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const groupSummaries = useMemo(() => buildGroupSummaries(rows.playerRows), [rows.playerRows])
  const groupAliases = useMemo(() => buildGroupAliasMap(groupSummaries), [groupSummaries])

  const activeLiveMatchIds = useMemo<Set<string>>(() => (
    new Set(
      rows.liveMatchRows
        .filter(match => match.status === 'live')
        .flatMap(match => [...(match.team_a ?? []), ...(match.team_b ?? [])].map(String)),
    )
  ), [rows.liveMatchRows])

  const activeRoundMatchIds = activeLiveMatchIds

  const applyMutationVersion = useCallback((payload: any) => {
    applyLiveStateVersion(payload?.live_state_version)
  }, [applyLiveStateVersion])

  const getRosterSyncFallbackIds = useCallback(() => (
    players
      .filter(player => {
        const status = player.checkInStatus
        return player.status === 'confirmed' && status !== 'no_show'
      })
      .map(player => String(player.id))
  ), [players])

  const scheduleLiveStateRefresh = useCallback((delayMs = 450) => {
    if (liveStateRefreshTimerRef.current) clearTimeout(liveStateRefreshTimerRef.current)
    liveStateRefreshTimerRef.current = setTimeout(() => {
      liveStateRefreshTimerRef.current = null
      void loadLiveState()
    }, delayMs)
  }, [loadLiveState])

  useEffect(() => () => {
    if (checkoutBatchTimerRef.current) clearTimeout(checkoutBatchTimerRef.current)
    if (liveStateRefreshTimerRef.current) clearTimeout(liveStateRefreshTimerRef.current)
  }, [])

  const syncRoster = useCallback(async () => {
    const fallbackIds = getRosterSyncFallbackIds()
    if (fallbackIds.length === 0) return

    setBusy('sync')
    setError(null)
    try {
      const result = await syncLiveRosterFromSessionPlayers(sessionId, fallbackIds)
      applyMutationVersion(result.payload)
      await loadLiveState()
    } catch (err) {
      const msg = toUserSafeError(err)
      setError(msg)
      if (__DEV__) console.warn('[RosterScreen] roster sync failed', err)
    } finally {
      setBusy(null)
    }
  }, [applyMutationVersion, getRosterSyncFallbackIds, loadLiveState, sessionId])

  useEffect(() => {
    if (loading || autoSyncAttemptedRef.current || rows.playerRows.length > 0) return
    if (getRosterSyncFallbackIds().length === 0) return

    autoSyncAttemptedRef.current = true
    void syncRoster()
  }, [getRosterSyncFallbackIds, loading, rows.playerRows.length, syncRoster])

  const flushPendingCheckout = useCallback(async () => {
    const targets = new Map(pendingCheckoutTargetsRef.current)
    const patches = new Map(pendingCheckoutPatchesRef.current)
    pendingCheckoutTargetsRef.current.clear()
    pendingCheckoutPatchesRef.current.clear()
    checkoutBatchTimerRef.current = null

    const checkoutIds = [...targets.entries()].filter(([, out]) => out).map(([id]) => id)
    const checkinIds = [...targets.entries()].filter(([, out]) => !out).map(([id]) => id)

    try {
      if (checkoutIds.length > 0) {
        const payload = await invokeLiveSessionFunction('session-checkout', sessionId, { player_ids: checkoutIds })
        applyMutationVersion(payload)
      }
      if (checkinIds.length > 0) {
        const payload = await invokeLiveSessionFunction('session-checkin', sessionId, { player_ids: checkinIds })
        applyMutationVersion(payload)
      }
      targets.forEach((_, playerId) => {
        const patch = patches.get(playerId)
        if (patch) settlePlayerPatch(playerId, patch)
      })
      scheduleLiveStateRefresh()
    } catch (err) {
      targets.forEach((_, playerId) => clearPlayerPatch(playerId))
      if (!isTimeoutError(err)) {
        const msg = toUserSafeError(err)
        setError(msg)
        Alert.alert('Lỗi', msg)
      }
      await loadLiveState()
    }
  }, [sessionId, applyMutationVersion, settlePlayerPatch, clearPlayerPatch, scheduleLiveStateRefresh, loadLiveState])

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
    if (targetCheckedOut && activeLiveMatchIds.has(String(playerId))) {
      const msg = 'Người này đang trong trận live. Hãy hủy hoặc kết thúc trận đó trước khi check-out.'
      setError(msg)
      Alert.alert('Không thể check-out', msg)
      return
    }
    doCheckout(playerId, checkedOut)
  }, [activeLiveMatchIds, doCheckout])

  const openSwap = useCallback((playerId: string) => {
    if (!activeRoundMatchIds.has(String(playerId))) return
    const msg = 'Người này đang trong trận live. Hãy hủy hoặc kết thúc trận đó trước; roster không còn dùng luồng đổi người legacy.'
    setError(msg)
    Alert.alert('Không thể đổi từ roster', msg)
  }, [activeRoundMatchIds])

  const toggleRest = useCallback(async (playerId: string, optedRest: boolean) => {
    if (activeRoundMatchIds.has(String(playerId))) {
      const msg = 'Người này đang trong live match. Hãy hoàn tất/hủy trận, hoặc dùng "Đổi người" trước khi cho xin nghỉ.'
      setError(msg)
      Alert.alert('Không thể xin nghỉ', msg)
      return
    }

    const patch: Partial<SessionPlayerStateRow> = { opted_rest: !optedRest }
    patchPlayerRow(playerId, patch)
    setError(null)
    try {
      const payload = await invokeLiveSessionFunction('session-request-rest', sessionId, { player_id: playerId, opted_rest: !optedRest })
      applyMutationVersion(payload)
      settlePlayerPatch(playerId, patch)
      scheduleLiveStateRefresh()
    } catch (err) {
      clearPlayerPatch(playerId)
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    }
  }, [activeRoundMatchIds, sessionId, applyMutationVersion, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, scheduleLiveStateRefresh, loadLiveState])

  const setGroupForPlayers = useCallback(async (playerIds: string[]) => {
    if (playerIds.length < 2) return
    const tempGroupId = `temp-${Date.now()}`
    const patch: Partial<SessionPlayerStateRow> = { group_id: tempGroupId }
    playerIds.forEach(id => patchPlayerRow(id, patch))
    setBusy(`group-${playerIds.join('-')}`)
    try {
      const payload = await invokeLiveSessionFunction('session-set-group', sessionId, { player_ids: playerIds })
      applyMutationVersion(payload)
      playerIds.forEach(id => settlePlayerPatch(id, patch))
      scheduleLiveStateRefresh()
    } catch (err) {
      playerIds.forEach(id => clearPlayerPatch(id))
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    } finally {
      setBusy(null)
    }
  }, [sessionId, applyMutationVersion, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, scheduleLiveStateRefresh, loadLiveState])

  const clearGroup = useCallback(async (playerId: string) => {
    const patch: Partial<SessionPlayerStateRow> = { group_id: null }
    patchPlayerRow(playerId, patch)
    try {
      const payload = await invokeLiveSessionFunction('session-set-group', sessionId, { clear_player_id: playerId })
      applyMutationVersion(payload)
      settlePlayerPatch(playerId, patch)
      scheduleLiveStateRefresh()
    } catch (err) {
      clearPlayerPatch(playerId)
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    }
  }, [sessionId, applyMutationVersion, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, scheduleLiveStateRefresh, loadLiveState])

  const clearWholeGroup = useCallback(async (groupId: string) => {
    const groupPlayerIds = rowsRef.current.playerRows
      .filter((row: SessionPlayerStateRow) => row.group_id === groupId)
      .map((row: SessionPlayerStateRow) => row.player_id)
    const patch: Partial<SessionPlayerStateRow> = { group_id: null }
    groupPlayerIds.forEach((id: string) => patchPlayerRow(id, patch))
    setBusy(`group-clear-${groupId}`)
    try {
      const payload = await invokeLiveSessionFunction('session-set-group', sessionId, { clear_group_id: groupId })
      applyMutationVersion(payload)
      groupPlayerIds.forEach((id: string) => settlePlayerPatch(id, patch))
      scheduleLiveStateRefresh()
    } catch (err) {
      groupPlayerIds.forEach((id: string) => clearPlayerPatch(id))
      if (!isTimeoutError(err)) setError(toUserSafeError(err))
      await loadLiveState()
    } finally {
      setBusy(null)
    }
  }, [sessionId, applyMutationVersion, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, scheduleLiveStateRefresh, loadLiveState])

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
        queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
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
          onRefreshRoster={syncRoster}
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
    </View>
  )
}
