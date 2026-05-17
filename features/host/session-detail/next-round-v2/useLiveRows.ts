import { useCallback, useEffect, useState } from 'react'

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

      setRows({
        playerRows: ((playerRes.data ?? []) as any[]).map(row => ({
          ...row,
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
        })),
        pairRows: (pairRes.data ?? []) as SessionPairHistoryRow[],
        roundRows: ((roundRes.data ?? []) as any[]).map(normalizeRoundRow),
      })
    } finally {
      setRefreshing(false)
    }
  }, [playersById, sessionId])

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

  return { error, loading, loadLiveState, refreshing, rows, setError }
}
