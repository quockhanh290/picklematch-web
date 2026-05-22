import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

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

async function main() {
  if (!ANON_KEY) throw new Error('Missing Supabase anon key')
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { data: auth, error: authError } = await authClient.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
  if (authError) throw authError
  const token = auth.session?.access_token
  if (!token) throw new Error('Host login failed')

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
    realtime: { transport: WebSocket as any },
  })

  const { data: ownerSessions, error: ownerSessionsError } = await client
    .from('owner_sessions')
    .select('id')
    .contains('format_metadata', { benchmark: 'versioned-load-test' })
    .order('created_at', { ascending: false })
    .limit(700)
  if (ownerSessionsError) throw ownerSessionsError

  const sessionIds = (ownerSessions ?? []).map((session) => String(session.id))
  const sessions: Array<{ id: string; live_state_version: number | null }> = []
  for (let index = 0; index < sessionIds.length; index += 100) {
    const batch = sessionIds.slice(index, index + 100)
    const { data, error } = await client
      .from('sessions')
      .select('id, live_state_version')
      .in('id', batch)
    if (error) throw error
    sessions.push(...((data ?? []) as Array<{ id: string; live_state_version: number | null }>))
  }

  const roundRows: Array<{ session_id: string; status: string }> = []
  for (let index = 0; index < sessionIds.length; index += 100) {
    const batch = sessionIds.slice(index, index + 100)
    const { data, error } = await client
      .from('session_rounds')
      .select('session_id, status')
      .in('session_id', batch)
    if (error) throw error
    roundRows.push(...(data ?? []))
  }

  const activeBySession = new Map<string, number>()
  for (const row of roundRows) {
    if (row.status !== 'active') continue
    activeBySession.set(row.session_id, (activeBySession.get(row.session_id) ?? 0) + 1)
  }

  const versions = new Map<number, number>()
  const versionsByActive = new Map<string, number>()
  for (const session of sessions ?? []) {
    const version = Number(session.live_state_version)
    versions.set(version, (versions.get(version) ?? 0) + 1)
    const activeKey = `${activeBySession.has(session.id) ? 'active' : 'inactive'}:v${version}`
    versionsByActive.set(activeKey, (versionsByActive.get(activeKey) ?? 0) + 1)
  }

  console.log(JSON.stringify({
    benchmarkSessions: sessionIds.length,
    activeSessions: activeBySession.size,
    activeRoundsSample: [...activeBySession.entries()].slice(0, 20),
    versionDistribution: [...versions.entries()].sort((a, b) => a[0] - b[0]),
    versionByActive: [...versionsByActive.entries()].sort(([a], [b]) => a.localeCompare(b)),
    roundRows: roundRows.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
