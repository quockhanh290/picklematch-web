import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '@/lib/next-round-suggester/state'
import type { SessionLiveMatchRow } from '@/lib/next-round-suggester/types'

type SupabaseAny = any

type Row = {
  matchIndex: number
  roundNo: number
  courtIdx: number
  preparePreviewMs: number
  prepareEdgeSuggestMs: number
  startRpcMs: number
  postStartReloadMs: number
  startToLoadedMs: number
  scoreLoadStateMs: number
  fairnessMs: number
  completeRpcMs: number
  postCompleteReloadMs: number
  postCompleteEdgeSuggestMs: number
  endToNextLoadedMs: number
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const targetRounds = Math.max(1, Number(argValue('--target-rounds', '8')))
const iterationsLimit = Math.max(1, Number(argValue('--iterations', String(Number.MAX_SAFE_INTEGER))))
const sourceSessionIdArg = argValue('--source-session-id', '')
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const cleanupEnabled = !process.argv.includes('--keep-clone')

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function round(n: number) {
  return Math.round(n)
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(values: number[]) {
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return {
    min: round(Math.min(...values)),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: round(Math.max(...values)),
    avg: round(avg),
  }
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

async function latestSessionId(client: SupabaseAny) {
  if (sourceSessionIdArg) return sourceSessionIdArg
  const { data, error } = await client
    .from('sessions')
    .select('id, status, created_at')
    .in('status', ['open', 'playing'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  for (const session of data ?? []) {
    const { count, error: countError } = await client
      .from('session_players')
      .select('player_id', { count: 'exact', head: true })
      .eq('session_id', session.id)
    if (countError) throw countError
    if ((count ?? 0) >= 8) return String(session.id)
  }
  throw new Error('No playable source session found')
}

async function cloneSession(client: SupabaseAny, sourceSessionId: string) {
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

  const playerIds = playerInserts.map((row) => String(row.player_id))
  const { error: syncError } = await client.rpc('sync_live_session_roster_versioned', {
    p_session_id: cloneId,
    p_player_ids: playerIds,
    p_revive_checked_out: true,
  })
  if (syncError) throw syncError

  const { error: playError } = await client
    .from('sessions')
    .update({ status: 'playing', check_in_completed: true })
    .eq('id', cloneId)
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

async function loadPreviewRows(client: SupabaseAny, sessionId: string) {
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
      .eq('session_id', sessionId)
      .order('player_a', { ascending: true }),
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

async function suggestViaEdge(client: SupabaseAny, sessionId: string, previewRows: Awaited<ReturnType<typeof loadPreviewRows>>, courts: number) {
  const { data } = await client.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('Missing access token')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      count: 1,
      court_count: courts,
      pvna_tolerance: pvnaTolerance,
      live_match_rows: previewRows.liveMatchRows,
      live_state_version: previewRows.liveStateVersion,
      completing_live_match_ids: [],
      players: previewRows.players,
      player_rows: previewRows.playerRows,
      pair_rows: previewRows.pairRows,
      round_rows: previewRows.roundRows,
    }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload.ok === false) throw new Error(`Edge suggest failed (${response.status}): ${payload.error ?? text}`)
  return payload.payloads?.[0]
}

async function startMatch(client: SupabaseAny, sessionId: string, match: any, matchIndex: number, courts: number) {
  const expectedVersion = Number(match.preview_live_state_version ?? 0)
  const { data, error } = await client.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: expectedVersion,
    p_match: match,
    p_audit_payload: {
      benchmark: true,
      cloned_session: true,
      source: 'scratch/bench-live-action-edge-latency.ts',
      match_index: matchIndex,
      expected_round_matches: courts,
      preview_live_state_version: expectedVersion,
    },
  })
  if (error) throw error
  return data
}

async function completeMatch(client: SupabaseAny, sessionId: string, matchId: string, version: number, courts: number, matchIndex: number) {
  const scoreLoadStartedAt = now()
  const scoreState = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const scoreLoadStateMs = now() - scoreLoadStartedAt

  const fairnessStartedAt = now()
  const scoreAfter = Math.round(computeSessionFairness(scoreState).total)
  const fairnessMs = now() - fairnessStartedAt

  const completeStartedAt = now()
  const { data, error } = await client.rpc('complete_live_session_match_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: version,
    p_match_id: matchId,
    p_score_a: 0,
    p_score_b: 0,
    p_score_after: scoreAfter,
    p_audit_payload: {
      benchmark: true,
      cloned_session: true,
      source: 'scratch/bench-live-action-edge-latency.ts',
      match_index: matchIndex,
      expected_round_matches: courts,
    },
  })
  const completeRpcMs = now() - completeStartedAt
  if (error) throw error

  return { scoreLoadStateMs, fairnessMs, completeRpcMs, completeVersion: Number(data.live_state_version) }
}

async function main() {
  const client = await signInClient()
  const sourceSessionId = await latestSessionId(client)
  let cloneId: string | null = null

  try {
    const clone = await cloneSession(client, sourceSessionId)
    cloneId = clone.cloneId
    const courtSetup = calculateOptimalCourts({
      n_players: clone.playerCount,
      session_duration_min: sessionDurationMin,
      match_duration_min: matchDurationMin,
      preset: courtPreset,
    })
    const courts = courtSetup.recommended.courts
    const rows: Row[] = []
    const totalMatches = Math.min(targetRounds * courts, iterationsLimit)

    for (let matchIndex = 1; matchIndex <= totalMatches; matchIndex += 1) {
      const prepareReloadStartedAt = now()
      const prepareRows = await loadPreviewRows(client, cloneId)
      const preparePreviewMs = now() - prepareReloadStartedAt

      const prepareSuggestStartedAt = now()
      const match = await suggestViaEdge(client, cloneId, prepareRows, courts)
      const prepareEdgeSuggestMs = now() - prepareSuggestStartedAt
      if (!match) throw new Error(`No edge match payload at match ${matchIndex}`)

      const startStartedAt = now()
      const started = await startMatch(client, cloneId, match, matchIndex, courts)
      const startRpcMs = now() - startStartedAt

      const postStartReloadStartedAt = now()
      await loadPreviewRows(client, cloneId)
      const postStartReloadMs = now() - postStartReloadStartedAt

      const complete = await completeMatch(client, cloneId, String(started.match.id), Number(started.live_state_version), courts, matchIndex)

      const postCompleteReloadStartedAt = now()
      const postCompleteRows = await loadPreviewRows(client, cloneId)
      const postCompleteReloadMs = now() - postCompleteReloadStartedAt

      const postCompleteSuggestStartedAt = now()
      await suggestViaEdge(client, cloneId, postCompleteRows, courts)
      const postCompleteEdgeSuggestMs = now() - postCompleteSuggestStartedAt

      rows.push({
        matchIndex,
        roundNo: Number(started.match.round_no ?? match.round_no ?? 0),
        courtIdx: Number(started.match.court_idx ?? match.court_idx ?? 0),
        preparePreviewMs,
        prepareEdgeSuggestMs,
        startRpcMs,
        postStartReloadMs,
        startToLoadedMs: startRpcMs + postStartReloadMs,
        scoreLoadStateMs: complete.scoreLoadStateMs,
        fairnessMs: complete.fairnessMs,
        completeRpcMs: complete.completeRpcMs,
        postCompleteReloadMs,
        postCompleteEdgeSuggestMs,
        endToNextLoadedMs: complete.completeRpcMs + postCompleteReloadMs + postCompleteEdgeSuggestMs,
      })
    }

    if (cleanupEnabled) await cleanupClone(client, cloneId)

    console.log(JSON.stringify({
      sourceSessionId,
      cloneId,
      cleanup: cleanupEnabled ? 'cancelled_and_live_rows_deleted' : 'kept',
      host: HOST_EMAIL,
      targetRounds,
      matchesMeasured: rows.length,
      courts,
      recommendedCourts: courts,
      courtReasoning: courtSetup.reasoning,
      summary: {
        preparePreviewMs: summarize(rows.map(row => row.preparePreviewMs)),
        prepareEdgeSuggestMs: summarize(rows.map(row => row.prepareEdgeSuggestMs)),
        startRpcMs: summarize(rows.map(row => row.startRpcMs)),
        postStartReloadMs: summarize(rows.map(row => row.postStartReloadMs)),
        startToLoadedMs: summarize(rows.map(row => row.startToLoadedMs)),
        scoreLoadStateMs: summarize(rows.map(row => row.scoreLoadStateMs)),
        fairnessMs: summarize(rows.map(row => row.fairnessMs)),
        completeRpcMs: summarize(rows.map(row => row.completeRpcMs)),
        postCompleteReloadMs: summarize(rows.map(row => row.postCompleteReloadMs)),
        postCompleteEdgeSuggestMs: summarize(rows.map(row => row.postCompleteEdgeSuggestMs)),
        endToNextLoadedMs: summarize(rows.map(row => row.endToNextLoadedMs)),
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

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
