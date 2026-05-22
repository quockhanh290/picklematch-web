import { useCallback, useEffect, useRef, useState } from 'react'

import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'

import { getPlayerPvna, normalizeRoundRow, type RawRoundRow } from './helpers'
import type { LiveRows } from './types'

type LoadLiveStateOptions = {
  silent?: boolean
}

export function useLiveRows(sessionId: string, playersById: Map<string, ArrangementPlayer>) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [rows, setRows] = useState<LiveRows>({
    playerRows: [],
    pairRows: [],
    roundRows: [],
    liveMatchRows: [],
    liveStateVersion: null,
  })
  const [error, setError] = useState<string | null>(null)
  const lastLoadStateMsRef = useRef<number | null>(null)
  const optimisticPlayerPatchesRef = useRef(new Map<string, Partial<SessionPlayerStateRow>>())
  const optimisticPlayerRowsRef = useRef(new Map<string, SessionPlayerStateRow>())
  const settleTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const loadLiveState = useCallback(async (options: LoadLiveStateOptions = {}): Promise<LiveRows | null> => {
    const silent = options.silent === true
    const startedAt = Date.now()
    setRefreshing(true)
    if (!silent) setError(null)
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
      let liveMatchRes: any = null
      let versionStable = false

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const beforeRes = await loadVersion()
        if (beforeRes.error) {
          sessionRes = beforeRes
          break
        }
        const [nextPlayerRes, nextPairRes, nextRoundRes, nextLiveMatchRes, afterRes] = await Promise.all([
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
          supabase
            .from('session_live_matches')
            .select('*')
            .eq('session_id', sessionId)
            .order('sequence_no', { ascending: true }),
          loadVersion(),
        ])
        sessionRes = afterRes
        playerRes = nextPlayerRes
        pairRes = nextPairRes
        roundRes = nextRoundRes
        liveMatchRes = nextLiveMatchRes
        versionStable = !afterRes.error && beforeRes.data?.live_state_version === afterRes.data?.live_state_version
        if (afterRes.error || versionStable) break
      }

      const nextError = sessionRes?.error ?? playerRes?.error ?? pairRes?.error ?? roundRes?.error ?? liveMatchRes?.error
      if (nextError) {
        if (silent) {
          if (__DEV__) console.warn('[useLiveRows] silent live state reload failed', nextError)
        } else {
          setError(nextError.message)
        }
        return null
      }
      if (!versionStable) {
        if (silent) {
          if (__DEV__) console.warn('[useLiveRows] silent live state reload saw unstable version')
        } else {
          setError('Live state changed while loading. Please refresh.')
        }
        return null
      }
      if (!sessionRes?.data) {
        if (silent) {
          if (__DEV__) console.warn('[useLiveRows] silent live state reload missing version row')
        } else {
          setError('Could not load live state version.')
        }
        return null
      }

      const liveStateVersion = typeof sessionRes.data.live_state_version === 'number'
        ? sessionRes.data.live_state_version
        : Number(sessionRes.data.live_state_version ?? 0)

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
      const nextRows = {
        playerRows: [...serverPlayerRows, ...optimisticRows],
        pairRows: (pairRes.data ?? []) as SessionPairHistoryRow[],
        roundRows: ((roundRes.data ?? []) as RawRoundRow[]).map(normalizeRoundRow),
        liveMatchRows: ((liveMatchRes.data ?? []) as SessionLiveMatchRow[]).map(row => ({
          ...row,
          team_a: row.team_a,
          team_b: row.team_b,
          resting: row.resting ?? [],
          score_a: row.score_a ?? 0,
          score_b: row.score_b ?? 0,
        })),
        liveStateVersion,
      }
      setRows(nextRows)
      return nextRows
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

  const applyLiveStateVersion = useCallback((version: unknown) => {
    const numericVersion = typeof version === 'number' ? version : Number(version)
    if (!Number.isFinite(numericVersion)) return
    setRows(current => ({
      ...current,
      liveStateVersion: current.liveStateVersion === null
        ? numericVersion
        : Math.max(current.liveStateVersion, numericVersion),
    }))
  }, [sessionId])

  const applyStartedRound = useCallback((round: RawRoundRow | null | undefined, version: unknown) => {
    if (!round) {
      applyLiveStateVersion(version)
      return
    }
    const nextRound = normalizeRoundRow(round)
    const numericVersion = typeof version === 'number' ? version : Number(version)
    setRows(current => {
      const roundRows = current.roundRows.some(row => row.round_no === nextRound.round_no)
        ? current.roundRows.map(row => row.round_no === nextRound.round_no ? nextRound : row)
        : [...current.roundRows, nextRound]
      return {
        ...current,
        roundRows: roundRows.sort((left, right) => left.round_no - right.round_no),
        liveStateVersion: Number.isFinite(numericVersion)
          ? current.liveStateVersion === null
            ? numericVersion
            : Math.max(current.liveStateVersion, numericVersion)
          : current.liveStateVersion,
      }
    })
  }, [applyLiveStateVersion])

  const applyEndedRound = useCallback((
    roundNo: number,
    round: RawRoundRow | null | undefined,
    playerStateRows: Partial<SessionPlayerStateRow>[],
    pairHistoryRows: Array<Pick<SessionPairHistoryRow, 'player_a' | 'player_b' | 'partner_count' | 'opponent_count'>>,
    version: unknown,
  ) => {
    const nextRound = round ? normalizeRoundRow(round) : null
    const playerPatchById = new Map(
      playerStateRows
        .filter(row => typeof row.player_id === 'string')
        .map(row => [String(row.player_id), row]),
    )
    const pairRowsByKey = new Map<string, Partial<SessionPairHistoryRow>>(
      pairHistoryRows.map(row => [`${row.player_a}:${row.player_b}`, row]),
    )
    const numericVersion = typeof version === 'number' ? version : Number(version)

    setRows(current => {
      const existingPairRows = new Map(current.pairRows.map(row => [`${row.player_a}:${row.player_b}`, row]))
      for (const [key, row] of pairRowsByKey) {
        const existing = existingPairRows.get(key)
        existingPairRows.set(key, {
          ...(existing ?? {
            session_id: sessionId,
            player_a: row.player_a ?? '',
            player_b: row.player_b ?? '',
            partner_count: 0,
            opponent_count: 0,
          }),
          ...row,
        })
      }

      return {
        ...current,
        playerRows: current.playerRows.map(row => ({
          ...row,
          ...(playerPatchById.get(row.player_id) ?? {}),
        })),
        pairRows: [...existingPairRows.values()].sort((left, right) =>
          `${left.player_a}:${left.player_b}`.localeCompare(`${right.player_a}:${right.player_b}`),
        ),
        roundRows: current.roundRows.map(row => {
          if (row.round_no !== roundNo) return row
          return nextRound ?? {
            ...row,
            status: 'completed',
            ended_at: new Date().toISOString(),
          }
        }),
        liveMatchRows: current.liveMatchRows,
        liveStateVersion: Number.isFinite(numericVersion)
          ? current.liveStateVersion === null
            ? numericVersion
            : Math.max(current.liveStateVersion, numericVersion)
          : current.liveStateVersion,
      }
    })
  }, [])

  const applyLiveMatches = useCallback((matches: SessionLiveMatchRow[], version: unknown) => {
    const numericVersion = typeof version === 'number' ? version : Number(version)
    setRows(current => {
      const byId = new Map(current.liveMatchRows.map(row => [row.id, row]))
      for (const match of matches) {
        byId.set(match.id, {
          ...match,
          resting: match.resting ?? [],
          score_a: match.score_a ?? 0,
          score_b: match.score_b ?? 0,
        })
      }
      return {
        ...current,
        liveMatchRows: [...byId.values()].sort((left, right) => left.sequence_no - right.sequence_no),
        liveStateVersion: Number.isFinite(numericVersion)
          ? current.liveStateVersion === null
            ? numericVersion
            : Math.max(current.liveStateVersion, numericVersion)
          : current.liveStateVersion,
      }
    })
  }, [])

  const applyCompletedLiveMatch = useCallback((
    match: SessionLiveMatchRow,
    playerStateRows: Partial<SessionPlayerStateRow>[],
    pairHistoryRows: Array<Pick<SessionPairHistoryRow, 'player_a' | 'player_b' | 'partner_count' | 'opponent_count'>>,
    version: unknown,
  ) => {
    const playerPatchById = new Map(
      playerStateRows
        .filter(row => typeof row.player_id === 'string')
        .map(row => [String(row.player_id), row]),
    )
    const pairRowsByKey = new Map<string, Partial<SessionPairHistoryRow>>(
      pairHistoryRows.map(row => [`${row.player_a}:${row.player_b}`, row]),
    )
    const numericVersion = typeof version === 'number' ? version : Number(version)

    setRows(current => {
      const existingPairRows = new Map(current.pairRows.map(row => [`${row.player_a}:${row.player_b}`, row]))
      for (const [key, row] of pairRowsByKey) {
        const existing = existingPairRows.get(key)
        existingPairRows.set(key, {
          ...(existing ?? {
            session_id: sessionId,
            player_a: row.player_a ?? '',
            player_b: row.player_b ?? '',
            partner_count: 0,
            opponent_count: 0,
          }),
          ...row,
        })
      }

      const liveMatchRows = current.liveMatchRows.some(row => row.id === match.id)
        ? current.liveMatchRows.map(row => row.id === match.id ? match : row)
        : [...current.liveMatchRows, match]

      return {
        ...current,
        playerRows: current.playerRows.map(row => ({
          ...row,
          ...(playerPatchById.get(row.player_id) ?? {}),
        })),
        pairRows: [...existingPairRows.values()].sort((left, right) =>
          `${left.player_a}:${left.player_b}`.localeCompare(`${right.player_a}:${right.player_b}`),
        ),
        liveMatchRows: liveMatchRows.sort((left, right) => left.sequence_no - right.sequence_no),
        liveStateVersion: Number.isFinite(numericVersion)
          ? current.liveStateVersion === null
            ? numericVersion
            : Math.max(current.liveStateVersion, numericVersion)
          : current.liveStateVersion,
      }
    })
  }, [sessionId])

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

  return { addPlayerRow, applyCompletedLiveMatch, applyEndedRound, applyLiveMatches, applyLiveStateVersion, applyStartedRound, clearPlayerPatch, clearPlayerRow, error, lastLoadStateMsRef, loading, loadLiveState, patchPlayerRow, refreshing, rows, setError, settlePlayerPatch, settlePlayerRow }
}
