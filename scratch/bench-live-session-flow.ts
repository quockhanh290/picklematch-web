import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { buildSessionStateFingerprint } from '../lib/next-round-suggester/state-version'
import { suggestNextRound, type SuggestionDiagnostic } from '../lib/next-round-suggester/suggest'
import type { SessionState, SuggestionAlternative, SuggestionResult } from '../lib/next-round-suggester/types'

type Mode = 'status' | 'plan' | 'start' | 'end' | 'cycle'

type Args = {
  mode: Mode
  yes: boolean
  autoCheckIn: boolean
  iterations: number
  delayMs: number
  courtsOverride: number | null
  courtPreset: CourtPreset
  sessionDurationMin: number
  matchDurationMin: number
  pvnaTolerance: number
  sessionId: string | null
}

type SessionStatus = {
  registered: number
  players: number
  present: number
  eligible: number
  rounds: number
  activeRound: number | null
  pairs: number
}

type Measurement = {
  name: string
  ok: boolean
  ms: number
  status?: number
  error?: string
  round_no?: number
}

type PlanResult = {
  state: SessionState
  suggestion: SuggestionResult
  alternative: SuggestionAlternative
  courtCount: number
  timings: {
    courtCalculator: number
    loadSessionState: number
    correctForFairness: number
    suggestNextRound: number
    total: number
  }
  courtCalculator: ReturnType<typeof calculateOptimalCourts>
  diagnostics: SuggestionDiagnostic
}

type SupabaseAny = any

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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const HOST_ACCESS_TOKEN = process.env.HOST_ACCESS_TOKEN

const CLIENT_OPTIONS = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: WebSocket as any,
  },
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const getValue = (name: string) => {
    const prefix = `${name}=`
    const inline = args.find((arg) => arg.startsWith(prefix))
    if (inline) return inline.slice(prefix.length)
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }

  const mode = (getValue('--mode') ?? 'status') as Mode
  if (!['status', 'plan', 'start', 'end', 'cycle'].includes(mode)) {
    throw new Error('--mode must be one of: status, plan, start, end, cycle')
  }
  const preset = (getValue('--court-preset') ?? 'balanced') as CourtPreset
  if (!['relaxed', 'balanced', 'play_more'].includes(preset)) {
    throw new Error('--court-preset must be one of: relaxed, balanced, play_more')
  }
  const courts = getValue('--courts')

  return {
    mode,
    yes: args.includes('--yes'),
    autoCheckIn: !args.includes('--no-auto-check-in'),
    iterations: Math.max(1, Number(getValue('--iterations') ?? '1')),
    delayMs: Math.max(0, Number(getValue('--delay-ms') ?? '600')),
    courtsOverride: courts === undefined ? null : Math.max(1, Number(courts)),
    courtPreset: preset,
    sessionDurationMin: Math.max(1, Number(getValue('--session-duration-min') ?? '120')),
    matchDurationMin: Math.max(1, Number(getValue('--match-duration-min') ?? '15')),
    pvnaTolerance: Math.max(0, Number(getValue('--pvna-tolerance') ?? '0.5')),
    sessionId: getValue('--session-id') ?? null,
  }
}

function requireEnv(mode: Mode) {
  const missing: string[] = []
  if (!ANON_KEY) missing.push('SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (!SERVICE_ROLE_KEY && !HOST_ACCESS_TOKEN && !HOST_PASSWORD) missing.push('HOST_PASSWORD or HOST_ACCESS_TOKEN')
  if ((mode === 'start' || mode === 'end' || mode === 'cycle') && !HOST_ACCESS_TOKEN && !HOST_PASSWORD) missing.push('HOST_PASSWORD or HOST_ACCESS_TOKEN')
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(', ')}`)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function printSummary(title: string, rows: Measurement[]) {
  const okRows = rows.filter((row) => row.ok)
  const failed = rows.filter((row) => !row.ok)
  const values = okRows.map((row) => row.ms)

  console.log(`\n${title}`)
  console.log(`  count=${rows.length} ok=${okRows.length} failed=${failed.length}`)
  if (values.length > 0) {
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length
    console.log(`  min=${Math.min(...values).toFixed(0)}ms p50=${percentile(values, 50).toFixed(0)}ms p95=${percentile(values, 95).toFixed(0)}ms max=${Math.max(...values).toFixed(0)}ms avg=${avg.toFixed(0)}ms`)
  }
  for (const row of failed) {
    console.log(`  FAIL ${row.name} ${row.ms.toFixed(0)}ms ${row.error ?? ''}`)
  }
}

async function getAccessToken() {
  return (await getHostAuth()).accessToken
}

async function getHostAuth() {
  if (HOST_ACCESS_TOKEN) {
    const client = createClient(SUPABASE_URL, ANON_KEY!, {
      global: {
        headers: {
          Authorization: `Bearer ${HOST_ACCESS_TOKEN}`,
        },
      },
      auth: CLIENT_OPTIONS.auth,
      realtime: CLIENT_OPTIONS.realtime,
    })
    const { data, error } = await client.auth.getUser(HOST_ACCESS_TOKEN)
    if (error || !data.user?.id) {
      throw new Error(`Could not verify HOST_ACCESS_TOKEN: ${error?.message ?? 'missing user'}`)
    }
    return {
      client,
      accessToken: HOST_ACCESS_TOKEN,
      userId: data.user.id,
    }
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

async function latestSessionId(service: SupabaseAny, hostUserId: string) {
  const { data, error } = await service
    .from('sessions')
    .select('id, created_at, status')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const session = data as any
  if (!session?.id) throw new Error(`No session found for ${HOST_EMAIL}`)
  return String(session.id)
}

async function latestPlayableSessionId(service: SupabaseAny, hostUserId: string) {
  const { data, error } = await service
    .from('sessions')
    .select('id, created_at, status')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error

  for (const session of data ?? []) {
    const ids = await loadSyncablePlayerIds(service, String((session as any).id))
    if (ids.length >= 4) return String((session as any).id)
  }

  throw new Error(`No session with at least 4 syncable players found for ${HOST_EMAIL}`)
}

async function getHostUserId(service: SupabaseAny) {
  const { data, error } = await service.auth.admin.listUsers()
  if (error) throw error
  const user = data.users.find((item) => item.email?.toLowerCase() === HOST_EMAIL.toLowerCase())
  if (!user) throw new Error(`No auth user found for ${HOST_EMAIL}`)
  return user.id
}

async function getActiveRound(service: SupabaseAny, sessionId: string) {
  const { data, error } = await service
    .from('session_rounds')
    .select('round_no, status')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data ? Number((data as any).round_no) : null
}

async function getSessionStatus(service: SupabaseAny, sessionId: string): Promise<SessionStatus> {
  const [registeredResult, playersResult, roundsResult, pairsResult] = await Promise.all([
    service.from('session_players').select('player_id, status, check_in_status').eq('session_id', sessionId),
    service.from('session_player_state').select('player_id, checked_out_at, opted_rest').eq('session_id', sessionId),
    service.from('session_rounds').select('round_no, status').eq('session_id', sessionId).order('round_no', { ascending: true }),
    service.from('session_pair_history').select('player_a').eq('session_id', sessionId),
  ])
  if (registeredResult.error) throw registeredResult.error
  if (playersResult.error) throw playersResult.error
  if (roundsResult.error) throw roundsResult.error
  if (pairsResult.error) throw pairsResult.error

  const registered = registeredResult.data
  const players = playersResult.data
  const rounds = roundsResult.data
  const pairs = pairsResult.data
  const active = (rounds ?? []).find((row: any) => row.status === 'active')
  return {
    registered: registered?.length ?? 0,
    players: players?.length ?? 0,
    present: (players ?? []).filter((row: any) => !row.checked_out_at).length,
    eligible: (players ?? []).filter((row: any) => !row.checked_out_at && !row.opted_rest).length,
    rounds: rounds?.length ?? 0,
    activeRound: active ? Number((active as any).round_no) : null,
    pairs: pairs?.length ?? 0,
  }
}

async function loadSyncablePlayerIds(service: SupabaseAny, sessionId: string) {
  const { data, error } = await service
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)
  if (error) throw error

  const confirmedRows = (data ?? []).filter((row: any) => row.status === 'confirmed' || row.status == null)
  const presentIds = confirmedRows
    .filter((row: any) => row.check_in_status === 'present' || row.check_in_status === 'checked_in')
    .map((row: any) => String(row.player_id))
  const activeIds = confirmedRows
    .filter((row: any) => row.check_in_status !== 'no_show' && row.check_in_status !== 'pending')
    .map((row: any) => String(row.player_id))
  const preferredIds = presentIds.length > 0 ? presentIds : activeIds

  return [...new Set(preferredIds)]
}

async function loadCheckInCandidatePlayerIds(service: SupabaseAny, sessionId: string) {
  const { data, error } = await service
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)
  if (error) throw error

  return [...new Set((data ?? [])
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
}

async function autoCheckInRoster(service: SupabaseAny, accessToken: string, sessionId: string) {
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
  return {
    playerIds,
    ms: result.ms,
  }
}

function getCourtCount(args: Args, status: SessionStatus) {
  const startedAt = performance.now()
  const courtCalculator = calculateOptimalCourts({
    n_players: status.present,
    session_duration_min: args.sessionDurationMin,
    match_duration_min: args.matchDurationMin,
    preset: args.courtPreset,
  })
  const courtCount = args.courtsOverride ?? courtCalculator.recommended.courts
  return {
    courtCount,
    courtCalculator,
    ms: performance.now() - startedAt,
  }
}

async function invoke(functionName: string, accessToken: string, sessionId: string, body: Record<string, unknown>, query: Record<string, string | number> = {}): Promise<Measurement> {
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
      return { name: functionName, ok: false, ms, status, error: payload?.error ?? text }
    }
    return { name: functionName, ok: true, ms, status, round_no: payload?.round?.round_no }
  } catch (error) {
    return {
      name: functionName,
      ok: false,
      ms: performance.now() - startedAt,
      status,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function buildPlan(service: SupabaseAny, sessionId: string, args: Args, status: SessionStatus): Promise<PlanResult> {
  const totalStartedAt = performance.now()
  const courtSetup = getCourtCount(args, status)

  const loadStartedAt = performance.now()
  const state = await loadSessionState(service as any, sessionId, {
    courts: courtSetup.courtCount,
    pvnaTolerance: args.pvnaTolerance,
  })
  const loadSessionStateMs = performance.now() - loadStartedAt

  const fairnessStartedAt = performance.now()
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const correctForFairnessMs = performance.now() - fairnessStartedAt

  const suggestStartedAt = performance.now()
  const diagnostics: SuggestionDiagnostic = {
    strategies: {},
    partition_count: 0,
    max_iterations: 0,
    exhaustive: false,
  }
  const suggestion = suggestNextRound(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
    diagnostics,
  })
  const suggestNextRoundMs = performance.now() - suggestStartedAt

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
    diagnostics,
    timings: {
      courtCalculator: courtSetup.ms,
      loadSessionState: loadSessionStateMs,
      correctForFairness: correctForFairnessMs,
      suggestNextRound: suggestNextRoundMs,
      total: performance.now() - totalStartedAt,
    },
  }
}

function printPlan(result: PlanResult) {
  console.log('  court calculator', {
    recommendedCourts: result.courtCalculator.recommended.courts,
    usedCourts: result.courtCount,
    reasoning: result.courtCalculator.reasoning,
  })
  console.log('  engine timings', {
    courtCalculator: `${result.timings.courtCalculator.toFixed(1)}ms`,
    loadSessionState: `${result.timings.loadSessionState.toFixed(1)}ms`,
    correctForFairness: `${result.timings.correctForFairness.toFixed(1)}ms`,
    suggestNextRound: `${result.timings.suggestNextRound.toFixed(1)}ms`,
    total: `${result.timings.total.toFixed(1)}ms`,
    alternatives: result.suggestion.alternatives.length,
    matches: result.alternative.matches.length,
    resting: result.alternative.resting.length,
  })
  console.log('  engine diagnostics', {
    partitionCount: result.diagnostics.partition_count,
    maxIterationsPerPartition: result.diagnostics.max_iterations,
    exhaustive: result.diagnostics.exhaustive,
    strategies: result.diagnostics.strategies,
  })
}

async function startRound(service: SupabaseAny, accessToken: string, sessionId: string, args: Args, status: SessionStatus) {
  const plan = await buildPlan(service, sessionId, args, status)
  printPlan(plan)

  return invoke('session-rounds-start', accessToken, sessionId, {
    suggestion_idx: 0,
    manual: plan.alternative.matches,
    decision_mode: 'host_selected_alternative',
    expected_state_fingerprint: buildSessionStateFingerprint(plan.state),
    courts: plan.state.config.courts,
    pvna_tolerance: plan.state.config.pvna_tolerance,
    decision_context: {
      benchmark: true,
      source: 'scratch/bench-live-session-flow.ts',
    },
  })
}

async function endRound(service: SupabaseAny, accessToken: string, sessionId: string) {
  const activeRound = await getActiveRound(service, sessionId)
  if (activeRound === null) throw new Error('No active round to end')
  return invoke('session-rounds-end', accessToken, sessionId, {}, { round_no: activeRound })
}

async function main() {
  const args = parseArgs()
  requireEnv(args.mode)

  if ((args.mode === 'start' || args.mode === 'end' || args.mode === 'cycle') && !args.yes) {
    throw new Error('This benchmark mutates live session data. Re-run with --yes to confirm.')
  }

  const hostAuth = await getHostAuth()
  const readClient = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTIONS) : hostAuth.client
  const hostUserId = SERVICE_ROLE_KEY ? await getHostUserId(readClient) : hostAuth.userId
  let sessionId = args.sessionId ?? await latestSessionId(readClient, hostUserId)
  let status = await getSessionStatus(readClient, sessionId)
  if (!args.sessionId && status.registered < 4 && status.players < 4 && args.mode !== 'status') {
    sessionId = await latestPlayableSessionId(readClient, hostUserId)
    status = await getSessionStatus(readClient, sessionId)
  }
  if (args.autoCheckIn && args.mode !== 'status' && status.eligible < 4) {
    const synced = await autoCheckInRoster(readClient, hostAuth.accessToken, sessionId)
    status = await getSessionStatus(readClient, sessionId)
    console.log('auto check-in', {
      players: synced.playerIds.length,
      ms: `${synced.ms.toFixed(0)}ms`,
    })
  }
  const courtSetup = getCourtCount(args, status)

  console.log('Live session benchmark')
  console.log({
    mode: args.mode,
    iterations: args.iterations,
    autoCheckIn: args.autoCheckIn,
    courts: courtSetup.courtCount,
    courtsOverride: args.courtsOverride,
    courtPreset: args.courtPreset,
    sessionDurationMin: args.sessionDurationMin,
    matchDurationMin: args.matchDurationMin,
    pvnaTolerance: args.pvnaTolerance,
    sessionId,
    host: HOST_EMAIL,
    status,
    courtCalculator: {
      recommendedCourts: courtSetup.courtCalculator.recommended.courts,
      reasoning: courtSetup.courtCalculator.reasoning,
    },
  })

  if (args.mode === 'status') return

  if (args.mode === 'plan') {
    for (let index = 0; index < args.iterations; index += 1) {
      console.log(`\niteration ${index + 1}/${args.iterations}`)
      printPlan(await buildPlan(readClient, sessionId, args, status))
      await sleep(args.delayMs)
    }
    return
  }

  const accessToken = hostAuth.accessToken
  const startRows: Measurement[] = []
  const endRows: Measurement[] = []

  for (let index = 0; index < args.iterations; index += 1) {
    console.log(`\niteration ${index + 1}/${args.iterations}`)

    if (args.mode === 'start' || args.mode === 'cycle') {
      const active = await getActiveRound(readClient, sessionId)
      if (active !== null) throw new Error(`Cannot start: round ${active} is active`)
      const currentStatus = await getSessionStatus(readClient, sessionId)
      const result = await startRound(readClient, accessToken, sessionId, args, currentStatus)
      startRows.push(result)
      console.log(`  start ${result.ok ? 'ok' : 'fail'} ${result.ms.toFixed(0)}ms status=${result.status ?? ''} round=${result.round_no ?? ''} ${result.error ?? ''}`)
      if (!result.ok) break
      await sleep(args.delayMs)
    }

    if (args.mode === 'end' || args.mode === 'cycle') {
      const result = await endRound(readClient, accessToken, sessionId)
      endRows.push(result)
      console.log(`  end   ${result.ok ? 'ok' : 'fail'} ${result.ms.toFixed(0)}ms status=${result.status ?? ''} round=${result.round_no ?? ''} ${result.error ?? ''}`)
      if (!result.ok) break
      await sleep(args.delayMs)
    }
  }

  if (startRows.length > 0) printSummary('start summary', startRows)
  if (endRows.length > 0) printSummary('end summary', endRows)

  console.log('\nTip: correlate with Supabase logs by searching:')
  console.log('  [session-rounds-start] requireHost detail')
  console.log('  [session-rounds-start] timing')
  console.log('  [session-rounds-end] requireHost detail')
  console.log('  [session-rounds-end] timing')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
