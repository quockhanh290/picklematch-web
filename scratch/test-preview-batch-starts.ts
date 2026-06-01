import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type { Match, SessionLiveMatchRow } from '../lib/next-round-suggester/types'

type SupabaseAny = any

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const sourceSessionIdArg = argValue('--source-session-id', 'a57ed2f9-54c4-4b08-b4c6-d8e7aa7be8b0')
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const courtCountOverride = Number(argValue('--courts', '0'))

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
  const sessionInsert = {
    ...session,
    id: cloneId,
    slot_id: null,
    status: 'open',
    created_at: nowIso,
    was_full_when_cancelled: false,
    check_in_completed: true,
    live_state_version: 0,
    results_status: 'not_submitted',
    results_submitted_at: null,
    results_confirmation_deadline: null,
    pending_completion_marked_at: null,
    completion_reminder_sent_at: null,
    auto_closed_at: null,
    auto_closed_reason: null,
    finalized_by: null,
    ghost_session_reported_at: null,
    elo_processed: false,
    elo_skip_reason: null,
  }
  const { error: insertSessionError } = await client.from('sessions').insert(sessionInsert)
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
    result_confirmed_at: null,
    result_disputed_at: null,
    result_dispute_note: null,
    member_reported_result: 'pending',
    member_reported_at: null,
    member_report_note: null,
    host_unprofessional_reported_at: null,
    host_unprofessional_report_note: null,
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
  const tables = [
    'session_live_matches',
    'session_pair_history',
    'session_player_state',
    'session_rounds',
    'suggester_decision_events',
    'session_next_round_settings',
  ]
  for (const table of tables) {
    const { error } = await client.from(table).delete().eq('session_id', cloneId)
    if (error) throw new Error(`Cleanup failed for ${table}: ${error.message}`)
  }
  const { error } = await client.rpc('cancel_host_session', { p_session_id: cloneId })
  if (error) throw error
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', { p_session_id: sessionId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return Number(row.live_state_version)
}

async function loadLiveMatches(client: SupabaseAny, sessionId: string): Promise<SessionLiveMatchRow[]> {
  const { data, error } = await client
    .from('session_live_matches')
    .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
    .eq('session_id', sessionId)
    .order('sequence_no', { ascending: true })
  if (error) throw error
  return (data ?? []) as SessionLiveMatchRow[]
}

function playersIn(match: Match) {
  return [...match.team_a, ...match.team_b].map(String)
}

async function startPreviewMatch(
  client: SupabaseAny,
  sessionId: string,
  expectedVersion: number,
  previewVersion: number,
  previewCountableMatchCount: number,
  match: Match,
  courtIdx: number,
) {
  const { data, error } = await client.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: expectedVersion,
    p_match: {
      ...match,
      court_idx: courtIdx,
      resting: [],
      round_no: 0,
    } satisfies Match & { resting: string[]; round_no: number },
    p_audit_payload: {
      source: 'client-preview-start-live-match',
      preview_id: `batch_start_test_${courtIdx}`,
      preview_live_state_version: previewVersion,
      preview_countable_match_count: previewCountableMatchCount,
    },
  })
  return { data, error }
}

async function main() {
  const client = await signInClient()
  const clone = await cloneSession(client, sourceSessionIdArg)
  const cleanupStartedAt = now()

  try {
    const courts = courtCountOverride > 0
      ? Math.floor(courtCountOverride)
      : calculateOptimalCourts(clone.playerCount, {
        preset: courtPreset,
        sessionDurationMin,
        matchDurationMin,
      }).optimal
    const state = await loadSessionState(client, clone.cloneId, {
      courts,
      pvnaTolerance,
    })
    if (state.config.courts < 2) throw new Error(`Need at least 2 courts for batch test, got ${state.config.courts}`)

    const previewVersion = await getVersionGuard(client, clone.cloneId)
    const previewLiveMatches = await loadLiveMatches(client, clone.cloneId)
    const previewCountableMatchCount = previewLiveMatches.filter((match) => match.status !== 'cancelled').length

    const firstSuggestion = suggestNextMatch(state, { court_idx: 0 })
    const firstMatch = firstSuggestion.alternatives[0]?.matches[0]
    if (!firstMatch) throw new Error(`No first match: ${firstSuggestion.warnings.join(', ')}`)

    const secondSuggestion = suggestNextMatch(state, {
      court_idx: 1,
      busy_player_ids: new Set(playersIn(firstMatch)),
    })
    const secondMatch = secondSuggestion.alternatives[0]?.matches[0]
    if (!secondMatch) throw new Error(`No second match: ${secondSuggestion.warnings.join(', ')}`)

    const start1StartedAt = now()
    const start1 = await startPreviewMatch(
      client,
      clone.cloneId,
      previewVersion,
      previewVersion,
      previewCountableMatchCount,
      firstMatch,
      0,
    )
    if (start1.error) throw start1.error
    const start1Ms = now() - start1StartedAt

    const afterStart1Version = Number(start1.data.live_state_version)
    const start2StartedAt = now()
    const start2 = await startPreviewMatch(
      client,
      clone.cloneId,
      afterStart1Version,
      previewVersion,
      previewCountableMatchCount,
      secondMatch,
      1,
    )
    const start2Ms = now() - start2StartedAt
    if (start2.error) throw start2.error

    const scoreState = await loadSessionState(client, clone.cloneId, { courts, pvnaTolerance })
    const scoreAfter = Math.round(computeSessionFairness(scoreState).total)
    const complete = await client.rpc('complete_live_session_match_versioned', {
      p_session_id: clone.cloneId,
      p_expected_live_state_version: Number(start2.data.live_state_version),
      p_match_id: start1.data.match.id,
      p_score_a: 0,
      p_score_b: 0,
      p_score_after: scoreAfter,
      p_audit_payload: {
        source: 'scratch/test-preview-batch-starts.ts',
        expected_round_matches: courts,
      },
    })
    if (complete.error) throw complete.error

    const staleAfterComplete = await startPreviewMatch(
      client,
      clone.cloneId,
      Number(complete.data.live_state_version),
      previewVersion,
      previewCountableMatchCount,
      firstMatch,
      2,
    )
    const staleRejected = Boolean(staleAfterComplete.error)
      && /Preview is stale|already in a live match/i.test(staleAfterComplete.error.message ?? '')

    const liveRows = await loadLiveMatches(client, clone.cloneId)
    console.log(JSON.stringify({
      sourceSessionId: sourceSessionIdArg,
      cloneId: clone.cloneId,
      playerCount: clone.playerCount,
      courts,
      previewVersion,
      previewCountableMatchCount,
      start1: {
        ok: true,
        ms: Math.round(start1Ms),
        nextVersion: Number(start1.data.live_state_version),
      },
      start2WithStalePreviewAfterOnlyStart: {
        ok: true,
        ms: Math.round(start2Ms),
        nextVersion: Number(start2.data.live_state_version),
      },
      staleAfterCompleteRejected: staleRejected,
      staleAfterCompleteMessage: staleAfterComplete.error?.message ?? null,
      liveRows: liveRows.map((row) => ({
        sequence_no: row.sequence_no,
        status: row.status,
        court_idx: row.court_idx,
      })),
    }, null, 2))

    if (!staleRejected) process.exitCode = 1
  } finally {
    await cleanupClone(client, clone.cloneId)
    console.log(JSON.stringify({
      cloneId: clone.cloneId,
      cleanup: 'cancelled_and_live_rows_deleted',
      cleanupMs: Math.round(now() - cleanupStartedAt),
    }, null, 2))
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
