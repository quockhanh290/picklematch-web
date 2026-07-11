import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const SESSION_CONTEXT_PATH = path.resolve(process.cwd(), 'e2e/.auth/session-context.json')
const HOST_EMAIL = 'host@test.com'
const HOST_PASSWORD = '123456'

export default async function globalSetup() {
  const serviceRoleKey = readFromDotEnv('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.warn(
      '\n[e2e/global-setup] SUPABASE_SERVICE_ROLE_KEY not set — skipping DB seed.\n' +
        'Tests will run against existing data. To seed: set SUPABASE_SERVICE_ROLE_KEY.\n'
    )
  } else {
    console.log('\n[e2e/global-setup] Seeding dummy data...')
    await runSeed(serviceRoleKey)
    console.log('[e2e/global-setup] Seed complete.\n')
  }

  const supabaseUrl =
    readFromDotEnv('EXPO_PUBLIC_SUPABASE_URL') ??
    readFromDotEnv('SUPABASE_URL') ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL

  if (!supabaseUrl) {
    console.warn('[e2e/global-setup] Không tìm thấy SUPABASE_URL — bỏ qua resolve session.')
    return
  }

  const apiKey =
    serviceRoleKey ??
    readFromDotEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

  if (!apiKey) {
    console.warn('[e2e/global-setup] Không tìm thấy SUPABASE_KEY — bỏ qua resolve session.')
    return
  }

  await resolveNextRoundSession(supabaseUrl, apiKey, serviceRoleKey)
}

async function resolveNextRoundSession(
  supabaseUrl: string,
  apiKey: string,
  serviceRoleKey?: string,
) {
  try {
    // Authenticate trực tiếp bằng host@test.com để lấy access token
    const accessToken = await signInAsHost(supabaseUrl, apiKey)
    if (!accessToken) {
      console.warn(`[e2e/global-setup] Không đăng nhập được "${HOST_EMAIL}" — dùng fallback.`)
      writeSessionContext({ sessionId: null, slotId: null, hostEmail: HOST_EMAIL, source: 'not_found' })
      return
    }

    const sourceSession = await fetchLatestSessionByToken(supabaseUrl, apiKey, accessToken)
    if (sourceSession && serviceRoleKey) {
      const disposable = await createDisposableNextRoundSession({
        supabaseUrl, apiKey, serviceRoleKey, accessToken, sourceSession,
      })
      writeSessionContext({ ...disposable, hostEmail: HOST_EMAIL, source: 'disposable' })
      await prewarmSyncRoster(supabaseUrl, apiKey, accessToken, disposable.sessionId)
      return
    }

    console.warn('[e2e/global-setup] Cannot provision disposable session; next-round lifecycle tests will skip.')
    writeSessionContext({ sessionId: null, slotId: null, hostEmail: HOST_EMAIL, source: 'unavailable' })
  } catch (err) {
    console.warn('[e2e/global-setup] Lỗi khi query session:', err)
    writeSessionContext({ sessionId: null, slotId: null, hostEmail: HOST_EMAIL, source: 'error' })
  }
}

async function signInAsHost(supabaseUrl: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: HOST_EMAIL, password: HOST_PASSWORD }),
    })
    if (!res.ok) {
      console.warn(`[e2e/global-setup] signInAsHost thất bại (${res.status})`)
      return null
    }
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}

function getUserIdFromToken(token: string): string | null {
  try {
    const [, payload] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return decoded.sub ?? null
  } catch {
    return null
  }
}

async function fetchLatestSessionByToken(
  supabaseUrl: string,
  apiKey: string,
  accessToken: string,
): Promise<{ id: string; status: string; court_id: string; elo_min: number; elo_max: number; max_players: number } | null> {
  // Decode JWT để lấy user ID → chỉ query sessions mà user là HOST
  const userId = getUserIdFromToken(accessToken)
  if (!userId) {
    console.warn('[e2e/global-setup] Không decode được user ID từ token.')
    return null
  }

  // Lấy 10 session gần nhất mà user là host, tìm session có ít nhất 1 player confirmed
  const res = await fetch(
    `${supabaseUrl}/rest/v1/sessions?host_id=eq.${userId}&order=created_at.desc&limit=10&select=id,status,court_id,elo_min,elo_max,max_players`,
    { headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return null
  const sessions = await res.json() as Array<{ id: string; status: string; court_id: string; elo_min: number; elo_max: number; max_players: number }>

  for (const session of sessions) {
    const playersRes = await fetch(
      `${supabaseUrl}/rest/v1/session_players?session_id=eq.${session.id}&status=eq.confirmed&limit=8&select=player_id`,
      { headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` } }
    )
    if (playersRes.ok) {
      const players = await playersRes.json() as Array<{ player_id: string }>
      if (players.length >= 8) {
        console.log(`[e2e/global-setup] Session ${session.id} (${session.status}) là host session có player confirmed.`)
        return session
      }
    }
  }

  // Không tìm thấy host session nào có player → trả null để dùng fallback seeded session
  console.warn(`[e2e/global-setup] Không có host session nào có player confirmed — sẽ dùng fallback seeded session.`)
  return null
}


function writeSessionContext(data: { sessionId: string | null; slotId: string | null; hostEmail: string; source: string }) {
  fs.mkdirSync(path.dirname(SESSION_CONTEXT_PATH), { recursive: true })
  fs.writeFileSync(SESSION_CONTEXT_PATH, JSON.stringify(data, null, 2), 'utf8')
}

async function createDisposableNextRoundSession({
  supabaseUrl,
  apiKey,
  serviceRoleKey,
  accessToken,
  sourceSession,
}: {
  supabaseUrl: string
  apiKey: string
  serviceRoleKey: string
  accessToken: string
  sourceSession: { id: string; court_id: string; elo_min: number; elo_max: number; max_players: number }
}): Promise<{ sessionId: string; slotId: string }> {
  const start = new Date(Date.now() + 45 * 86_400_000 + Math.floor(Math.random() * 86_400_000))
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const createRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_session_with_host`, {
    method: 'POST',
    headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_court_id: sourceSession.court_id,
      p_start_time: start.toISOString(),
      p_end_time: end.toISOString(),
      p_price: 0,
      p_elo_min: sourceSession.elo_min,
      p_elo_max: sourceSession.elo_max,
      p_is_ranked: false,
      p_max_players: Math.max(8, sourceSession.max_players),
      p_fill_deadline: new Date(start.getTime() - 86_400_000).toISOString(),
      p_total_cost: 0,
      p_require_approval: false,
      p_court_booking_status: 'confirmed',
      p_booking_reference: `E2E-${Date.now()}`,
      p_booking_name: 'Playwright disposable session',
      p_booking_phone: null,
      p_booking_notes: 'Disposable next-round E2E fixture',
      p_booking_confirmed_at: new Date().toISOString(),
    }),
  })
  if (!createRes.ok) {
    throw new Error(`Could not create disposable session (${createRes.status}): ${await createRes.text()}`)
  }
  const sessionId = String(await createRes.json())
  const serviceHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
  const [sessionRes, playersRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${sessionId}&select=slot_id`, { headers: serviceHeaders }),
    fetch(`${supabaseUrl}/rest/v1/session_players?session_id=eq.${sourceSession.id}&status=eq.confirmed&select=player_id`, { headers: serviceHeaders }),
  ])
  if (!sessionRes.ok || !playersRes.ok) {
    await fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${sessionId}`, { method: 'DELETE', headers: serviceHeaders })
    throw new Error('Could not read disposable fixture dependencies')
  }
  const sessionRows = await sessionRes.json() as Array<{ slot_id: string }>
  const sourcePlayers = await playersRes.json() as Array<{ player_id: string }>
  if (!sessionRows[0]?.slot_id || sourcePlayers.length < 8) {
    await fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${sessionId}`, { method: 'DELETE', headers: serviceHeaders })
    throw new Error('Disposable fixture requires a slot and at least 8 confirmed players')
  }
  const cleanup = async () => {
    await fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${sessionId}`, { method: 'DELETE', headers: serviceHeaders })
    await fetch(`${supabaseUrl}/rest/v1/court_slots?id=eq.${sessionRows[0].slot_id}`, { method: 'DELETE', headers: serviceHeaders })
  }
  const rosterRes = await fetch(`${supabaseUrl}/rest/v1/session_players?on_conflict=session_id,player_id`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(sourcePlayers.map(player => ({
      session_id: sessionId,
      player_id: player.player_id,
      status: 'confirmed',
      check_in_status: 'checked_in',
    }))),
  })
  if (!rosterRes.ok) {
    await cleanup()
    throw new Error(`Could not clone disposable roster (${rosterRes.status}): ${await rosterRes.text()}`)
  }
  const settingsRes = await fetch(`${supabaseUrl}/rest/v1/session_next_round_settings`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      session_id: sessionId,
      court_count_override: 2,
      court_preset: 'balanced',
      court_duration_min: 15,
      pvna_tolerance: 0.5,
      target_rounds: 1,
    }),
  })
  if (!settingsRes.ok) {
    await cleanup()
    throw new Error(`Could not configure disposable session (${settingsRes.status}): ${await settingsRes.text()}`)
  }
  return { sessionId, slotId: sessionRows[0].slot_id }
}

function readFromDotEnv(key: string): string | undefined {
  try {
    const envFile = path.resolve(process.cwd(), '.env')
    if (!fs.existsSync(envFile)) return undefined
    const raw = fs.readFileSync(envFile, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      if (trimmed.slice(0, idx).trim() === key) {
        return trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
      }
    }
  } catch { /* ignore */ }
  return undefined
}

async function prewarmSyncRoster(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  sessionId: string,
): Promise<void> {
  try {
    // Lấy danh sách player đã confirmed
    const playersRes = await fetch(
      `${supabaseUrl}/rest/v1/session_players?session_id=eq.${sessionId}&status=eq.confirmed&select=player_id`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } }
    )
    if (!playersRes.ok) {
      console.warn(`[e2e/global-setup] Không lấy được player list (${playersRes.status}) — bỏ qua pre-sync.`)
      return
    }
    const players = await playersRes.json() as Array<{ player_id: string }>
    if (players.length === 0) {
      console.warn('[e2e/global-setup] Không có player confirmed — bỏ qua pre-sync.')
      return
    }
    const playerIds = players.map(p => String(p.player_id))

    // Gọi edge function session-sync-roster để warm up và populate session_player_state
    console.log(`[e2e/global-setup] Pre-syncing roster cho session ${sessionId} (${playerIds.length} players)...`)
    const syncUrl = `${supabaseUrl}/functions/v1/session-sync-roster?session_id=${sessionId}`
    const syncRes = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ player_ids: playerIds }),
    })

    if (syncRes.ok) {
      console.log(`[e2e/global-setup] Pre-sync thành công (${playerIds.length} players) — session_player_state đã có data.`)
    } else {
      const body = await syncRes.text().catch(() => '')
      console.warn(`[e2e/global-setup] Pre-sync thất bại (${syncRes.status}): ${body.slice(0, 200)}`)
    }
  } catch (err) {
    console.warn('[e2e/global-setup] Lỗi pre-sync:', err)
  }
}

function runSeed(serviceRoleKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'seed-dummy-data.mjs')
    const child = spawn('node', [scriptPath], {
      env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
      stdio: 'inherit',
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Seed script exited with code ${code}`))
    })
    child.on('error', reject)
  })
}
