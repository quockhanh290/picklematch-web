import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { getPlayerPvna, normalizeRoundRow, type RawRoundRow } from './helpers'
import type { LiveRows, RegisteredSessionPlayerRow } from './types'
import { markNextRoundStage } from './telemetry'

export const liveSessionQueryKeys = {
  all: ['liveSession'] as const,
  detail: (sessionId: string) => [...liveSessionQueryKeys.all, sessionId] as const,
}

const POLL_INTERVAL_MS = process.env.EXPO_PUBLIC_USE_COURT_LANE_BOARD === '1' ? false : 3000

export function keepNewestLiveRows(previous: LiveRows | undefined, incoming: LiveRows): LiveRows {
  const previousVersion = Number(previous?.liveStateVersion ?? -1)
  const incomingVersion = Number(incoming.liveStateVersion ?? -1)
  return previous && previousVersion > incomingVersion ? previous : incoming
}

export function useLiveSessionQuery(sessionId: string, playersById: Map<string, ArrangementPlayer>) {
  return useQuery<LiveRows, Error>({
    queryKey: liveSessionQueryKeys.detail(sessionId),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 600,
    queryFn: async () => {
      const requestStartedAt = Date.now()
      markNextRoundStage(sessionId, 'rows_request_start')
      const snapshotRes = await supabase.rpc('get_live_session_snapshot_versioned', {
        p_session_id: sessionId,
      })
      
      if (snapshotRes.error) {
        throw new Error(snapshotRes.error.message)
      }

      const raw = snapshotRes.data as {
        live_state_version: unknown
        player_rows?: SessionPlayerStateRow[]
        registered_player_rows?: RegisteredSessionPlayerRow[]
        pair_rows?: SessionPairHistoryRow[]
        round_rows?: RawRoundRow[]
        live_match_rows?: SessionLiveMatchRow[]
      }

      const liveStateVersion = typeof raw.live_state_version === 'number'
        ? raw.live_state_version
        : Number(raw.live_state_version ?? 0)

      const serverPlayerRows = ((raw.player_rows ?? []) as SessionPlayerStateRow[]).map(row => ({
        ...row,
        players: {
          pvna: getPlayerPvna(playersById.get(row.player_id)) ?? row.players?.pvna ?? 0,
          elo: playersById.get(row.player_id)?.elo ?? row.players?.elo ?? row.players?.current_elo,
          gender: playersById.get(row.player_id)?.gender ?? row.players?.gender,
          partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref ?? row.players?.partner_gender_pref,
          opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref ?? row.players?.opponent_gender_pref,
        },
        session_players: {
          metadata: playersById.get(row.player_id)?.metadata ?? row.session_players?.metadata ?? null,
        },
      }))

      const liveRows = {
        playerRows: serverPlayerRows,
        registeredPlayerRows: (raw.registered_player_rows ?? []) as RegisteredSessionPlayerRow[],
        pairRows: (raw.pair_rows ?? []) as SessionPairHistoryRow[],
        roundRows: ((raw.round_rows ?? []) as RawRoundRow[]).map(normalizeRoundRow),
        liveMatchRows: ((raw.live_match_rows ?? []) as SessionLiveMatchRow[]).map(row => ({
          ...row,
          team_a: row.team_a,
          team_b: row.team_b,
          resting: row.resting ?? [],
          score_a: row.score_a ?? 0,
          score_b: row.score_b ?? 0,
        })),
        liveStateVersion,
      }
      markNextRoundStage(sessionId, 'rows_loaded', {
        rpc_ms: Date.now() - requestStartedAt,
        player_rows: liveRows.playerRows.length,
        registered_player_rows: liveRows.registeredPlayerRows.length,
        pair_rows: liveRows.pairRows.length,
        round_rows: liveRows.roundRows.length,
        live_match_rows: liveRows.liveMatchRows.length,
        live_state_version: liveRows.liveStateVersion,
      })
      return liveRows
    },
    enabled: !!sessionId,
    structuralSharing: (previous, incoming) => keepNewestLiveRows(
      previous as LiveRows | undefined,
      incoming as LiveRows,
    ),
  })
}
