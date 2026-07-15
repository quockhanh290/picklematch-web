import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'
const sessionId = process.argv.find(value => value.startsWith('--session-id='))?.split('=')[1]

if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment')
if (!sessionId) throw new Error('Usage: npx tsx scripts/diagnostics/probe-session-plan-advisory.ts --session-id=<id>')

async function main() {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.session) throw new Error(authError?.message ?? 'Unable to sign in')

  const [{ data: snapshot, error: snapshotError }, { data: job, error: jobError }] = await Promise.all([
    client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId }),
    client
      .from('session_plan_jobs')
      .select('id, court_count, input_payload, result_plan_version_id')
      .eq('session_id', sessionId)
      .eq('status', 'completed')
      .eq('engine_version', 'precomputed-v8-rolling-frontier')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
  ])
  if (snapshotError) throw snapshotError
  if (jobError || !job) throw new Error(jobError?.message ?? 'No completed v8 plan job')

  const state = job.input_payload?.state ?? {}
  const planner = job.input_payload?.planner ?? {}
  const requestId = `plan-advisory-smoke-${crypto.randomUUID()}`
  const startedAt = performance.now()
  const response = await fetch(`${supabaseUrl}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.session.access_token}`,
      apikey: anonKey!,
      'Content-Type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      count: Number(job.court_count),
      mode: 'full_board',
      court_count: Number(job.court_count),
      pvna_tolerance: Number(state.config?.pvna_tolerance ?? 0.5),
      planned_total_rounds: Number(planner.target_rounds ?? state.config?.planned_total_rounds ?? 8),
      court_preset: state.config?.court_preset ?? 'balanced',
      live_state_version: Number(snapshot?.live_state_version),
      completing_live_match_ids: [],
      players: (snapshot?.player_rows ?? []).map((row: any) => ({
        id: row.player_id,
        name: row.players?.name ?? String(row.player_id).slice(0, 8),
      })),
      player_rows: snapshot?.player_rows ?? [],
      pair_rows: snapshot?.pair_rows ?? [],
      round_rows: snapshot?.round_rows ?? [],
    }),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  console.log(JSON.stringify({
    session_id: sessionId,
    request_id: requestId,
    plan_job_id: job.id,
    plan_version_id: job.result_plan_version_id,
    status: response.status,
    wall_ms: Math.round(performance.now() - startedAt),
    ok: response.ok && body.ok !== false,
    payload_count: body.payloads?.length ?? 0,
    final_preview_board_count: body.final_preview_board?.length ?? 0,
    missing_target_courts: body.missing_target_courts ?? [],
    error: body.error ?? null,
  }, null, 2))
  if (!response.ok || body.ok === false) process.exitCode = 1
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
