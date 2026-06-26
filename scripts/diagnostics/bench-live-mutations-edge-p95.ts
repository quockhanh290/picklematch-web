import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

type SupabaseAny = any
type Measurement = { path: string; ms: number; ok: boolean; status: number; error?: string }

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
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket as any },
}

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

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summary(rows: Measurement[]) {
  const values = rows.filter((row) => row.ok).map((row) => row.ms)
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return {
    count: rows.length,
    ok: rows.filter((row) => row.ok).length,
    min: Math.round(Math.min(...values)),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(Math.max(...values)),
    avg: Math.round(avg),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (HOST_ACCESS_TOKEN) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      ...CLIENT_OPTIONS,
      global: { headers: { Authorization: `Bearer ${HOST_ACCESS_TOKEN}` } },
    })
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTIONS)
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
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

async function getRoster(client: SupabaseAny, sessionId: string) {
  const [registered, state] = await Promise.all([
    client.from('session_players').select('player_id, status, check_in_status').eq('session_id', sessionId),
    client.from('session_player_state').select('player_id, checked_out_at').eq('session_id', sessionId).order('player_id', { ascending: true }),
  ])
  if (registered.error) throw registered.error
  if (state.error) throw state.error
  const registeredIds = [...new Set((registered.data ?? [])
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
  const presentIds = (state.data ?? []).filter((row: any) => row.checked_out_at === null).map((row: any) => String(row.player_id))
  return { registeredIds, presentIds }
}

async function invoke(accessToken: string, sessionId: string, functionName: string, body: Record<string, unknown>): Promise<Measurement> {
  const params = new URLSearchParams({ session_id: sessionId })
  const startedAt = now()
  let status = 0
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    status = response.status
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    const ms = now() - startedAt
    if (!response.ok || payload?.ok === false) {
      return { path: functionName, ok: false, ms, status, error: payload?.error ?? text }
    }
    return { path: functionName, ok: true, ms, status }
  } catch (error) {
    return { path: functionName, ok: false, ms: now() - startedAt, status, error: error instanceof Error ? error.message : String(error) }
  }
}

async function rpc(client: SupabaseAny, fn: string, args: Record<string, unknown>) {
  const { error } = await client.rpc(fn, args)
  if (error) throw error
}

async function main() {
  const sessionId = argValue('--session-id', '')
  if (!sessionId) throw new Error('Missing --session-id')
  const iterations = Math.max(1, Number(argValue('--iterations', '10')))
  const delayMs = Math.max(0, Number(argValue('--delay-ms', '150')))
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const roster = await getRoster(client, sessionId)
  const [a, b, c] = roster.presentIds
  if (!a || !b || !c) throw new Error('Need at least 3 present players')

  const rows: Record<string, Measurement[]> = {
    restOn: [],
    restOff: [],
    setGroup: [],
    clearGroup: [],
    checkout: [],
    checkin: [],
  }

  for (let i = 0; i < iterations; i += 1) {
    rows.restOn.push(await invoke(accessToken, sessionId, 'session-request-rest', { player_id: c, opted_rest: true }))
    await sleep(delayMs)
    rows.restOff.push(await invoke(accessToken, sessionId, 'session-request-rest', { player_id: c, opted_rest: false }))
    await sleep(delayMs)
    rows.setGroup.push(await invoke(accessToken, sessionId, 'session-set-group', { player_ids: [a, b] }))
    await sleep(delayMs)
    rows.clearGroup.push(await invoke(accessToken, sessionId, 'session-set-group', { clear_group_id: `${sessionId}:${[a, b].sort().join(':')}` }))
    await sleep(delayMs)
    rows.checkout.push(await invoke(accessToken, sessionId, 'session-checkout', { player_id: c }))
    await sleep(delayMs)
    rows.checkin.push(await invoke(accessToken, sessionId, 'session-checkin', { player_id: c }))
    await sleep(delayMs)
  }

  await rpc(client, 'sync_live_session_roster_versioned', {
    p_session_id: sessionId,
    p_player_ids: roster.registeredIds,
    p_revive_checked_out: true,
  })

  console.log(JSON.stringify({
    sessionId,
    iterations,
    delayMs,
    summary: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, summary(value)])),
    failures: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.filter((row) => !row.ok)]).filter(([, value]) => value.length > 0)),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
