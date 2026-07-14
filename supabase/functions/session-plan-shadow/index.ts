/* eslint-disable import/no-unresolved */
import {
  getSessionId,
  handleCorsPreflight,
  jsonResponse,
  readJson,
  requireHost,
} from '../_shared/live-session.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import {
  buildPrecomputedSessionPlan,
  summarizeSessionPlan,
} from '../../../lib/next-round-suggester/planner/session-plan.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { calculateOptimalCourts } from '../../../lib/court-calculator/calculator.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { CourtPreset } from '../../../lib/court-calculator/types.ts'
import type { SessionState } from '../../../lib/next-round-suggester/types.ts'

const ENGINE_VERSION = 'precomputed-v2-court-parity'
const MAX_PLANNED_ROUNDS = 12

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value))
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(stableJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function serializeState(state: SessionState) {
  return {
    session_id: state.session_id,
    current_round: state.current_round,
    status: state.status,
    config: state.config,
    players: [...state.players.values()]
      .sort((left, right) => left.player_id.localeCompare(right.player_id))
      .map(player => ({
        ...player,
        checked_in_at: player.checked_in_at.toISOString(),
        checked_out_at: player.checked_out_at?.toISOString() ?? null,
        partner_counts: [...player.partner_counts].sort(([left], [right]) => left.localeCompare(right)),
        opponent_counts: [...player.opponent_counts].sort(([left], [right]) => left.localeCompare(right)),
      })),
    rounds: state.rounds,
  }
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function courtPreset(value: unknown): CourtPreset {
  return value === 'play_more' || value === 'relaxed' ? value : 'balanced'
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)
  }

  const body = await readJson(request)
  const sessionId = getSessionId(request)
    ?? (typeof body.session_id === 'string' ? body.session_id : null)
  if (!sessionId) return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)
  const auth = await requireHost(request, sessionId, 'session-plan-shadow')
  if (auth.error) return auth.error

  const persist = body.persist !== false
  const maxRoundRuntimeMs = positiveInteger(body.max_round_runtime_ms) ?? undefined
  let jobId: string | null = null

  try {
    const [
      { data: sessionRow, error: sessionError },
      { data: settingsRow, error: settingsError },
      state,
    ] = await Promise.all([
      auth.supabase
        .from('sessions')
        .select('live_state_version')
        .eq('id', sessionId)
        .single(),
      auth.supabase
        .from('session_next_round_settings')
        .select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds')
        .eq('session_id', sessionId)
        .maybeSingle(),
      loadSessionState(auth.supabase, sessionId),
    ])
    if (sessionError || !sessionRow) throw new Error(sessionError?.message ?? 'Session not found')
    if (settingsError) throw new Error(settingsError.message)

    const preset = courtPreset(settingsRow?.court_preset)
    const durationMin = positiveInteger(settingsRow?.court_duration_min) ?? 120
    const presentPlayerCount = [...state.players.values()]
      .filter(player => player.checked_out_at === null)
      .length
    const courtRecommendation = calculateOptimalCourts({
      n_players: presentPlayerCount,
      session_duration_min: durationMin,
      match_duration_min: 15,
      preset,
    })
    const courtOverride = positiveInteger(settingsRow?.court_count_override)
    const courts = courtOverride ?? courtRecommendation.recommended.courts
    const configuredRounds = positiveInteger(settingsRow?.target_rounds)
      ?? courtRecommendation.recommended.total_rounds
      ?? 8
    state.config = {
      ...state.config,
      courts,
      pvna_tolerance: finiteNumber(settingsRow?.pvna_tolerance, 0.5),
      planned_total_rounds: configuredRounds,
      court_preset: preset,
    }
    const requestedRounds = positiveInteger(body.planned_round_count) ?? configuredRounds
    if (requestedRounds > MAX_PLANNED_ROUNDS) {
      return jsonResponse({ ok: false, error: `planned_round_count must be <= ${MAX_PLANNED_ROUNDS}` }, 400, request)
    }
    const liveStateVersion = Number(sessionRow.live_state_version)
    const inputPayload = {
      planner: {
        engine_version: ENGINE_VERSION,
        planned_round_count: requestedRounds,
        court_count: courts,
        court_source: courtOverride === null ? 'court_suggester' : 'session_override',
        court_suggester: {
          player_count: presentPlayerCount,
          session_duration_min: durationMin,
          match_duration_min: 15,
          preset,
          recommended_courts: courtRecommendation.recommended.courts,
          recommended_rounds: courtRecommendation.recommended.total_rounds,
        },
        starting_round: state.current_round,
      },
      state: serializeState(state),
    }
    const [inputHash, rosterFingerprint, configFingerprint] = await Promise.all([
      sha256(inputPayload),
      sha256(inputPayload.state.players),
      sha256(inputPayload.state.config),
    ])

    if (persist) {
      const { data: insertedJob, error: insertError } = await auth.supabase
        .from('session_plan_jobs')
        .insert({
          session_id: sessionId,
          requested_by: auth.userId,
          live_state_version: liveStateVersion,
          input_hash: inputHash,
          engine_version: ENGINE_VERSION,
          roster_fingerprint: rosterFingerprint,
          config_fingerprint: configFingerprint,
          planned_round_count: requestedRounds,
          court_count: courts,
          status: 'running',
          input_payload: inputPayload,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id, status')
        .single()
      if (insertError?.code === '23505') {
        const { data: existingJob, error: existingError } = await auth.supabase
          .from('session_plan_jobs')
          .select('id, status')
          .eq('session_id', sessionId)
          .eq('live_state_version', liveStateVersion)
          .eq('input_hash', inputHash)
          .eq('engine_version', ENGINE_VERSION)
          .single()
        if (existingError || !existingJob) throw new Error(existingError?.message ?? 'Unable to load idempotent plan job')
        jobId = existingJob.id
        if (existingJob.status === 'completed') {
          return jsonResponse({ ok: true, reused: true, job_id: jobId, input_hash: inputHash }, 200, request)
        }
        const { error: restartError } = await auth.supabase
          .from('session_plan_jobs')
          .update({
            status: 'running',
            error_detail: null,
            started_at: new Date().toISOString(),
            completed_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)
        if (restartError) throw new Error(restartError.message)
      } else if (insertError || !insertedJob) {
        throw new Error(insertError?.message ?? 'Unable to create plan job')
      } else {
        jobId = insertedJob.id
      }
    }

    const plan = buildPrecomputedSessionPlan(state, requestedRounds, courts, {
      localSearchPasses: 1,
      maxRoundRuntimeMs,
      startingRound: state.current_round,
    })
    const qualitySummary = summarizeSessionPlan(plan)
    const compactRounds = plan.rounds.map(round => ({
      round_no: round.round,
      resting_ids: round.resting,
      matches: round.matches,
      quality_summary: {
        avg_team_gap: round.metrics.avgInter,
        max_team_gap: round.metrics.maxInter,
        team_gap_over_1: round.metrics.interOverOne,
        max_intra_gap: round.metrics.maxIntra,
        intra_gap_over_2: round.metrics.intraOverTwo,
        partner_repeats: round.metrics.partnerRepeats,
        opponent_repeats: round.metrics.opponentRepeats,
      },
    }))
    const planHash = await sha256(compactRounds)

    if (!persist) {
      return jsonResponse({
        ok: true,
        persisted: false,
        input_hash: inputHash,
        plan_hash: planHash,
        engine_version: ENGINE_VERSION,
        invariants: plan.invariants,
        quality_summary: qualitySummary,
        runtime_summary: plan.timings,
      }, 200, request)
    }
    if (!jobId) throw new Error('Plan job identity is missing')

    const { data: currentSession, error: currentSessionError } = await auth.supabase
      .from('sessions')
      .select('live_state_version')
      .eq('id', sessionId)
      .single()
    if (currentSessionError || !currentSession) throw new Error(currentSessionError?.message ?? 'Unable to recheck session version')
    if (Number(currentSession.live_state_version) !== liveStateVersion) {
      await auth.supabase
        .from('session_plan_jobs')
        .update({ status: 'stale', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId)
      return jsonResponse({ ok: false, stale: true, job_id: jobId, error: 'Session changed while planning' }, 409, request)
    }

    const { data: version, error: versionError } = await auth.supabase
      .from('session_plan_versions')
      .upsert({
        job_id: jobId,
        session_id: sessionId,
        live_state_version: liveStateVersion,
        input_hash: inputHash,
        plan_hash: planHash,
        engine_version: ENGINE_VERSION,
        quality_summary: qualitySummary,
        runtime_summary: plan.timings,
      }, { onConflict: 'job_id' })
      .select('id')
      .single()
    if (versionError || !version) throw new Error(versionError?.message ?? 'Unable to publish plan version')

    const roundRows = await Promise.all(compactRounds.map(async round => ({
      plan_version_id: version.id,
      session_id: sessionId,
      ...round,
      output_hash: await sha256(round),
    })))
    const { error: roundsError } = await auth.supabase
      .from('session_plan_rounds')
      .upsert(roundRows, { onConflict: 'plan_version_id,round_no' })
    if (roundsError) throw new Error(roundsError.message)

    const { error: completeError } = await auth.supabase
      .from('session_plan_jobs')
      .update({
        status: 'completed',
        runtime_summary: plan.timings,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    if (completeError) throw new Error(completeError.message)

    return jsonResponse({
      ok: true,
      persisted: true,
      job_id: jobId,
      plan_version_id: version.id,
      input_hash: inputHash,
      plan_hash: planHash,
      engine_version: ENGINE_VERSION,
      invariants: plan.invariants,
      quality_summary: qualitySummary,
      runtime_summary: plan.timings,
    }, 200, request)
  } catch (error) {
    if (jobId) {
      await auth.supabase
        .from('session_plan_jobs')
        .update({
          status: 'failed',
          error_detail: {
            message: error instanceof Error ? error.message : 'Unknown shadow planner error',
          },
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    }
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown shadow planner error',
    }, 500, request)
  }
})
