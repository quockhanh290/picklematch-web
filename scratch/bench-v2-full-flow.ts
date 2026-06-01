import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import {
  suggestNextRoundExperimental,
  type ExperimentalDiagnostic,
  type ExperimentalSuggestOptions,
} from '../features/host/session-detail/next-round-benchmark/experimental-suggest'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { buildSessionStateFingerprint } from '../lib/next-round-suggester/state-version'
import type { SessionState, SuggestionAlternative, SuggestionResult } from '../lib/next-round-suggester/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Args = {
  yes: boolean
  autoCheckIn: boolean
  candidateMode: NonNullable<ExperimentalSuggestOptions['mode']>
  candidateLimit: number
  perStrategyLimit: number
  courtsOverride: number | null
  courtPreset: CourtPreset
  sessionDurationMin: number
  matchDurationMin: number
  pvnaTolerance: number
  sessionId: string | null
  targetRoundsOverride: number | null
}

type RoundRecord = {
  round_no: number
  gap_from_prev_ms: number | null
  plan_ms: number
  loadSessionState_ms: number
  correctFairness_ms: number
  suggestNextRound_ms: number
  startRound_ms: number
  endRound_ms: number
  total_ms: number
  ok: boolean
  error?: string
}

type PlanResult = {
  state: SessionState
  suggestion: SuggestionResult
  alternative: SuggestionAlternative
  courtCount: number
  courtCalculator: ReturnType<typeof calculateOptimalCourts>
  diagnostics: ExperimentalDiagnostic
  timings: {
    courtCalculator: number
    loadSessionState: number
    correctForFairness: number
    suggestNextRound: number
    total: number
  }
}

type SupabaseAny = any

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

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

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const HOST_ACCESS_TOKEN = process.env.HOST_ACCESS_TOKEN

const CLIENT_OPTIONS = {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket as any },
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const getValue = (name: string) => {
    const prefix = `${name}=`
    const inline = args.find((arg) => arg.startsWith(prefix))
    if (inline) return inline.slice(prefix.length)
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }

  const preset = (getValue('--court-preset') ?? 'balanced') as CourtPreset
  if (!['relaxed', 'balanced', 'play_more'].includes(preset)) {
    throw new Error('--court-preset must be one of: relaxed, balanced, play_more')
  }
  const candidateMode = (getValue('--candidate-mode') ?? 'cached-production') as NonNullable<ExperimentalSuggestOptions['mode']>
  if (!['global', 'per-strategy', 'adaptive', 'strategy-stop', 'cached-production'].includes(candidateMode)) {
    throw new Error('--candidate-mode must be global, per-strategy, adaptive, strategy-stop, or cached-production')
  }
  const courts = getValue('--courts')

  return {
    yes: args.includes('--yes'),
    autoCheckIn: !args.includes('--no-auto-check-in'),
    candidateMode,
    candidateLimit: Math.max(1, Number(getValue('--candidate-limit') ?? '28')),
    perStrategyLimit: Math.max(1, Number(getValue('--per-strategy-limit') ?? '6')),
    courtsOverride: courts === undefined ? null : Math.max(1, Number(courts)),
    courtPreset: preset,
    sessionDurationMin: Math.max(1, Number(getValue('--session-duration-min') ?? '120')),
    matchDurationMin: Math.max(1, Number(getValue('--match-duration-min') ?? '15')),
    pvnaTolerance: Math.max(0, Number(getValue('--pvna-tolerance') ?? '0.5')),
    sessionId: getValue('--session-id') ?? null,
    targetRoundsOverride: getValue('--target-rounds') ? Math.max(1, Number(getValue('--target-rounds'))) : null,
  }
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function avg(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function fmtMs(ms: number | null) {
  if (ms === null) return '   —  '
  return `${ms.toFixed(0)}ms`.padStart(7)
}

function printPhaseTable(rows: { label: string; values: number[] }[]) {
  console.log(
    `\n  ${'Phase'.padEnd(26)} ${'avg'.padStart(7)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'max'.padStart(7)}`,
  )
  console.log(`  ${'─'.repeat(56)}`)
  for (const { label, values } of rows) {
    if (values.length === 0) continue
    console.log(
      `  ${label.padEnd(26)} ${fmtMs(avg(values))} ${fmtMs(percentile(values, 50))} ${fmtMs(percentile(values, 95))} ${fmtMs(Math.max(...values))}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getHostAuth() {
  if (HOST_ACCESS_TOKEN) {
    const client = createClient(SUPABASE_URL, ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${HOST_ACCESS_TOKEN}` } },
      auth: CLIENT_OPTIONS.auth,
      realtime: CLIENT_OPTIONS.realtime,
    })
    const { data, error } = await client.auth.getUser(HOST_ACCESS_TOKEN)
    if (error || !data.user?.id) {
      throw new Error(`Could not verify HOST_ACCESS_TOKEN: ${error?.message ?? 'missing user'}`)
    }
    return { client, accessToken: HOST_ACCESS_TOKEN, userId: data.user.id }
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY!, CLIENT_OPTIONS)
  const { data, error } = await authClient.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD!,
  })
  if (error || !data.session?.access_token) {
    throw new Error(`Could not sign in ${HOST_EMAIL}: ${error?.message ?? 'missing session'}`)
  }
  return {
    client: authClient,
    accessToken: data.session.access_token,
    userId: data.session.user.id,
  }
}

async function getHostUserId(service: SupabaseAny) {
  const { data, error } = await service.auth.admin.listUsers()
  if (error) throw error
  const user = data.users.find((item: any) => item.email?.toLowerCase() === HOST_EMAIL.toLowerCase())
  if (!user) throw new Error(`No auth user found for ${HOST_EMAIL}`)
  return user.id
}

// ---------------------------------------------------------------------------
// Session queries
// ---------------------------------------------------------------------------

async function latestSessionId(service: SupabaseAny, hostUserId: string) {
  const { data, error } = await service
    .from('sessions')
    .select('id, created_at, status')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error(`No session found for ${HOST_EMAIL}`)
  return String(data.id)
}

async function getTargetRounds(service: SupabaseAny, sessionId: string): Promise<number | null> {
  const { data, error } = await service
    .from('session_next_round_settings')
    .select('target_rounds')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.target_rounds === null || data.target_rounds === undefined) return null
  return Number(data.target_rounds)
}

async function getCompletedRoundCount(service: SupabaseAny, sessionId: string): Promise<number> {
  const { data, error } = await service
    .from('session_rounds')
    .select('round_no', { count: 'exact' })
    .eq('session_id', sessionId)
    .eq('status', 'completed')
  if (error) throw error
  return data?.length ?? 0
}

async function getActiveRound(service: SupabaseAny, sessionId: string): Promise<number | null> {
  const { data, error } = await service
    .from('session_rounds')
    .select('round_no')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data ? Number(data.round_no) : null
}

async function getPresentPlayerCount(service: SupabaseAny, sessionId: string): Promise<number> {
  const { data, error } = await service
    .from('session_player_state')
    .select('player_id')
    .eq('session_id', sessionId)
    .is('checked_out_at', null)
  if (error) throw error
  return data?.length ?? 0
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

async function loadCheckInCandidatePlayerIds(service: SupabaseAny, sessionId: string) {
  const { data, error } = await service
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)
  if (error) throw error
  return [...new Set(
    (data ?? [])
      .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
      .map((row: any) => String(row.player_id)),
  )]
}

async function autoCheckInRoster(
  service: SupabaseAny,
  accessToken: string,
  sessionId: string,
): Promise<{ playerIds: string[]; ms: number }> {
  const playerIds = await loadCheckInCandidatePlayerIds(service, sessionId)
  if (playerIds.length < 4) {
    throw new Error(`Cannot auto check-in: only ${playerIds.length} confirmed players in session_players`)
  }

  const { error } = await service
    .from('session_players')
    .update({ check_in_status: 'present' })
    .eq('session_id', sessionId)
    .in('player_id', playerIds)
  if (error) throw error

  const result = await invoke('session-sync-roster', accessToken, sessionId, {
    player_ids: playerIds,
    revive_checked_out: true,
  })
  if (!result.ok) {
    throw new Error(`Auto check-in failed: ${result.error ?? result.status}`)
  }
  return { playerIds, ms: result.ms }
}

// ---------------------------------------------------------------------------
// Edge function invocation
// ---------------------------------------------------------------------------

async function invoke(
  functionName: string,
  accessToken: string,
  sessionId: string,
  body: Record<string, unknown>,
  query: Record<string, string | number> = {},
): Promise<{ ok: boolean; ms: number; status: number; error?: string; round_no?: number }> {
  const params = new URLSearchParams({ session_id: sessionId })
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  const url = `${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`
  const startedAt = performance.now()
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
    const ms = performance.now() - startedAt
    if (!response.ok || payload?.ok === false) {
      return { ok: false, ms, status, error: payload?.error ?? text }
    }
    return { ok: true, ms, status, round_no: payload?.round?.round_no }
  } catch (error) {
    return {
      ok: false,
      ms: performance.now() - startedAt,
      status,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ---------------------------------------------------------------------------
// Plan (local CPU + DB read)
// ---------------------------------------------------------------------------

function getCourtCount(args: Args, presentCount: number) {
  const startedAt = performance.now()
  const courtCalculator = calculateOptimalCourts({
    n_players: presentCount,
    session_duration_min: args.sessionDurationMin,
    match_duration_min: args.matchDurationMin,
    preset: args.courtPreset,
  })
  const courtCount = args.courtsOverride ?? courtCalculator.recommended.courts
  return { courtCount, courtCalculator, ms: performance.now() - startedAt }
}

async function buildPlan(
  service: SupabaseAny,
  sessionId: string,
  args: Args,
  presentCount: number,
): Promise<PlanResult> {
  const totalT0 = performance.now()
  const courtSetup = getCourtCount(args, presentCount)

  const loadT0 = performance.now()
  const state = await loadSessionState(service as any, sessionId, {
    courts: courtSetup.courtCount,
    pvnaTolerance: args.pvnaTolerance,
  })
  const loadSessionState_ms = performance.now() - loadT0

  const fairnessT0 = performance.now()
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const correctForFairness_ms = performance.now() - fairnessT0

  const suggestT0 = performance.now()
  const suggestion = suggestNextRoundExperimental(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
    mode: args.candidateMode,
    candidateLimit: args.candidateLimit,
    perStrategyLimit: args.perStrategyLimit,
  })
  const suggestNextRound_ms = performance.now() - suggestT0

  const alternative = suggestion.alternatives[0]
  if (!alternative) {
    throw new Error(`No suggestion available. warnings=${suggestion.warnings.join(',')}`)
  }

  return {
    state,
    suggestion,
    alternative,
    courtCount: courtSetup.courtCount,
    courtCalculator: courtSetup.courtCalculator,
    diagnostics: suggestion.diagnostic,
    timings: {
      courtCalculator: courtSetup.ms,
      loadSessionState: loadSessionState_ms,
      correctForFairness: correctForFairness_ms,
      suggestNextRound: suggestNextRound_ms,
      total: performance.now() - totalT0,
    },
  }
}

// ---------------------------------------------------------------------------
// Main benchmark loop
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs()

  if (!ANON_KEY) throw new Error('Missing: SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (!HOST_ACCESS_TOKEN && !HOST_PASSWORD) throw new Error('Missing: HOST_PASSWORD or HOST_ACCESS_TOKEN')

  if (!args.yes) {
    throw new Error(
      'This benchmark writes real rounds to the live session. Re-run with --yes to confirm.',
    )
  }

  const hostAuth = await getHostAuth()
  const readClient = SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTIONS)
    : hostAuth.client
  const hostUserId = SERVICE_ROLE_KEY ? await getHostUserId(readClient) : hostAuth.userId
  const sessionId = args.sessionId ?? (await latestSessionId(readClient, hostUserId))

  const dbTargetRounds = await getTargetRounds(readClient, sessionId)
  const targetRounds = args.targetRoundsOverride ?? dbTargetRounds
  if (targetRounds === null) {
    throw new Error(
      `Session ${sessionId} has no target_rounds set.\n` +
        'Either set a target in the app, or pass --target-rounds N to the benchmark.',
    )
  }

  let completedRounds = await getCompletedRoundCount(readClient, sessionId)
  const startingRound = completedRounds + 1
  const roundsToRun = targetRounds - completedRounds

  if (roundsToRun <= 0) {
    console.log(`Session already has ${completedRounds} completed rounds — target of ${targetRounds} reached. Nothing to do.`)
    return
  }

  // Cancel any lingering active round before we start
  const activeRound = await getActiveRound(readClient, sessionId)
  if (activeRound !== null) {
    console.log(`⚠  Active round ${activeRound} detected — ending it before benchmark starts...`)
    const endResult = await invoke(
      'session-rounds-end',
      hostAuth.accessToken,
      sessionId,
      {},
      { round_no: activeRound },
    )
    if (!endResult.ok) {
      throw new Error(`Could not end active round ${activeRound}: ${endResult.error}`)
    }
    completedRounds += 1
  }

  // Check-in — this is T0
  const wallT0 = performance.now()
  let checkInMs: number | null = null

  if (args.autoCheckIn) {
    const presentCount = await getPresentPlayerCount(readClient, sessionId)
    if (presentCount < 4) {
      const synced = await autoCheckInRoster(readClient, hostAuth.accessToken, sessionId)
      checkInMs = synced.ms
      console.log(`check-in: ${synced.playerIds.length} players synced in ${synced.ms.toFixed(0)}ms`)
    } else {
      console.log(`check-in: skipped — ${presentCount} players already present`)
    }
  }

  const presentCount = await getPresentPlayerCount(readClient, sessionId)
  const courtSetup = getCourtCount(args, presentCount)

  console.log('\n=== V2 Full-Flow Benchmark ===')
  console.log({
    session: sessionId,
    host: HOST_EMAIL,
    target_rounds: targetRounds,
    starting_round: startingRound,
    rounds_to_run: roundsToRun,
    present_players: presentCount,
    courts: courtSetup.courtCount,
    courtsOverride: args.courtsOverride,
    courtPreset: args.courtPreset,
    candidateMode: args.candidateMode,
    pvnaTolerance: args.pvnaTolerance,
  })
  console.log('')

  const records: RoundRecord[] = []
  let prevEndAt: number | null = null

  for (let roundNo = completedRounds + 1; roundNo <= targetRounds; roundNo++) {
    const roundT0 = performance.now()
    const gap_from_prev_ms = prevEndAt !== null ? roundT0 - prevEndAt : null

    process.stdout.write(`  Round ${roundNo}/${targetRounds}  plan...`)

    let plan: PlanResult
    try {
      plan = await buildPlan(readClient, sessionId, args, presentCount)
    } catch (err) {
      const record: RoundRecord = {
        round_no: roundNo,
        gap_from_prev_ms,
        plan_ms: performance.now() - roundT0,
        loadSessionState_ms: 0,
        correctFairness_ms: 0,
        suggestNextRound_ms: 0,
        startRound_ms: 0,
        endRound_ms: 0,
        total_ms: performance.now() - roundT0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      records.push(record)
      console.log(` FAIL: ${record.error}`)
      break
    }

    process.stdout.write(` ${plan.timings.total.toFixed(0)}ms  start...`)

    const startResult = await invoke(
      'session-rounds-start',
      hostAuth.accessToken,
      sessionId,
      {
        suggestion_idx: 0,
        manual: plan.alternative.matches,
        decision_mode: 'host_selected_alternative',
        expected_state_fingerprint: buildSessionStateFingerprint(plan.state),
        courts: plan.state.config.courts,
        pvna_tolerance: plan.state.config.pvna_tolerance,
        decision_context: { benchmark: true, source: 'scratch/bench-v2-full-flow.ts' },
      },
    )

    if (!startResult.ok) {
      const record: RoundRecord = {
        round_no: roundNo,
        gap_from_prev_ms,
        plan_ms: plan.timings.total,
        loadSessionState_ms: plan.timings.loadSessionState,
        correctFairness_ms: plan.timings.correctForFairness,
        suggestNextRound_ms: plan.timings.suggestNextRound,
        startRound_ms: startResult.ms,
        endRound_ms: 0,
        total_ms: performance.now() - roundT0,
        ok: false,
        error: `startRound: ${startResult.error} (HTTP ${startResult.status})`,
      }
      records.push(record)
      console.log(` FAIL: ${record.error}`)
      break
    }

    process.stdout.write(` ${startResult.ms.toFixed(0)}ms  end...`)

    // Use the round_no returned by session-rounds-start (source of truth)
    const activeRoundNo = startResult.round_no ?? (await getActiveRound(readClient, sessionId))
    if (activeRoundNo === null) {
      const record: RoundRecord = {
        round_no: roundNo,
        gap_from_prev_ms,
        plan_ms: plan.timings.total,
        loadSessionState_ms: plan.timings.loadSessionState,
        correctFairness_ms: plan.timings.correctForFairness,
        suggestNextRound_ms: plan.timings.suggestNextRound,
        startRound_ms: startResult.ms,
        endRound_ms: 0,
        total_ms: performance.now() - roundT0,
        ok: false,
        error: 'Could not determine active round_no after startRound',
      }
      records.push(record)
      console.log(` FAIL: ${record.error}`)
      break
    }

    const endResult = await invoke(
      'session-rounds-end',
      hostAuth.accessToken,
      sessionId,
      {},
      { round_no: activeRoundNo },
    )

    const total_ms = performance.now() - roundT0
    prevEndAt = performance.now()

    const record: RoundRecord = {
      round_no: roundNo,
      gap_from_prev_ms,
      plan_ms: plan.timings.total,
      loadSessionState_ms: plan.timings.loadSessionState,
      correctFairness_ms: plan.timings.correctForFairness,
      suggestNextRound_ms: plan.timings.suggestNextRound,
      startRound_ms: startResult.ms,
      endRound_ms: endResult.ms,
      total_ms,
      ok: endResult.ok,
      error: endResult.ok ? undefined : `endRound: ${endResult.error} (HTTP ${endResult.status})`,
    }
    records.push(record)

    if (!endResult.ok) {
      console.log(` FAIL: ${record.error}`)
      break
    }

    const gapStr = gap_from_prev_ms !== null ? `  gap=${gap_from_prev_ms.toFixed(0)}ms` : ''
    console.log(` ${endResult.ms.toFixed(0)}ms  total=${total_ms.toFixed(0)}ms${gapStr}`)
  }

  const wallTotal_ms = performance.now() - wallT0
  const okRecords = records.filter((r) => r.ok)
  const failedRecords = records.filter((r) => !r.ok)

  // Phase arrays for stats
  const loadStateVals = okRecords.map((r) => r.loadSessionState_ms)
  const fairnessVals = okRecords.map((r) => r.correctFairness_ms)
  const suggestVals = okRecords.map((r) => r.suggestNextRound_ms)
  const planVals = okRecords.map((r) => r.plan_ms)
  const startVals = okRecords.map((r) => r.startRound_ms)
  const endVals = okRecords.map((r) => r.endRound_ms)
  const totalVals = okRecords.map((r) => r.total_ms)
  const gapVals = okRecords.filter((r) => r.gap_from_prev_ms !== null).map((r) => r.gap_from_prev_ms!)

  console.log(`\n─────────────────────────────────────────────────────────────`)
  console.log(`  host:           ${HOST_EMAIL}`)
  console.log(`  session:        ${sessionId}`)
  console.log(`  target_rounds:  ${targetRounds}`)
  const firstRound = records[0]?.round_no ?? startingRound
  const lastRound = records[records.length - 1]?.round_no ?? startingRound
  console.log(`  rounds_run:     ${okRecords.length}/${roundsToRun} (round ${firstRound}–${lastRound})`)
  if (checkInMs !== null) console.log(`  check-in:       ${checkInMs.toFixed(0)}ms`)
  if (failedRecords.length > 0) {
    console.log(`  FAILURES:       ${failedRecords.length}`)
    for (const r of failedRecords) console.log(`    round ${r.round_no}: ${r.error}`)
  }

  printPhaseTable([
    { label: 'loadSessionState (DB)', values: loadStateVals },
    { label: 'correctFairness', values: fairnessVals },
    { label: 'suggestNextRound', values: suggestVals },
    { label: 'plan (total)', values: planVals },
    { label: 'startRound edge fn', values: startVals },
    { label: 'endRound edge fn', values: endVals },
    { label: 'round cycle (total)', values: totalVals },
    { label: 'inter-round gap ←', values: gapVals },
  ])

  console.log(`\n  TOTAL wall-clock: ${wallTotal_ms.toFixed(0)}ms  (check-in → last round end)`)

  if (records.length > 1) {
    console.log('\n  Per-round breakdown:')
    for (const r of records) {
      const gapStr = r.gap_from_prev_ms !== null ? `  gap=${r.gap_from_prev_ms.toFixed(0)}ms` : ''
      const status = r.ok ? '' : '  FAIL'
      console.log(
        `    Round ${String(r.round_no).padStart(2)}: plan=${r.plan_ms.toFixed(0)}ms  start=${r.startRound_ms.toFixed(0)}ms  end=${r.endRound_ms.toFixed(0)}ms  total=${r.total_ms.toFixed(0)}ms${gapStr}${status}`,
      )
    }
  }

  console.log('\n  Tip: correlate with Supabase logs by searching:')
  console.log('    [session-rounds-start] timing')
  console.log('    [session-rounds-end] timing')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
