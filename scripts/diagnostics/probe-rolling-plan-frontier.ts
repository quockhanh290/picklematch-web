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
if (!sessionId) throw new Error('Usage: npx tsx scripts/diagnostics/probe-rolling-plan-frontier.ts --session-id=<id>')

const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function loadAdvisoryAudit(clientRequestId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managementToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          select response_payload, detail
          from public.session_audit_events
          where client_request_id = '${clientRequestId}'
            and event_type = 'session_plan_advisory_shadow'
          order by created_at desc
          limit 1
        `,
      }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Management query failed (${response.status}): ${text}`)
    const rows = text ? JSON.parse(text) : []
    if (rows[0]) {
      const decisions = Array.isArray(rows[0].detail?.decisions) ? rows[0].detail.decisions : []
      return {
        ...rows[0].response_payload,
        reasons: [...new Set(decisions.flatMap((decision: any) => decision.reasons ?? []))].sort(),
      }
    }
    await sleep(500)
  }
  throw new Error(`Advisory audit not found for ${clientRequestId}`)
}

async function invokeLive(
  token: string,
  functionName: string,
  body: Record<string, unknown>,
) {
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

async function invokeAdvisory(
  token: string,
  snapshot: any,
  job: any,
) {
  const state = job.input_payload?.state ?? {}
  const planner = job.input_payload?.planner ?? {}
  const courtCount = Number(job.input_payload?.planner?.court_count ?? state.config?.courts ?? 6)
  const clientRequestId = `rolling-frontier-advisory-${crypto.randomUUID()}`
  const startedAt = performance.now()
  const response = await fetch(`${supabaseUrl}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey!,
      'Content-Type': 'application/json',
      'x-request-id': clientRequestId,
    },
    body: JSON.stringify({
      count: courtCount,
      mode: 'full_board',
      court_count: courtCount,
      pvna_tolerance: Number(state.config?.pvna_tolerance ?? 0.5),
      planned_total_rounds: Number(planner.target_rounds ?? state.config?.planned_total_rounds ?? 8),
      court_preset: state.config?.court_preset ?? 'balanced',
      live_state_version: Number(snapshot.live_state_version),
      completing_live_match_ids: [],
      players: (snapshot.player_rows ?? []).map((row: any) => ({
        id: row.player_id,
        name: row.players?.name ?? String(row.player_id).slice(0, 8),
      })),
      player_rows: snapshot.player_rows ?? [],
      pair_rows: snapshot.pair_rows ?? [],
      round_rows: snapshot.round_rows ?? [],
    }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload.ok === false) {
    throw new Error(`session-live-matches-suggest failed (${response.status}): ${payload.error ?? text}`)
  }
  return {
    client_request_id: clientRequestId,
    wall_ms: Math.round(performance.now() - startedAt),
    payload_count: payload.payloads?.length ?? 0,
    final_preview_board_count: payload.final_preview_board?.length ?? 0,
    missing_target_courts: payload.missing_target_courts ?? [],
  }
}

async function main() {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.session) throw new Error(authError?.message ?? 'Unable to sign in')

  const { data: before, error: beforeError } = await client.rpc('get_live_session_snapshot_versioned', {
    p_session_id: sessionId,
  })
  if (beforeError) throw beforeError
  const suggested = (before?.live_match_rows ?? []).find((row: any) => row.status === 'suggested')
  if (!suggested?.id) throw new Error('No suggested match available for rolling probe')

  let startedMatchId: string | null = null
  try {
    const started = await invokeLive(auth.session.access_token, 'session-live-matches-start', {
      expected_live_state_version: Number(before.live_state_version),
      match_id: suggested.id,
      audit_payload: { source: 'probe-rolling-plan-frontier' },
    })
    startedMatchId = String(started.match?.id ?? suggested.id)

    const chunkResults: any[] = []
    let final: any = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await client.functions.invoke('session-plan-shadow', {
        body: {
          session_id: sessionId,
          planned_round_count: 2,
          local_search_passes: 1,
          persist: true,
          chunked: true,
        },
      })
      if (error || data?.ok === false) {
        throw new Error(error?.message ?? data?.error ?? 'Rolling planner invocation failed')
      }
      chunkResults.push(data)
      final = data
      if (data.completed !== false) break
    }
    if (!final?.completed) throw new Error('Rolling planner did not finish its two-round suffix')

    const { data: job, error: jobError } = await client
      .from('session_plan_jobs')
      .select('id, engine_version, input_payload, planned_round_count, status')
      .eq('id', final.job_id)
      .single()
    if (jobError || !job) throw new Error(jobError?.message ?? 'Unable to load rolling planner job')

    const { data: liveSnapshot, error: liveSnapshotError } = await client.rpc(
      'get_live_session_snapshot_versioned',
      { p_session_id: sessionId },
    )
    if (liveSnapshotError) throw liveSnapshotError
    const advisory = await invokeAdvisory(auth.session.access_token, liveSnapshot, job)
    const advisoryAudit = await loadAdvisoryAudit(advisory.client_request_id)

    const summary = {
      session_id: sessionId,
      started_match_id: startedMatchId,
      engine_version: job.engine_version,
      job_id: job.id,
      job_status: job.status,
      planned_round_count: job.planned_round_count,
      fixed_commitment_count: job.input_payload?.frontier?.fixed_commitment_count ?? null,
      busy_player_count: job.input_payload?.frontier?.busy_player_count ?? null,
      checkpoint_calls: chunkResults.length,
      completed_while_live: true,
      advisory,
      advisory_audit: advisoryAudit,
    }
    console.log(JSON.stringify(summary, null, 2))
    if (summary.engine_version !== 'precomputed-v8-rolling-frontier'
      || summary.fixed_commitment_count < 1
      || summary.busy_player_count < 4
      || summary.job_status !== 'completed'
      || summary.advisory.payload_count < 1
      || summary.advisory.missing_target_courts.length > 0
      || summary.advisory_audit?.counts?.fallback !== 0
      || summary.advisory_audit?.roster_identity_matches !== true
      || summary.advisory_audit?.config_identity_matches !== true
      || summary.advisory_audit?.frontier_matches !== true
      || summary.advisory_audit?.planning_version_matches !== true) {
      process.exitCode = 1
    }
  } finally {
    if (startedMatchId) {
      const { data: current, error: currentError } = await client.rpc('get_live_session_snapshot_versioned', {
        p_session_id: sessionId,
      })
      if (currentError) throw currentError
      await invokeLive(auth.session.access_token, 'session-live-matches-cancel', {
        expected_live_state_version: Number(current.live_state_version),
        match_id: startedMatchId,
        audit_payload: { source: 'probe-rolling-plan-frontier-cleanup' },
      })
    }
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
