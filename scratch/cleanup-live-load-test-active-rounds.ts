import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'

type SupabaseAny = any

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

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

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing Supabase anon key')
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { data: auth, error } = await authClient.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
  if (error) throw error
  const token = auth.session?.access_token
  if (!token) throw new Error('Host login failed')
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  return { client, accessToken: token }
}

async function getBenchmarkSessionIds(client: SupabaseAny) {
  const { data, error } = await client
    .from('owner_sessions')
    .select('id, created_at')
    .contains('format_metadata', { benchmark: 'versioned-load-test' })
    .order('created_at', { ascending: false })
    .limit(700)
  if (error) throw error
  return (data ?? []).map((row: any) => String(row.id))
}

async function getActiveSessionIds(client: SupabaseAny, sessionIds: string[]) {
  const active = new Set<string>()
  for (let index = 0; index < sessionIds.length; index += 100) {
    const batch = sessionIds.slice(index, index + 100)
    const { data, error } = await client
      .from('session_rounds')
      .select('session_id')
      .in('session_id', batch)
      .eq('status', 'active')
    if (error) throw error
    for (const row of data ?? []) active.add(String(row.session_id))
  }
  return [...active]
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', {
    p_session_id: sessionId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Missing version guard')
  return {
    liveStateVersion: Number(row.live_state_version),
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

async function invokeEnd(accessToken: string, sessionId: string, roundNo: number, body: Record<string, unknown>) {
  const params = new URLSearchParams({ session_id: sessionId, round_no: String(roundNo) })
  const response = await fetch(`${SUPABASE_URL}/functions/v1/session-rounds-end-versioned?${params.toString()}`, {
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
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? text)
  return payload
}

async function cleanupOne(client: SupabaseAny, accessToken: string, sessionId: string) {
  const startedAt = now()
  const guard = await getVersionGuard(client, sessionId)
  if (guard.activeRoundNo === null) {
    return { sessionId, ok: true, skipped: true, ms: Math.round(now() - startedAt) }
  }

  const state = await loadSessionState(client, sessionId, { courts: 6, pvnaTolerance: 0.5 })
  const activeRound = state.rounds.find((round) => round.round_no === guard.activeRoundNo && round.status === 'active')
  if (!activeRound) throw new Error(`Missing active round ${guard.activeRoundNo}`)

  const existingPairs = pairHistoryRowsFromState(state)
  const committed = commitCompletedRound(state, activeRound, existingPairs)
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
    current_round: Math.max(state.current_round, guard.activeRoundNo + 1),
    players: committed.players,
  }).total

  const payload = await invokeEnd(accessToken, sessionId, guard.activeRoundNo, {
    expected_live_state_version: guard.liveStateVersion,
    round_no: guard.activeRoundNo,
    player_state: playerStatePayload,
    pair_history: pairHistoryPayload,
    score_after: scoreAfter,
    audit_payload: {
      benchmark_cleanup: true,
      source: 'scratch/cleanup-live-load-test-active-rounds.ts',
    },
  })

  return {
    sessionId,
    ok: Number(payload.live_state_version) === guard.liveStateVersion + 1,
    roundNo: guard.activeRoundNo,
    versionBefore: guard.liveStateVersion,
    versionAfter: Number(payload.live_state_version),
    ms: Math.round(now() - startedAt),
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
  const concurrency = Math.max(1, Number(argValue('--concurrency', '20')))
  const { client, accessToken } = await getHostClient()
  const sessionIds = await getBenchmarkSessionIds(client)
  const activeSessionIds = await getActiveSessionIds(client, sessionIds)
  const startedAt = now()
  const rows = await runPool(activeSessionIds, concurrency, async (sessionId) => {
    try {
      return await cleanupOne(client, accessToken, sessionId)
    } catch (error) {
      return {
        sessionId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  const ok = rows.filter((row: any) => row.ok).length
  console.log(JSON.stringify({
    benchmarkSessions: sessionIds.length,
    activeBefore: activeSessionIds.length,
    concurrency,
    ok,
    failed: rows.length - ok,
    wallMs: Math.round(now() - startedAt),
    rows,
  }, null, 2))
  if (ok !== rows.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
