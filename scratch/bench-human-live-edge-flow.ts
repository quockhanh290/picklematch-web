import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow } from '../lib/next-round-suggester/types'

type SupabaseAny = any

type TimingRow = {
  step: number
  phase: 'initial' | 'replacement'
  courtIdx: number
  completedBefore: number
  startedBefore: number
  completeRpcMs: number
  suggestMs: number
  startRpcMs: number
  completeToNextStartedMs: number
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback = '') {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const sourceSessionId = argValue('--source-session-id')
if (!sourceSessionId) throw new Error('Usage: npx tsx scratch/bench-human-live-edge-flow.ts --source-session-id=<id>')

const targetRounds = Math.max(1, Number(argValue('--target-rounds', '8')))
const maxCourtAhead = Math.max(1, Number(argValue('--max-court-ahead', '3')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const seed = Number(argValue('--seed', '11'))
const cleanupEnabled = !process.argv.includes('--keep-clone')

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function makeRandom(initialSeed: number) {
  let state = initialSeed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(values: number[]) {
  if (values.length === 0) return { n: 0, min: 0, p50: 0, p95: 0, max: 0, avg: 0 }
  return {
    n: values.length,
    min: Math.round(Math.min(...values)),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(Math.max(...values)),
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }
}

function round(value: number) {
  return Math.round(value)
}

async function signInClient() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return client
}

async function accessToken(client: SupabaseAny) {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Missing access token')
  return token
}

async function cloneSession(client: SupabaseAny) {
  const [{ data: session, error: sessionError }, { data: players, error: playersError }] = await Promise.all([
    client.from('sessions').select('*').eq('id', sourceSessionId).single(),
    client.from('session_players').select('*').eq('session_id', sourceSessionId),
  ])
  if (sessionError) throw sessionError
  if (playersError) throw playersError
  if (!players || players.length < 8) throw new Error(`Source session has too few players: ${players?.length ?? 0}`)

  const cloneId = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const { error: insertSessionError } = await client.from('sessions').insert({
    ...session,
    id: cloneId,
    slot_id: null,
    status: 'open',
    created_at: nowIso,
    check_in_completed: true,
    live_state_version: 0,
    results_status: 'not_submitted',
    results_submitted_at: null,
    pending_completion_marked_at: null,
    auto_closed_at: null,
    finalized_by: null,
    elo_processed: false,
  })
  if (insertSessionError) throw insertSessionError

  const playerInserts = players.map((row: Record<string, unknown>) => ({
    ...row,
    session_id: cloneId,
    status: 'confirmed',
    check_in_status: 'present',
    created_at: nowIso,
    match_result: 'pending',
    proposed_result: 'pending',
    result_confirmation_status: 'not_submitted',
  }))
  const { error: insertPlayersError } = await client.from('session_players').insert(playerInserts)
  if (insertPlayersError) throw insertPlayersError

  const playerIds = playerInserts.map(row => String(row.player_id))
  const { error: syncError } = await client.rpc('sync_live_session_roster_versioned', {
    p_session_id: cloneId,
    p_player_ids: playerIds,
    p_revive_checked_out: true,
  })
  if (syncError) throw syncError

  const { error: playError } = await client.from('sessions').update({ status: 'playing', check_in_completed: true }).eq('id', cloneId)
  if (playError) throw playError

  return { cloneId, playerCount: playerIds.length }
}

async function cleanupClone(client: SupabaseAny, cloneId: string) {
  for (const table of [
    'session_live_matches',
    'session_pair_history',
    'session_player_state',
    'session_rounds',
    'suggester_decision_events',
    'session_next_round_settings',
  ]) {
    const { error } = await client.from(table).delete().eq('session_id', cloneId)
    if (error) throw new Error(`Cleanup failed for ${table}: ${error.message}`)
  }
  const { error } = await client.rpc('cancel_host_session', { p_session_id: cloneId })
  if (error) throw error
}

async function loadRows(client: SupabaseAny, sessionId: string) {
  const [sessionResult, playersResult, pairsResult, roundsResult, liveResult] = await Promise.all([
    client.from('sessions').select('live_state_version').eq('id', sessionId).single(),
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client.from('session_pair_history').select('session_id, player_a, player_b, partner_count, opponent_count').eq('session_id', sessionId),
    client.from('session_rounds').select('id, session_id, round_no, status, matches, resting, started_at, ended_at').eq('session_id', sessionId).order('round_no'),
    client
      .from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
      .eq('session_id', sessionId)
      .order('sequence_no'),
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
    players: playerRows.map((row: any) => ({ id: row.player_id, name: row.players?.name ?? String(row.player_id).slice(0, 8) })),
  }
}

async function suggestViaEdge(
  client: SupabaseAny,
  sessionId: string,
  token: string,
  courts: number,
  body: { count: number; mode?: 'full_board' | 'replace_courts'; courtIdxs?: number[]; completingIds?: string[] },
) {
  const rows = await loadRows(client, sessionId)
  const currentPreviewBoard = rows.liveMatchRows.filter(row => row.status === 'suggested')
  const startedAt = now()
  const response = await fetch(`${SUPABASE_URL}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      count: body.count,
      mode: body.mode ?? 'full_board',
      court_count: courts,
      court_idxs: body.courtIdxs,
      pvna_tolerance: pvnaTolerance,
      live_match_rows: rows.liveMatchRows,
      live_state_version: rows.liveStateVersion,
      completing_live_match_ids: body.completingIds ?? [],
      current_preview_board: currentPreviewBoard,
      players: rows.players,
      player_rows: rows.playerRows,
      pair_rows: rows.pairRows,
      round_rows: rows.roundRows,
    }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload?.ok === false) throw new Error(`suggest failed (${response.status}): ${payload?.error ?? text}`)
  return { payload, ms: now() - startedAt }
}

async function startPayload(client: SupabaseAny, sessionId: string, match: any, courts: number) {
  const rows = await loadRows(client, sessionId)
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
      benchmark: true,
      source: 'scratch/bench-human-live-edge-flow.ts',
      expected_round_matches: courts,
      preview_live_state_version: match.preview_live_state_version,
      preview_countable_match_count: match.preview_countable_match_count,
    },
  })
  if (error) throw error
  return { match: data.match as SessionLiveMatchRow, ms: now() - startedAt }
}

async function completeMatch(client: SupabaseAny, sessionId: string, match: SessionLiveMatchRow, courts: number) {
  const scoreState = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const scoreAfter = Math.round(computeSessionFairness(scoreState).total)
  const rows = await loadRows(client, sessionId)
  const startedAt = now()
  const { data, error } = await client.rpc('complete_live_session_match_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: rows.liveStateVersion,
    p_match_id: match.id,
    p_score_a: 0,
    p_score_b: 0,
    p_score_after: scoreAfter,
    p_audit_payload: {
      benchmark: true,
      source: 'scratch/bench-human-live-edge-flow.ts',
      expected_round_matches: courts,
    },
  })
  if (error) throw error
  return { liveStateVersion: Number(data.live_state_version), ms: now() - startedAt }
}

function pickLiveMatch(liveMatches: SessionLiveMatchRow[], completedByCourt: number[], random: () => number) {
  const minCompleted = Math.min(...completedByCourt)
  const eligible = liveMatches.filter(match => {
    const courtIdx = Number(match.court_idx ?? 0)
    return completedByCourt[courtIdx] + 1 <= minCompleted + maxCourtAhead
  })
  const pool = eligible.length > 0 ? eligible : liveMatches
  return pool[Math.floor(random() * pool.length)]
}

async function main() {
  const client = await signInClient()
  const token = await accessToken(client)
  let cloneId: string | null = null
  try {
    const clone = await cloneSession(client)
    cloneId = clone.cloneId
    const courtSetup = calculateOptimalCourts({
      n_players: clone.playerCount,
      session_duration_min: sessionDurationMin,
      match_duration_min: matchDurationMin,
      preset: courtPreset,
    })
    const courts = courtSetup.recommended.courts
    const targetMatches = courts * targetRounds
    const random = makeRandom(seed)
    const startedByCourt = Array.from({ length: courts }, () => 0)
    const completedByCourt = Array.from({ length: courts }, () => 0)
    const rows: TimingRow[] = []

    const initial = await suggestViaEdge(client, cloneId, token, courts, { count: courts, mode: 'full_board' })
    const initialPayloads = initial.payload.final_preview_board ?? initial.payload.payloads ?? []
    if (initialPayloads.length < courts) throw new Error(`Initial suggest returned ${initialPayloads.length}/${courts} payloads`)
    for (const payload of initialPayloads.slice(0, courts)) {
      const started = await startPayload(client, cloneId, payload, courts)
      startedByCourt[Number(started.match.court_idx ?? 0)] += 1
    }

    let completedTotal = 0
    while (completedTotal < targetMatches) {
      const currentRows = await loadRows(client, cloneId)
      const liveMatches = currentRows.liveMatchRows.filter(row => row.status === 'live')
      if (liveMatches.length === 0) throw new Error(`No live matches before target completed (${completedTotal}/${targetMatches})`)

      const match = pickLiveMatch(liveMatches, completedByCourt, random)
      const courtIdx = Number(match.court_idx ?? 0)
      const stepStartedAt = now()
      const completed = await completeMatch(client, cloneId, match, courts)
      completedByCourt[courtIdx] += 1
      completedTotal += 1

      let suggestMs = 0
      let startRpcMs = 0
      if (startedByCourt.reduce((sum, value) => sum + value, 0) < targetMatches) {
        const suggested = await suggestViaEdge(client, cloneId, token, courts, {
          count: 1,
          mode: 'replace_courts',
          courtIdxs: [courtIdx],
          completingIds: [match.id],
        })
        suggestMs = suggested.ms
        const replacement = (suggested.payload.final_preview_board ?? suggested.payload.payloads ?? [])
          .find((payload: any) => Number(payload.court_idx ?? -1) === courtIdx)
        if (!replacement) throw new Error(`No replacement payload for court ${courtIdx + 1} after completing step ${completedTotal}`)
        const started = await startPayload(client, cloneId, replacement, courts)
        startRpcMs = started.ms
        startedByCourt[courtIdx] += 1
      }

      rows.push({
        step: completedTotal,
        phase: completedTotal <= courts ? 'initial' : 'replacement',
        courtIdx,
        completedBefore: completedTotal - 1,
        startedBefore: startedByCourt.reduce((sum, value) => sum + value, 0) - (startRpcMs > 0 ? 1 : 0),
        completeRpcMs: completed.ms,
        suggestMs,
        startRpcMs,
        completeToNextStartedMs: now() - stepStartedAt,
      })
    }

    if (cleanupEnabled) await cleanupClone(client, cloneId)

    console.log(JSON.stringify({
      sourceSessionId,
      cloneId,
      cleanup: cleanupEnabled ? 'cancelled_and_live_rows_deleted' : 'kept',
      players: clone.playerCount,
      courts,
      targetRounds,
      targetMatches,
      maxCourtAhead,
      seed,
      courtReasoning: courtSetup.reasoning,
      distribution: {
        startedByCourt: startedByCourt.map(Number),
        completedByCourt: completedByCourt.map(Number),
        completedGap: Math.max(...completedByCourt) - Math.min(...completedByCourt),
      },
      summary: {
        initialSuggestMs: round(initial.ms),
        completeRpcMs: summarize(rows.map(row => row.completeRpcMs)),
        replacementSuggestMs: summarize(rows.filter(row => row.suggestMs > 0).map(row => row.suggestMs)),
        replacementStartRpcMs: summarize(rows.filter(row => row.startRpcMs > 0).map(row => row.startRpcMs)),
        completeToNextStartedMs: summarize(rows.filter(row => row.suggestMs > 0).map(row => row.completeToNextStartedMs)),
      },
      rows: rows.map(row => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]),
      )),
    }, null, 2))
  } catch (error) {
    if (cloneId && cleanupEnabled) {
      try {
        await cleanupClone(client, cloneId)
      } catch (cleanupError) {
        console.error('Cleanup failed after benchmark error', cleanupError)
      }
    }
    throw error
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
