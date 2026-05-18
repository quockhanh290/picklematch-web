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

  await resolveNextRoundSession(supabaseUrl, apiKey)
}

async function resolveNextRoundSession(
  supabaseUrl: string,
  apiKey: string,
) {
  try {
    // Authenticate trực tiếp bằng host@test.com để lấy access token
    const accessToken = await signInAsHost(supabaseUrl, apiKey)
    if (!accessToken) {
      console.warn(`[e2e/global-setup] Không đăng nhập được "${HOST_EMAIL}" — dùng fallback.`)
      writeSessionContext({ sessionId: null, hostEmail: HOST_EMAIL, source: 'not_found' })
      return
    }

    const session = await fetchLatestSessionByToken(supabaseUrl, apiKey, accessToken)
    if (session) {
      console.log(`[e2e/global-setup] Session mới nhất của ${HOST_EMAIL}: ${session.id} (${session.status})`)
      // Reset session về trạng thái clean trước khi test (xóa rounds + player state cũ)
      await resetSessionForTest(supabaseUrl, apiKey, accessToken, session.id, session.status)
      writeSessionContext({ sessionId: session.id, hostEmail: HOST_EMAIL, source: 'db_query' })
      await prewarmSyncRoster(supabaseUrl, apiKey, accessToken, session.id)
      return
    }

    console.warn(`[e2e/global-setup] "${HOST_EMAIL}" không có host session nào có player confirmed — dùng fallback.`)
    writeSessionContext({ sessionId: null, hostEmail: HOST_EMAIL, source: 'no_sessions' })
  } catch (err) {
    console.warn('[e2e/global-setup] Lỗi khi query session:', err)
    writeSessionContext({ sessionId: null, hostEmail: HOST_EMAIL, source: 'error' })
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

async function resetSessionForTest(
  supabaseUrl: string,
  apiKey: string,
  accessToken: string,
  sessionId: string,
  currentStatus: string,
): Promise<void> {
  const headers = { apikey: apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }

  // 1. Nếu session đã 'done', reopen về 'open' để tests có thể chạy
  if (currentStatus !== 'open') {
    const reopenRes = await fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'open' }),
    })
    if (reopenRes.ok) {
      console.log(`[e2e/global-setup] Reopened session ${sessionId} từ '${currentStatus}' → 'open'`)
    } else {
      console.warn(`[e2e/global-setup] Không reopen được session (${reopenRes.status}) — tiếp tục...`)
    }
  }

  // 2. Xóa session_rounds để reset về fresh (không có vòng nào đã chạy)
  const roundsRes = await fetch(`${supabaseUrl}/rest/v1/session_rounds?session_id=eq.${sessionId}`, {
    method: 'DELETE',
    headers,
  })
  if (roundsRes.ok) {
    console.log(`[e2e/global-setup] Cleared session_rounds cho session ${sessionId}`)
  } else {
    console.warn(`[e2e/global-setup] Không xóa được session_rounds (${roundsRes.status})`)
  }

  // 3. Xóa session_player_state cũ để pre-sync sẽ tạo fresh data
  const stateRes = await fetch(`${supabaseUrl}/rest/v1/session_player_state?session_id=eq.${sessionId}`, {
    method: 'DELETE',
    headers,
  })
  if (stateRes.ok) {
    console.log(`[e2e/global-setup] Cleared session_player_state cho session ${sessionId}`)
  } else {
    console.warn(`[e2e/global-setup] Không xóa được session_player_state (${stateRes.status})`)
  }

  // 4. Xóa session_pair_history để model bắt đầu tính toán từ đầu
  const historyRes = await fetch(`${supabaseUrl}/rest/v1/session_pair_history?session_id=eq.${sessionId}`, {
    method: 'DELETE',
    headers,
  })
  if (historyRes.ok) {
    console.log(`[e2e/global-setup] Cleared session_pair_history cho session ${sessionId}`)
  } else {
    console.warn(`[e2e/global-setup] Không xóa được session_pair_history (${historyRes.status})`)
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
): Promise<{ id: string; status: string } | null> {
  // Decode JWT để lấy user ID → chỉ query sessions mà user là HOST
  const userId = getUserIdFromToken(accessToken)
  if (!userId) {
    console.warn('[e2e/global-setup] Không decode được user ID từ token.')
    return null
  }

  // Lấy 10 session gần nhất mà user là host, tìm session có ít nhất 1 player confirmed
  const res = await fetch(
    `${supabaseUrl}/rest/v1/sessions?host_id=eq.${userId}&order=created_at.desc&limit=10&select=id,status`,
    { headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return null
  const sessions = await res.json() as Array<{ id: string; status: string }>

  for (const session of sessions) {
    const playersRes = await fetch(
      `${supabaseUrl}/rest/v1/session_players?session_id=eq.${session.id}&status=eq.confirmed&limit=1&select=player_id`,
      { headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` } }
    )
    if (playersRes.ok) {
      const players = await playersRes.json() as Array<{ player_id: string }>
      if (players.length > 0) {
        console.log(`[e2e/global-setup] Session ${session.id} (${session.status}) là host session có player confirmed.`)
        return session
      }
    }
  }

  // Không tìm thấy host session nào có player → trả null để dùng fallback seeded session
  console.warn(`[e2e/global-setup] Không có host session nào có player confirmed — sẽ dùng fallback seeded session.`)
  return null
}


function writeSessionContext(data: { sessionId: string | null; hostEmail: string; source: string }) {
  fs.mkdirSync(path.dirname(SESSION_CONTEXT_PATH), { recursive: true })
  fs.writeFileSync(SESSION_CONTEXT_PATH, JSON.stringify(data, null, 2), 'utf8')
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
