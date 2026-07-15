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
const mode = argument('--mode') ?? 'full'

if (!supabaseUrl || !anonKey || !managementToken) throw new Error('Missing Supabase environment')
if (!sessionId || (mode === 'full' && !missingPlanSessionId)) {
  throw new Error('Usage: npx tsx scripts/diagnostics/probe-phase5a-advisory-matrix.ts --session-id=<id> [--missing-plan-session-id=<id>] [--mode=full|manual-quality]')
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

async function invokeSuggestWithBackoff(
  client: ReturnType<typeof createClient>,
  token: string,
  targetSessionId: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await invokeSuggest(client, token, targetSessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const resourceLimited = message.includes('(546)') || message.includes('WORKER_RESOURCE_LIMIT')
      if (!resourceLimited || attempt === 2) throw error
      await sleep(10_000 * (attempt + 1))
    }
  }
  throw new Error('Suggest retry loop exhausted')
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

async function assertManualPlanDeferred(token: string, targetSessionId: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/session-plan-shadow`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: targetSessionId,
      planned_round_count: 2,
      local_search_passes: 1,
      persist: true,
      chunked: true,
    }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (response.status !== 409
    || payload.replan_deferred !== true
    || payload.reason !== 'manual_suggestion_pending') {
    throw new Error(`Expected manual_suggestion_pending, got ${response.status}: ${text}`)
  }
  return payload
}

async function loadPlanQuality(
  client: ReturnType<typeof createClient>,
  plan: Awaited<ReturnType<typeof buildPlan>>,
) {
  const [{ data: version, error: versionError }, { data: rounds, error: roundsError }, { data: job, error: jobError }] = await Promise.all([
    client
      .from('session_plan_versions')
      .select('quality_summary, runtime_summary')
      .eq('id', plan.plan_version_id)
      .single(),
    client
      .from('session_plan_rounds')
      .select('round_no, matches, resting_ids')
      .eq('plan_version_id', plan.plan_version_id)
      .order('round_no', { ascending: true }),
    client
      .from('session_plan_jobs')
      .select('input_payload')
      .eq('id', plan.job_id)
      .single(),
  ])
  if (versionError || !version) throw new Error(versionError?.message ?? 'Missing plan version')
  if (roundsError) throw roundsError
  if (jobError || !job) throw new Error(jobError?.message ?? 'Missing plan job')
  const matches = (rounds ?? []).flatMap((round: any) => Array.isArray(round.matches) ? round.matches : [])
  return {
    quality_summary: version.quality_summary,
    runtime_summary: version.runtime_summary,
    rounds: (rounds ?? []).map((round: any) => ({
      round_no: Number(round.round_no),
      matches: Array.isArray(round.matches) ? round.matches.length : 0,
      resting: Array.isArray(round.resting_ids) ? round.resting_ids.length : 0,
    })),
    selected_player_ids: [...new Set(matches.flatMap((match: any) => [
      ...(match.team_a ?? []),
      ...(match.team_b ?? []),
    ]))],
    fixed_commitment_count: Number(job.input_payload?.frontier?.fixed_commitment_count ?? 0),
  }
}

function assertPlanQuality(report: Awaited<ReturnType<typeof loadPlanQuality>>, label: string) {
  const quality = report.quality_summary as Record<string, unknown>
  if (Number(quality?.team_gap_over_1 ?? 0) > 0
    || Number(quality?.intra_gap_over_2 ?? 0) > 0
    || Number(quality?.partner_repeats ?? 0) > 0) {
    throw new Error(`${label} violated quality gates: ${JSON.stringify(quality)}`)
  }
}

function partitionKey(teamA: string[], teamB: string[]) {
  return [teamA.slice().sort().join(':'), teamB.slice().sort().join(':')].sort().join('|')
}

function repartition(teamA: string[], teamB: string[]) {
  const candidates = [
    { team_a: [teamA[0], teamB[0]], team_b: [teamA[1], teamB[1]] },
    { team_a: [teamA[0], teamB[1]], team_b: [teamA[1], teamB[0]] },
  ]
  const current = partitionKey(teamA, teamB)
  const changed = candidates.find(candidate => partitionKey(candidate.team_a, candidate.team_b) !== current)
  if (!changed) throw new Error('Unable to construct a different same-four partition')
  return changed
}

function lineupQuality(snapshot: any, teamA: string[], teamB: string[]) {
  const pvna = new Map((snapshot?.player_rows ?? []).map((row: any) => [
    String(row.player_id),
    Number(row.effective_pvna ?? row.players?.pvna ?? row.players?.current_elo ?? row.players?.elo ?? 0),
  ]))
  const valuesA = teamA.map(id => Number(pvna.get(id) ?? 0))
  const valuesB = teamB.map(id => Number(pvna.get(id) ?? 0))
  return {
    team_gap: Math.abs(valuesA.reduce((sum, value) => sum + value, 0) - valuesB.reduce((sum, value) => sum + value, 0)),
    max_intra_gap: Math.max(Math.abs(valuesA[0] - valuesA[1]), Math.abs(valuesB[0] - valuesB[1])),
  }
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

async function runManualQualityCase(options: {
  client: ReturnType<typeof createClient>
  token: string
  targetSessionId: string
  kind: 'manual_team_repartition' | 'manual_player_replacement'
}) {
  const { client, token, targetSessionId, kind } = options
  const { data: before, error: beforeError } = await client.rpc(
    'get_live_session_snapshot_versioned',
    { p_session_id: targetSessionId },
  )
  if (beforeError) throw beforeError
  const suggestedRows = (before?.live_match_rows ?? []).filter((row: any) => row.status === 'suggested')
  const existing = suggestedRows[0]
  if (!existing?.id || existing.team_a?.length !== 2 || existing.team_b?.length !== 2) {
    throw new Error(`No doubles suggestion available for ${kind}`)
  }

  let changed: { team_a: string[]; team_b: string[] }
  let replacementPlayerId: string | null = null
  if (kind === 'manual_team_repartition') {
    changed = repartition(existing.team_a, existing.team_b)
  } else {
    const boardIds = new Set(suggestedRows.flatMap((row: any) => [...(row.team_a ?? []), ...(row.team_b ?? [])]))
    const removedPlayerId = String(existing.team_a[1])
    const removedPvna = Number((before.player_rows ?? []).find((row: any) => row.player_id === removedPlayerId)?.players?.pvna ?? 0)
    const candidates = (before.player_rows ?? [])
      .filter((row: any) => row.checked_out_at == null && !row.opted_rest && !boardIds.has(row.player_id))
      .sort((left: any, right: any) => (
        Math.abs(Number(left.players?.pvna ?? 0) - removedPvna)
        - Math.abs(Number(right.players?.pvna ?? 0) - removedPvna)
      ))
    replacementPlayerId = candidates[0]?.player_id ?? null
    if (!replacementPlayerId) throw new Error('No resting replacement player available')
    changed = {
      team_a: [String(existing.team_a[0]), replacementPlayerId],
      team_b: existing.team_b.map(String),
    }
  }

  let manualRowId: string | null = null
  try {
    const { data: mutation, error: mutationError } = await client.rpc(
      'replace_manual_live_session_suggestion_versioned',
      {
        p_session_id: targetSessionId,
        p_expected_live_state_version: Number(before.live_state_version),
        p_match: {
          court_idx: Number(existing.court_idx),
          team_a: changed.team_a,
          team_b: changed.team_b,
          resting: existing.resting ?? [],
          round_no: Number(existing.round_no),
        },
        p_audit_payload: { source: 'probe-phase5a-mutation-quality', expected_kind: kind },
      },
    )
    if (mutationError) throw mutationError
    if (mutation?.manual_mutation_kind !== kind) {
      throw new Error(`Expected ${kind}, got ${mutation?.manual_mutation_kind ?? 'null'}`)
    }

    const { data: mutatedSnapshot, error: mutatedError } = await client.rpc(
      'get_live_session_snapshot_versioned',
      { p_session_id: targetSessionId },
    )
    if (mutatedError) throw mutatedError
    const manualRow = (mutatedSnapshot?.live_match_rows ?? []).find((row: any) => (
      row.status === 'suggested'
      && Number(row.court_idx) === Number(existing.court_idx)
      && row.suggestion_metadata?.manual_override === true
    ))
    if (!manualRow?.id) throw new Error(`Manual row was not persisted for ${kind}`)
    manualRowId = String(manualRow.id)

    const beforeCounts = new Map((before.player_rows ?? []).map((row: any) => [
      String(row.player_id),
      Number(row.matches_played ?? 0),
    ]))
    const manualPlayerIds = [...changed.team_a, ...changed.team_b]
    for (const playerId of manualPlayerIds) {
      const mutatedPlayer = (mutatedSnapshot.player_rows ?? []).find((row: any) => row.player_id === playerId)
      if (Number(mutatedPlayer?.matches_played ?? 0) !== Number(beforeCounts.get(playerId) ?? 0)) {
        throw new Error(`${kind} counted ${playerId} as played before start`)
      }
    }
    const deferred = await assertManualPlanDeferred(token, targetSessionId)

    await invokeFunction(token, targetSessionId, 'session-live-matches-start', {
      expected_live_state_version: Number(mutatedSnapshot.live_state_version),
      match_id: manualRowId,
      audit_payload: { source: 'probe-phase5a-mutation-quality-start', kind },
    })

    const plan = await buildPlan(client, targetSessionId)
    const quality = await loadPlanQuality(client, plan)
    assertPlanQuality(quality, kind)
    if (quality.fixed_commitment_count < 1) {
      throw new Error(`${kind} was not captured as a planning commitment`)
    }
    return {
      kind,
      court_idx: Number(existing.court_idx),
      replacement_player_id: replacementPlayerId,
      commitment_quality: lineupQuality(mutatedSnapshot, changed.team_a, changed.team_b),
      prestart_matches_unchanged: true,
      prestart_replan: {
        deferred: deferred.replan_deferred,
        reason: deferred.reason,
      },
      plan,
      suffix_quality: quality,
    }
  } finally {
    if (manualRowId) {
      const { data: current, error: currentError } = await client.rpc(
        'get_live_session_snapshot_versioned',
        { p_session_id: targetSessionId },
      )
      if (currentError) throw currentError
      await invokeFunction(token, targetSessionId, 'session-live-matches-cancel', {
        expected_live_state_version: Number(current.live_state_version),
        match_id: manualRowId,
        audit_payload: { source: 'probe-phase5a-mutation-quality-cleanup', kind },
      })
      await invokeSuggestWithBackoff(client, token, targetSessionId)
      await buildPlan(client, targetSessionId)
    }
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

  if (mode === 'manual-quality') {
    const initialSuggest = await invokeSuggestWithBackoff(client, token, sessionId!)
    assertFullBoard(initialSuggest, 'manual quality setup')
    await buildPlan(client, sessionId!)
    const teamRepartition = await runManualQualityCase({
      client,
      token,
      targetSessionId: sessionId!,
      kind: 'manual_team_repartition',
    })
    await sleep(10_000)
    const playerReplacement = await runManualQualityCase({
      client,
      token,
      targetSessionId: sessionId!,
      kind: 'manual_player_replacement',
    })
    console.log(JSON.stringify({
      ok: true,
      mode,
      session_id: sessionId,
      matrix: { manual_mutations: { team_repartition: teamRepartition, player_replacement: playerReplacement } },
    }, null, 2))
    return
  }

  const baselinePlan = await buildPlan(client, sessionId!)
  const baselineQuality = await loadPlanQuality(client, baselinePlan)
  assertPlanQuality(baselineQuality, 'baseline')
  const baselineSuggest = await invokeSuggest(client, token, sessionId!)
  assertFullBoard(baselineSuggest, 'baseline')
  const baselineAudit = await loadAudit(baselineSuggest.client_request_id)
  assertAudit(baselineAudit, 'baseline', { usable: baselineSuggest.final_preview_board_count, fallback: 0 })
  matrix.baseline = {
    plan: baselinePlan,
    quality: baselineQuality,
    suggest: baselineSuggest,
    audit: baselineAudit.response_payload,
  }

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
    const activeMutationPlan = await buildPlan(client, sessionId!)
    const activeMutationQuality = await loadPlanQuality(client, activeMutationPlan)
    assertPlanQuality(activeMutationQuality, 'active roster mutation')
    if (activeMutationQuality.selected_player_ids.includes(rosterPlayer.player_id)) {
      throw new Error('Active roster mutation plan selected the opted-rest player')
    }
    const activeMutationSuggest = await invokeSuggest(client, token, sessionId!)
    const activeMutationAudit = await loadAudit(activeMutationSuggest.client_request_id)
    assertFullBoard(activeMutationSuggest, 'active roster mutation plan')
    assertAudit(activeMutationAudit, 'active roster mutation plan', {
      usable: activeMutationSuggest.final_preview_board_count,
      fallback: 0,
    })
    ;(matrix.roster_mutation as any).active_replan = {
      plan: activeMutationPlan,
      quality: activeMutationQuality,
      suggest: activeMutationSuggest,
      audit: activeMutationAudit.response_payload,
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
    const activeMutationPlan = await buildPlan(client, sessionId!)
    const activeMutationQuality = await loadPlanQuality(client, activeMutationPlan)
    assertPlanQuality(activeMutationQuality, 'active config mutation')
    const activeMutationSuggest = await invokeSuggest(client, token, sessionId!)
    const activeMutationAudit = await loadAudit(activeMutationSuggest.client_request_id)
    assertFullBoard(activeMutationSuggest, 'active config mutation plan')
    assertAudit(activeMutationAudit, 'active config mutation plan', {
      usable: activeMutationSuggest.final_preview_board_count,
      fallback: 0,
    })
    ;(matrix.config_mutation as any).active_replan = {
      plan: activeMutationPlan,
      quality: activeMutationQuality,
      suggest: activeMutationSuggest,
      audit: activeMutationAudit.response_payload,
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

  matrix.manual_mutations = {
    team_repartition: await runManualQualityCase({
      client,
      token,
      targetSessionId: sessionId!,
      kind: 'manual_team_repartition',
    }),
    player_replacement: await runManualQualityCase({
      client,
      token,
      targetSessionId: sessionId!,
      kind: 'manual_player_replacement',
    }),
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
