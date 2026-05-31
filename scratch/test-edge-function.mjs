import { readFileSync } from 'fs'

const env = readFileSync('.env', 'utf8')
const url = env.match(/EXPO_PUBLIC_SUPABASE_URL="?([^"\n]+)"?/)?.[1]?.trim()
const anon = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY="?([^"\n]+)"?/)?.[1]?.trim()

async function rest(path, method = 'GET', body = null, token) {
  const res = await fetch(url + path, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token || anon}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try { return { status: res.status, data: JSON.parse(text) }
  } catch { return { status: res.status, data: text } }
}

async function test() {
  // Sign in
  const { data: auth } = await rest('/auth/v1/token?grant_type=password', 'POST', { email: 'host@test.com', password: 'Pickle123!' })
  if (!auth.access_token) { console.error('Auth failed:', auth); return }
  const token = auth.access_token
  const userId = auth.user.id
  console.log('Signed in:', auth.user.email)

  // Get latest session
  const { data: sessions } = await rest(
    `/rest/v1/sessions?host_id=eq.${userId}&check_in_completed=eq.true&order=created_at.desc&limit=1&select=id,status`,
    'GET', null, token
  )
  const sessionId = sessions?.[0]?.id
  if (!sessionId) { console.log('No session found, sessions:', JSON.stringify(sessions)); return }
  console.log('Session:', sessionId, 'status:', sessions[0].status)

  // Get snapshot
  const { status: snapStatus, data: snap } = await rest(
    '/rest/v1/rpc/get_live_session_snapshot_versioned', 'POST',
    { p_session_id: sessionId }, token
  )
  console.log('Snapshot status:', snapStatus)
  if (snapStatus !== 200) { console.log('Snap error:', JSON.stringify(snap)); return }
  console.log('players:', snap.player_rows?.length ?? 0, 'pairs:', snap.pair_rows?.length ?? 0,
    'rounds:', snap.round_rows?.length ?? 0, 'live:', snap.live_match_rows?.length ?? 0,
    'version:', snap.live_state_version)

  if (!snap.player_rows?.length) { console.log('No player rows — session has no live state'); return }

  const body = {
    count: 2,
    court_count: 1,
    pvna_tolerance: 0.5,
    live_match_rows: snap.live_match_rows ?? [],
    live_state_version: snap.live_state_version,
    completing_live_match_ids: [],
    players: (snap.player_rows ?? []).map(p => ({ id: p.player_id, name: 'P' })),
    player_rows: snap.player_rows ?? [],
    pair_rows: snap.pair_rows ?? [],
    round_rows: snap.round_rows ?? [],
  }
  console.log('Payload bytes:', JSON.stringify(body).length)

  const { status, data: result } = await rest(
    `/functions/v1/session-live-matches-suggest?session_id=${sessionId}`,
    'POST', body, token
  )
  console.log('Edge Function status:', status)
  console.log('ok:', result.ok)
  if (result.error) console.log('error:', result.error)
  if (result.payloads) {
    console.log('payloads:', result.payloads.length)
    if (result.payloads[0]) {
      const p = result.payloads[0]
      console.log('Match 0: court', p.court_idx, 'team_a:', p.team_a, 'vs team_b:', p.team_b)
    }
  }
  if (result.debug) console.log('debug:', JSON.stringify(result.debug))
}

test().catch(e => console.error('FATAL:', e.message, e.stack?.split('\n')[1]))
