import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

type SupabaseAny = any

type Timing = {
  step: string
  ms: number
  detail?: Record<string, unknown>
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

async function timed<T>(rows: Timing[], step: string, fn: () => Promise<{ value: T; detail?: Record<string, unknown> }>) {
  const startedAt = now()
  const result = await fn()
  rows.push({ step, ms: now() - startedAt, detail: result.detail })
  return result.value
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

async function getUserId(client: SupabaseAny) {
  if (HOST_ACCESS_TOKEN) {
    const { data, error } = await client.auth.getUser(HOST_ACCESS_TOKEN)
    if (error) throw error
    return data.user?.id
  }
  const { data, error } = await client.auth.getUser()
  if (error) throw error
  return data.user?.id
}

async function latestPlayableSessionId(client: SupabaseAny, hostUserId: string) {
  const { data, error } = await client
    .from('sessions')
    .select('id, created_at')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error

  for (const session of data ?? []) {
    const { count, error: countError } = await client
      .from('session_players')
      .select('player_id', { count: 'exact', head: true })
      .eq('session_id', session.id)
    if (countError) throw countError
    if ((count ?? 0) >= 8) return String(session.id)
  }

  throw new Error(`No playable session found for ${HOST_EMAIL}`)
}

async function queryActiveRound(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_rounds')
    .select('round_no, status')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data ? Number(data.round_no) : null
}

async function querySessionPlayers(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)
  if (error) throw error
  return data ?? []
}

async function queryPlayerState(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_player_state')
    .select('player_id, checked_out_at, opted_rest')
    .eq('session_id', sessionId)
    .order('player_id', { ascending: true })
  if (error) throw error
  return data ?? []
}

function summarizeRoster(registeredRows: any[], stateRows: any[]) {
  const registeredIds = [...new Set(registeredRows
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
  const presentIds = stateRows
    .filter((row: any) => row.checked_out_at === null)
    .map((row: any) => String(row.player_id))
  const eligibleIds = stateRows
    .filter((row: any) => row.checked_out_at === null && !row.opted_rest)
    .map((row: any) => String(row.player_id))
  return { registeredIds, presentIds, eligibleIds }
}

async function detailedRosterRead(client: SupabaseAny, sessionId: string, rows: Timing[], label: string) {
  const registeredStartedAt = now()
  const registeredRows = await querySessionPlayers(client, sessionId)
  rows.push({
    step: `${label}:query-session-players`,
    ms: now() - registeredStartedAt,
    detail: { rows: registeredRows.length },
  })

  const stateStartedAt = now()
  const stateRows = await queryPlayerState(client, sessionId)
  rows.push({
    step: `${label}:query-session-player-state`,
    ms: now() - stateStartedAt,
    detail: { rows: stateRows.length },
  })

  return summarizeRoster(registeredRows, stateRows)
}

async function invokeFunction(
  functionName: string,
  accessToken: string,
  sessionId: string,
  body: Record<string, unknown>,
) {
  const params = new URLSearchParams({ session_id: sessionId })
  const startedFetchAt = now()
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const responseReceivedMs = now() - startedFetchAt
  const startedTextAt = now()
  const text = await response.text()
  const readTextMs = now() - startedTextAt
  const startedParseAt = now()
  const payload = text ? JSON.parse(text) : {}
  const parseMs = now() - startedParseAt
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? text)
  }
  return {
    payload,
    detail: {
      status: response.status,
      responseReceivedMs: Math.round(responseReceivedMs),
      readTextMs: Math.round(readTextMs),
      parseMs: Math.round(parseMs),
    },
  }
}

async function getVersion(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('sessions')
    .select('live_state_version')
    .eq('id', sessionId)
    .single()
  if (error) throw error
  return Number(data.live_state_version)
}

async function directRestRpc(client: SupabaseAny, sessionId: string, playerId: string, optedRest: boolean) {
  const { data, error } = await client.rpc('set_live_session_player_rest_versioned', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_opted_rest: optedRest,
  })
  if (error) throw error
  return data
}

async function measureEdgeRest(
  client: SupabaseAny,
  accessToken: string,
  sessionId: string,
  playerId: string,
  optedRest: boolean,
  rows: Timing[],
  label: string,
) {
  const before = await timed(rows, `${label}:read-version-before`, async () => ({
    value: await getVersion(client, sessionId),
  }))
  const edge = await timed(rows, `${label}:edge-session-request-rest`, async () => {
    const result = await invokeFunction('session-request-rest', accessToken, sessionId, {
      player_id: playerId,
      opted_rest: optedRest,
    })
    return {
      value: result.payload,
      detail: {
        ...result.detail,
        live_state_version: result.payload.live_state_version,
      },
    }
  })
  const after = await timed(rows, `${label}:read-version-after`, async () => ({
    value: await getVersion(client, sessionId),
  }))
  rows.push({
    step: `${label}:version-delta`,
    ms: 0,
    detail: {
      before,
      edgeVersion: edge.live_state_version,
      after,
      delta: after - before,
    },
  })
}

async function measureDirectRestRpc(
  client: SupabaseAny,
  sessionId: string,
  playerId: string,
  optedRest: boolean,
  rows: Timing[],
  label: string,
) {
  const before = await timed(rows, `${label}:read-version-before`, async () => ({
    value: await getVersion(client, sessionId),
  }))
  const payload = await timed(rows, `${label}:direct-rpc-set-rest`, async () => ({
    value: await directRestRpc(client, sessionId, playerId, optedRest),
  }))
  const after = await timed(rows, `${label}:read-version-after`, async () => ({
    value: await getVersion(client, sessionId),
  }))
  rows.push({
    step: `${label}:version-delta`,
    ms: 0,
    detail: {
      before,
      rpcVersion: payload.live_state_version,
      after,
      delta: after - before,
    },
  })
}

async function main() {
  const explicitSessionId = argValue('--session-id')
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const userId = await getUserId(client)
  if (!userId) throw new Error('Missing host user id')
  const sessionId = explicitSessionId ?? await latestPlayableSessionId(client, userId)
  const rows: Timing[] = []

  await timed(rows, 'ensure-roster:get-active-round', async () => {
    const activeRound = await queryActiveRound(client, sessionId)
    return { value: activeRound, detail: { activeRound } }
  })
  const firstRoster = await detailedRosterRead(client, sessionId, rows, 'ensure-roster:first-roster')
  if (firstRoster.presentIds.length < 8) {
    await timed(rows, 'ensure-roster:sync-roster', async () => {
      const result = await invokeFunction('session-sync-roster', accessToken, sessionId, {
        player_ids: firstRoster.registeredIds,
        revive_checked_out: true,
      })
      return { value: result.payload, detail: result.detail }
    })
  } else {
    rows.push({
      step: 'ensure-roster:sync-roster',
      ms: 0,
      detail: { skipped: true, present: firstRoster.presentIds.length },
    })
  }
  const finalRoster = await detailedRosterRead(client, sessionId, rows, 'ensure-roster:final-roster')
  const playerId = finalRoster.presentIds[0]
  if (!playerId) throw new Error('No present player available')

  await measureEdgeRest(client, accessToken, sessionId, playerId, true, rows, 'rest-on-edge')
  await measureEdgeRest(client, accessToken, sessionId, playerId, false, rows, 'rest-off-edge')

  await measureDirectRestRpc(client, sessionId, playerId, true, rows, 'rest-on-direct-rpc')
  await measureDirectRestRpc(client, sessionId, playerId, false, rows, 'rest-off-direct-rpc')

  console.log(JSON.stringify({
    sessionId,
    host: HOST_EMAIL,
    playerId,
    steps: rows.map((row) => ({
      step: row.step,
      ms: Math.round(row.ms),
      detail: row.detail ?? {},
    })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
