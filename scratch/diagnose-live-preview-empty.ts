import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { buildSuggestedMatchPayloads } from '../lib/next-round-suggester/live-preview'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const SESSION_ID = process.argv[2] ?? 'a38311de-cba5-446e-8296-0a3c2f83c6e8'
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
  if (signInError) throw signInError
  const { data, error } = await client.rpc('get_live_session_snapshot_versioned', {
    p_session_id: SESSION_ID,
  })
  if (error) throw error
  const raw = data as any
  const playerRows = raw.player_rows ?? []
  const pairRows = raw.pair_rows ?? []
  const roundRows = raw.round_rows ?? []
  const liveMatchRows = raw.live_match_rows ?? []
  const state = mapRowsToSessionState({
    sessionId: SESSION_ID,
    playerRows,
    pairRows,
    roundRows,
    courts: 6,
    pvnaTolerance: 0.5,
  })
  const liveRows = liveMatchRows.filter((match: any) => match.status === 'live')
  const busyIds = new Set(liveRows.flatMap((match: any) => [...match.team_a, ...match.team_b].map(String)))
  const activePlayers = [...state.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest)
  const freePlayers = activePlayers.filter(player => !busyIds.has(player.player_id))
  const fairnessAdjustment = correctForFairness(state)
  const payloads = buildSuggestedMatchPayloads({
    count: 1,
    sessionId: SESSION_ID,
    courtCount: 6,
    state,
    rows: { liveMatchRows, liveStateVersion: raw.live_state_version },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment,
    fairnessWarnings: [],
    playersById: new Map(playerRows.map((row: any) => [String(row.player_id), { name: row.players?.full_name ?? row.player_id }])),
    pvnaTolerance: 0.5,
  })

  console.log(JSON.stringify({
    liveStateVersion: raw.live_state_version,
    counts: {
      playerRows: playerRows.length,
      activePlayers: activePlayers.length,
      liveRows: liveRows.length,
      completedRows: liveMatchRows.filter((match: any) => match.status === 'completed').length,
      busyIds: busyIds.size,
      freePlayers: freePlayers.length,
      payloads: payloads.length,
    },
    freePlayers: freePlayers.map(player => ({
      id: player.player_id,
      pvna: player.pvna,
      matches: player.matches_played,
      rest: player.consecutive_rest,
      last: player.last_played_round,
      group: player.group_id,
    })),
    payloads,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
