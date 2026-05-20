import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { loadSessionState } from '../lib/next-round-suggester/state'

type Args = {
  sessionId: string
  iterations: number
  delayMs: number
}

type QueryTiming = {
  name: string
  ms: number
  rows: number
  error?: string
}

type LoaderTiming = {
  name: string
  totalMs: number
  queries: QueryTiming[]
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
    sessionId,
    iterations: Math.max(1, Number(getValue('--iterations') ?? '10')),
    delayMs: Math.max(0, Number(getValue('--delay-ms') ?? '250')),
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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

function summary(values: number[]) {
  if (values.length === 0) return null
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    min: Math.round(Math.min(...values)),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(Math.max(...values)),
    avg: Math.round(avg),
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

async function timedQuery<T>(name: string, query: Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<QueryTiming> {
  const startedAt = now()
  const result = await query
  return {
    name,
    ms: now() - startedAt,
    rows: result.data?.length ?? 0,
    error: result.error?.message,
  }
}

async function fullLoader(client: SupabaseAny, sessionId: string): Promise<LoaderTiming> {
  const startedAt = now()
  await loadSessionState(client, sessionId)
  return {
    name: 'full-loadSessionState',
    totalMs: now() - startedAt,
    queries: [],
  }
}

async function lightStartLoader(client: SupabaseAny, sessionId: string): Promise<LoaderTiming> {
  const startedAt = now()
  const queries = await Promise.all([
    timedQuery(
      'player_state_min',
      client
        .from('session_player_state')
        .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest')
        .eq('session_id', sessionId)
        .order('checked_in_at', { ascending: true }),
    ),
    timedQuery(
      'rounds_min',
      client
        .from('session_rounds')
        .select('id, session_id, round_no, status, started_at, ended_at')
        .eq('session_id', sessionId)
        .order('round_no', { ascending: true }),
    ),
  ])
  return {
    name: 'light-start-loader',
    totalMs: now() - startedAt,
    queries,
  }
}

async function lightEndLoader(client: SupabaseAny, sessionId: string): Promise<LoaderTiming> {
  const startedAt = now()
  const queries = await Promise.all([
    timedQuery(
      'player_state_commit',
      client
        .from('session_player_state')
        .select('session_id, player_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest')
        .eq('session_id', sessionId)
        .order('checked_in_at', { ascending: true }),
    ),
    timedQuery(
      'pair_history',
      client
        .from('session_pair_history')
        .select('session_id, player_a, player_b, partner_count, opponent_count')
        .eq('session_id', sessionId)
        .order('player_a', { ascending: true }),
    ),
    timedQuery(
      'rounds_active_only',
      client
        .from('session_rounds')
        .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
        .eq('session_id', sessionId)
        .eq('status', 'active'),
    ),
  ])
  return {
    name: 'light-end-loader',
    totalMs: now() - startedAt,
    queries,
  }
}

function printLoaderSummary(name: string, rows: LoaderTiming[]) {
  console.log(`\n${name}`)
  console.table({
    total: summary(rows.map((row) => row.totalMs)),
  })

  const queryNames = [...new Set(rows.flatMap((row) => row.queries.map((query) => query.name)))]
  if (queryNames.length > 0) {
    console.table(Object.fromEntries(queryNames.map((queryName) => [
      queryName,
      summary(rows.flatMap((row) => row.queries.filter((query) => query.name === queryName).map((query) => query.ms))),
    ])))
  }
}

async function main() {
  const args = parseArgs()
  const client = await getHostClient()
  const results: Record<string, LoaderTiming[]> = {
    'full-loadSessionState': [],
    'light-start-loader': [],
    'light-end-loader': [],
  }

  for (let index = 0; index < args.iterations; index += 1) {
    const full = await fullLoader(client, args.sessionId)
    const start = await lightStartLoader(client, args.sessionId)
    const end = await lightEndLoader(client, args.sessionId)
    results[full.name].push(full)
    results[start.name].push(start)
    results[end.name].push(end)
    console.log(`iteration ${index + 1}/${args.iterations}`, {
      full: `${full.totalMs.toFixed(0)}ms`,
      lightStart: `${start.totalMs.toFixed(0)}ms`,
      lightEnd: `${end.totalMs.toFixed(0)}ms`,
    })
    await sleep(args.delayMs)
  }

  printLoaderSummary('full-loadSessionState', results['full-loadSessionState'])
  printLoaderSummary('light-start-loader', results['light-start-loader'])
  printLoaderSummary('light-end-loader', results['light-end-loader'])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
