import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch } from '../lib/next-round-suggester/live-preview'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '../lib/next-round-suggester/types'

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
if (!sessionId) throw new Error('Usage: tsx scratch/inspect-session-rest-state.ts <session-id>')

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
    live_state_version: number | string | null
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
    .map(row => ({ ...row, resting: row.resting ?? [], score_a: row.score_a ?? 0, score_b: row.score_b ?? 0 }))
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

  const courtCapacity = Math.max(1, Math.floor(state.config.courts || courtCount || 1))
  const countableMatches = liveMatchRows
    .filter(match => match.status !== 'cancelled')
    .sort((left, right) => left.sequence_no - right.sequence_no)
  const playerIdsByRound = new Map<number, Set<string>>()
  const roundCounts = new Map<number, number>()
  let projectedState = state
  const projectedRoundNos = new Set<number>()
  countableMatches.forEach((match, index) => {
    const roundNo = Math.floor(index / courtCapacity)
    roundCounts.set(roundNo, (roundCounts.get(roundNo) ?? 0) + 1)
    const players = playerIdsByRound.get(roundNo) ?? new Set<string>()
    match.team_a.forEach(id => players.add(id))
    match.team_b.forEach(id => players.add(id))
    playerIdsByRound.set(roundNo, players)
    if (match.status === 'live' || match.status === 'suggested') {
      projectedRoundNos.add(roundNo)
      projectedState = buildProjectedStateAfterLiveMatch(projectedState, match, roundNo)
    }
  })
  for (const roundNo of projectedRoundNos) {
    if ((roundCounts.get(roundNo) ?? 0) >= courtCapacity) {
      projectedState = buildProjectedStateAfterCompletedLiveRound(projectedState, playerIdsByRound.get(roundNo) ?? new Set())
    }
  }

  const busy = new Set(
    liveMatchRows
      .filter(match => match.status === 'live' || match.status === 'suggested')
      .flatMap(match => [...match.team_a, ...match.team_b]),
  )
  const summarize = (players: typeof state.players, minRest: number) => [...players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .filter(player => player.consecutive_rest >= minRest)
    .map(player => ({
      name: names.get(player.player_id),
      pvna: player.pvna,
      matchesPlayed: player.matches_played,
      consecutiveRest: player.consecutive_rest,
      consecutivePlay: player.consecutive_play,
      busy: busy.has(player.player_id),
    }))
    .sort((a, b) => b.consecutiveRest - a.consecutiveRest || a.matchesPlayed - b.matchesPlayed || String(a.name).localeCompare(String(b.name)))

  console.log(JSON.stringify({
    liveStateVersion: raw.live_state_version == null ? null : Number(raw.live_state_version),
    courtCount,
    countableMatches: countableMatches.length,
    liveRows: liveMatchRows.map(row => ({
      sequenceNo: row.sequence_no,
      roundNo: row.round_no,
      logicalRound: Math.floor(countableMatches.findIndex(match => match.id === row.id) / courtCapacity),
      court: Number(row.court_idx ?? 0) + 1,
      status: row.status,
      teamA: row.team_a.map(id => names.get(id)),
      teamB: row.team_b.map(id => names.get(id)),
    })),
    rawRestAtLeast2: summarize(state.players, 2),
    projectedRestAtLeast2: summarize(projectedState.players, 2),
    projectedRestAtLeast1: summarize(projectedState.players, 1),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
