import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const managementToken = process.env.SUPABASE_ACCESS_TOKEN
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

const sessionId = argument('--session-id')
const missingPlanSessionId = argument('--missing-plan-session-id')

if (!supabaseUrl || !anonKey || !managementToken) throw new Error('Missing Supabase environment')
if (!sessionId || !missingPlanSessionId) {
  throw new Error('Usage: npx tsx scripts/diagnostics/probe-phase5a-advisory-matrix.ts --session-id=<id> --missing-plan-session-id=<id>')
}

const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Settings = {
  court_count_override: number | null
  court_preset: 'balanced' | 'play_more' | 'relaxed'
  court_duration_min: number
  pvna_tolerance: number
  target_rounds: number | null
  updated_by?: string | null
}

type AdvisoryAudit = {
  response_payload?: {
    plan_job_id?: string | null
    roster_identity_matches?: boolean | null
    config_identity_matches?: boolean | null
    planning_version_matches?: boolean | null
    frontier_matches?: boolean | null
    counts?: { usable?: number; repair_required?: number; fallback?: number }
  }
  detail?: { decisions?: Array<{ reasons?: string[] }> }
}

function uniqueReasons(audit: AdvisoryAudit | null) {
  return [...new Set((audit?.detail?.decisions ?? []).flatMap(decision => decision.reasons ?? []))].sort()
}

async function managementQuery<T>(query: string): Promise<T[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managementToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Management query failed (${response.status}): ${text}`)
  return text ? JSON.parse(text) as T[] : []
}

async function loadAudit(clientRequestId: string): Promise<AdvisoryAudit> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await managementQuery<AdvisoryAudit>(`
      select response_payload, detail
      from public.session_audit_events
      where client_request_id = '${clientRequestId}'
        and event_type = 'session_plan_advisory_shadow'
      order by created_at desc
      limit 1
    `)
    if (rows[0]) return rows[0]
    await sleep(500)
  }
  throw new Error(`Advisory audit not found for ${clientRequestId}`)
}

async function invokeFunction(token: string, targetSessionId: string, functionName: string, body: Record<string, unknown>) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}?session_id=${targetSessionId}`, {
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

async function loadSettings(client: ReturnType<typeof createClient>, targetSessionId: string): Promise<Settings> {
  const { data, error } = await client
    .from('session_next_round_settings')
    .select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds, updated_by')
    .eq('session_id', targetSessionId)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Missing session settings')
  return {
    court_count_override: data.court_count_override == null ? null : Number(data.court_count_override),
    court_preset: data.court_preset,
    court_duration_min: Number(data.court_duration_min),
    pvna_tolerance: Number(data.pvna_tolerance),
    target_rounds: data.target_rounds == null ? null : Number(data.target_rounds),
    updated_by: data.updated_by,
  }
}

async function saveSettings(client: ReturnType<typeof createClient>, targetSessionId: string, settings: Settings) {
  const { error } = await client.from('session_next_round_settings').upsert({
    session_id: targetSessionId,
    ...settings,
  }, { onConflict: 'session_id' })
  if (error) throw error
}

async function invokeSuggest(client: ReturnType<typeof createClient>, token: string, targetSessionId: string) {
  const [{ data: snapshot, error: snapshotError }, settings] = await Promise.all([
    client.rpc('get_live_session_snapshot_versioned', { p_session_id: targetSessionId }),
    loadSettings(client, targetSessionId),
  ])
  if (snapshotError) throw snapshotError
  const courtCount = settings.court_count_override ?? 6
  const clientRequestId = `phase5a-matrix-${crypto.randomUUID()}`
  const startedAt = performance.now()
  const response = await fetch(`${supabaseUrl}/functions/v1/session-live-matches-suggest?session_id=${targetSessionId}`, {
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
      pvna_tolerance: settings.pvna_tolerance,
      planned_total_rounds: settings.target_rounds,
      court_preset: settings.court_preset,
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
  if (!response.ok || body.ok === false) {
    throw new Error(`session-live-matches-suggest failed (${response.status}): ${body.error ?? text}`)
  }
  return {
    client_request_id: clientRequestId,
    wall_ms: Math.round(performance.now() - startedAt),
    payload_count: body.payloads?.length ?? 0,
    final_preview_board_count: body.final_preview_board?.length ?? 0,
    missing_target_courts: body.missing_target_courts ?? [],
  }
}

async function buildPlan(client: ReturnType<typeof createClient>, targetSessionId: string) {
  let final: any = null
  const chunks: Array<{ completed: boolean; active_compute_ms: number | null }> = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await client.functions.invoke('session-plan-shadow', {
      body: {
        session_id: targetSessionId,
        planned_round_count: 2,
        local_search_passes: 1,
        persist: true,
        chunked: true,
      },
    })
    if (error || data?.ok === false) throw new Error(error?.message ?? data?.error ?? 'Planner failed')
    final = data
    chunks.push({
      completed: data.completed !== false,
      active_compute_ms: data.chunk_runtime_ms ?? null,
    })
    if (data.completed !== false) break
    if (data.in_progress) await sleep(1_000)
  }
  if (!final?.completed) throw new Error('Planner did not complete two suffix rounds')
  return { job_id: final.job_id, plan_version_id: final.plan_version_id, chunks }
}

function assertFullBoard(result: Awaited<ReturnType<typeof invokeSuggest>>, label: string) {
  if (result.payload_count < 1 || result.missing_target_courts.length > 0) {
    throw new Error(`${label} did not return a complete board: ${JSON.stringify(result)}`)
  }
}

function assertAudit(
  audit: AdvisoryAudit,
  label: string,
  expected: { usable?: number; fallback?: number; reason?: string; noPlan?: boolean },
) {
  const counts = audit.response_payload?.counts ?? {}
  const reasons = uniqueReasons(audit)
  if (expected.usable !== undefined && counts.usable !== expected.usable) {
    throw new Error(`${label} expected usable=${expected.usable}, got ${JSON.stringify({ counts, reasons })}`)
  }
  if (expected.fallback !== undefined && counts.fallback !== expected.fallback) {
    throw new Error(`${label} expected fallback=${expected.fallback}, got ${JSON.stringify({ counts, reasons })}`)
  }
  if (expected.reason && !reasons.includes(expected.reason)) {
    throw new Error(`${label} expected ${expected.reason}, got ${JSON.stringify({ counts, reasons })}`)
  }
  if (expected.noPlan && audit.response_payload?.plan_job_id != null) {
    throw new Error(`${label} unexpectedly found plan ${audit.response_payload?.plan_job_id}`)
  }
}

async function main() {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.session || !auth.user) throw new Error(authError?.message ?? 'Unable to sign in')
  const token = auth.session.access_token
  const matrix: Record<string, unknown> = {}

  const baselinePlan = await buildPlan(client, sessionId!)
  const baselineSuggest = await invokeSuggest(client, token, sessionId!)
  assertFullBoard(baselineSuggest, 'baseline')
  const baselineAudit = await loadAudit(baselineSuggest.client_request_id)
  assertAudit(baselineAudit, 'baseline', { usable: baselineSuggest.final_preview_board_count, fallback: 0 })
  matrix.baseline = { plan: baselinePlan, suggest: baselineSuggest, audit: baselineAudit.response_payload }

  const { data: rosterSnapshot, error: rosterSnapshotError } = await client.rpc(
    'get_live_session_snapshot_versioned',
    { p_session_id: sessionId },
  )
  if (rosterSnapshotError) throw rosterSnapshotError
  const liveBusy = new Set((rosterSnapshot?.live_match_rows ?? [])
    .filter((row: any) => row.status === 'live')
    .flatMap((row: any) => [...(row.team_a ?? []), ...(row.team_b ?? [])]))
  const rosterPlayer = (rosterSnapshot?.player_rows ?? []).find((row: any) =>
    row.checked_out_at == null && !row.opted_rest && !liveBusy.has(row.player_id))
  if (!rosterPlayer?.player_id) throw new Error('No safe player available for roster mutation')
  try {
    await invokeFunction(token, sessionId!, 'session-request-rest', {
      player_id: rosterPlayer.player_id,
      opted_rest: true,
    })
    const staleSuggest = await invokeSuggest(client, token, sessionId!)
    assertFullBoard(staleSuggest, 'roster mutation fallback')
    const staleAudit = await loadAudit(staleSuggest.client_request_id)
    assertAudit(staleAudit, 'roster mutation fallback', {
      fallback: staleSuggest.final_preview_board_count,
      reason: 'roster_changed',
    })
    matrix.roster_mutation = {
      player_id: rosterPlayer.player_id,
      fallback_suggest: staleSuggest,
      fallback_audit: { ...staleAudit.response_payload, reasons: uniqueReasons(staleAudit) },
    }
  } finally {
    await invokeFunction(token, sessionId!, 'session-request-rest', {
      player_id: rosterPlayer.player_id,
      opted_rest: false,
    })
  }
  const rosterRecoveryPlan = await buildPlan(client, sessionId!)
  const rosterRecoverySuggest = await invokeSuggest(client, token, sessionId!)
  const rosterRecoveryAudit = await loadAudit(rosterRecoverySuggest.client_request_id)
  assertFullBoard(rosterRecoverySuggest, 'roster recovery')
  assertAudit(rosterRecoveryAudit, 'roster recovery', {
    usable: rosterRecoverySuggest.final_preview_board_count,
    fallback: 0,
  })
  ;(matrix.roster_mutation as any).recovery = {
    plan: rosterRecoveryPlan,
    suggest: rosterRecoverySuggest,
    audit: rosterRecoveryAudit.response_payload,
  }

  const originalSettings = await loadSettings(client, sessionId!)
  const mutatedSettings: Settings = {
    ...originalSettings,
    pvna_tolerance: Number((originalSettings.pvna_tolerance + 0.1).toFixed(2)),
    updated_by: auth.user.id,
  }
  try {
    await saveSettings(client, sessionId!, mutatedSettings)
    const staleSuggest = await invokeSuggest(client, token, sessionId!)
    assertFullBoard(staleSuggest, 'config mutation fallback')
    const staleAudit = await loadAudit(staleSuggest.client_request_id)
    assertAudit(staleAudit, 'config mutation fallback', {
      fallback: staleSuggest.final_preview_board_count,
      reason: 'config_changed',
    })
    matrix.config_mutation = {
      before_pvna_tolerance: originalSettings.pvna_tolerance,
      mutated_pvna_tolerance: mutatedSettings.pvna_tolerance,
      fallback_suggest: staleSuggest,
      fallback_audit: { ...staleAudit.response_payload, reasons: uniqueReasons(staleAudit) },
    }
  } finally {
    await saveSettings(client, sessionId!, originalSettings)
  }
  const configRecoveryPlan = await buildPlan(client, sessionId!)
  const configRecoverySuggest = await invokeSuggest(client, token, sessionId!)
  const configRecoveryAudit = await loadAudit(configRecoverySuggest.client_request_id)
  assertFullBoard(configRecoverySuggest, 'config recovery')
  assertAudit(configRecoveryAudit, 'config recovery', {
    usable: configRecoverySuggest.final_preview_board_count,
    fallback: 0,
  })
  ;(matrix.config_mutation as any).recovery = {
    plan: configRecoveryPlan,
    suggest: configRecoverySuggest,
    audit: configRecoveryAudit.response_payload,
  }

  const missingSuggest = await invokeSuggest(client, token, missingPlanSessionId!)
  assertFullBoard(missingSuggest, 'missing plan fallback')
  const missingAudit = await loadAudit(missingSuggest.client_request_id)
  assertAudit(missingAudit, 'missing plan fallback', {
    fallback: missingSuggest.final_preview_board_count,
    reason: 'plan_missing',
    noPlan: true,
  })
  matrix.missing_plan = {
    session_id: missingPlanSessionId,
    suggest: missingSuggest,
    audit: { ...missingAudit.response_payload, reasons: uniqueReasons(missingAudit) },
  }

  console.log(JSON.stringify({ ok: true, session_id: sessionId, matrix }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
