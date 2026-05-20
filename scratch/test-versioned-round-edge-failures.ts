import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'

type Args = {
  yes: boolean
  sessionId: string
  courts: number
}

type SupabaseAny = any

type TestResult = {
  name: string
  ok: boolean
  detail: string
}

type Plan = Awaited<ReturnType<typeof buildPlan>>

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
  const sessionId = getValue('--session-id')
  if (!sessionId) throw new Error('Missing --session-id')
  return {
    yes: args.includes('--yes'),
    sessionId,
    courts: Math.max(1, Number(getValue('--courts') ?? '6')),
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '')
}

async function expectFailure(name: string, fn: () => Promise<unknown>, expected: RegExp): Promise<TestResult> {
  try {
    await fn()
    return { name, ok: false, detail: 'unexpected success' }
  } catch (error) {
    const message = messageOf(error)
    return {
      name,
      ok: expected.test(message),
      detail: message,
    }
  }
}

async function expectSuccess(name: string, fn: () => Promise<unknown>): Promise<TestResult> {
  try {
    const startedAt = now()
    await fn()
    return { name, ok: true, detail: `${(now() - startedAt).toFixed(0)}ms` }
  } catch (error) {
    return { name, ok: false, detail: messageOf(error) }
  }
}

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (HOST_ACCESS_TOKEN) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      ...CLIENT_OPTIONS,
      global: {
        headers: {
          Authorization: `Bearer ${HOST_ACCESS_TOKEN}`,
        },
      },
    })
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTIONS)
  const { error } = await client.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
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

async function getNonHostOrAnonymousToken() {
  const client = createClient(SUPABASE_URL, ANON_KEY!, CLIENT_OPTIONS)
  const email = `versioned-non-host-${Date.now()}@test.com`
  const { data } = await client.auth.signUp({
    email,
    password: '123456',
  })
  return {
    token: data.session?.access_token ?? ANON_KEY!,
    label: data.session?.access_token ? `non-host ${email}` : 'anonymous fallback',
  }
}

async function invokeFunction(
  functionName: string,
  accessToken: string,
  sessionId: string,
  body: Record<string, unknown>,
  query: Record<string, string | number> = {},
) {
  const params = new URLSearchParams({ session_id: sessionId })
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`, {
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
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? text)
  }
  return payload
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', {
    p_session_id: sessionId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Missing version guard row')
  return {
    liveStateVersion: Number(row.live_state_version),
    currentRound: Number(row.current_round),
    activeRoundNo: row.active_round_no == null ? null : Number(row.active_round_no),
  }
}

function changedPairHistoryRows(
  beforeRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
  afterRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
) {
  const beforeByKey = new Map(beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]))
  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before || before.partner_count !== row.partner_count || before.opponent_count !== row.opponent_count
  })
}

async function getStatus(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_rounds')
    .select('round_no, status')
    .eq('session_id', sessionId)
    .order('round_no', { ascending: true })
  if (error) throw error
  const active = (data ?? []).find((round: any) => round.status === 'active')
  return {
    rounds: data?.length ?? 0,
    activeRound: active ? Number((active as any).round_no) : null,
  }
}

async function buildPlan(client: SupabaseAny, sessionId: string, courts: number) {
  const state = await loadSessionState(client, sessionId, { courts })
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const suggestion = suggestNextRoundExperimental(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
    mode: 'global',
    candidateLimit: 28,
  })
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available. warnings=${suggestion.warnings.join(',')}`)

  calculateOptimalCourts({
    n_players: [...state.players.values()].filter((player) => !player.checked_out_at).length,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  })

  return {
    state,
    alternative,
  }
}

async function startVersioned(accessToken: string, sessionId: string, guard: Awaited<ReturnType<typeof getVersionGuard>>, plan: Plan) {
  return invokeFunction('session-rounds-start-versioned', accessToken, sessionId, {
    expected_live_state_version: guard.liveStateVersion,
    round_no: guard.currentRound,
    matches: plan.alternative.matches,
    resting: plan.alternative.resting,
    audit_payload: {
      benchmark: true,
      source: 'scratch/test-versioned-round-edge-failures.ts',
    },
  })
}

async function endVersioned(
  client: SupabaseAny,
  accessToken: string,
  sessionId: string,
  roundNo: number,
  expectedVersion: number,
  courts: number,
) {
  const state = await loadSessionState(client, sessionId, { courts })
  const round = state.rounds.find((item) => item.round_no === roundNo && item.status === 'active')
  if (!round) throw new Error(`Active round ${roundNo} not found`)
  const existingPairs = pairHistoryRowsFromState(state)
  const committed = commitCompletedRound(
    state,
    {
      round_no: round.round_no,
      matches: round.matches,
      resting: round.resting,
    },
    existingPairs,
  )
  const playerStatePayload = [...committed.players.values()].map((player) => ({
    player_id: player.player_id,
    matches_played: player.matches_played,
    last_played_round: player.last_played_round,
    consecutive_rest: player.consecutive_rest,
    consecutive_play: player.consecutive_play,
    opted_rest: player.opted_rest,
  }))
  const pairHistoryPayload = changedPairHistoryRows(existingPairs, committed.pairHistory).map((row) => ({
    player_a: row.player_a,
    player_b: row.player_b,
    partner_count: row.partner_count,
    opponent_count: row.opponent_count,
  }))
  const scoreAfter = computeSessionFairness({
    ...state,
    current_round: Math.max(state.current_round, roundNo + 1),
    players: committed.players,
    rounds: state.rounds.map((item) =>
      item.round_no === roundNo
        ? {
            ...item,
            status: 'completed',
            ended_at: new Date(),
          }
        : item,
    ),
  }).total

  return invokeFunction('session-rounds-end-versioned', accessToken, sessionId, {
    expected_live_state_version: expectedVersion,
    round_no: roundNo,
    player_state: playerStatePayload,
    pair_history: pairHistoryPayload,
    score_after: scoreAfter,
    audit_payload: {
      benchmark: true,
      source: 'scratch/test-versioned-round-edge-failures.ts',
    },
  }, { round_no: roundNo })
}

async function startAndEndClean(client: SupabaseAny, accessToken: string, args: Args) {
  const plan = await buildPlan(client, args.sessionId, args.courts)
  const guard = await getVersionGuard(client, args.sessionId)
  const start = await startVersioned(accessToken, args.sessionId, guard, plan)
  const roundNo = Number(start.round.round_no)
  await endVersioned(client, accessToken, args.sessionId, roundNo, Number(start.live_state_version), args.courts)
  return roundNo
}

async function startOnly(client: SupabaseAny, accessToken: string, args: Args) {
  const plan = await buildPlan(client, args.sessionId, args.courts)
  const guard = await getVersionGuard(client, args.sessionId)
  const start = await startVersioned(accessToken, args.sessionId, guard, plan)
  return {
    plan,
    guard,
    roundNo: Number(start.round.round_no),
    liveStateVersion: Number(start.live_state_version),
  }
}

async function cleanupActiveRound(client: SupabaseAny, accessToken: string, args: Args) {
  const status = await getStatus(client, args.sessionId)
  if (status.activeRound === null) return
  const guard = await getVersionGuard(client, args.sessionId)
  await endVersioned(client, accessToken, args.sessionId, status.activeRound, guard.liveStateVersion, args.courts)
}

async function main() {
  const args = parseArgs()
  if (!args.yes) throw new Error('This test mutates live session data. Re-run with --yes to confirm.')
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const results: TestResult[] = []

  await cleanupActiveRound(client, accessToken, args)

  results.push(await expectSuccess('parity start/end clean cycle', async () => {
    await startAndEndClean(client, accessToken, args)
  }))

  results.push(await expectFailure('version mismatch', async () => {
    const plan = await buildPlan(client, args.sessionId, args.courts)
    const guard = await getVersionGuard(client, args.sessionId)
    await startVersioned(accessToken, args.sessionId, {
      ...guard,
      liveStateVersion: guard.liveStateVersion - 1,
    }, plan)
  }, /Session changed/i))

  results.push(await expectFailure('active round already exists', async () => {
    const active = await startOnly(client, accessToken, args)
    try {
      const plan = await buildPlan(client, args.sessionId, args.courts)
      const guard = await getVersionGuard(client, args.sessionId)
      await startVersioned(accessToken, args.sessionId, guard, plan)
    } finally {
      await endVersioned(client, accessToken, args.sessionId, active.roundNo, active.liveStateVersion, args.courts)
    }
  }, /active/i))

  results.push(await expectFailure('double click start', async () => {
    const plan = await buildPlan(client, args.sessionId, args.courts)
    const guard = await getVersionGuard(client, args.sessionId)
    const [left, right] = await Promise.allSettled([
      startVersioned(accessToken, args.sessionId, guard, plan),
      startVersioned(accessToken, args.sessionId, guard, plan),
    ])
    const status = await getStatus(client, args.sessionId)
    if (status.activeRound !== null) {
      const cleanupGuard = await getVersionGuard(client, args.sessionId)
      await endVersioned(client, accessToken, args.sessionId, status.activeRound, cleanupGuard.liveStateVersion, args.courts)
    }
    const rejected = [left, right].filter((item) => item.status === 'rejected') as PromiseRejectedResult[]
    if (rejected.length !== 1) {
      throw new Error(`Expected exactly 1 rejected start, got ${rejected.length}`)
    }
    throw rejected[0].reason
  }, /Session changed|active/i))

  results.push(await expectFailure('player checkout between suggest and start', async () => {
    const plan = await buildPlan(client, args.sessionId, args.courts)
    const guard = await getVersionGuard(client, args.sessionId)
    const playerId = plan.alternative.matches[0].team_a[0]
    try {
      await invokeFunction('session-checkout', accessToken, args.sessionId, { player_id: playerId })
      await startVersioned(accessToken, args.sessionId, guard, plan)
    } finally {
      await invokeFunction('session-checkin', accessToken, args.sessionId, { player_id: playerId })
    }
  }, /checked-in|Session changed/i))

  results.push(await expectFailure('end round twice', async () => {
    const active = await startOnly(client, accessToken, args)
    await endVersioned(client, accessToken, args.sessionId, active.roundNo, active.liveStateVersion, args.courts)
    const guard = await getVersionGuard(client, args.sessionId)
    await endVersioned(client, accessToken, args.sessionId, active.roundNo, guard.liveStateVersion, args.courts)
  }, /Active round .*not found|Active round not found/i))

  results.push(await expectFailure('non-host or anonymous cannot start', async () => {
    const plan = await buildPlan(client, args.sessionId, args.courts)
    const guard = await getVersionGuard(client, args.sessionId)
    const nonHost = await getNonHostOrAnonymousToken()
    try {
      await startVersioned(nonHost.token, args.sessionId, guard, plan)
    } catch (error) {
      throw new Error(`${nonHost.label}: ${messageOf(error)}`)
    }
  }, /host|JWT|authorization|not authenticated|Invalid|permission denied/i))

  console.table(results)
  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    throw new Error(`${failed.length} failure-case tests failed`)
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
