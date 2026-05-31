import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { getPlayerPvna, normalizeRoundRow, type RawRoundRow } from './helpers'
import type { LiveRows } from './types'

export const liveSessionQueryKeys = {
  all: ['liveSession'] as const,
  detail: (sessionId: string) => [...liveSessionQueryKeys.all, sessionId] as const,
}

const POLL_INTERVAL_MS = 3000

export function useLiveSessionQuery(sessionId: string, playersById: Map<string, ArrangementPlayer>) {
  return useQuery<LiveRows, Error>({
    queryKey: liveSessionQueryKeys.detail(sessionId),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const snapshotRes = await supabase.rpc('get_live_session_snapshot_versioned', {
        p_session_id: sessionId,
      })
      
      if (snapshotRes.error) {
        throw new Error(snapshotRes.error.message)
      }

      const raw = snapshotRes.data as {
        live_state_version: unknown
        player_rows?: SessionPlayerStateRow[]
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

      return {
        playerRows: serverPlayerRows,
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
    },
    enabled: !!sessionId && playersById.size > 0, // only fetch if we have player data
  })
}
