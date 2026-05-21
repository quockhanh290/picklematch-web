import { useCallback, useEffect, useRef, useState } from 'react'

import type { SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'

import { getPlayerPvna, normalizeRoundRow, type RawRoundRow } from './helpers'
import type { LiveRows } from './types'

export function useLiveRows(sessionId: string, playersById: Map<string, ArrangementPlayer>) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [rows, setRows] = useState<LiveRows>({
    playerRows: [],
    pairRows: [],
    roundRows: [],
    liveStateVersion: null,
  })
  const [error, setError] = useState<string | null>(null)
  const lastLoadStateMsRef = useRef<number | null>(null)
  const optimisticPlayerPatchesRef = useRef(new Map<string, Partial<SessionPlayerStateRow>>())
  const optimisticPlayerRowsRef = useRef(new Map<string, SessionPlayerStateRow>())
  const settleTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const loadLiveState = useCallback(async () => {
    const startedAt = Date.now()
    setRefreshing(true)
    setError(null)
    try {
      const loadVersion = () =>
        supabase
          .from('sessions')
          .select('live_state_version')
          .eq('id', sessionId)
          .single()

      let sessionRes: Awaited<ReturnType<typeof loadVersion>> | null = null
      let playerRes: any = null
      let pairRes: any = null
      let roundRes: any = null
      let versionStable = false

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const beforeRes = await loadVersion()
        if (beforeRes.error) {
          sessionRes = beforeRes
          break
        }
        const [nextPlayerRes, nextPairRes, nextRoundRes, afterRes] = await Promise.all([
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
          loadVersion(),
        ])
        sessionRes = afterRes
        playerRes = nextPlayerRes
        pairRes = nextPairRes
        roundRes = nextRoundRes
        versionStable = !afterRes.error && beforeRes.data?.live_state_version === afterRes.data?.live_state_version
        if (afterRes.error || versionStable) break
      }

      const nextError = sessionRes?.error ?? playerRes?.error ?? pairRes?.error ?? roundRes?.error
      if (nextError) {
        setError(nextError.message)
        return
      }
      if (!versionStable) {
        setError('Live state changed while loading. Please refresh.')
        return
      }

      const serverPlayerRows = ((playerRes.data ?? []) as SessionPlayerStateRow[]).map(row => ({
          ...row,
          ...(optimisticPlayerPatchesRef.current.get(row.player_id) ?? {}),
          players: {
            pvna: getPlayerPvna(playersById.get(row.player_id)) ?? 0,
            elo: playersById.get(row.player_id)?.elo,
            gender: playersById.get(row.player_id)?.gender,
            partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref,
            opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref,
          },
          session_players: {
            metadata: playersById.get(row.player_id)?.metadata ?? null,
          },
        }))
      const serverPlayerIds = new Set(serverPlayerRows.map(row => row.player_id))
      const optimisticRows = [...optimisticPlayerRowsRef.current.values()]
        .filter(row => !serverPlayerIds.has(row.player_id))
      setRows({
        playerRows: [...serverPlayerRows, ...optimisticRows],
        pairRows: (pairRes.data ?? []) as SessionPairHistoryRow[],
        roundRows: ((roundRes.data ?? []) as RawRoundRow[]).map(normalizeRoundRow),
        liveStateVersion: typeof sessionRes.data?.live_state_version === 'number'
          ? sessionRes.data.live_state_version
          : Number(sessionRes.data?.live_state_version ?? 0),
      })
    } finally {
      lastLoadStateMsRef.current = Date.now() - startedAt
      setRefreshing(false)
    }
  }, [playersById, sessionId])

  const patchPlayerRow = useCallback((playerId: string, patch: Partial<SessionPlayerStateRow>) => {
    optimisticPlayerPatchesRef.current.set(playerId, patch)
    setRows(current => ({
      ...current,
      playerRows: current.playerRows.map(row => (
        row.player_id === playerId ? { ...row, ...patch } : row
      )),
    }))
  }, [])

  const addPlayerRow = useCallback((row: SessionPlayerStateRow) => {
    optimisticPlayerRowsRef.current.set(row.player_id, row)
    setRows(current => {
      const exists = current.playerRows.some(playerRow => playerRow.player_id === row.player_id)
      return {
        ...current,
        playerRows: exists
          ? current.playerRows.map(playerRow => playerRow.player_id === row.player_id ? { ...playerRow, ...row } : playerRow)
          : [...current.playerRows, row],
      }
    })
  }, [])

  const settlePlayerPatch = useCallback((playerId: string, patch: Partial<SessionPlayerStateRow>) => {
    const id = setTimeout(() => {
      if (optimisticPlayerPatchesRef.current.get(playerId) === patch) {
        optimisticPlayerPatchesRef.current.delete(playerId)
      }
    }, 2500)
    settleTimeoutsRef.current.push(id)
  }, [])

  const clearPlayerPatch = useCallback((playerId: string) => {
    optimisticPlayerPatchesRef.current.delete(playerId)
  }, [])

  const settlePlayerRow = useCallback((playerId: string, row: SessionPlayerStateRow) => {
    const id = setTimeout(() => {
      if (optimisticPlayerRowsRef.current.get(playerId) === row) {
        optimisticPlayerRowsRef.current.delete(playerId)
      }
    }, 2500)
    settleTimeoutsRef.current.push(id)
  }, [])

  const clearPlayerRow = useCallback((playerId: string) => {
    optimisticPlayerRowsRef.current.delete(playerId)
    setRows(current => ({
      ...current,
      playerRows: current.playerRows.filter(row => row.player_id !== playerId),
    }))
  }, [])

  useEffect(() => {
    let mounted = true
    async function run() {
      setLoading(true)
      await loadLiveState()
      if (mounted) setLoading(false)
    }
    void run()
    return () => {
      mounted = false
      settleTimeoutsRef.current.forEach(clearTimeout)
      settleTimeoutsRef.current = []
    }
  }, [loadLiveState])

  return { addPlayerRow, clearPlayerPatch, clearPlayerRow, error, lastLoadStateMsRef, loading, loadLiveState, patchPlayerRow, refreshing, rows, setError, settlePlayerPatch, settlePlayerRow }
}
