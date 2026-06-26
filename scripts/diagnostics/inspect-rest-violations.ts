import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { computeRestFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/inspect-rest-violations.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (authError) throw authError

  const snapshotRes = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
  if (snapshotRes.error) throw snapshotRes.error
  const raw = snapshotRes.data as {
    player_rows?: SessionPlayerStateRow[]
    pair_rows?: SessionPairHistoryRow[]
    round_rows?: any[]
    live_match_rows?: SessionLiveMatchRow[]
  }

  const playersRes = await client
    .from('session_players')
    .select('player_id, players(name, pvna, current_elo, elo)')
    .eq('session_id', sessionId)
  if (playersRes.error) throw playersRes.error

  const names = new Map<string, string>()
  const pvnas = new Map<string, number>()
  for (const row of playersRes.data ?? []) {
    const player = (row as any).players
    names.set(String(row.player_id), String(player?.name ?? row.player_id))
    pvnas.set(String(row.player_id), Number(player?.pvna ?? player?.current_elo ?? player?.elo ?? 3))
  }

  const liveMatchRows = ((raw.live_match_rows ?? []) as SessionLiveMatchRow[])
  const courtCount = Math.max(1, ...liveMatchRows.map(row => Number(row.court_idx ?? 0) + 1), 6)
  const state = mapRowsToSessionState({
    sessionId,
    playerRows: ((raw.player_rows ?? []) as SessionPlayerStateRow[]).map(row => ({
      ...row,
      players: { ...row.players, pvna: pvnas.get(row.player_id) ?? row.players?.pvna ?? 3 },
    })),
    pairRows: (raw.pair_rows ?? []) as SessionPairHistoryRow[],
    roundRows: raw.round_rows ?? [],
    courts: courtCount,
    pvnaTolerance: 0.5,
  })

  const rest = computeRestFairness(state)
  const violations = rest.violations.map(violation => {
    const rounds = state.rounds
      .filter(round => round.status === 'completed')
      .filter(round => round.resting.includes(violation.player_id))
      .map(round => round.round_no + 1)
    return {
      name: names.get(violation.player_id),
      maxRest: violation.max_rest,
      restingRounds: rounds,
      currentConsecutiveRest: state.players.get(violation.player_id)?.consecutive_rest ?? null,
      matchesPlayed: state.players.get(violation.player_id)?.matches_played ?? null,
    }
  })

  console.log(JSON.stringify({ violations }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
