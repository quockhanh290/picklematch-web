import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'
const sessionId = process.argv.find(value => value.startsWith('--session-id='))?.split('=')[1]

if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment')
if (!sessionId) throw new Error('Usage: npx tsx scripts/diagnostics/probe-rolling-plan-frontier.ts --session-id=<id>')

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
    }
    console.log(JSON.stringify(summary, null, 2))
    if (summary.engine_version !== 'precomputed-v8-rolling-frontier'
      || summary.fixed_commitment_count < 1
      || summary.busy_player_count < 4
      || summary.job_status !== 'completed') {
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
