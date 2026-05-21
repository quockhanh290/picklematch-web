import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

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

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

async function getHostClient() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { data: auth, error } = await authClient.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
  if (error) throw error
  if (!auth.session?.access_token || !auth.user?.id) throw new Error('Host login failed')

  const host = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
    global: { headers: { Authorization: `Bearer ${auth.session.access_token}` } },
  })
  return { host, hostUserId: auth.user.id, accessToken: auth.session.access_token }
}

async function invokeFunction(
  functionName: string,
  accessToken: string,
  sessionId: string,
  body: Record<string, unknown>,
) {
  const params = new URLSearchParams({ session_id: sessionId })
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

async function seedOneSession(
  host: SupabaseAny,
  accessToken: string,
  hostUserId: string,
  courtId: string,
  playerRows: Array<Record<string, unknown>>,
  index: number,
  offset: number,
) {
  const now = Date.now()
  const slotIndex = offset + index
  const slotBase = now
    + (90 + slotIndex) * 24 * 60 * 60 * 1000
    + (slotIndex % 8) * 3 * 60 * 60 * 1000

  const { data: sessionId, error } = await host.rpc('create_owner_session', {
    p_court_id: courtId,
    p_start_time: new Date(slotBase).toISOString(),
    p_end_time: new Date(slotBase + 2 * 60 * 60 * 1000).toISOString(),
    p_elo_min: 0,
    p_elo_max: 9999,
    p_is_ranked: false,
    p_max_players: 40,
    p_fill_deadline: new Date(now + 60 * 60 * 1000).toISOString(),
    p_total_cost: 0,
    p_require_approval: false,
    p_format_type: 'social',
    p_sub_court_numbers: [1, 2, 3, 4, 5, 6],
    p_is_unlimited: false,
    p_host_is_playing: true,
    p_format_metadata: {
      benchmark: 'versioned-load-test',
      seed_index: slotIndex,
      seeded_at: new Date().toISOString(),
    },
    p_require_results: false,
    p_match_format: 'doubles',
    p_host_gender: null,
    p_host_skill: null,
  })
  if (error) throw error
  const id = String(sessionId)

  const rows = playerRows.map((row) => ({
    ...row,
    session_id: id,
  }))
  if (rows.length > 0) {
    const { error: insertError } = await host.from('session_players').insert(rows)
    if (insertError) throw insertError
  }

  const playerIds = rows.map((row) => String(row.player_id))
  await invokeFunction('session-sync-roster', accessToken, id, {
    player_ids: [hostUserId, ...playerIds],
    revive_checked_out: true,
  })

  const { data: session, error: sessionError } = await host
    .from('sessions')
    .select('live_state_version')
    .eq('id', id)
    .single()
  if (sessionError) throw sessionError
  return {
    id,
    players: playerIds.length + 1,
    live_state_version: Number(session.live_state_version),
  }
}

async function main() {
  const count = Math.max(1, Number(argValue('--count', '20')))
  const playerCount = Math.max(8, Number(argValue('--players', '40')))
  const offset = Math.max(0, Number(argValue('--offset', '0')))
  const { host, accessToken, hostUserId } = await getHostClient()

  const { data: courts, error: courtsError } = await host
    .from('courts')
    .select('id')
    .limit(1)
  if (courtsError) throw courtsError
  const courtId = courts?.[0]?.id
  if (!courtId) throw new Error('No court found')

  const sourceLimit = Math.max(0, playerCount - 1)
  const { data: sourcePlayers, error: playersError } = await host
    .from('players')
    .select('id, partner_gender_pref, opponent_gender_pref')
    .neq('id', hostUserId)
    .limit(sourceLimit)
  if (playersError) throw playersError
  if ((sourcePlayers?.length ?? 0) < sourceLimit) {
    throw new Error(`Need ${sourceLimit} source players, found ${sourcePlayers?.length ?? 0}`)
  }

  const playerRows = (sourcePlayers ?? []).map((row: any) => ({
    player_id: row.id,
    status: 'confirmed',
    check_in_status: 'present',
    metadata: {
      partner_gender_pref: row.partner_gender_pref ?? null,
      opponent_gender_pref: row.opponent_gender_pref ?? null,
    },
  }))

  const rows = []
  const startedAt = Date.now()
  for (let index = 0; index < count; index += 1) {
    const row = await seedOneSession(host, accessToken, hostUserId, courtId, playerRows, index, offset)
    rows.push(row)
    console.log(`seeded ${index + 1}/${count} ${row.id} players=${row.players} version=${row.live_state_version}`)
  }

  console.log(JSON.stringify({
    count,
    playerCount,
    offset,
    elapsedMs: Date.now() - startedAt,
    sessionIds: rows.map((row) => row.id),
    rows,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
