import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type { Match, SessionLiveMatchRow } from '../lib/next-round-suggester/types'

type SupabaseAny = any
type TimingRow = {
  iteration: number
  loadStateMs: number
  loadLiveMs: number
  suggestMs: number
  versionGuardMs: number
  startRpcMs: number
  scoreLoadStateMs: number
  fairnessMs: number
  completeRpcMs: number
  totalMs: number
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
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

const iterations = Math.max(1, Number(argValue('--iterations', '5')))
const sourceSessionIdArg = argValue('--source-session-id', '')
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const targetName = argValue('--target', 'P25')
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
    .select('id, status')
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
  const { error: cancelError } = await client.rpc('cancel_host_session', { p_session_id: cloneId })
  if (cancelError) throw cancelError
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

function firstFreeCourtIdx(matches: SessionLiveMatchRow[], courts: number) {
  const liveCourts = new Set(
    matches
      .filter((match) => match.status === 'live' && match.court_idx != null)
      .map((match) => Number(match.court_idx)),
  )
  for (let index = 0; index < courts; index += 1) {
    if (!liveCourts.has(index)) return index
  }
  return null
}

function busyPlayerIds(matches: SessionLiveMatchRow[]) {
  return new Set(
    matches
      .filter((match) => match.status === 'live')
      .flatMap((match) => [...(match.team_a ?? []), ...(match.team_b ?? [])].map(String)),
  )
}

async function runOneIteration(client: SupabaseAny, sessionId: string, courts: number, iteration: number): Promise<TimingRow> {
  const totalStartedAt = now()

  const loadStateStartedAt = now()
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const loadStateMs = now() - loadStateStartedAt

  const loadLiveStartedAt = now()
  const liveMatches = await loadLiveMatches(client, sessionId)
  const loadLiveMs = now() - loadLiveStartedAt

  const courtIdx = firstFreeCourtIdx(liveMatches, courts)
  if (courtIdx === null) throw new Error('No free court')

  const suggestStartedAt = now()
  const suggestion = suggestNextMatch(state, {
    busy_player_ids: busyPlayerIds(liveMatches),
    court_idx: courtIdx,
  })
  const match = suggestion.alternatives[0]?.matches[0]
  const suggestMs = now() - suggestStartedAt
  if (!match) throw new Error(`No match suggested: ${suggestion.warnings.join(', ')}`)

  const versionGuardStartedAt = now()
  const startVersion = await getVersionGuard(client, sessionId)
  const versionGuardMs = now() - versionGuardStartedAt

  const startRpcStartedAt = now()
  const { data: started, error: startError } = await client.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: startVersion,
    p_match: {
      ...match,
      court_idx: courtIdx,
      resting: suggestion.alternatives[0]?.resting ?? [],
      round_no: Math.floor(liveMatches.filter((item) => item.status !== 'cancelled').length / Math.max(1, courts)),
    } satisfies Match & { resting: string[]; round_no: number },
    p_audit_payload: {
      benchmark: true,
      cloned_session: true,
      source: 'client-preview-start-live-match',
      iteration,
      preview_live_state_version: startVersion,
    },
  })
  const startRpcMs = now() - startRpcStartedAt
  if (startError) throw startError

  const scoreLoadStartedAt = now()
  const scoreState = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const scoreLoadStateMs = now() - scoreLoadStartedAt

  const fairnessStartedAt = now()
  const scoreAfter = Math.round(computeSessionFairness(scoreState).total)
  const fairnessMs = now() - fairnessStartedAt

  const completeRpcStartedAt = now()
  const { error: completeError } = await client.rpc('complete_live_session_match_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: Number(started.live_state_version),
    p_match_id: started.match.id,
    p_score_a: 0,
    p_score_b: 0,
    p_score_after: scoreAfter,
    p_audit_payload: {
      benchmark: true,
      cloned_session: true,
      source: 'scratch/bench-cloned-live-match-flow.ts',
      iteration,
      expected_round_matches: courts,
    },
  })
  const completeRpcMs = now() - completeRpcStartedAt
  if (completeError) throw completeError

  return {
    iteration,
    loadStateMs,
    loadLiveMs,
    suggestMs,
    versionGuardMs,
    startRpcMs,
    scoreLoadStateMs,
    fairnessMs,
    completeRpcMs,
    totalMs: now() - totalStartedAt,
  }
}

async function analyzeTargetRest(client: SupabaseAny, sessionId: string, courts: number, target: string) {
  const [{ data: targetRows, error: targetError }, { data: liveRows, error: liveError }, { data: activeRows, error: activeError }] = await Promise.all([
    client
      .from('session_player_state')
      .select('player_id, matches_played, last_played_round, consecutive_rest, consecutive_play, players(name)')
      .eq('session_id', sessionId),
    client
      .from('session_live_matches')
      .select('sequence_no, round_no, status, team_a, team_b')
      .eq('session_id', sessionId)
      .neq('status', 'cancelled')
      .order('sequence_no', { ascending: true }),
    client
      .from('session_player_state')
      .select('player_id')
      .eq('session_id', sessionId)
      .is('checked_out_at', null)
      .eq('opted_rest', false),
  ])
  if (targetError) throw targetError
  if (liveError) throw liveError
  if (activeError) throw activeError

  const targetRow = (targetRows ?? []).find((row: any) => row.players?.name === target)
  if (!targetRow) throw new Error(`Could not find target ${target}`)

  const targetId = String(targetRow.player_id)
  const activeIds = new Set((activeRows ?? []).map((row: any) => String(row.player_id)))
  const byRound = new Map<number, any[]>()
  for (const row of liveRows ?? []) {
    const roundNo = Number(row.round_no ?? Math.floor(Number(row.sequence_no) / Math.max(1, courts)))
    byRound.set(roundNo, [...(byRound.get(roundNo) ?? []), row])
  }

  let consecutiveRest = 0
  let maxConsecutiveRest = 0
  const timeline = [...byRound.entries()]
    .sort(([left], [right]) => left - right)
    .map(([roundNo, matches]) => {
      const completed = matches.filter(row => row.status === 'completed')
      const fullRound = completed.length >= courts
      const played = completed.some(row => [...(row.team_a ?? []), ...(row.team_b ?? [])].map(String).includes(targetId))
      const resting = fullRound && activeIds.has(targetId) && !played
      if (fullRound) {
        consecutiveRest = resting ? consecutiveRest + 1 : 0
        maxConsecutiveRest = Math.max(maxConsecutiveRest, consecutiveRest)
      }
      return {
        round_no: roundNo,
        completed: completed.length,
        fullRound,
        target_played: played,
        target_resting: resting,
        target_consecutive_rest_after: fullRound ? consecutiveRest : null,
      }
    })

  return {
    target,
    current_db: {
      matches_played: targetRow.matches_played,
      last_played_round: targetRow.last_played_round,
      consecutive_rest: targetRow.consecutive_rest,
      consecutive_play: targetRow.consecutive_play,
    },
    maxConsecutiveRest,
    timeline,
  }
}

async function main() {
  const client = await signInClient()
  const sourceSessionId = await latestSessionId(client)
  let cloneId: string | null = null
  const cleanupStartedAt = now()

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
    const rows: TimingRow[] = []

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      rows.push(await runOneIteration(client, cloneId, courts, iteration))
    }
    const targetRest = await analyzeTargetRest(client, cloneId, courts, targetName)

    const summary = {
      loadStateMs: summarize(rows.map((row) => row.loadStateMs)),
      loadLiveMs: summarize(rows.map((row) => row.loadLiveMs)),
      suggestMs: summarize(rows.map((row) => row.suggestMs)),
      versionGuardMs: summarize(rows.map((row) => row.versionGuardMs)),
      startRpcMs: summarize(rows.map((row) => row.startRpcMs)),
      scoreLoadStateMs: summarize(rows.map((row) => row.scoreLoadStateMs)),
      fairnessMs: summarize(rows.map((row) => row.fairnessMs)),
      completeRpcMs: summarize(rows.map((row) => row.completeRpcMs)),
      totalMs: summarize(rows.map((row) => row.totalMs)),
    }

    if (cleanupEnabled) await cleanupClone(client, cloneId)

    console.log(JSON.stringify({
      sourceSessionId,
      cloneId,
      cleanup: cleanupEnabled ? 'cancelled_and_live_rows_deleted' : 'kept',
      host: HOST_EMAIL,
      iterations,
      courts,
      targetRest,
      recommendedCourts: courts,
      courtReasoning: courtSetup.reasoning,
      rows: rows.map((row) => ({
        ...row,
        loadStateMs: round(row.loadStateMs),
        loadLiveMs: round(row.loadLiveMs),
        suggestMs: round(row.suggestMs),
        versionGuardMs: round(row.versionGuardMs),
        startRpcMs: round(row.startRpcMs),
        scoreLoadStateMs: round(row.scoreLoadStateMs),
        fairnessMs: round(row.fairnessMs),
        completeRpcMs: round(row.completeRpcMs),
        totalMs: round(row.totalMs),
      })),
      summary,
      cleanupMs: cleanupEnabled ? round(now() - cleanupStartedAt - rows.reduce((sum, row) => sum + row.totalMs, 0)) : null,
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
