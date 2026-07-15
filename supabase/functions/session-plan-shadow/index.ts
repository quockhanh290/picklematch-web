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
  buildPrecomputedSessionPlanChunk,
  resolveSessionPlanRoundCount,
  summarizeSessionPlan,
  type SessionPlan,
  type SessionPlanChunkCheckpoint,
} from '../../../lib/next-round-suggester/planner/session-plan.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { calculateOptimalCourts } from '../../../lib/court-calculator/calculator.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { CourtPreset } from '../../../lib/court-calculator/types.ts'
import type { SessionState } from '../../../lib/next-round-suggester/types.ts'
import {
  buildPlanningConfigIdentity,
  buildPlanningRosterIdentity,
  stablePlannerJson,
} from '../../../lib/next-round-suggester/planner/identity.ts'
import {
  buildPlanningFrontier,
  buildPlanningFrontierIdentity,
  getPlanningCommitments,
} from '../../../lib/next-round-suggester/planner/frontier.ts'
import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types.ts'

const ENGINE_VERSION = 'precomputed-v8-rolling-frontier'
const MAX_PLANNED_ROUNDS = 12
const MAX_LOCAL_SEARCH_PASSES = 3

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(stablePlannerJson(value))
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
  const chunked = body.chunked === true
  if (chunked && !persist) {
    return jsonResponse({ ok: false, error: 'chunked planning requires persist=true' }, 400, request)
  }
  const maxRoundRuntimeMs = positiveInteger(body.max_round_runtime_ms) ?? undefined
  const localSearchPasses = positiveInteger(body.local_search_passes) ?? 2
  if (localSearchPasses > MAX_LOCAL_SEARCH_PASSES) {
    return jsonResponse({ ok: false, error: `local_search_passes must be <= ${MAX_LOCAL_SEARCH_PASSES}` }, 400, request)
  }
  let jobId: string | null = null
  let checkpoint: SessionPlanChunkCheckpoint | null = null
  let previousChunkComputeMs = 0
  let previousMaxChunkComputeMs = 0

  try {
    const [
      { data: sessionRow, error: sessionError },
      { data: settingsRow, error: settingsError },
      { data: liveMatchRows, error: liveMatchRowsError },
      loadedState,
    ] = await Promise.all([
      auth.supabase
        .from('sessions')
        .select('live_state_version, planning_mutation_version')
        .eq('id', sessionId)
        .single(),
      auth.supabase
        .from('session_next_round_settings')
        .select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds')
        .eq('session_id', sessionId)
        .maybeSingle(),
      auth.supabase
        .from('session_live_matches')
        .select('id, session_id, sequence_no, round_no, cycle_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, suggestion_metadata')
        .eq('session_id', sessionId)
        .in('status', ['suggested', 'live']),
      loadSessionState(auth.supabase, sessionId),
    ])
    if (sessionError || !sessionRow) throw new Error(sessionError?.message ?? 'Session not found')
    if (settingsError) throw new Error(settingsError.message)
    if (liveMatchRowsError) throw new Error(liveMatchRowsError.message)

    const preset = courtPreset(settingsRow?.court_preset)
    const durationMin = positiveInteger(settingsRow?.court_duration_min) ?? 120
    const presentPlayerCount = [...loadedState.players.values()]
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
    loadedState.config = {
      ...loadedState.config,
      courts,
      pvna_tolerance: finiteNumber(settingsRow?.pvna_tolerance, 0.5),
      planned_total_rounds: configuredRounds,
      court_preset: preset,
    }
    const frontier = buildPlanningFrontier(
      loadedState,
      (liveMatchRows ?? []) as SessionLiveMatchRow[],
    )
    if (frontier.pending_manual_suggestions.length > 0) {
      return jsonResponse({
        ok: false,
        replan_deferred: true,
        reason: 'manual_suggestion_pending',
        pending_manual_match_ids: frontier.pending_manual_suggestions.map(match => match.id),
        error: 'Start or cancel the manual suggestion before replanning',
      }, 409, request)
    }
    const state = frontier.state
    const requestedRoundOverride = positiveInteger(body.planned_round_count)
    const requestedRounds = resolveSessionPlanRoundCount(
      state.current_round,
      configuredRounds,
      requestedRoundOverride,
    )
    if (requestedRounds > MAX_PLANNED_ROUNDS) {
      return jsonResponse({ ok: false, error: `planned_round_count must be <= ${MAX_PLANNED_ROUNDS}` }, 400, request)
    }
    if (requestedRounds === 0) {
      return jsonResponse({
        ok: true,
        completed: true,
        persisted: false,
        no_plan_required: true,
        starting_round: state.current_round,
        target_rounds: configuredRounds,
        planned_round_count: 0,
      }, 200, request)
    }
    const liveStateVersion = Number(sessionRow.live_state_version)
    const planningMutationVersion = Number(sessionRow.planning_mutation_version ?? 0)
    const [rosterFingerprint, configFingerprint, frontierFingerprint] = await Promise.all([
      sha256(buildPlanningRosterIdentity(loadedState)),
      sha256(buildPlanningConfigIdentity(loadedState)),
      sha256(frontier.identity),
    ])
    const inputPayload = {
      planner: {
        engine_version: ENGINE_VERSION,
        planned_round_count: requestedRounds,
        target_rounds: configuredRounds,
        local_search_passes: localSearchPasses,
        execution_mode: chunked ? 'round_checkpointed' : 'single_request',
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
        planning_mutation_version: planningMutationVersion,
        frontier_fingerprint: frontierFingerprint,
      },
      state: serializeState(state),
      frontier: {
        fixed_commitment_count: frontier.commitments.length,
        busy_player_count: frontier.busy_ids.length,
      },
      fixed_commitments: frontier.commitments.map(match => ({
        id: match.id,
        status: match.status,
        round_no: match.round_no,
        court_idx: match.court_idx,
        team_a: match.team_a,
        team_b: match.team_b,
        manual_override: match.suggestion_metadata?.manual_override === true,
      })),
    }
    const inputHash = await sha256({
      planner: inputPayload.planner,
      roster_fingerprint: rosterFingerprint,
      config_fingerprint: configFingerprint,
      frontier_fingerprint: frontierFingerprint,
    })
    const recheckPlanningFrontier = async () => {
      const [
        { data: currentSession, error: currentSessionError },
        { data: currentLiveRows, error: currentLiveRowsError },
        currentState,
      ] = await Promise.all([
        auth.supabase
          .from('sessions')
          .select('planning_mutation_version')
          .eq('id', sessionId)
          .single(),
        auth.supabase
          .from('session_live_matches')
          .select('id, session_id, sequence_no, round_no, cycle_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, suggestion_metadata')
          .eq('session_id', sessionId)
          .in('status', ['suggested', 'live']),
        loadSessionState(auth.supabase, sessionId),
      ])
      if (currentSessionError || !currentSession) {
        throw new Error(currentSessionError?.message ?? 'Unable to recheck planning mutation version')
      }
      if (currentLiveRowsError) throw new Error(currentLiveRowsError.message)
      const currentCommitments = getPlanningCommitments(
        (currentLiveRows ?? []) as SessionLiveMatchRow[],
      )
      return {
        planningMutationVersion: Number(currentSession.planning_mutation_version ?? 0),
        frontierFingerprint: await sha256(buildPlanningFrontierIdentity(currentState, currentCommitments)),
      }
    }

    if (persist) {
      const { error: supersedeError } = await auth.supabase
        .from('session_plan_jobs')
        .update({
          status: 'stale',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_detail: { message: 'Superseded by a newer roster or planning horizon' },
        })
        .eq('session_id', sessionId)
        .in('status', ['queued', 'running', 'checkpointed'])
        .neq('input_hash', inputHash)
      if (supersedeError) throw new Error(supersedeError.message)

      const { data: insertedJob, error: insertError } = await auth.supabase
        .from('session_plan_jobs')
        .insert({
          session_id: sessionId,
          requested_by: auth.userId,
          live_state_version: liveStateVersion,
          planning_mutation_version: planningMutationVersion,
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
          .select('id, status, checkpoint, runtime_summary, updated_at, result_plan_version_id')
          .eq('session_id', sessionId)
          .eq('live_state_version', liveStateVersion)
          .eq('input_hash', inputHash)
          .eq('engine_version', ENGINE_VERSION)
          .single()
        if (existingError || !existingJob) throw new Error(existingError?.message ?? 'Unable to load idempotent plan job')
        jobId = existingJob.id
        if (existingJob.status === 'completed' && existingJob.result_plan_version_id) {
          return jsonResponse({
            ok: true,
            completed: true,
            reused: true,
            job_id: jobId,
            plan_version_id: existingJob.result_plan_version_id,
            input_hash: inputHash,
          }, 200, request)
        }
        if (chunked) {
          if (existingJob.status === 'stale' || existingJob.status === 'cancelled') {
            return jsonResponse({ ok: false, job_id: jobId, error: `Plan job is ${existingJob.status}` }, 409, request)
          }
          const runtime = existingJob.runtime_summary as Record<string, unknown> | null
          previousChunkComputeMs = finiteNumber(runtime?.chunk_compute_ms, 0)
          previousMaxChunkComputeMs = finiteNumber(runtime?.max_chunk_compute_ms, 0)
          checkpoint = existingJob.checkpoint as SessionPlanChunkCheckpoint | null
          const updatedAtMs = Date.parse(String(existingJob.updated_at))
          const runningLeaseExpired = Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > 120_000
          if (existingJob.status === 'running' && !runningLeaseExpired) {
            return jsonResponse({
              ok: true,
              completed: false,
              in_progress: true,
              job_id: jobId,
              checkpoint_rounds: checkpoint?.rounds.length ?? 0,
            }, 202, request)
          }
          const claimAt = new Date().toISOString()
          let claimQuery = auth.supabase
            .from('session_plan_jobs')
            .update({
              status: 'running',
              error_detail: null,
              completed_at: null,
              result_plan_version_id: null,
              updated_at: claimAt,
            })
            .eq('id', jobId)
            .eq('status', existingJob.status)
          if (existingJob.updated_at) claimQuery = claimQuery.eq('updated_at', existingJob.updated_at)
          const { data: claimed, error: claimError } = await claimQuery.select('id').maybeSingle()
          if (claimError) throw new Error(claimError.message)
          if (!claimed) {
            return jsonResponse({
              ok: true,
              completed: false,
              in_progress: true,
              job_id: jobId,
              checkpoint_rounds: checkpoint?.rounds.length ?? 0,
            }, 202, request)
          }
        } else {
          const { error: restartError } = await auth.supabase
            .from('session_plan_jobs')
            .update({
              status: 'running',
              error_detail: null,
              started_at: new Date().toISOString(),
              completed_at: null,
              result_plan_version_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', jobId)
          if (restartError) throw new Error(restartError.message)
        }
      } else if (insertError || !insertedJob) {
        throw new Error(insertError?.message ?? 'Unable to create plan job')
      } else {
        jobId = insertedJob.id
      }
    }

    let plan: SessionPlan
    let runtimeSummary: Record<string, unknown>
    let lastChunkRuntimeMs: number | null = null
    if (chunked) {
      if (!jobId) throw new Error('Chunked plan job identity is missing')
      const chunk = buildPrecomputedSessionPlanChunk(state, requestedRounds, courts, checkpoint, {
        localSearchPasses,
        maxRoundRuntimeMs,
        startingRound: state.current_round,
      })
      const chunkComputeMs = previousChunkComputeMs + chunk.chunk_runtime_ms
      lastChunkRuntimeMs = chunk.chunk_runtime_ms
      const maxChunkComputeMs = Math.max(previousMaxChunkComputeMs, chunk.chunk_runtime_ms)
      runtimeSummary = {
        execution_mode: 'round_checkpointed',
        chunks_completed: chunk.checkpoint.rounds.length,
        chunk_compute_ms: chunkComputeMs,
        max_chunk_compute_ms: maxChunkComputeMs,
        planner_compute_ms: chunk.checkpoint.rest_schedule_ms
          + chunk.checkpoint.round_timings.reduce((sum, round) => sum + round.total_ms, 0),
        rounds: chunk.checkpoint.round_timings,
      }

      if (!chunk.completed || !chunk.plan) {
        const currentFrontier = await recheckPlanningFrontier()
        if (currentFrontier.planningMutationVersion !== planningMutationVersion
          || currentFrontier.frontierFingerprint !== frontierFingerprint) {
          await auth.supabase
            .from('session_plan_jobs')
            .update({ status: 'stale', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', jobId)
          return jsonResponse({ ok: false, stale: true, job_id: jobId, error: 'Planning frontier changed while planning' }, 409, request)
        }
        const { data: checkpointedJob, error: checkpointError } = await auth.supabase
          .from('session_plan_jobs')
          .update({
            status: 'checkpointed',
            checkpoint: chunk.checkpoint,
            runtime_summary: runtimeSummary,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)
          .eq('status', 'running')
          .select('id')
          .maybeSingle()
        if (checkpointError) throw new Error(checkpointError.message)
        if (!checkpointedJob) {
          return jsonResponse({
            ok: false,
            stale: true,
            job_id: jobId,
            error: 'Plan job was superseded while checkpointing',
          }, 409, request)
        }
        return jsonResponse({
          ok: true,
          persisted: true,
          completed: false,
          resume_required: true,
          job_id: jobId,
          input_hash: inputHash,
          engine_version: ENGINE_VERSION,
          checkpoint_rounds: chunk.checkpoint.rounds.length,
          planned_round_count: requestedRounds,
          chunk_runtime_ms: chunk.chunk_runtime_ms,
          runtime_summary: runtimeSummary,
        }, 202, request)
      }
      plan = chunk.plan
      runtimeSummary = {
        ...runtimeSummary,
        total_ms: plan.timings.total_ms,
        rest_schedule_ms: plan.timings.rest_schedule_ms,
      }
    } else {
      plan = buildPrecomputedSessionPlan(state, requestedRounds, courts, {
        localSearchPasses,
        maxRoundRuntimeMs,
        startingRound: state.current_round,
      })
      runtimeSummary = plan.timings as unknown as Record<string, unknown>
    }
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
        runtime_summary: runtimeSummary,
      }, 200, request)
    }
    if (!jobId) throw new Error('Plan job identity is missing')

    const currentFrontier = await recheckPlanningFrontier()
    if (currentFrontier.planningMutationVersion !== planningMutationVersion
      || currentFrontier.frontierFingerprint !== frontierFingerprint) {
      await auth.supabase
        .from('session_plan_jobs')
        .update({ status: 'stale', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId)
      return jsonResponse({ ok: false, stale: true, job_id: jobId, error: 'Planning frontier changed while planning' }, 409, request)
    }

    const { data: publishedVersion, error: versionError } = await auth.supabase
      .from('session_plan_versions')
      .upsert({
        job_id: jobId,
        session_id: sessionId,
        live_state_version: liveStateVersion,
        input_hash: inputHash,
        plan_hash: planHash,
        engine_version: ENGINE_VERSION,
        quality_summary: qualitySummary,
        runtime_summary: runtimeSummary,
      }, { onConflict: 'job_id' })
      .select('id')
      .single()
    let version = publishedVersion
    let reusedPlanVersion = false
    if (versionError?.code === '23505') {
      const { data: existingVersion, error: existingVersionError } = await auth.supabase
        .from('session_plan_versions')
        .select('id')
        .eq('session_id', sessionId)
        .eq('live_state_version', liveStateVersion)
        .eq('plan_hash', planHash)
        .single()
      if (existingVersionError || !existingVersion) {
        throw new Error(existingVersionError?.message ?? 'Unable to load deduplicated plan version')
      }
      version = existingVersion
      reusedPlanVersion = true
    } else if (versionError || !version) {
      throw new Error(versionError?.message ?? 'Unable to publish plan version')
    }

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
        runtime_summary: runtimeSummary,
        checkpoint: null,
        result_plan_version_id: version.id,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    if (completeError) throw new Error(completeError.message)

    return jsonResponse({
      ok: true,
      completed: true,
      persisted: true,
      job_id: jobId,
      plan_version_id: version.id,
      reused_plan_version: reusedPlanVersion,
      input_hash: inputHash,
      plan_hash: planHash,
      engine_version: ENGINE_VERSION,
      invariants: plan.invariants,
      quality_summary: qualitySummary,
      chunk_runtime_ms: lastChunkRuntimeMs,
      runtime_summary: runtimeSummary,
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
