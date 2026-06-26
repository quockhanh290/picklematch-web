import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

import { calculateOptimalCourts } from '@/lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '@/lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { SessionState } from '@/lib/next-round-suggester/types'

type SupabaseAny = any

type RunTiming = {
  sessionId: string
  round: number | null
  ok: boolean
  error?: string
  planMs: number
  startMs: number
  reloadMs: number
  commitMs: number
  endMs: number
  totalMs: number
  versionBefore: number | null
  versionAfter: number | null
}

type PreparedPlan = {
  sessionId: string
  courtCount: number
  alternative: ReturnType<typeof suggestNextRound>['alternatives'][number]
  planMs: number
  state: SessionState | null
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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
  const { error } = await client.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
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
  return data.user.id as string
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

async function candidateSessionIds(client: SupabaseAny, hostUserId: string, limit: number) {
  const { data, error } = await client
    .from('sessions')
    .select('id, created_at')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(Math.max(80, limit + 20))
  if (error) throw error

  const ids: string[] = []
  for (const session of data ?? []) {
    const sessionId = String(session.id)
    const [stateResult, activeResult] = await Promise.all([
      client
        .from('session_player_state')
        .select('player_id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .is('checked_out_at', null),
      client
        .from('session_rounds')
        .select('round_no')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .maybeSingle(),
    ])
    if (stateResult.error) throw stateResult.error
    if (activeResult.error) throw activeResult.error
    if ((stateResult.count ?? 0) >= 8 && !activeResult.data) ids.push(sessionId)
    if (ids.length >= limit) break
  }
  return ids
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

async function preparePlan(client: SupabaseAny, sessionId: string): Promise<PreparedPlan> {
  const planStarted = now()
  const initialState = await loadSessionState(client, sessionId, { courts: 6, pvnaTolerance: 0.5 })
  const presentPlayers = [...initialState.players.values()].filter((player) => player.checked_out_at === null).length
  const courtCount = Math.max(1, calculateOptimalCourts({
    n_players: presentPlayers,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  }).recommended.courts)
  const state = await loadSessionState(client, sessionId, { courts: courtCount, pvnaTolerance: 0.5 })
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const suggestion = suggestNextRound(adjustedState, { tier_overrides: adjustment.tier_overrides })
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available for ${sessionId}`)
  return {
    sessionId,
    courtCount,
    alternative,
    planMs: now() - planStarted,
    state,
  }
}

async function prepareSimplePlan(client: SupabaseAny, sessionId: string): Promise<PreparedPlan> {
  const planStarted = now()
  const state = await loadSessionState(client, sessionId, { courts: 6, pvnaTolerance: 0.5 })

  const eligibleIds = [...state.players.values()]
    .filter((player) => player.checked_out_at === null && !player.opted_rest)
    .map((player) => player.player_id)
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
    courtCount,
    alternative: {
      matches,
      resting: eligibleIds.slice(courtCount * 4),
      score: 0,
      warnings: [],
      stats: {} as any,
      runtime_ms: 0,
      iterations: 0,
    } as any,
    planMs: now() - planStarted,
    state,
  }
}

async function prepareMinimalSimplePlan(client: SupabaseAny, sessionId: string): Promise<PreparedPlan> {
  const planStarted = now()
  const { data, error } = await client
    .from('session_player_state')
    .select('player_id, checked_out_at, opted_rest')
    .eq('session_id', sessionId)
    .order('checked_in_at', { ascending: true })
  if (error) throw error

  const eligibleIds = (data ?? [])
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
    courtCount,
    alternative: {
      matches,
      resting: eligibleIds.slice(courtCount * 4),
      score: 0,
      warnings: [],
      stats: {} as any,
      runtime_ms: 0,
      iterations: 0,
    } as any,
    planMs: now() - planStarted,
    state: null,
  }
}

async function runOneSession(
  client: SupabaseAny,
  accessToken: string,
  sessionId: string,
  preparedPlan: PreparedPlan | null = null,
  skipPostStartReload = false,
  dbDeltaEnd = false,
): Promise<RunTiming> {
  const startedAt = now()
  let planMs = 0
  let startMs = 0
  let reloadMs = 0
  let commitMs = 0
  let endMs = 0
  let roundNo: number | null = null
  let versionBefore: number | null = null
  let versionAfter: number | null = null

  try {
    const plan = preparedPlan ?? await preparePlan(client, sessionId)
    const { courtCount, alternative } = plan
    planMs = plan.planMs

    const guard = await getVersionGuard(client, sessionId)
    versionBefore = guard.liveStateVersion
    if (guard.activeRoundNo !== null) throw new Error(`Active round ${guard.activeRoundNo}`)

    const startStarted = now()
    const startPayload = await invokeFunction('session-rounds-start-versioned', accessToken, sessionId, {
      expected_live_state_version: guard.liveStateVersion,
      round_no: guard.currentRound,
      matches: alternative.matches,
      resting: alternative.resting,
      audit_payload: {
        benchmark: true,
        source: 'scratch/load-test-versioned-rounds-concurrent.ts',
      },
    })
    startMs = now() - startStarted
    roundNo = Number(startPayload.round?.round_no)

    const startedState = skipPostStartReload && plan.state
      ? {
          ...plan.state,
          rounds: [
            ...plan.state.rounds.filter((round) => round.round_no !== roundNo),
            {
              id: String(startPayload.round?.id ?? ''),
              session_id: sessionId,
              round_no: roundNo,
              status: 'active' as const,
              matches: alternative.matches,
              resting: alternative.resting,
              started_at: startPayload.round?.started_at ?? new Date().toISOString(),
              ended_at: null,
            },
          ],
        }
      : dbDeltaEnd
        ? null
        : await (async () => {
          const reloadStarted = now()
          const state = await loadSessionState(client, sessionId, { courts: courtCount, pvnaTolerance: 0.5 })
          reloadMs = now() - reloadStarted
          return state
        })()
    const activeRound = startedState?.rounds.find((round) => round.round_no === roundNo && round.status === 'active') ?? null
    if (!dbDeltaEnd && !activeRound) throw new Error(`Round ${roundNo} not active after start`)

    const commitStarted = now()
    const existingPairs = startedState ? pairHistoryRowsFromState(startedState) : []
    const committed = startedState && activeRound ? commitCompletedRound(startedState, activeRound, existingPairs) : null
    const playerStatePayload = committed
      ? [...committed.players.values()].map((player) => ({
          player_id: player.player_id,
          matches_played: player.matches_played,
          last_played_round: player.last_played_round,
          consecutive_rest: player.consecutive_rest,
          consecutive_play: player.consecutive_play,
          opted_rest: player.opted_rest,
        }))
      : []
    const pairHistoryPayload = committed
      ? changedPairHistoryRows(existingPairs, committed.pairHistory).map((row) => ({
          player_a: row.player_a,
          player_b: row.player_b,
          partner_count: row.partner_count,
          opponent_count: row.opponent_count,
        }))
      : []
    const scoreAfter = committed && startedState
      ? computeSessionFairness({
          ...startedState,
          current_round: Math.max(startedState.current_round, roundNo + 1),
          players: committed.players,
        }).total
      : 0
    commitMs = now() - commitStarted

    const endStarted = now()
    const endPayload = await invokeFunction('session-rounds-end-versioned', accessToken, sessionId, {
      expected_live_state_version: Number(startPayload.live_state_version),
      round_no: roundNo,
      player_state: playerStatePayload,
      pair_history: pairHistoryPayload,
      score_after: scoreAfter,
      audit_payload: {
        benchmark: true,
        source: 'scratch/load-test-versioned-rounds-concurrent.ts',
      },
    }, { round_no: roundNo })
    endMs = now() - endStarted
    versionAfter = Number(endPayload.live_state_version)

    return {
      sessionId,
      round: roundNo,
      ok: versionAfter === versionBefore + 2,
      error: versionAfter === versionBefore + 2 ? undefined : `version ${versionBefore}->${versionAfter}`,
      planMs,
      startMs,
      reloadMs,
      commitMs,
      endMs,
      totalMs: now() - startedAt,
      versionBefore,
      versionAfter,
    }
  } catch (error) {
    return {
      sessionId,
      round: roundNo,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      planMs,
      startMs,
      reloadMs,
      commitMs,
      endMs,
      totalMs: now() - startedAt,
      versionBefore,
      versionAfter,
    }
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

async function main() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')
  const concurrency = Math.max(1, Number(argValue('--concurrency', '3')))
  const planConcurrency = Math.max(1, Number(argValue('--plan-concurrency', '25')))
  const precomputePlans = process.argv.includes('--precompute-plans')
  const simplePlan = process.argv.includes('--simple-plan')
  const skipPostStartReload = process.argv.includes('--skip-post-start-reload')
  const dbDeltaEnd = process.argv.includes('--db-delta-end')
  const summaryOnly = process.argv.includes('--summary-only')
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const sessionIds = await candidateSessionIds(client, await getHostUserId(client), concurrency)
  if (sessionIds.length < concurrency) {
    throw new Error(`Need ${concurrency} candidate sessions, found ${sessionIds.length}`)
  }

  const planStartedAt = now()
  const preparedPlans = precomputePlans
    ? await runPool(sessionIds, planConcurrency, (sessionId) => (
      simplePlan
        ? dbDeltaEnd
          ? prepareMinimalSimplePlan(client, sessionId)
          : prepareSimplePlan(client, sessionId)
        : preparePlan(client, sessionId)
    ))
    : []
  const planWallMs = now() - planStartedAt

  const startedAt = now()
  const planBySession = new Map(preparedPlans.map((plan) => [plan.sessionId, plan]))
  const rows = await Promise.all(sessionIds.map((sessionId) => runOneSession(
    client,
    accessToken,
    sessionId,
    planBySession.get(sessionId) ?? null,
    skipPostStartReload,
    dbDeltaEnd,
  )))
  const okRows = rows.filter((row) => row.ok)
  const result = {
    concurrency,
    planConcurrency: precomputePlans ? planConcurrency : null,
    precomputePlans,
    simplePlan,
    skipPostStartReload,
    dbDeltaEnd,
    sessions: summaryOnly ? undefined : sessionIds,
    planWallMs: precomputePlans ? Math.round(planWallMs) : null,
    wallMs: Math.round(now() - startedAt),
    ok: okRows.length,
    failed: rows.length - okRows.length,
    summary: {
      total: summary(okRows.map((row) => row.totalMs)),
      plan: summary(okRows.map((row) => row.planMs)),
      start: summary(okRows.map((row) => row.startMs)),
      reload: summary(okRows.map((row) => row.reloadMs)),
      commit: summary(okRows.map((row) => row.commitMs)),
      end: summary(okRows.map((row) => row.endMs)),
    },
    rows: summaryOnly ? undefined : rows.map((row) => ({
      ...row,
      planMs: Math.round(row.planMs),
      startMs: Math.round(row.startMs),
      reloadMs: Math.round(row.reloadMs),
      commitMs: Math.round(row.commitMs),
      endMs: Math.round(row.endMs),
      totalMs: Math.round(row.totalMs),
    })),
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
