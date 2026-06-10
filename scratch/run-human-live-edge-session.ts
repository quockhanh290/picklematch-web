import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow } from '../lib/next-round-suggester/types'

type SupabaseAny = any

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const HOST_ACCESS_TOKEN = process.env.HOST_ACCESS_TOKEN

if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const sessionId = argValue('--session-id', '')
if (!sessionId) throw new Error('Usage: tsx scratch/run-human-live-edge-session.ts --session-id=<id>')

const targetRounds = Math.max(1, Number(argValue('--target-rounds', '8')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const delayMs = Math.max(0, Number(argValue('--delay-ms', '900')))
const courtsOverride = Number(argValue('--courts', '0'))
const preserveCheckIn = process.argv.includes('--preserve-checkin')

const CLIENT_OPTIONS = {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket as any },
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(values: number[]) {
  if (values.length === 0) return { n: 0, avg: 0, p50: 0, p95: 0, max: 0 }
  return {
    n: values.length,
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(Math.max(...values)),
  }
}

async function getClient() {
  if (HOST_ACCESS_TOKEN) {
    return createClient(SUPABASE_URL, ANON_KEY!, {
      ...CLIENT_OPTIONS,
      global: { headers: { Authorization: `Bearer ${HOST_ACCESS_TOKEN}` } },
    })
  }
  const client = createClient(SUPABASE_URL, ANON_KEY!, CLIENT_OPTIONS)
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return client
}

async function getAccessToken(client: SupabaseAny) {
  if (HOST_ACCESS_TOKEN) return HOST_ACCESS_TOKEN
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Missing host access token')
  return token
}

async function loadRegisteredIds(client: SupabaseAny) {
  const { data, error } = await client
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)
  if (error) throw error
  return [...new Set((data ?? [])
    .filter((row: any) =>
      (row.status === 'confirmed' || row.status == null) &&
      (
        preserveCheckIn
          ? row.check_in_status === 'present' || row.check_in_status === 'checked_in'
          : row.check_in_status !== 'no_show'
      )
    )
    .map((row: any) => String(row.player_id)))]
}

async function invokeEdge(functionName: string, accessToken: string, body: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload?.ok === false) throw new Error(`${functionName} failed (${response.status}): ${payload?.error ?? text}`)
  return payload
}

async function loadRows(client: SupabaseAny) {
  const [sessionResult, playersResult, pairsResult, roundsResult, liveResult] = await Promise.all([
    client.from('sessions').select('live_state_version').eq('id', sessionId).single(),
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
  const error = sessionResult.error ?? playersResult.error ?? pairsResult.error ?? roundsResult.error ?? liveResult.error
  if (error) throw error
  const playerRows = playersResult.data ?? []
  return {
    liveStateVersion: Number(sessionResult.data?.live_state_version ?? 0),
    playerRows,
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    liveMatchRows: (liveResult.data ?? []) as SessionLiveMatchRow[],
    players: playerRows.map((row: any) => ({
      id: row.player_id,
      name: row.players?.name ?? String(row.player_id).slice(0, 8),
    })),
  }
}

function countCompleted(liveRows: SessionLiveMatchRow[]) {
  return liveRows.filter(row => row.status === 'completed').length
}

function countLive(liveRows: SessionLiveMatchRow[]) {
  return liveRows.filter(row => row.status === 'live').length
}

async function suggestBatch(client: SupabaseAny, accessToken: string, courts: number, count: number) {
  const loadStartedAt = now()
  const rows = await loadRows(client)
  const loadRowsMs = now() - loadStartedAt
  const suggestStartedAt = now()
  const payload = await invokeEdge('session-live-matches-suggest', accessToken, {
    count,
    court_count: courts,
    pvna_tolerance: pvnaTolerance,
    live_match_rows: rows.liveMatchRows,
    live_state_version: rows.liveStateVersion,
    completing_live_match_ids: [],
    players: rows.players,
    player_rows: rows.playerRows,
    pair_rows: rows.pairRows,
    round_rows: rows.roundRows,
  })
  return {
    rows,
    payloads: payload.payloads ?? [],
    loadRowsMs,
    suggestMs: now() - suggestStartedAt,
  }
}

async function startPayload(client: SupabaseAny, match: any, index: number, courts: number) {
  const rows = await loadRows(client)
  const startedAt = now()
  const { data, error } = await client.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: rows.liveStateVersion,
    p_match: {
      court_idx: match.court_idx,
      team_a: match.team_a,
      team_b: match.team_b,
      resting: match.resting ?? [],
      round_no: match.round_no ?? -1,
    },
    p_audit_payload: {
      source: 'scratch/run-human-live-edge-session.ts',
      preview_id: `human-edge-${index}`,
      preview_live_state_version: match.preview_live_state_version,
      preview_countable_match_count: match.preview_countable_match_count,
      expected_round_matches: courts,
    },
  })
  if (error) throw error
  return { match: data.match as SessionLiveMatchRow, ms: now() - startedAt }
}

async function completeLiveMatch(client: SupabaseAny, match: SessionLiveMatchRow, courts: number) {
  const scoreLoadStartedAt = now()
  const scoreState = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const scoreLoadMs = now() - scoreLoadStartedAt
  const fairnessStartedAt = now()
  const scoreAfter = Math.round(computeSessionFairness(scoreState).total)
  const fairnessMs = now() - fairnessStartedAt
  const rows = await loadRows(client)
  const completeStartedAt = now()
  const { data, error } = await client.rpc('complete_live_session_match_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: rows.liveStateVersion,
    p_match_id: match.id,
    p_score_a: 0,
    p_score_b: 0,
    p_score_after: scoreAfter,
    p_audit_payload: {
      source: 'scratch/run-human-live-edge-session.ts',
      expected_round_matches: courts,
    },
  })
  if (error) throw error
  return { data, scoreLoadMs, fairnessMs, ms: now() - completeStartedAt }
}

async function main() {
  const client = await getClient()
  const accessToken = await getAccessToken(client)
  const registeredIds = await loadRegisteredIds(client)
  if (registeredIds.length < 4) throw new Error(`Session has too few registered players: ${registeredIds.length}`)

  const syncStartedAt = now()
  if (!preserveCheckIn) {
    await client
      .from('session_players')
      .update({ check_in_status: 'present' })
      .eq('session_id', sessionId)
      .in('player_id', registeredIds)
  }
  await invokeEdge('session-sync-roster', accessToken, {
    player_ids: registeredIds,
    revive_checked_out: !preserveCheckIn,
  })
  await client.from('sessions').update({ status: 'playing', check_in_completed: true }).eq('id', sessionId)
  const checkInMs = now() - syncStartedAt

  const courts = courtsOverride > 0
    ? Math.floor(courtsOverride)
    : calculateOptimalCourts({
      n_players: registeredIds.length,
      session_duration_min: sessionDurationMin,
      match_duration_min: matchDurationMin,
      preset: courtPreset,
    }).recommended.courts
  const targetMatches = targetRounds * courts

  const suggestTimes: number[] = []
  const startTimes: number[] = []
  const completeTimes: number[] = []
  const scoreLoadTimes: number[] = []
  const fairnessTimes: number[] = []

  console.log('human live edge run', { sessionId, players: registeredIds.length, courts, targetRounds, targetMatches, delayMs, checkInMs: Math.round(checkInMs) })

  while (true) {
    const rows = await loadRows(client)
    const completed = countCompleted(rows.liveMatchRows)
    if (completed >= targetMatches) break
    const live = countLive(rows.liveMatchRows)
    const slots = Math.max(0, courts - live)
    if (slots > 0) {
      const batch = await suggestBatch(client, accessToken, courts, slots)
      suggestTimes.push(batch.suggestMs)
      if (batch.payloads.length === 0) {
        console.log('suggest returned no payloads; waiting for live matches to complete', { completed, live, slots })
      }
      let started = 0
      for (const payload of batch.payloads) {
        const result = await startPayload(client, payload, completed + started, courts)
        startTimes.push(result.ms)
        started += 1
        await sleep(delayMs)
      }
    }

    const afterStartRows = await loadRows(client)
    const liveMatches = afterStartRows.liveMatchRows.filter(row => row.status === 'live')
    if (liveMatches.length === 0) {
      await sleep(delayMs)
      continue
    }

    for (const match of liveMatches) {
      if (countCompleted((await loadRows(client)).liveMatchRows) >= targetMatches) break
      const result = await completeLiveMatch(client, match, courts)
      completeTimes.push(result.ms)
      scoreLoadTimes.push(result.scoreLoadMs)
      fairnessTimes.push(result.fairnessMs)
      await sleep(delayMs)
    }

    const statusRows = await loadRows(client)
    console.log('wave', {
      completed: countCompleted(statusRows.liveMatchRows),
      live: countLive(statusRows.liveMatchRows),
      suggest: summarize(suggestTimes),
      start: summarize(startTimes),
      complete: summarize(completeTimes),
    })
  }

  console.log('done', {
    checkInMs: Math.round(checkInMs),
    suggest: summarize(suggestTimes),
    start: summarize(startTimes),
    scoreLoad: summarize(scoreLoadTimes),
    fairness: summarize(fairnessTimes),
    complete: summarize(completeTimes),
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
