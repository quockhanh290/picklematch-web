import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

type SupabaseAny = any
type Mode = 'rest-rpc' | 'round-rpc' | 'round-edge'

type Plan = {
  sessionId: string
  roundNo: number
  expectedVersion: number
  matches: Array<{ court: number; team_a: string[]; team_b: string[] }>
  resting: string[]
  planMs: number
}

type Row = {
  sessionId: string
  ok: boolean
  error?: string
  planMs: number
  restMs: number
  startMs: number
  endMs: number
  totalMs: number
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
    if (key && process.env[key] === undefined) process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function summary(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    min: Math.round(sorted[0]),
    p50: Math.round(percentile(50)),
    p95: Math.round(percentile(95)),
    max: Math.round(sorted[sorted.length - 1]),
    avg: Math.round(sum / sorted.length),
  }
}

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return client
}

async function getAccessToken(client: SupabaseAny) {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Missing access token')
  return token
}

async function getHostUserId(client: SupabaseAny) {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user?.id) throw new Error(error?.message ?? 'Missing host user')
  return String(data.user.id)
}

async function candidateSessionIds(client: SupabaseAny, hostUserId: string, limit: number) {
  const { data, error } = await client
    .from('sessions')
    .select('id, created_at')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(Math.max(700, limit + 50))
  if (error) throw error

  const ids: string[] = []
  for (const row of data ?? []) {
    const sessionId = String(row.id)
    const [state, active] = await Promise.all([
      client.from('session_player_state').select('player_id', { count: 'exact', head: true }).eq('session_id', sessionId).is('checked_out_at', null),
      client.from('session_rounds').select('round_no').eq('session_id', sessionId).eq('status', 'active').maybeSingle(),
    ])
    if (state.error) throw state.error
    if (active.error) throw active.error
    if ((state.count ?? 0) >= 8 && !active.data) ids.push(sessionId)
    if (ids.length >= limit) break
  }
  return ids
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', { p_session_id: sessionId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Missing version guard')
  return {
    liveStateVersion: Number(row.live_state_version),
    currentRound: Number(row.current_round),
    activeRoundNo: row.active_round_no == null ? null : Number(row.active_round_no),
  }
}

async function rpc(client: SupabaseAny, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw error
  return data
}

async function invokeFunction(functionName: string, accessToken: string, sessionId: string, body: Record<string, unknown>, query: Record<string, string | number> = {}) {
  const params = new URLSearchParams({ session_id: sessionId })
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? text)
  return payload
}

async function prepareMinimalPlan(client: SupabaseAny, sessionId: string): Promise<Plan> {
  const startedAt = now()
  const [guard, state] = await Promise.all([
    getVersionGuard(client, sessionId),
    client
      .from('session_player_state')
      .select('player_id, checked_out_at, opted_rest, checked_in_at')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
  ])
  if (state.error) throw state.error
  if (guard.activeRoundNo !== null) throw new Error(`Active round ${guard.activeRoundNo}`)

  const eligibleIds = (state.data ?? [])
    .filter((row: any) => row.checked_out_at === null && !row.opted_rest)
    .map((row: any) => String(row.player_id))
  if (eligibleIds.length < 8) throw new Error(`Need at least 8 eligible players for ${sessionId}`)

  const courtCount = Math.max(1, Math.min(6, Math.floor(eligibleIds.length / 4)))
  const playingIds = eligibleIds.slice(0, courtCount * 4)
  const matches = []
  for (let index = 0; index < playingIds.length; index += 4) {
    matches.push({
      court: matches.length + 1,
      team_a: [playingIds[index], playingIds[index + 1]],
      team_b: [playingIds[index + 2], playingIds[index + 3]],
    })
  }

  return {
    sessionId,
    roundNo: guard.currentRound,
    expectedVersion: guard.liveStateVersion,
    matches,
    resting: eligibleIds.slice(courtCount * 4),
    planMs: now() - startedAt,
  }
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = []
  let cursor = 0
  async function next() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
  return results
}

async function runRestRpc(client: SupabaseAny, sessionId: string): Promise<Row> {
  const startedAt = now()
  let restMs = 0
  try {
    const { data, error } = await client
      .from('session_player_state')
      .select('player_id, opted_rest')
      .eq('session_id', sessionId)
      .is('checked_out_at', null)
      .limit(1)
      .single()
    if (error) throw error
    const restStarted = now()
    await rpc(client, 'set_live_session_player_rest_versioned', {
      p_session_id: sessionId,
      p_player_id: String(data.player_id),
      p_opted_rest: !Boolean(data.opted_rest),
    })
    restMs = now() - restStarted
    return { sessionId, ok: true, planMs: 0, restMs, startMs: 0, endMs: 0, totalMs: now() - startedAt }
  } catch (error) {
    return { sessionId, ok: false, error: error instanceof Error ? error.message : String(error), planMs: 0, restMs, startMs: 0, endMs: 0, totalMs: now() - startedAt }
  }
}

async function runRoundRpc(client: SupabaseAny, plan: Plan): Promise<Row> {
  const startedAt = now()
  let startMs = 0
  let endMs = 0
  try {
    const startStarted = now()
    const start = await rpc(client, 'start_live_session_round_versioned', {
      p_session_id: plan.sessionId,
      p_expected_live_state_version: plan.expectedVersion,
      p_round_no: plan.roundNo,
      p_matches: plan.matches,
      p_resting: plan.resting,
      p_audit_payload: { benchmark: true, source: 'scratch/benchmark-live-rpc-root-cause.ts', transport: 'rpc' },
    })
    startMs = now() - startStarted
    const startRow = Array.isArray(start) ? start[0] : start
    const versionAfterStart = Number(startRow?.live_state_version ?? plan.expectedVersion + 1)
    const endStarted = now()
    await rpc(client, 'complete_live_session_round_versioned', {
      p_session_id: plan.sessionId,
      p_expected_live_state_version: versionAfterStart,
      p_round_no: plan.roundNo,
      p_player_state: [],
      p_pair_history: [],
      p_score_after: 0,
      p_audit_payload: { benchmark: true, source: 'scratch/benchmark-live-rpc-root-cause.ts', transport: 'rpc' },
    })
    endMs = now() - endStarted
    return { sessionId: plan.sessionId, ok: true, planMs: plan.planMs, restMs: 0, startMs, endMs, totalMs: now() - startedAt }
  } catch (error) {
    return { sessionId: plan.sessionId, ok: false, error: error instanceof Error ? error.message : String(error), planMs: plan.planMs, restMs: 0, startMs, endMs, totalMs: now() - startedAt }
  }
}

async function runRoundEdge(accessToken: string, plan: Plan): Promise<Row> {
  const startedAt = now()
  let startMs = 0
  let endMs = 0
  try {
    const startStarted = now()
    const start = await invokeFunction('session-rounds-start-versioned', accessToken, plan.sessionId, {
      expected_live_state_version: plan.expectedVersion,
      round_no: plan.roundNo,
      matches: plan.matches,
      resting: plan.resting,
      audit_payload: { benchmark: true, source: 'scratch/benchmark-live-rpc-root-cause.ts', transport: 'edge' },
    })
    startMs = now() - startStarted
    const versionAfterStart = Number(start.live_state_version)
    const roundNo = Number(start.round?.round_no ?? plan.roundNo)
    const endStarted = now()
    await invokeFunction('session-rounds-end-versioned', accessToken, plan.sessionId, {
      expected_live_state_version: versionAfterStart,
      round_no: roundNo,
      player_state: [],
      pair_history: [],
      score_after: 0,
      audit_payload: { benchmark: true, source: 'scratch/benchmark-live-rpc-root-cause.ts', transport: 'edge' },
    }, { round_no: roundNo })
    endMs = now() - endStarted
    return { sessionId: plan.sessionId, ok: true, planMs: plan.planMs, restMs: 0, startMs, endMs, totalMs: now() - startedAt }
  } catch (error) {
    return { sessionId: plan.sessionId, ok: false, error: error instanceof Error ? error.message : String(error), planMs: plan.planMs, restMs: 0, startMs, endMs, totalMs: now() - startedAt }
  }
}

async function main() {
  const mode = (argValue('--mode', 'rest-rpc') ?? 'rest-rpc') as Mode
  const concurrency = Math.max(1, Number(argValue('--concurrency', '100')))
  const planConcurrency = Math.max(1, Number(argValue('--plan-concurrency', '25')))
  if (!['rest-rpc', 'round-rpc', 'round-edge'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`)

  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const hostUserId = await getHostUserId(client)
  const sessionIds = await candidateSessionIds(client, hostUserId, concurrency)
  if (sessionIds.length < concurrency) throw new Error(`Need ${concurrency} candidate sessions, found ${sessionIds.length}`)

  const planStartedAt = now()
  const plans = mode === 'rest-rpc' ? [] : await runPool(sessionIds, planConcurrency, (sessionId) => prepareMinimalPlan(client, sessionId))
  const planWallMs = now() - planStartedAt
  const runStartedAt = now()
  const rows = mode === 'rest-rpc'
    ? await Promise.all(sessionIds.map((sessionId) => runRestRpc(client, sessionId)))
    : mode === 'round-rpc'
      ? await Promise.all(plans.map((plan) => runRoundRpc(client, plan)))
      : await Promise.all(plans.map((plan) => runRoundEdge(accessToken, plan)))
  const okRows = rows.filter((row) => row.ok)
  const result = {
    mode,
    concurrency,
    planConcurrency: mode === 'rest-rpc' ? null : planConcurrency,
    planWallMs: mode === 'rest-rpc' ? null : Math.round(planWallMs),
    wallMs: Math.round(now() - runStartedAt),
    ok: okRows.length,
    failed: rows.length - okRows.length,
    summary: {
      total: summary(okRows.map((row) => row.totalMs)),
      plan: summary(okRows.map((row) => row.planMs)),
      rest: summary(okRows.map((row) => row.restMs)),
      start: summary(okRows.map((row) => row.startMs)),
      end: summary(okRows.map((row) => row.endMs)),
    },
    failures: rows.filter((row) => !row.ok).slice(0, 10).map((row) => ({ sessionId: row.sessionId, error: row.error })),
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
