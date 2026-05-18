import { useCallback, useEffect, useRef, useState } from 'react'

import type { SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'

import { getPlayerPvna, normalizeRoundRow, type RawRoundRow } from './helpers'
import type { LiveRows } from './types'

export function useLiveRows(sessionId: string, playersById: Map<string, ArrangementPlayer>) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [rows, setRows] = useState<LiveRows>({ playerRows: [], pairRows: [], roundRows: [] })
  const [error, setError] = useState<string | null>(null)
  const optimisticPlayerPatchesRef = useRef(new Map<string, Partial<SessionPlayerStateRow>>())
  const optimisticPlayerRowsRef = useRef(new Map<string, SessionPlayerStateRow>())

  const loadLiveState = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
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
      })
    } finally {
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
    setTimeout(() => {
      if (optimisticPlayerPatchesRef.current.get(playerId) === patch) {
        optimisticPlayerPatchesRef.current.delete(playerId)
      }
    }, 2500)
  }, [])

  const clearPlayerPatch = useCallback((playerId: string) => {
    optimisticPlayerPatchesRef.current.delete(playerId)
  }, [])

  const settlePlayerRow = useCallback((playerId: string, row: SessionPlayerStateRow) => {
    setTimeout(() => {
      if (optimisticPlayerRowsRef.current.get(playerId) === row) {
        optimisticPlayerRowsRef.current.delete(playerId)
      }
    }, 2500)
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
    }
  }, [loadLiveState])

  return { addPlayerRow, clearPlayerPatch, clearPlayerRow, error, loading, loadLiveState, patchPlayerRow, refreshing, rows, setError, settlePlayerPatch, settlePlayerRow }
}
