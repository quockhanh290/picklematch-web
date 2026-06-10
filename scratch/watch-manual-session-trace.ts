import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator/index.ts'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/watch-manual-session-trace.ts <session-id>')

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const pollMs = Math.max(500, Number(process.env.TRACE_POLL_MS ?? 1000))
const maxRunMs = Math.max(60_000, Number(process.env.TRACE_MAX_RUN_MS ?? 4 * 60 * 60 * 1000))
const outputDir = path.resolve('scratch', 'traces', sessionId)
const tracePath = path.join(outputDir, 'manual-trace.json')
const statusPath = path.join(outputDir, 'watcher-status.json')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

type TraceEntry = {
  captured_at: string
  reason: string
  live_state_version: number
  session: any
  settings: any
  session_players: any[]
  player_rows: any[]
  pair_rows: any[]
  round_rows: any[]
  live_match_rows: any[]
  edge_preview: any
  edge_timing_ms: number | null
  edge_error: string | null
}

const trace: {
  session_id: string
  started_at: string
  updated_at: string
  entries: TraceEntry[]
} = {
  session_id: sessionId,
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  entries: [],
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function persist(status: string, error?: unknown) {
  trace.updated_at = new Date().toISOString()
  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(tracePath, JSON.stringify(trace, null, 2), 'utf8'),
    writeFile(statusPath, JSON.stringify({
      session_id: sessionId,
      status,
      started_at: trace.started_at,
      updated_at: trace.updated_at,
      entries: trace.entries.length,
      last_live_state_version: trace.entries.at(-1)?.live_state_version ?? null,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    }, null, 2), 'utf8'),
  ])
}

async function loadSnapshot() {
  const [
    sessionResult,
    settingsResult,
    sessionPlayersResult,
    playersResult,
    pairsResult,
    roundsResult,
    liveResult,
  ] = await Promise.all([
    client.from('sessions').select('*').eq('id', sessionId).single(),
    client.from('session_next_round_settings').select('*').eq('session_id', sessionId).maybeSingle(),
    client
      .from('session_players')
      .select('player_id, status, check_in_status, created_at, metadata, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_pair_history')
      .select('session_id, player_a, player_b, partner_count, opponent_count')
      .eq('session_id', sessionId),
    client
      .from('session_rounds')
      .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
      .eq('session_id', sessionId)
      .order('round_no', { ascending: true }),
    client
      .from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: true }),
  ])
  const error =
    sessionResult.error ??
    settingsResult.error ??
    sessionPlayersResult.error ??
    playersResult.error ??
    pairsResult.error ??
    roundsResult.error ??
    liveResult.error
  if (error) throw error
  return {
    session: sessionResult.data,
    settings: settingsResult.data,
    sessionPlayers: sessionPlayersResult.data ?? [],
    playerRows: playersResult.data ?? [],
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    liveMatchRows: liveResult.data ?? [],
  }
}

async function fetchEdgePreview(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Missing access token')
  const presentCount = snapshot.playerRows.filter((row: any) => !row.checked_out_at).length
  const settings = snapshot.settings
  const calculatedCourts = calculateOptimalCourts({
    n_players: presentCount,
    session_duration_min: Number(snapshot.session?.duration_minutes ?? 120),
    match_duration_min: Number(settings?.court_duration_min ?? 15),
    preset: settings?.court_preset ?? 'balanced',
  }).recommended.courts
  const courts = Math.max(1, Number(settings?.court_count_override ?? calculatedCourts))
  const liveCount = snapshot.liveMatchRows.filter((row: any) => row.status === 'live').length
  const startedAt = performance.now()
  const response = await fetch(`${url}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      count: Math.max(0, courts - liveCount),
      court_count: courts,
      pvna_tolerance: Number(settings?.pvna_tolerance ?? 0.5),
      live_match_rows: snapshot.liveMatchRows,
      live_state_version: Number(snapshot.session?.live_state_version ?? 0),
      completing_live_match_ids: [],
      players: snapshot.playerRows.map((row: any) => ({
        id: row.player_id,
        name: row.players?.name ?? String(row.player_id).slice(0, 8),
      })),
      player_rows: snapshot.playerRows,
      pair_rows: snapshot.pairRows,
      round_rows: snapshot.roundRows,
    }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Edge suggest failed (${response.status})`)
  }
  return { payload, timingMs: Math.round(performance.now() - startedAt) }
}

function snapshotFingerprint(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
  return JSON.stringify({
    version: snapshot.session?.live_state_version,
    checkin: snapshot.sessionPlayers.map((row: any) => [row.player_id, row.check_in_status]),
    live: snapshot.liveMatchRows.map((row: any) => [row.id, row.status, row.score_a, row.score_b, row.updated_at]),
  })
}

async function capture(reason: string, snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
  let edgePreview: any = null
  let edgeTimingMs: number | null = null
  let edgeError: string | null = null
  try {
    const result = await fetchEdgePreview(snapshot)
    edgePreview = result.payload
    edgeTimingMs = result.timingMs
  } catch (error) {
    edgeError = error instanceof Error ? error.message : String(error)
  }
  trace.entries.push({
    captured_at: new Date().toISOString(),
    reason,
    live_state_version: Number(snapshot.session?.live_state_version ?? 0),
    session: snapshot.session,
    settings: snapshot.settings,
    session_players: snapshot.sessionPlayers,
    player_rows: snapshot.playerRows,
    pair_rows: snapshot.pairRows,
    round_rows: snapshot.roundRows,
    live_match_rows: snapshot.liveMatchRows,
    edge_preview: edgePreview,
    edge_timing_ms: edgeTimingMs,
    edge_error: edgeError,
  })
  await persist('running')
}

async function main() {
  const { error } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (error) throw error
  await persist('starting')

  const startedAt = Date.now()
  let previousFingerprint = ''
  let lastHeartbeatAt = 0
  while (Date.now() - startedAt < maxRunMs) {
    const snapshot = await loadSnapshot()
    const fingerprint = snapshotFingerprint(snapshot)
    if (fingerprint !== previousFingerprint) {
      await capture(previousFingerprint ? 'state_changed' : 'initial', snapshot)
      previousFingerprint = fingerprint
      lastHeartbeatAt = Date.now()
    } else if (Date.now() - lastHeartbeatAt >= 10_000) {
      await persist('running')
      lastHeartbeatAt = Date.now()
    }
    await sleep(pollMs)
  }
  await persist('completed')
}

main().catch(async error => {
  await persist('failed', error).catch(() => undefined)
  console.error(error)
  process.exit(1)
})
