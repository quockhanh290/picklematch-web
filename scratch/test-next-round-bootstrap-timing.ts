import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

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

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summary(values: number[]) {
  if (values.length === 0) return null
  return {
    count: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    avg: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
  }
}

async function timed<T>(action: () => PromiseLike<T>) {
  const startedAt = Date.now()
  const result = await action()
  return { result, ms: Date.now() - startedAt }
}

async function main() {
  loadLocalEnv()
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  const hostEmail = process.env.HOST_EMAIL ?? 'host@test.com'
  const hostPassword = process.env.HOST_PASSWORD ?? '123456'
  if (!url || !anonKey) throw new Error('Missing Supabase URL or anon key')

  const options = {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  }
  const authClient = createClient(url, anonKey, options)
  const { data: auth, error: authError } = await authClient.auth.signInWithPassword({
    email: hostEmail,
    password: hostPassword,
  })
  if (authError) throw authError
  if (!auth.user || !auth.session) throw new Error('Host login failed')
  const host = createClient(url, anonKey, {
    ...options,
    global: { headers: { Authorization: `Bearer ${auth.session.access_token}` } },
  })

  const { data: courts, error: courtsError } = await host
    .from('courts')
    .select('id')
    .limit(1)
  if (courtsError) throw courtsError
  const courtId = courts?.[0]?.id
  if (!courtId) throw new Error('No court found')

  const now = Date.now()
  const slotBase = now + (30 + Math.floor(Math.random() * 30)) * 24 * 60 * 60 * 1000
  const { data: newSessionId, error: newSessionError } = await host.rpc('create_owner_session', {
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
    p_sub_court_numbers: [1, 2, 3, 4, 5],
    p_is_unlimited: false,
    p_host_is_playing: true,
    p_format_metadata: { benchmark: 'next-round-bootstrap' },
    p_require_results: false,
    p_match_format: 'doubles',
    p_host_gender: null,
    p_host_skill: null,
  })
  if (newSessionError) throw newSessionError
  const newSession = { id: newSessionId as string }

  const { data: sourcePlayers, error: playersError } = await host
    .from('players')
    .select('id,gender,partner_gender_pref,opponent_gender_pref')
    .neq('id', auth.user.id)
    .limit(34)
  if (playersError) throw playersError
  const playerRows = (sourcePlayers ?? []).map((row: any) => ({
    session_id: newSession.id,
    player_id: row.id,
    status: 'confirmed',
    check_in_status: 'present',
    metadata: {
      partner_gender_pref: row.partner_gender_pref ?? null,
      opponent_gender_pref: row.opponent_gender_pref ?? null,
    },
  }))
  if (playerRows.length > 0) {
    const { error: insertPlayersError } = await host.from('session_players').insert(playerRows)
    if (insertPlayersError) throw insertPlayersError
  }

  async function measureBootstrap(variant: 'full' | 'light') {
    const includeMatches = variant === 'full'
    const includeViewerExtras = variant === 'full'
    const totalStartedAt = Date.now()
    const [sessionTiming, matchesTiming] = await Promise.all([
      timed(() => host.rpc('get_session_detail_overview', { p_session_id: newSession.id })),
      includeMatches
        ? timed(() => host.rpc('get_session_matches', { p_session_id: newSession.id }))
        : Promise.resolve({ result: { data: [], error: null }, ms: 0 }),
    ])
    const sessionResult: any = sessionTiming.result
    const matchesResult: any = matchesTiming.result
    if (sessionResult.error) throw sessionResult.error
    if (matchesResult.error) throw matchesResult.error

    let viewerProfileMs = 0
    let ratingsMs = 0
    if (includeViewerExtras) {
      const [viewer, ratings] = await Promise.all([
        timed(() => host.from('players').select('id, elo, current_elo').eq('id', auth.user!.id).single()),
        timed(() => host.from('ratings').select('id').eq('session_id', newSession.id).eq('rater_id', auth.user!.id).limit(1)),
      ])
      const viewerResult: any = viewer.result
      const ratingsResult: any = ratings.result
      if (viewerResult.error) throw viewerResult.error
      if (ratingsResult.error) throw ratingsResult.error
      viewerProfileMs = viewer.ms
      ratingsMs = ratings.ms
    }
    return {
      variant,
      total_ms: Date.now() - totalStartedAt,
      session_detail_ms: sessionTiming.ms,
      matches_ms: includeMatches ? matchesTiming.ms : null,
      viewer_profile_ms: includeViewerExtras ? viewerProfileMs : null,
      ratings_ms: includeViewerExtras ? ratingsMs : null,
      players: sessionResult.data?.session?.session_players?.length ?? null,
    }
  }

  const iterations = Math.max(1, Number(process.argv.find(arg => arg.startsWith('--iterations='))?.split('=')[1] ?? 10))
  const rows = []
  for (let i = 0; i < iterations; i += 1) {
    rows.push(await measureBootstrap('full'))
    rows.push(await measureBootstrap('light'))
  }

  const full = rows.filter(row => row.variant === 'full')
  const light = rows.filter(row => row.variant === 'light')
  console.log(JSON.stringify({
    seededSessionId: newSession.id,
    players: playerRows.length,
    iterations,
    summary: {
      full: {
        total_ms: summary(full.map(row => row.total_ms)),
        session_detail_ms: summary(full.map(row => row.session_detail_ms)),
        matches_ms: summary(full.map(row => row.matches_ms ?? 0)),
        viewer_profile_ms: summary(full.map(row => row.viewer_profile_ms ?? 0)),
        ratings_ms: summary(full.map(row => row.ratings_ms ?? 0)),
      },
      light: {
        total_ms: summary(light.map(row => row.total_ms)),
        session_detail_ms: summary(light.map(row => row.session_detail_ms)),
      },
      speedupAvg: summary(full.map((row, index) => row.total_ms / Math.max(1, light[index]?.total_ms ?? 1))),
    },
    rows,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
