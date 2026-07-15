import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'
const sessionId = process.argv.find(value => value.startsWith('--session-id='))?.split('=')[1]
const requestedCourt = process.argv.find(value => value.startsWith('--court-idx='))?.split('=')[1]

if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment')
if (!sessionId) {
  throw new Error('Usage: npx tsx scripts/diagnostics/probe-manual-plan-mutation.ts --session-id=<id> [--court-idx=<zero-based>]')
}

function partitionKey(teamA: string[], teamB: string[]) {
  return [teamA.slice().sort().join(':'), teamB.slice().sort().join(':')].sort().join('|')
}

function repartition(teamA: string[], teamB: string[]) {
  if (teamA.length !== 2 || teamB.length !== 2) throw new Error('Expected a doubles lineup')
  const candidates = [
    { team_a: [teamA[0], teamB[0]], team_b: [teamA[1], teamB[1]] },
    { team_a: [teamA[0], teamB[1]], team_b: [teamA[1], teamB[0]] },
  ]
  const current = partitionKey(teamA, teamB)
  const changed = candidates.find(candidate => partitionKey(candidate.team_a, candidate.team_b) !== current)
  if (!changed) throw new Error('Unable to construct a different same-four partition')
  return changed
}

async function main() {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.session) throw new Error(authError?.message ?? 'Unable to sign in')

  const [{ data: before, error: snapshotError }, { data: session, error: sessionError }, { data: job, error: jobError }] = await Promise.all([
    client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId }),
    client.from('sessions').select('planning_mutation_version').eq('id', sessionId).single(),
    client
      .from('session_plan_jobs')
      .select('id, court_count, input_payload, result_plan_version_id')
      .eq('session_id', sessionId)
      .eq('status', 'completed')
      .eq('engine_version', 'precomputed-v7-planning-mutation-version')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
  ])
  if (snapshotError) throw snapshotError
  if (sessionError || !session) throw new Error(sessionError?.message ?? 'Unable to load planning version')
  if (jobError || !job) throw new Error(jobError?.message ?? 'No completed v7 plan job')

  const courtIdx = requestedCourt === undefined ? null : Number(requestedCourt)
  const suggestedRows = (before?.live_match_rows ?? []).filter((row: any) => row.status === 'suggested')
  const existing = suggestedRows.find((row: any) => courtIdx === null || Number(row.court_idx) === courtIdx)
  if (!existing) throw new Error('No suggested row found; run probe-session-plan-advisory first')

  const changed = repartition(existing.team_a ?? [], existing.team_b ?? [])
  const versionBefore = Number(session.planning_mutation_version)
  const { data: mutation, error: mutationError } = await client.rpc('replace_manual_live_session_suggestion_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: Number(before.live_state_version),
    p_match: {
      court_idx: Number(existing.court_idx),
      team_a: changed.team_a,
      team_b: changed.team_b,
      resting: existing.resting ?? [],
      round_no: Number(existing.round_no),
    },
    p_audit_payload: { source: 'probe-manual-plan-mutation' },
  })
  if (mutationError) throw mutationError

  const [{ data: after, error: afterError }, { data: updatedSession, error: updatedSessionError }] = await Promise.all([
    client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId }),
    client.from('sessions').select('planning_mutation_version').eq('id', sessionId).single(),
  ])
  if (afterError) throw afterError
  if (updatedSessionError || !updatedSession) throw new Error(updatedSessionError?.message ?? 'Unable to reload planning version')
  const versionAfter = Number(updatedSession.planning_mutation_version)
  const persisted = (after?.live_match_rows ?? []).find((row: any) => (
    row.status === 'suggested' && Number(row.court_idx) === Number(existing.court_idx)
  ))

  const requestId = `manual-plan-mutation-${crypto.randomUUID()}`
  const state = job.input_payload?.state ?? {}
  const planner = job.input_payload?.planner ?? {}
  const response = await fetch(`${supabaseUrl}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.session.access_token}`,
      apikey: anonKey!,
      'Content-Type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      count: 1,
      mode: 'replace_courts',
      court_count: Number(job.court_count),
      court_idxs: [Number(existing.court_idx)],
      pvna_tolerance: Number(state.config?.pvna_tolerance ?? 0.5),
      planned_total_rounds: Number(planner.target_rounds ?? state.config?.planned_total_rounds ?? 8),
      court_preset: state.config?.court_preset ?? 'balanced',
      live_state_version: Number(after.live_state_version),
      completing_live_match_ids: [],
      current_preview_board: (after?.live_match_rows ?? []).filter((row: any) => row.status === 'suggested'),
      players: (after?.player_rows ?? []).map((row: any) => ({
        id: row.player_id,
        name: row.players?.name ?? String(row.player_id).slice(0, 8),
      })),
      player_rows: after?.player_rows ?? [],
      pair_rows: after?.pair_rows ?? [],
      round_rows: after?.round_rows ?? [],
    }),
  })
  const responseText = await response.text()
  const responseBody = responseText ? JSON.parse(responseText) : {}
  if (!response.ok || responseBody.ok === false) {
    throw new Error(`Live advisory probe failed (${response.status}): ${responseBody.error ?? responseText}`)
  }

  let audit: any = null
  for (let attempt = 0; attempt < 12 && !audit; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
    const { data } = await client
      .from('session_audit_events')
      .select('response_payload, detail')
      .eq('session_id', sessionId)
      .eq('event_type', 'session_plan_advisory_shadow')
      .eq('request_id', requestId)
      .maybeSingle()
    audit = data
  }

  const decisions = Array.isArray(audit?.detail?.decisions) ? audit.detail.decisions : []
  const targetDecision = decisions.find((decision: any) => Number(decision.court_idx) === Number(existing.court_idx))
  const summary = {
    session_id: sessionId,
    court_idx: Number(existing.court_idx),
    plan_job_id: job.id,
    plan_version_id: job.result_plan_version_id,
    planning_mutation_version_before: versionBefore,
    planning_mutation_version_after: versionAfter,
    version_delta: versionAfter - versionBefore,
    rpc_mutation_kind: mutation?.manual_mutation_kind ?? null,
    persisted_manual_metadata: persisted?.suggestion_metadata ?? null,
    advisory_planning_version_matches: audit?.response_payload?.planning_version_matches ?? null,
    advisory_status: targetDecision?.status ?? null,
    advisory_reasons: targetDecision?.reasons ?? [],
    edge_payload_count: responseBody.payloads?.length ?? 0,
    audit_found: Boolean(audit),
  }
  console.log(JSON.stringify(summary, null, 2))

  const passed = summary.version_delta === 1
    && summary.rpc_mutation_kind === 'manual_team_repartition'
    && summary.persisted_manual_metadata?.manual_override === true
    && summary.advisory_status === 'fallback'
    && summary.advisory_reasons.includes('manual_team_repartition')
    && summary.edge_payload_count > 0
  if (!passed) process.exitCode = 1
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
