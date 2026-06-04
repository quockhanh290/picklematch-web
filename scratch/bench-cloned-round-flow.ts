import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { buildSessionStateFingerprint } from '../lib/next-round-suggester/state-version'
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import type { Match, SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

type SupabaseAny = any

type TimingRow = {
  roundNo: number
  gapFromPreviousEndMs: number | null
  loadSessionStateMs: number
  correctFairnessMs: number
  suggestNextRoundMs: number
  planMs: number
  getStartVersionMs: number
  startRoundMs: number
  endRoundMs: number
  totalMs: number
  score: number
  pvnaDiff: number
  warnings: string[]
}

type Plan = {
  state: SessionState
  alternative: SuggestionAlternative
  timings: {
    loadSessionStateMs: number
    correctFairnessMs: number
    suggestNextRoundMs: number
    totalMs: number
  }
}

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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const HOST_ACCESS_TOKEN = process.env.HOST_ACCESS_TOKEN

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const sourceSessionIdArg = argValue('--source-session-id', '')
const targetRounds = Math.max(1, Number(argValue('--target-rounds', '8')))
const sessionDurationMinArg = argValue('--session-duration-min', '')
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const courtPresetArg = argValue('--court-preset', '') as CourtPreset | ''
const pvnaToleranceArg = argValue('--pvna-tolerance', '')
const cleanupEnabled = !process.argv.includes('--keep-clone')
const label = argValue('--label', 'current')

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function round(n: number) {
  return Math.round(n)
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
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
  if (HOST_ACCESS_TOKEN) {
    const { error } = await client.auth.getUser(HOST_ACCESS_TOKEN)
    if (error) throw error
    return { client, accessToken: HOST_ACCESS_TOKEN, userId: null as string | null }
  }
  const { data, error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return { client, accessToken: data.session.access_token, userId: data.session.user.id }
}

async function latestHostSessionId(client: SupabaseAny, hostUserId: string | null) {
  if (sourceSessionIdArg) return sourceSessionIdArg
  let query = client
    .from('sessions')
    .select('id, status, created_at, host_id')
    .order('created_at', { ascending: false })
    .limit(1)
  if (hostUserId) query = query.eq('host_id', hostUserId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error(`No latest session found for ${HOST_EMAIL}`)
  return String(data.id)
}

async function loadSettings(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_next_round_settings')
    .select('court_preset, court_duration_min, pvna_tolerance')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw error
  return {
    courtPreset: courtPresetArg || ((data?.court_preset ?? 'balanced') as CourtPreset),
    sessionDurationMin: Math.max(1, Number(sessionDurationMinArg || data?.court_duration_min || 120)),
    pvnaTolerance: Math.max(0, Number(pvnaToleranceArg || data?.pvna_tolerance || 0.5)),
  }
}

async function cloneSession(client: SupabaseAny, sourceSessionId: string) {
  const [{ data: session, error: sessionError }, { data: players, error: playersError }] = await Promise.all([
    client.from('sessions').select('*').eq('id', sourceSessionId).single(),
    client.from('session_players').select('*').eq('session_id', sourceSessionId),
  ])
  if (sessionError) throw sessionError
  if (playersError) throw playersError
  if (!players || players.length < 4) throw new Error(`Source session has too few players: ${players?.length ?? 0}`)

  const cloneId = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const sessionInsert = {
    ...session,
    id: cloneId,
    slot_id: null,
    status: 'open',
    created_at: nowIso,
    check_in_completed: false,
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
    check_in_status: null,
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

  return { cloneId, playerIds: playerInserts.map((row) => String(row.player_id)) }
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

async function checkInClone(client: SupabaseAny, accessToken: string, cloneId: string, playerIds: string[]) {
  const startedAt = now()
  const { error: updateError } = await client
    .from('session_players')
    .update({ check_in_status: 'present' })
    .eq('session_id', cloneId)
    .in('player_id', playerIds)
  if (updateError) throw updateError

  const result = await invoke('session-sync-roster', accessToken, cloneId, {
    player_ids: playerIds,
    revive_checked_out: true,
  })
  if (!result.ok) throw new Error(`session-sync-roster failed: ${result.error ?? result.status}`)

  const { error: sessionError } = await client
    .from('sessions')
    .update({ status: 'playing', check_in_completed: true })
    .eq('id', cloneId)
  if (sessionError) throw sessionError
  return now() - startedAt
}

async function invoke(
  functionName: string,
  accessToken: string,
  sessionId: string,
  body: Record<string, unknown>,
  query: Record<string, string | number> = {},
) {
  const params = new URLSearchParams({ session_id: sessionId })
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  const url = `${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`
  const startedAt = now()
  let status = 0
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    status = response.status
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    const ms = now() - startedAt
    if (!response.ok || payload?.ok === false) {
      return { ok: false, ms, status, error: payload?.error ?? text }
    }
    return { ok: true, ms, status, round_no: payload?.round?.round_no, ...payload }
  } catch (error) {
    return { ok: false, ms: now() - startedAt, status, error: error instanceof Error ? error.message : String(error) }
  }
}

async function getLiveStateVersion(client: SupabaseAny, sessionId: string) {
  const startedAt = now()
  const { data, error } = await client.from('sessions').select('live_state_version').eq('id', sessionId).single()
  if (error) throw error
  return { version: Number(data.live_state_version), ms: now() - startedAt }
}

async function buildPlan(client: SupabaseAny, sessionId: string, courts: number, pvnaTolerance: number): Promise<Plan> {
  const totalStartedAt = now()
  const loadStartedAt = now()
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const loadSessionStateMs = now() - loadStartedAt

  const fairnessStartedAt = now()
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const correctFairnessMs = now() - fairnessStartedAt

  const suggestStartedAt = now()
  const suggestion = suggestNextRound(adjustedState, { tier_overrides: adjustment.tier_overrides })
  const suggestNextRoundMs = now() - suggestStartedAt
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available: ${suggestion.warnings.join(',')}`)

  return {
    state,
    alternative,
    timings: {
      loadSessionStateMs,
      correctFairnessMs,
      suggestNextRoundMs,
      totalMs: now() - totalStartedAt,
    },
  }
}

function scoreAfterCompletedRound(state: SessionState, alternative: SuggestionAlternative, roundNo: number) {
  const committed = commitCompletedRound(
    state,
    {
      round_no: roundNo,
      matches: alternative.matches,
      resting: alternative.resting,
    },
    pairHistoryRowsFromState(state),
  )
  return computeSessionFairness({
    ...state,
    current_round: Math.max(state.current_round, roundNo + 1),
    players: committed.players,
    rounds: [
      ...state.rounds,
      {
        round_no: roundNo,
        status: 'completed',
        matches: alternative.matches,
        resting: alternative.resting,
        started_at: new Date(),
        ended_at: new Date(),
      },
    ],
  }).total
}

async function runRound(
  client: SupabaseAny,
  accessToken: string,
  sessionId: string,
  courts: number,
  pvnaTolerance: number,
  roundNo: number,
  previousEndAt: number | null,
): Promise<TimingRow> {
  const roundStartedAt = now()
  const plan = await buildPlan(client, sessionId, courts, pvnaTolerance)
  const startVersion = await getLiveStateVersion(client, sessionId)
  const startResult = await invoke(
    'session-rounds-start-versioned',
    accessToken,
    sessionId,
    {
      expected_live_state_version: startVersion.version,
      round_no: plan.state.current_round,
      matches: plan.alternative.matches,
      resting: plan.alternative.resting,
      audit_payload: {
        benchmark: true,
        cloned_session: true,
        source: 'scratch/bench-cloned-round-flow.ts',
        label,
        round_no: roundNo,
        expected_state_fingerprint: buildSessionStateFingerprint(plan.state),
        courts,
        pvna_tolerance: plan.state.config.pvna_tolerance,
      },
    },
  )
  if (!startResult.ok) throw new Error(`start round ${roundNo} failed: ${startResult.error}`)

  const activeRoundNo = Number(startResult.round_no ?? plan.state.current_round)
  const endResult = await invoke(
    'session-rounds-end-versioned',
    accessToken,
    sessionId,
    {
      expected_live_state_version: Number(startResult.live_state_version),
      round_no: activeRoundNo,
      player_state: [],
      pair_history: [],
      score_after: scoreAfterCompletedRound(plan.state, plan.alternative, activeRoundNo),
      audit_payload: {
        benchmark: true,
        cloned_session: true,
        source: 'scratch/bench-cloned-round-flow.ts',
        label,
        round_no: roundNo,
      },
    },
    { round_no: activeRoundNo },
  )
  if (!endResult.ok) throw new Error(`end round ${roundNo} failed: ${endResult.error}`)

  return {
    roundNo,
    gapFromPreviousEndMs: previousEndAt === null ? null : roundStartedAt - previousEndAt,
    loadSessionStateMs: plan.timings.loadSessionStateMs,
    correctFairnessMs: plan.timings.correctFairnessMs,
    suggestNextRoundMs: plan.timings.suggestNextRoundMs,
    planMs: plan.timings.totalMs,
    getStartVersionMs: startVersion.ms,
    startRoundMs: startResult.ms,
    endRoundMs: endResult.ms,
    totalMs: now() - roundStartedAt,
    score: plan.alternative.score,
    pvnaDiff: plan.alternative.stats.pvna_diff,
    warnings: plan.alternative.warnings,
  }
}

async function main() {
  const { client, accessToken, userId } = await signInClient()
  const sourceSessionId = await latestHostSessionId(client, userId)
  const settings = await loadSettings(client, sourceSessionId)
  const clone = await cloneSession(client, sourceSessionId)
  let shouldCleanup = cleanupEnabled
  const wallStartedAt = now()

  try {
    const checkInMs = await checkInClone(client, accessToken, clone.cloneId, clone.playerIds)
    const courtSetup = calculateOptimalCourts({
      n_players: clone.playerIds.length,
      session_duration_min: settings.sessionDurationMin,
      match_duration_min: matchDurationMin,
      preset: settings.courtPreset,
    })
    const courts = courtSetup.recommended.courts
    const rows: TimingRow[] = []
    let previousEndAt: number | null = null

    for (let roundNo = 1; roundNo <= targetRounds; roundNo += 1) {
      const row = await runRound(client, accessToken, clone.cloneId, courts, settings.pvnaTolerance, roundNo, previousEndAt)
      rows.push(row)
      previousEndAt = now()
      console.log(`[${label}] round ${roundNo}/${targetRounds}: suggest=${round(row.suggestNextRoundMs)}ms start=${round(row.startRoundMs)}ms end=${round(row.endRoundMs)}ms total=${round(row.totalMs)}ms`)
    }

    if (shouldCleanup) {
      await cleanupClone(client, clone.cloneId)
      shouldCleanup = false
    }

    const output = {
      label,
      sourceSessionId,
      cloneId: clone.cloneId,
      cleanup: cleanupEnabled ? 'cancelled_and_live_rows_deleted' : 'kept',
      host: HOST_EMAIL,
      targetRounds,
      playerCount: clone.playerIds.length,
      courtSuggester: {
        courts,
        preset: settings.courtPreset,
        sessionDurationMin: settings.sessionDurationMin,
        matchDurationMin,
        pvnaTolerance: settings.pvnaTolerance,
        reasoning: courtSetup.reasoning,
      },
      checkInMs: round(checkInMs),
      wallTotalMs: round(now() - wallStartedAt),
      summary: {
        loadSessionStateMs: summarize(rows.map((row) => row.loadSessionStateMs)),
        correctFairnessMs: summarize(rows.map((row) => row.correctFairnessMs)),
        suggestNextRoundMs: summarize(rows.map((row) => row.suggestNextRoundMs)),
        planMs: summarize(rows.map((row) => row.planMs)),
        getStartVersionMs: summarize(rows.map((row) => row.getStartVersionMs)),
        startRoundMs: summarize(rows.map((row) => row.startRoundMs)),
        endRoundMs: summarize(rows.map((row) => row.endRoundMs)),
        totalMs: summarize(rows.map((row) => row.totalMs)),
        interRoundGapMs: summarize(rows.filter((row) => row.gapFromPreviousEndMs !== null).map((row) => row.gapFromPreviousEndMs!)),
      },
      rows: rows.map((row) => ({
        ...row,
        gapFromPreviousEndMs: row.gapFromPreviousEndMs === null ? null : round(row.gapFromPreviousEndMs),
        loadSessionStateMs: round(row.loadSessionStateMs),
        correctFairnessMs: round(row.correctFairnessMs),
        suggestNextRoundMs: round(row.suggestNextRoundMs),
        planMs: round(row.planMs),
        getStartVersionMs: round(row.getStartVersionMs),
        startRoundMs: round(row.startRoundMs),
        endRoundMs: round(row.endRoundMs),
        totalMs: round(row.totalMs),
        score: Number(row.score.toFixed(2)),
        pvnaDiff: Number(row.pvnaDiff.toFixed(2)),
      })),
    }

    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    if (shouldCleanup) {
      try {
        await cleanupClone(client, clone.cloneId)
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
