import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'

type SupabaseAny = any

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

const sourceSessionId = argValue('--source-session-id', '')
if (!sourceSessionId) throw new Error('Usage: tsx scratch/bench-live-checkin-first-suggest.ts --source-session-id=<id>')

const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const cleanupEnabled = !process.argv.includes('--keep-clone')

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
    check_in_completed: false,
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

  return { cloneId, playerIds: playerInserts.map((row) => String(row.player_id)) }
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
      .eq('session_id', sessionId),
    client
      .from('session_rounds')
      .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
      .eq('session_id', sessionId),
    client
      .from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
      .eq('session_id', sessionId),
  ])
  const error = sessionResult.error ?? playersResult.error ?? pairsResult.error ?? roundsResult.error ?? liveResult.error
  if (error) throw error
  const playerRows = playersResult.data ?? []
  return {
    liveStateVersion: Number(sessionResult.data?.live_state_version ?? 0),
    playerRows,
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    liveMatchRows: liveResult.data ?? [],
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
  return payload
}

async function main() {
  const client = await signInClient()
  let cloneId: string | null = null

  try {
    const cloneStartedAt = now()
    const clone = await cloneSession(client)
    cloneId = clone.cloneId
    const cloneMs = now() - cloneStartedAt

    const courtSetup = calculateOptimalCourts({
      n_players: clone.playerIds.length,
      session_duration_min: sessionDurationMin,
      match_duration_min: matchDurationMin,
      preset: courtPreset,
    })
    const courts = courtSetup.recommended.courts

    const finishStartedAt = now()
    const syncStartedAt = now()
    const { error: syncError } = await client.rpc('sync_live_session_roster_versioned', {
      p_session_id: cloneId,
      p_player_ids: clone.playerIds,
      p_revive_checked_out: true,
    })
    if (syncError) throw syncError
    const syncRosterMs = now() - syncStartedAt

    const markStartedAt = now()
    const { error: playError } = await client
      .from('sessions')
      .update({ status: 'playing', check_in_completed: true })
      .eq('id', cloneId)
    if (playError) throw playError
    const markPlayingMs = now() - markStartedAt

    const loadStartedAt = now()
    const previewRows = await loadPreviewRows(client, cloneId)
    const loadRowsMs = now() - loadStartedAt

    const edgeStartedAt = now()
    const edge = await suggestViaEdge(client, cloneId, previewRows, courts)
    const firstSuggestMs = now() - edgeStartedAt
    const finishToFirstSuggestLoadedMs = now() - finishStartedAt

    if (cleanupEnabled) await cleanupClone(client, cloneId)

    console.log(JSON.stringify({
      sourceSessionId,
      cloneId,
      cleanup: cleanupEnabled ? 'cancelled_and_live_rows_deleted' : 'kept',
      players: clone.playerIds.length,
      courts,
      courtReasoning: courtSetup.reasoning,
      payloads: edge.payloads?.length ?? 0,
      timing: {
        cloneMs: round(cloneMs),
        syncRosterMs: round(syncRosterMs),
        markPlayingMs: round(markPlayingMs),
        loadRowsMs: round(loadRowsMs),
        firstSuggestMs: round(firstSuggestMs),
        finishToFirstSuggestLoadedMs: round(finishToFirstSuggestLoadedMs),
      },
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
