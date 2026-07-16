import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const managementToken = process.env.SUPABASE_ACCESS_TOKEN
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'
const sessionId = process.argv.find(value => value.startsWith('--session-id='))?.split('=')[1]

if (!supabaseUrl || !anonKey || !managementToken) throw new Error('Missing Supabase environment')
if (!sessionId) throw new Error('Usage: npx tsx scripts/diagnostics/probe-rolling-horizon-canary.ts --session-id=<id>')

const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function invoke(token: string, functionName: string, body: Record<string, unknown>) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload.ok === false) {
    throw new Error(`${functionName} failed (${response.status}): ${payload.error ?? text}`)
  }
  return payload
}

function suggestBody(
  snapshot: any,
  courtCount: number,
  config: { court_preset: string; avoid_pairs: unknown[] },
  extra: Record<string, unknown>,
) {
  return {
    court_count: courtCount,
    pvna_tolerance: Number(snapshot?.pvna_tolerance ?? 0.5),
    planned_total_rounds: Number(snapshot?.planned_total_rounds ?? 8),
    live_state_version: Number(snapshot.live_state_version),
    players: (snapshot.player_rows ?? []).map((row: any) => ({
      id: row.player_id,
      name: row.players?.name ?? String(row.player_id).slice(0, 8),
    })),
    player_rows: snapshot.player_rows ?? [],
    pair_rows: snapshot.pair_rows ?? [],
    round_rows: snapshot.round_rows ?? [],
    court_preset: config.court_preset,
    current_courts: courtCount,
    avoid_pairs: config.avoid_pairs,
    ...extra,
  }
}

async function loadRollingEvent(since: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managementToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          select created_at, detail, court_count, available
          from public.engine_instrumentation
          where session_id = '${sessionId}'
            and event = 'rolling_horizon'
            and created_at >= '${since}'::timestamptz
          order by created_at desc
          limit 1
        `,
      }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Management query failed (${response.status}): ${text}`)
    const rows = text ? JSON.parse(text) : []
    if (rows[0]) return rows[0]
    await sleep(500)
  }
  throw new Error('rolling_horizon instrumentation event was not written')
}

async function main() {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.session) throw new Error(authError?.message ?? 'Unable to sign in')
  const token = auth.session.access_token
  const [{ data: settings, error: settingsError }, { data: avoidPairs, error: avoidPairsError }] = await Promise.all([
    client
      .from('session_next_round_settings')
      .select('court_preset')
      .eq('session_id', sessionId)
      .maybeSingle(),
    client
      .from('session_avoid_pairs')
      .select('player_a, player_b, reason')
      .eq('session_id', sessionId),
  ])
  if (settingsError) throw settingsError
  if (avoidPairsError) throw avoidPairsError
  const suggestConfig = {
    court_preset: settings?.court_preset ?? 'balanced',
    avoid_pairs: avoidPairs ?? [],
  }
  const snapshotResponse = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
  if (snapshotResponse.error) throw snapshotResponse.error
  const initial = snapshotResponse.data
  const suggestions = (initial.live_match_rows ?? []).filter((row: any) => row.status === 'suggested')
  if (suggestions.length < 2) throw new Error('Canary requires at least two suggested lanes')
  const startedSuggestion = suggestions[0]
  const targetSuggestion = suggestions[1]
  const courtCount = Number(initial.court_count ?? initial.session?.court_count ?? 6)
  let startedMatchId: string | null = null

  try {
    const started = await invoke(token, 'session-live-matches-start', {
      expected_live_state_version: Number(initial.live_state_version),
      match_id: startedSuggestion.id,
      audit_payload: { source: 'probe-rolling-horizon-canary' },
    })
    startedMatchId = String(started.match?.id ?? startedSuggestion.id)
    for (const suggestion of suggestions.slice(1)) {
      const currentResponse = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
      if (currentResponse.error) throw currentResponse.error
      const currentSuggestion = (currentResponse.data.live_match_rows ?? [])
        .find((row: any) => row.id === suggestion.id && row.status === 'suggested')
      if (!currentSuggestion) continue
      await invoke(token, 'session-live-matches-cancel', {
        expected_live_state_version: Number(currentResponse.data.live_state_version),
        match_id: currentSuggestion.id,
        audit_payload: { source: 'probe-rolling-horizon-canary-clear-preview' },
      })
    }
    const activeResponse = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
    if (activeResponse.error) throw activeResponse.error
    const active = activeResponse.data
    let planResult: any = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await client.functions.invoke('session-plan-shadow', {
        body: {
          session_id: sessionId,
          planned_round_count: 2,
          local_search_passes: 1,
          persist: true,
          chunked: true,
        },
      })
      if (response.error || response.data?.ok === false) {
        throw new Error(response.error?.message ?? response.data?.error ?? 'Canary suffix replan failed')
      }
      planResult = response.data
      if (response.data?.completed !== false) break
    }
    if (!planResult?.completed) throw new Error('Canary suffix replan did not complete')
    const plannedResponse = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
    if (plannedResponse.error) throw plannedResponse.error
    const planned = plannedResponse.data
    const activeSuggestions = (planned.live_match_rows ?? []).filter((row: any) => row.status === 'suggested')
    const startedAt = new Date().toISOString()
    const requestStartedAt = performance.now()
    const result = await invoke(token, 'session-live-matches-suggest', suggestBody(planned, courtCount, suggestConfig, {
      count: 1,
      mode: 'replace_courts',
      court_idxs: [Number(targetSuggestion.court_idx)],
      current_preview_board: activeSuggestions,
      completing_live_match_ids: [],
    }))
    const wallMs = Math.round(performance.now() - requestStartedAt)
    const event = await loadRollingEvent(startedAt)
    const summary = {
      session_id: sessionId,
      started_match_id: startedMatchId,
      plan_job_id: planResult.job_id ?? null,
      plan_version_id: planResult.plan_version_id ?? null,
      target_court_idx: Number(targetSuggestion.court_idx),
      wall_ms: wallMs,
      payload_count: result.payloads?.length ?? 0,
      missing_target_courts: result.missing_target_courts ?? [],
      rolling_target_loaded: result.plan_consumption?.rolling_target_loaded ?? null,
      instrumentation: event,
    }
    console.log(JSON.stringify(summary, null, 2))
    if (
      summary.payload_count !== 1
      || summary.missing_target_courts.length > 0
      || summary.rolling_target_loaded !== true
    ) process.exitCode = 1
  } finally {
    if (startedMatchId) {
      const currentResponse = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
      if (currentResponse.error) throw currentResponse.error
      await invoke(token, 'session-live-matches-cancel', {
        expected_live_state_version: Number(currentResponse.data.live_state_version),
        match_id: startedMatchId,
        audit_payload: { source: 'probe-rolling-horizon-canary-cleanup' },
      })
      const cleanupResponse = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
      if (cleanupResponse.error) throw cleanupResponse.error
      await invoke(token, 'session-live-matches-suggest', suggestBody(cleanupResponse.data, courtCount, suggestConfig, {
        count: courtCount,
        mode: 'full_board',
        completing_live_match_ids: [],
      }))
    }
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
