/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createServiceClient, getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost, writeSessionAuditEvent } from '../_shared/live-session.ts'
import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector.ts'
import { detectFairnessIssues } from '../../../lib/next-round-suggester/fairness/detector.ts'
import {
  buildTightPoolQualityDeferUntilByCourt,
  buildFinalPreviewBoard,
  getPreviewMatchesToPersist,
  buildSuggestedMatchPayloads,
  hasFulfilledPreviewBoardReplacements,
  improvesPreviewBoardPvna,
  needsEarlyFullBoardPvnaRescue,
  LIVE_PREVIEW_ALGORITHM_VERSION,
} from '../../../lib/next-round-suggester/live-preview.ts'
import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state.ts'
import {
  plannedBoardEqualsLiveBoard,
  plannedMatchEqualsLiveMatch,
  resolvePlannedMatchAdvisory,
} from '../../../lib/next-round-suggester/planner/advisory.ts'
import {
  buildPlanningConfigIdentity,
  buildPlanningRosterIdentity,
  stablePlannerJson,
} from '../../../lib/next-round-suggester/planner/identity.ts'
import {
  buildPlanningFrontierIdentity,
  getPlanningCommitments,
} from '../../../lib/next-round-suggester/planner/frontier.ts'
import type {
  SessionState,
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
} from '../../../lib/next-round-suggester/types.ts'

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const REPLAY_SCHEMA_VERSION = 2
const EDGE_FUNCTION_NAME = 'session-live-matches-suggest'
const SLOW_SUGGEST_THRESHOLD_MS = 3_000
const PLAN_ADVISORY_ENGINE_VERSION = 'precomputed-v8-rolling-frontier'

type SuggestTimingStage =
  | 'auth'
  | 'request_parse'
  | 'snapshot_load'
  | 'state_build'
  | 'fairness'
  | 'engine_search'
  | 'consistency_check'
  | 'persistence'
  | 'postprocess'

function roundedDuration(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

async function plannerIdentityHash(value: unknown) {
  const bytes = new TextEncoder().encode(stablePlannerJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function writePlanAdvisoryShadow(options: {
  supabase: { from: (table: string) => any }
  sessionId: string
  actorId: string
  requestId: string
  clientRequestId: string | null
  state: SessionState
  liveStateVersion: number
  targetCourtIdxs: number[]
  finalPreviewBoard: Array<{
    court_idx?: number | null
    round_no?: number | null
    team_a?: string[]
    team_b?: string[]
  }>
  liveBusyIds: ReadonlySet<string>
  activeManualMutationKind?: string | null
  authoritativeLiveMatchRows: SessionLiveMatchRow[]
}) {
  try {
    const [
      { data: job, error: jobError },
      { data: sessionVersion, error: sessionVersionError },
    ] = await Promise.all([
      options.supabase
        .from('session_plan_jobs')
        .select('id, result_plan_version_id, roster_fingerprint, config_fingerprint, engine_version, input_payload, planning_mutation_version')
        .eq('session_id', options.sessionId)
        .eq('status', 'completed')
        .eq('engine_version', PLAN_ADVISORY_ENGINE_VERSION)
        .not('result_plan_version_id', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      options.supabase
        .from('sessions')
        .select('planning_mutation_version')
        .eq('id', options.sessionId)
        .single(),
    ])
    if (jobError) throw new Error(jobError.message)
    if (sessionVersionError) throw new Error(sessionVersionError.message)

    const [rosterFingerprint, configFingerprint, frontierFingerprint] = await Promise.all([
      plannerIdentityHash(buildPlanningRosterIdentity(options.state)),
      plannerIdentityHash(buildPlanningConfigIdentity(options.state)),
      plannerIdentityHash(buildPlanningFrontierIdentity(
        options.state,
        getPlanningCommitments(options.authoritativeLiveMatchRows),
      )),
    ])
    const rosterIdentityMatches = Boolean(job && job.roster_fingerprint === rosterFingerprint)
    const configIdentityMatches = Boolean(job && job.config_fingerprint === configFingerprint)
    const planningVersionMatches = Boolean(job
      && Number(job.planning_mutation_version) === Number(sessionVersion.planning_mutation_version))
    const frontierMatches = Boolean(job
      && job.input_payload?.planner?.frontier_fingerprint === frontierFingerprint)
    const liveByCourt = new Map(options.finalPreviewBoard
      .map(match => [Number(match.court_idx), match] as const)
      .filter(([courtIdx]) => Number.isFinite(courtIdx)))
    const requestedCourts = [...new Set([
      ...options.targetCourtIdxs,
      ...liveByCourt.keys(),
    ])].sort((left, right) => left - right)
    const targetRoundNos = requestedCourts.map(courtIdx => {
      const liveRoundNo = Number(liveByCourt.get(courtIdx)?.round_no)
      return Number.isFinite(liveRoundNo) ? liveRoundNo + 1 : options.state.current_round + 1
    })
    const startingRound = Number(job?.input_payload?.planner?.starting_round)
    const completedHistory = Number.isFinite(startingRound)
      ? options.state.rounds.filter(round =>
          round.status === 'completed'
          && round.round_no + 1 > startingRound
          && round.round_no + 1 <= options.state.current_round
        )
      : []
    const roundNos = [...new Set([
      ...targetRoundNos,
      ...completedHistory.map(round => round.round_no + 1),
    ])]

    let roundRows: Array<{ round_no: number; matches: unknown }> = []
    if (job?.result_plan_version_id && roundNos.length > 0) {
      const { data, error } = await options.supabase
        .from('session_plan_rounds')
        .select('round_no, matches')
        .eq('plan_version_id', job.result_plan_version_id)
        .in('round_no', roundNos)
      if (error) throw new Error(error.message)
      roundRows = data ?? []
    }
    const plannedByRound = new Map(roundRows.map(row => [Number(row.round_no), Array.isArray(row.matches) ? row.matches : []]))
    const historyMatches = completedHistory.every(round => {
      const planned = plannedByRound.get(round.round_no + 1)
      return Array.isArray(planned) && plannedBoardEqualsLiveBoard(planned as any, round.matches)
    })
    const targetCourtSet = new Set(requestedCourts)
    const lockedPlayerIds = new Set(options.finalPreviewBoard
      .filter(match => !targetCourtSet.has(Number(match.court_idx)))
      .flatMap(match => [...(match.team_a ?? []), ...(match.team_b ?? [])]))
    const decisions = requestedCourts.map(courtIdx => {
      const live = liveByCourt.get(courtIdx)
      const liveRoundNo = Number(live?.round_no)
      const plannedRoundNo = Number.isFinite(liveRoundNo) ? liveRoundNo + 1 : options.state.current_round + 1
      const plannedMatches = plannedByRound.get(plannedRoundNo) ?? []
      const planned = plannedMatches[courtIdx] && typeof plannedMatches[courtIdx] === 'object'
        ? plannedMatches[courtIdx] as { team_a: [string, string]; team_b: [string, string] }
        : null
      const advisory = resolvePlannedMatchAdvisory({
        plannedMatch: planned,
        state: options.state,
        busyIds: options.liveBusyIds,
        reservedIds: lockedPlayerIds,
        rosterIdentityMatches: job ? rosterIdentityMatches : undefined,
        configIdentityMatches: job ? configIdentityMatches : undefined,
        historyMatches: job ? historyMatches : undefined,
        planningVersionMatches: job ? planningVersionMatches : undefined,
        frontierMatches: job ? frontierMatches : undefined,
        activeManualMutationKind: options.activeManualMutationKind,
      })
      return {
        court_idx: courtIdx,
        planned_round_no: plannedRoundNo,
        status: advisory.status,
        reasons: advisory.reasons,
        planned_match: planned,
        live_match: live ? { team_a: live.team_a ?? [], team_b: live.team_b ?? [] } : null,
        exact_match: plannedMatchEqualsLiveMatch(planned, live as any),
      }
    })

    await writeSessionAuditEvent(options.supabase, {
      sessionId: options.sessionId,
      eventType: 'session_plan_advisory_shadow',
      edgeFunction: EDGE_FUNCTION_NAME,
      requestId: options.requestId,
      clientRequestId: options.clientRequestId,
      actorId: options.actorId,
      requestPayload: {
        live_state_version: options.liveStateVersion,
        target_court_idxs: requestedCourts,
      },
      responsePayload: {
        plan_job_id: job?.id ?? null,
        plan_version_id: job?.result_plan_version_id ?? null,
        roster_identity_matches: job ? rosterIdentityMatches : null,
        config_identity_matches: job ? configIdentityMatches : null,
        history_matches: job ? historyMatches : null,
        planning_version_matches: job ? planningVersionMatches : null,
        frontier_matches: job ? frontierMatches : null,
        counts: {
          usable: decisions.filter(decision => decision.status === 'usable').length,
          repair_required: decisions.filter(decision => decision.status === 'repair_required').length,
          fallback: decisions.filter(decision => decision.status === 'fallback').length,
          exact_match: decisions.filter(decision => decision.exact_match).length,
        },
      },
      detail: { decisions },
    })
  } catch (error) {
    console.warn('[suggest] session plan advisory shadow failed', {
      suggestion_request_id: options.requestId,
      session_id: options.sessionId,
      error: error instanceof Error ? error.message : String(error ?? 'Unknown advisory error'),
    })
  }
}

function classifySlowSuggest(timingMs: Record<SuggestTimingStage, number>) {
  const stages = Object.entries(timingMs) as [SuggestTimingStage, number][]
  const [slowStage, slowStageMs] = stages.reduce((slowest, current) =>
    current[1] > slowest[1] ? current : slowest
  )
  const slowReason = slowStage === 'engine_search'
    ? 'engine_search'
    : slowStage === 'snapshot_load' || slowStage === 'consistency_check' || slowStage === 'persistence'
      ? 'database_roundtrip'
      : slowStage === 'auth'
        ? 'auth_roundtrip'
        : 'edge_processing'
  return { slow_stage: slowStage, slow_stage_ms: slowStageMs, slow_reason: slowReason }
}

function getEngineBuildInfo() {
  return {
    function_name: EDGE_FUNCTION_NAME,
    replay_schema_version: REPLAY_SCHEMA_VERSION,
    build_label: 'live-suggest-session-audit-v2',
    algorithm_version: LIVE_PREVIEW_ALGORITHM_VERSION,
    git_sha: Deno.env.get('ENGINE_GIT_SHA')
      ?? Deno.env.get('GIT_COMMIT_SHA')
      ?? Deno.env.get('VERCEL_GIT_COMMIT_SHA')
      ?? null,
    deployment_id: Deno.env.get('DENO_DEPLOYMENT_ID') ?? null,
  }
}

function previewMatchId(match: any) {
  const courtIdx = Number(match?.court_idx ?? match?.sequence_no ?? 0)
  const teamA = Array.isArray(match?.team_a) ? match.team_a.map(String) : []
  const teamB = Array.isArray(match?.team_b) ? match.team_b.map(String) : []
  return `preview-${Number.isFinite(courtIdx) ? courtIdx : 0}-${teamA.join('-')}-${teamB.join('-')}`
}

function normalizeStartablePreviewMatch(match: any, {
  liveStateVersion,
  countableMatchCount,
  maxSequenceNo,
}: {
  liveStateVersion: number
  countableMatchCount: number
  maxSequenceNo: number
}) {
  const suggestionMetadata = match?.suggestion_metadata && typeof match.suggestion_metadata === 'object'
    ? match.suggestion_metadata
    : {}
  const teamA = Array.isArray(match?.team_a) ? match.team_a.map(String) : []
  const teamB = Array.isArray(match?.team_b) ? match.team_b.map(String) : []
  const courtIdx = Number(match?.court_idx ?? match?.sequence_no)
  if (teamA.length !== 2 || teamB.length !== 2 || !Number.isFinite(courtIdx)) return null
  return {
    ...suggestionMetadata,
    ...match,
    id: typeof match?.id === 'string' && match.id.length > 0 ? match.id : previewMatchId({ ...match, team_a: teamA, team_b: teamB, court_idx: courtIdx }),
    status: 'suggested',
    team_a: teamA,
    team_b: teamB,
    resting: Array.isArray(match?.resting) ? match.resting.map(String) : [],
    court_idx: courtIdx,
    sequence_no: Number.isFinite(Number(match?.sequence_no)) ? Number(match.sequence_no) : courtIdx,
    preview_source: match?.preview_source ?? 'edge_committed',
    preview_live_state_version: liveStateVersion,
    preview_countable_match_count: countableMatchCount,
    preview_max_sequence_no: maxSequenceNo,
    suggested_at: match?.suggested_at ?? new Date().toISOString(),
    started_at: null,
    ended_at: null,
  }
}

function isNonNullPreviewMatch<T>(match: T | null): match is T {
  return match !== null
}

Deno.serve(async (request) => {
  console.log('[suggest] engine-build AB-FIX3', new Date().toISOString())
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  const url = new URL(request.url)
  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400)
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
  }
  const edgeRequestId = crypto.randomUUID()

  // Avoid pairs CRUD routes
  if (url.pathname.endsWith('/avoid-pairs')) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    if (request.method === 'POST') {
      const { player_a, player_b, reason } = await readJson(request) as Record<string, unknown>
      const [a, b] = [String(player_a), String(player_b)].sort()
      const { error } = await userClient
        .from('session_avoid_pairs')
        .upsert(
          { session_id: sessionId, player_a: a, player_b: b, reason: reason ?? null },
          { onConflict: 'session_id,player_a,player_b' },
        )
      if (error) return jsonResponse({ ok: false, error: error.message }, 500)
      await writeSessionAuditEvent(userClient, {
        sessionId,
        eventType: 'avoid_pair_upsert',
        edgeFunction: EDGE_FUNCTION_NAME,
        request,
        requestId: edgeRequestId,
        includeSnapshotAfter: true,
        requestPayload: {
          player_a: a,
          player_b: b,
          reason: reason ?? null,
        },
        responsePayload: { ok: true },
      })
      return jsonResponse({ ok: true }, 200)
    }

    if (request.method === 'DELETE') {
      const { player_a, player_b } = await readJson(request) as Record<string, unknown>
      const [a, b] = [String(player_a), String(player_b)].sort()
      const { error } = await userClient
        .from('session_avoid_pairs')
        .delete()
        .eq('session_id', sessionId)
        .eq('player_a', a)
        .eq('player_b', b)
      if (error) return jsonResponse({ ok: false, error: error.message }, 500)
      await writeSessionAuditEvent(userClient, {
        sessionId,
        eventType: 'avoid_pair_delete',
        edgeFunction: EDGE_FUNCTION_NAME,
        request,
        requestId: edgeRequestId,
        includeSnapshotAfter: true,
        requestPayload: {
          player_a: a,
          player_b: b,
        },
        responsePayload: { ok: true },
      })
      return jsonResponse({ ok: true }, 200)
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  // PVNA override route
  if (url.pathname.includes('/pvna-override')) {
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
    }
    const playerId = url.pathname.split('/').at(-2)
    if (!playerId) {
      return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
    }
    const { effective_pvna } = await readJson(request) as Record<string, unknown>
    if (effective_pvna !== null && effective_pvna !== undefined) {
      const numericPvna = Number(effective_pvna)
      if (!Number.isFinite(numericPvna) || numericPvna < 1.0 || numericPvna > 6.0) {
        return jsonResponse({ ok: false, error: 'effective_pvna must be between 1.0 and 6.0' }, 400)
      }
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await userClient
      .from('session_player_state')
      .update({ effective_pvna: effective_pvna ?? null })
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    await writeSessionAuditEvent(userClient, {
      sessionId,
      eventType: 'roster_pvna_override',
      edgeFunction: EDGE_FUNCTION_NAME,
      request,
      requestId: edgeRequestId,
      includeSnapshotAfter: true,
      requestPayload: {
        player_id: playerId,
        effective_pvna: effective_pvna ?? null,
      },
      responsePayload: { ok: true },
    })
    return jsonResponse({ ok: true }, 200)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const requestReceivedAt = new Date().toISOString()
  const requestStartedAt = performance.now()
  const suggestionRequestId = edgeRequestId
  const clientRequestId = request.headers.get('x-request-id')
    ?? request.headers.get('x-client-request-id')
    ?? null

  try {
    let stageStartedAt = performance.now()
    const auth = await requireHost(request, sessionId, 'session-live-matches-suggest')
    if (auth.error) return auth.error
    if (!auth.supabase) return jsonResponse({ ok: false, error: 'Unable to verify host access' }, 500)
    const timingMs = {} as Record<SuggestTimingStage, number>
    timingMs.auth = roundedDuration(stageStartedAt)

    stageStartedAt = performance.now()
    const body = await readJson(request)

    if (!Array.isArray(body.player_rows)) {
      return jsonResponse({ ok: false, error: 'Missing player_rows' }, 400)
    }
    const requestLiveStateVersion = optionalNumber(body.live_state_version)
    if (requestLiveStateVersion === undefined) {
      return jsonResponse({ ok: false, error: 'Missing live_state_version' }, 400)
    }
    timingMs.request_parse = roundedDuration(stageStartedAt)
    const loadLiveStateVersion = async () => {
      const { data, error } = await auth.supabase
        .from('sessions')
        .select('live_state_version')
        .eq('id', sessionId)
        .single()
      if (error) throw new Error(`Could not verify live state version: ${error.message}`)
      return Number(data.live_state_version)
    }
    stageStartedAt = performance.now()
    const { data: authoritativeSnapshotData, error: authoritativeSnapshotError } = await auth.supabase.rpc(
      'get_live_session_snapshot_versioned',
      { p_session_id: sessionId },
    )
    if (authoritativeSnapshotError) {
      throw new Error(`Could not load authoritative live snapshot: ${authoritativeSnapshotError.message}`)
    }
    const authoritativeSnapshot = (authoritativeSnapshotData ?? {}) as {
      live_state_version?: unknown
      player_rows?: unknown[]
      pair_rows?: unknown[]
      round_rows?: unknown[]
      live_match_rows?: unknown[]
    }
    const versionBeforeSuggest = Number(authoritativeSnapshot.live_state_version)
    if (versionBeforeSuggest !== requestLiveStateVersion) {
      return jsonResponse({
        ok: false,
        error: 'PREVIEW_STATE_CHANGED',
        state_changed: true,
        request_live_state_version: requestLiveStateVersion,
        current_live_state_version: versionBeforeSuggest,
      }, 409)
    }
    timingMs.snapshot_load = roundedDuration(stageStartedAt)

    // 1. Reconstruct engine state from the authoritative DB snapshot.
    stageStartedAt = performance.now()
    const courtCount = optionalNumber(body.court_count) ?? 1
    const pvnaTolerance = optionalNumber(body.pvna_tolerance) ?? 0.5
    const plannedTotalRounds = optionalNumber(body.planned_total_rounds)
    const courtPreset = body.court_preset === 'balanced' || body.court_preset === 'play_more' || body.court_preset === 'relaxed'
      ? body.court_preset as 'balanced' | 'play_more' | 'relaxed'
      : undefined
    const currentCourts = optionalNumber(body.current_courts)
    const avoidPairs = Array.isArray(body.avoid_pairs) ? body.avoid_pairs : undefined
    const state = mapRowsToSessionState({
      sessionId,
      playerRows: (Array.isArray(authoritativeSnapshot.player_rows) ? authoritativeSnapshot.player_rows : []) as SessionPlayerStateRow[],
      pairRows: (Array.isArray(authoritativeSnapshot.pair_rows) ? authoritativeSnapshot.pair_rows : []) as SessionPairHistoryRow[],
      roundRows: (Array.isArray(authoritativeSnapshot.round_rows) ? authoritativeSnapshot.round_rows : []) as SessionRoundRow[],
      courts: courtCount,
      pvnaTolerance,
      extraConfig: {
        planned_total_rounds: plannedTotalRounds,
        court_preset: courtPreset,
        current_courts: currentCourts,
        avoid_pairs: avoidPairs,
      },
    })
    const completedRoundsCount = state.rounds.filter(round => round.status === 'completed').length
    timingMs.state_build = roundedDuration(stageStartedAt)
    if (plannedTotalRounds != null && completedRoundsCount >= plannedTotalRounds) {
      console.log('[suggest] target_rounds_reached', {
        suggestion_request_id: suggestionRequestId,
        client_request_id: clientRequestId,
        session_id: sessionId,
        request_received_at: requestReceivedAt,
        planned_total_rounds: plannedTotalRounds,
        completed_rounds: completedRoundsCount,
      })
      return jsonResponse({
        ok: true,
        payloads: [],
        final_preview_board: [],
        warnings: ['TARGET_ROUNDS_REACHED'],
        should_end: true,
        live_state_version_used: requestLiveStateVersion,
        debug: {
          reason: 'TARGET_ROUNDS_REACHED',
          planned_total_rounds: plannedTotalRounds,
          completed_rounds: completedRoundsCount,
        },
      }, 200)
    }

    // 2. Compute fairness (pure functions, no DB)
    stageStartedAt = performance.now()
    const adjustment = correctForFairness(state)
    const warnings = detectFairnessIssues(state)
    timingMs.fairness = roundedDuration(stageStartedAt)

    // 3. Reconstruct request params
    const requestedCount = typeof body.count === 'number' ? body.count : 1
    const authoritativeLiveMatchRows = (Array.isArray(authoritativeSnapshot.live_match_rows)
      ? authoritativeSnapshot.live_match_rows
      : []) as SessionLiveMatchRow[]
    const liveStateVersion = requestLiveStateVersion
    const maxEdgePreviewCount = Math.min(courtCount, requestedCount)
    const preferAvailablePool = body.prefer_available_pool === true
    const count = Math.max(1, Math.min(requestedCount, maxEdgePreviewCount))
    const courtIdxs = Array.isArray(body.court_idxs)
      ? body.court_idxs
          .map((value: unknown) => optionalNumber(value))
          .filter((value: number | undefined): value is number => value !== undefined)
          .slice(0, count)
      : undefined
    const mode = body.mode === 'replace_courts' ? 'replace_courts' : 'full_board'
    const currentPreviewBoard = mode === 'full_board'
      ? []
      : Array.isArray(body.current_preview_board) ? body.current_preview_board : []
    const liveMatchRows = mode === 'full_board'
      ? authoritativeLiveMatchRows.filter(match => match.status !== 'suggested')
      : authoritativeLiveMatchRows
    const completingLiveMatchIds = new Set<string>(
      Array.isArray(body.completing_live_match_ids) ? body.completing_live_match_ids : []
    )
    const tightPoolQualityDeferUntilByCourt = buildTightPoolQualityDeferUntilByCourt(
      authoritativeLiveMatchRows,
      courtIdxs,
    )
    console.log('[suggest] request_start', {
      suggestion_request_id: suggestionRequestId,
      client_request_id: clientRequestId,
      session_id: sessionId,
      request_received_at: requestReceivedAt,
      mode,
      requested_count: requestedCount,
      count,
      court_count: courtCount,
      live_state_version: liveStateVersion,
      prefer_available_pool: preferAvailablePool,
      completing_live_match_ids: [...completingLiveMatchIds],
    })

    const playersById = new Map<string, { name: string }>()
    if (Array.isArray(body.players)) {
      for (const p of body.players) {
        if (p && typeof p.id === 'string' && typeof p.name === 'string') {
          playersById.set(p.id, { name: p.name })
        }
      }
    }

    // 4. Run suggestion algorithm
    const serviceClient = createServiceClient()
    const backgroundWrites: Promise<unknown>[] = []
    const verifyDumpEnabled = Deno.env.get('VERIFY_DUMP') === '1'
    const decisionSource = preferAvailablePool ? 'host_replacement' : 'engine_auto'
    const verifyDumps: import('../../../lib/next-round-suggester/live-preview.ts').IncompleteDump[] = []
    const instrumentEvents: { event: string; detail: string; court_count?: number; available?: number }[] = []
    const onIncompleteDump = verifyDumpEnabled
      ? (dump: import('../../../lib/next-round-suggester/live-preview.ts').IncompleteDump) => {
          verifyDumps.push(dump)
        }
      : undefined
    const onInstrumentEvent = (event: { event: string; detail: string; court_count?: number; available?: number }) => {
      instrumentEvents.push({ ...event })
      const instrumentationWrite = serviceClient.from('engine_instrumentation').insert({
        session_id: sessionId,
        event: event.event,
        detail: event.detail,
        court_count: event.court_count ?? courtCount,
        available: event.available ?? null,
      }).then(({ error }) => {
        if (error) {
          console.warn('[suggest] engine_instrumentation insert failed', {
            suggestion_request_id: suggestionRequestId,
            session_id: sessionId,
            error: error.message,
          })
        }
      })
      backgroundWrites.push(Promise.resolve(instrumentationWrite))
    }
    const selectionDebug: any[] = []
    stageStartedAt = performance.now()
    let payloads = buildSuggestedMatchPayloads({
      count,
      sessionId,
      courtCount,
      state,
      rows: { liveMatchRows, liveStateVersion },
      completingLiveMatchIds,
      fairnessAdjustment: adjustment,
      fairnessWarnings: warnings,
      playersById,
      pvnaTolerance,
      options: {
        ...(courtIdxs && courtIdxs.length > 0 ? { courtIdxs } : {}),
        ignoreCapacityLock: !preferAvailablePool,
        deferExtremeTightPool: true,
        tightPoolQualityDeferUntilByCourt,
        onIncompleteDump,
        onInstrumentEvent,
      },
      debugOut: selectionDebug,
    })
    let board = buildFinalPreviewBoard({
      mode,
      payloads,
      currentPreviewBoard,
      replacementCourtIdxs: courtIdxs,
      courtCount,
    })
    let qualityRescueUsed = false
    const replacementBoardIncomplete = mode === 'replace_courts'
      && !hasFulfilledPreviewBoardReplacements(board, courtIdxs)
    const needsQualityRescue = mode === 'replace_courts'
      && needsEarlyFullBoardPvnaRescue(payloads, state, pvnaTolerance)
    const allowReplacementFullBoardRescue = mode === 'replace_courts'
      && body.allow_full_board_rescue === true
    if (
      allowReplacementFullBoardRescue
      && (replacementBoardIncomplete || needsQualityRescue)
    ) {
      const liveRowsWithoutRetainedPreviews = liveMatchRows.filter((match: any) => match?.status !== 'suggested')
      const fullBoardCount = Math.min(
        courtCount,
        Math.max(count, currentPreviewBoard.length + count),
      )
      const rescuedPayloads = buildSuggestedMatchPayloads({
        count: fullBoardCount,
        sessionId,
        courtCount,
        state,
        rows: { liveMatchRows: liveRowsWithoutRetainedPreviews, liveStateVersion },
        completingLiveMatchIds,
        fairnessAdjustment: adjustment,
        fairnessWarnings: warnings,
        playersById,
        pvnaTolerance,
        options: { onIncompleteDump, onInstrumentEvent },
      })
      const rescuedBoard = buildFinalPreviewBoard({
        mode: 'full_board',
        payloads: rescuedPayloads,
        currentPreviewBoard: [],
        courtCount,
      })
      const fillsMoreCourts = rescuedBoard.final_preview_board.length > board.final_preview_board.length
      const improvesQualityWithoutLosingCourts = rescuedBoard.final_preview_board.length >= board.final_preview_board.length
        && improvesPreviewBoardPvna(rescuedPayloads, payloads, state, pvnaTolerance)
      if (fillsMoreCourts || (!replacementBoardIncomplete && improvesQualityWithoutLosingCourts)) {
        payloads = rescuedPayloads
        board = rescuedBoard
        qualityRescueUsed = true
      }
    }
    timingMs.engine_search = roundedDuration(stageStartedAt)
    stageStartedAt = performance.now()
    const currentCountableMatchCount = liveMatchRows.filter((match: any) =>
      match?.status !== 'cancelled' && match?.status !== 'suggested'
    ).length
    const currentMaxSequenceNo = liveMatchRows.reduce((max: number, m: any) =>
      Math.max(max, typeof m?.sequence_no === 'number' ? m.sequence_no : -1), -1)
    let finalPreviewBoard = board.final_preview_board
      .map(payload => normalizeStartablePreviewMatch(payload, {
        liveStateVersion,
        countableMatchCount: currentCountableMatchCount,
        maxSequenceNo: currentMaxSequenceNo,
      }))
      .filter(isNonNullPreviewMatch)
    const liveBusyIds = new Set<string>(
      liveMatchRows
        .filter((m: any) => m.status === 'live' && !completingLiveMatchIds.has(m.id))
        .flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])])
    )
    const suggestedBusyIds = new Set<string>(
      liveMatchRows
        .filter((m: any) => m.status === 'suggested')
        .flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])])
    )
    const allOccupiedIds = new Set<string>([
      ...liveBusyIds,
      ...suggestedBusyIds,
    ])
    const freeCount = [...state.players.values()].filter(
      (p: any) => p.checked_out_at === null && !p.opted_rest && !allOccupiedIds.has(p.player_id)
    ).length
    const playerLimitedCourts = Math.max(0, count - payloads.length)
    const maxCourtsWithEveryone = Math.floor((freeCount + liveBusyIds.size) / 4)
    const tempLimitedCourts = Math.min(playerLimitedCourts, Math.max(0, maxCourtsWithEveryone - payloads.length))
    const realLimitedCourts = playerLimitedCourts - tempLimitedCourts
    const occupiedCourtIdxs = new Set(
      liveMatchRows
        .filter((match: any) =>
          match?.status === 'live'
          && !completingLiveMatchIds.has(match.id)
          && match?.court_idx !== null
          && match?.court_idx !== undefined
        )
        .map((match: any) => Number(match.court_idx))
        .filter((idx: number) => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
    )
    const finalFilledCourtIdxs = new Set(
      finalPreviewBoard
        .map((payload: any) => Number(payload.court_idx))
        .filter((idx: number) => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
    )
    const finalMissingOpenCourts = Array.from({ length: courtCount }, (_, idx) => idx)
      .filter(idx => !occupiedCourtIdxs.has(idx) && !finalFilledCourtIdxs.has(idx))
    const openCourtIdxs = Array.from({ length: courtCount }, (_, idx) => idx)
      .filter(idx => !occupiedCourtIdxs.has(idx))
    const explicitTargetCourtIdxs = (courtIdxs ?? [])
      .filter(idx => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
    const partialFullBoardRequest = mode === 'full_board'
      && explicitTargetCourtIdxs.length === 0
      && count < openCourtIdxs.length
    const targetCourtIdxs = mode === 'replace_courts'
      ? explicitTargetCourtIdxs
      : partialFullBoardRequest
        ? []
        : openCourtIdxs
    const missingTargetCourts = targetCourtIdxs.filter(idx => !finalFilledCourtIdxs.has(idx))
    const filledTargetCount = targetCourtIdxs.length > 0
      ? targetCourtIdxs.filter(idx => finalFilledCourtIdxs.has(idx)).length
      : Math.min(count, finalPreviewBoard.length)
    const targetExpectedCount = targetCourtIdxs.length > 0
      ? targetCourtIdxs.length
      : count
    const targetCountShortfall = Math.max(0, targetExpectedCount - filledTargetCount)
    timingMs.postprocess = roundedDuration(stageStartedAt)
    stageStartedAt = performance.now()
    if (finalPreviewBoard.length === 0 && targetCourtIdxs.length === 0) {
      const versionAfterSuggest = await loadLiveStateVersion()
      if (versionAfterSuggest !== requestLiveStateVersion) {
        return jsonResponse({
          ok: false,
          error: 'PREVIEW_STATE_CHANGED',
          state_changed: true,
          request_live_state_version: requestLiveStateVersion,
          current_live_state_version: versionAfterSuggest,
        }, 409)
      }
    }
    timingMs.consistency_check = roundedDuration(stageStartedAt)
    stageStartedAt = performance.now()
    let persistedPreviewVersion = liveStateVersion
    let persistedPreviewNoop = false
    if (finalPreviewBoard.length > 0 || targetCourtIdxs.length > 0) {
      const replaceCourtIdxs = targetCourtIdxs.length > 0
        ? targetCourtIdxs
        : finalPreviewBoard
            .map((payload: any) => Number(payload.court_idx))
            .filter((idx: number) => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
      const replaceAllSuggestions = mode === 'full_board' && explicitTargetCourtIdxs.length === 0
      const matchesToPersist = getPreviewMatchesToPersist({
        mode,
        finalPreviewBoard,
        replacementCourtIdxs: replaceCourtIdxs,
      })
      const { data: persistedPreviewData, error: persistedPreviewError } = await auth.supabase.rpc(
        'replace_live_session_suggestions_versioned',
        {
          p_session_id: sessionId,
          p_expected_live_state_version: requestLiveStateVersion,
          p_matches: matchesToPersist,
          p_replace_court_idxs: replaceCourtIdxs,
          p_replace_all: replaceAllSuggestions,
          p_audit_payload: {
            source: EDGE_FUNCTION_NAME,
            suggestion_request_id: suggestionRequestId,
            client_request_id: clientRequestId,
            mode,
            requested_count: requestedCount,
            count,
            court_count: courtCount,
            target_court_idxs: targetCourtIdxs,
            missing_target_courts: missingTargetCourts,
            target_count_shortfall: targetCountShortfall,
          },
        },
      )
      if (persistedPreviewError) {
        if (persistedPreviewError.message?.includes('Session changed')) {
          return jsonResponse({
            ok: false,
            error: 'PREVIEW_STATE_CHANGED',
            state_changed: true,
            request_live_state_version: requestLiveStateVersion,
          }, 409)
        }
        throw new Error(`Could not persist live match suggestions: ${persistedPreviewError.message}`)
      }
      persistedPreviewVersion = Number((persistedPreviewData as any)?.live_state_version ?? liveStateVersion)
      persistedPreviewNoop = (persistedPreviewData as any)?.persisted_preview_noop === true
      const persistedMatches = Array.isArray((persistedPreviewData as any)?.matches)
        ? (persistedPreviewData as any).matches
        : []
      const normalizedPersistedMatches = persistedMatches
        .map((payload: any) => normalizeStartablePreviewMatch(payload, {
          liveStateVersion: persistedPreviewVersion,
          countableMatchCount: currentCountableMatchCount,
          maxSequenceNo: currentMaxSequenceNo,
        }))
        .filter(isNonNullPreviewMatch)
      finalPreviewBoard = mode === 'replace_courts'
        ? buildFinalPreviewBoard({
            mode,
            payloads: normalizedPersistedMatches,
            currentPreviewBoard,
            replacementCourtIdxs: replaceCourtIdxs,
            courtCount,
          }).final_preview_board
        : normalizedPersistedMatches
    }
    timingMs.persistence = roundedDuration(stageStartedAt)

    const totalTimingMs = roundedDuration(requestStartedAt)
    const slowRequest = totalTimingMs >= SLOW_SUGGEST_THRESHOLD_MS
    const slowDiagnostic = slowRequest ? classifySlowSuggest(timingMs) : null

    if (verifyDumpEnabled) {
      const latestDump = verifyDumps.at(-1)
      const finalChosenMatches = finalPreviewBoard.map((payload: any) => ({
        court_idx: payload.court_idx ?? -1,
        team_a: [...(payload.team_a ?? [])],
        team_b: [...(payload.team_b ?? [])],
        is_replacement: preferAvailablePool,
        warnings: payload.warnings ?? [],
        tradeoffs: payload.tradeoffs ?? [],
      }))
      const dumpAnomaly = missingTargetCourts.length > 0
        || targetCountShortfall > 0
        || realLimitedCourts > 0
        || replacementBoardIncomplete
      const fullDumpEnabled = Deno.env.get('VERIFY_DUMP_FULL') === '1' || dumpAnomaly
      const compactPlayers = [...state.players.values()].map((player: any) => ({
        id: player.player_id,
        pvna: player.pvna,
        gender: player.gender,
        partner_gender_pref: player.partner_gender_pref,
        opponent_gender_pref: player.opponent_gender_pref,
        matches_played: player.matches_played,
        last_played_round: player.last_played_round ?? 0,
        consecutive_rest: player.consecutive_rest,
        consecutive_play: player.consecutive_play,
        rounds_available: player.rounds_available,
        opted_rest: player.opted_rest,
        checked_out: player.checked_out_at !== null,
        checked_in_at: player.checked_in_at instanceof Date ? player.checked_in_at.toISOString() : player.checked_in_at,
        checked_out_at: player.checked_out_at instanceof Date ? player.checked_out_at.toISOString() : player.checked_out_at,
        group_id: player.group_id ?? null,
        partner_counts: Object.fromEntries(player.partner_counts ?? []),
        opponent_counts: Object.fromEntries(player.opponent_counts ?? []),
      }))
      const compactRounds = state.rounds.map(round => ({
        round_no: round.round_no,
        status: round.status,
        match_count: round.matches.length,
        resting_count: round.resting.length,
      }))
      const compactMatch = (match: any) => ({
        id: match?.id ?? null,
        status: match?.status ?? null,
        round_no: match?.round_no ?? null,
        cycle_no: match?.cycle_no ?? null,
        sequence_no: match?.sequence_no ?? null,
        court_idx: match?.court_idx ?? null,
        team_a: [...(match?.team_a ?? [])],
        team_b: [...(match?.team_b ?? [])],
        resting: [...(match?.resting ?? [])],
        warnings: match?.warnings ?? undefined,
        tradeoffs: match?.tradeoffs ?? undefined,
        preview_source: match?.preview_source ?? undefined,
        preview_live_state_version: match?.preview_live_state_version ?? undefined,
        preview_countable_match_count: match?.preview_countable_match_count ?? undefined,
      })
      const compactRoundRecords = state.rounds.map(round => ({
        id: round.id ?? null,
        session_id: round.session_id,
        round_no: round.round_no,
        status: round.status,
        started_at: round.started_at instanceof Date ? round.started_at.toISOString() : round.started_at,
        ended_at: round.ended_at instanceof Date ? round.ended_at.toISOString() : round.ended_at,
        resting: [...(round.resting ?? [])],
        matches: (round.matches ?? []).map((match: any) => ({
          team_a: [...(match.team_a ?? [])],
          team_b: [...(match.team_b ?? [])],
        })),
      }))
      const compactSelectionDebug = selectionDebug.map((court: any) => ({
        court_idx: court.court_idx,
        busy_count: court.busy_count,
        required_for_court: [...(court.required_for_court ?? [])],
        eligible_players: (court.eligible_players ?? []).map((player: any) => ({
          id: player.id,
          pvna: player.pvna,
          consecutive_rest: player.consecutive_rest,
          matches_played: player.matches_played,
          tier: player.tier,
        })),
        selected: (court.selected ?? []).map((player: any) => ({
          id: player.id,
          pvna: player.pvna,
          team: player.team,
        })),
      }))
      const baseReplayPayload = {
        replay_schema_version: REPLAY_SCHEMA_VERSION,
        dump_level: fullDumpEnabled ? 'full' : 'lite',
        full_dump_reason: fullDumpEnabled
          ? Deno.env.get('VERIFY_DUMP_FULL') === '1'
            ? 'env'
            : 'anomaly'
          : null,
        event_type: 'live_match_suggested',
        event_created_at: new Date().toISOString(),
        request_received_at: requestReceivedAt,
        suggestion_request_id: suggestionRequestId,
        client_request_id: clientRequestId,
        session_id: sessionId,
        decision_source: decisionSource,
        edge_function: EDGE_FUNCTION_NAME,
        engine_build: getEngineBuildInfo(),
        request: {
          requested_count: requestedCount,
          count,
          mode,
          court_count: courtCount,
          court_idxs: courtIdxs ?? null,
          prefer_available_pool: preferAvailablePool,
          live_state_version: liveStateVersion,
          completing_live_match_ids: [...completingLiveMatchIds],
          current_preview_board: currentPreviewBoard,
          allow_full_board_rescue: allowReplacementFullBoardRescue,
          pvna_tolerance: pvnaTolerance,
          planned_total_rounds: plannedTotalRounds ?? null,
          court_preset: courtPreset ?? null,
          current_courts: currentCourts ?? null,
          avoid_pairs: avoidPairs ?? [],
        },
        derived_state_summary: {
          session_status: state.status,
          current_round: state.current_round,
          config: state.config,
          players: state.players.size,
          active_players: [...state.players.values()].filter(p => p.checked_out_at === null).length,
          opted_rest_players: [...state.players.values()].filter(p => p.checked_out_at === null && p.opted_rest).length,
          checked_out_players: [...state.players.values()].filter(p => p.checked_out_at !== null).length,
          live_busy_players: liveBusyIds.size,
          suggested_busy_players: suggestedBusyIds.size,
          free_playable_players: freeCount,
          completed_rounds: state.rounds.filter(round => round.status === 'completed').length,
          active_rounds: state.rounds.filter(round => round.status === 'active').length,
        },
        fairness: {
          adjustment,
          warnings,
        },
        engine_decision: {
          input_count: count,
          output_payload_count: payloads.length,
          final_preview_board_count: finalPreviewBoard.length,
          replacement_board_incomplete: replacementBoardIncomplete,
          needs_quality_rescue: needsQualityRescue,
          quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
          player_limited_courts: playerLimitedCourts,
          temp_limited_courts: tempLimitedCourts,
          real_limited_courts: realLimitedCourts,
          max_courts_with_free_players: Math.floor(freeCount / 4),
          max_courts_with_free_plus_live_busy_players: maxCourtsWithEveryone,
        },
        timing_ms: {
          ...timingMs,
          total: totalTimingMs,
        },
        slow_request: slowRequest,
        slow_diagnostic: slowDiagnostic
          ? {
              threshold_ms: SLOW_SUGGEST_THRESHOLD_MS,
              ...slowDiagnostic,
              engine_instrumentation_events: instrumentEvents,
              search_shape: {
                selection_count: selectionDebug.length,
                max_busy_count: Math.max(0, ...selectionDebug.map((court: any) => Number(court.busy_count) || 0)),
                min_eligible_count: selectionDebug.length > 0
                  ? Math.min(...selectionDebug.map((court: any) => Array.isArray(court.eligible_players) ? court.eligible_players.length : 0))
                  : 0,
                max_required_count: Math.max(0, ...selectionDebug.map((court: any) => Array.isArray(court.required_for_court) ? court.required_for_court.length : 0)),
                quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
              },
            }
          : null,
        player_snapshot_lite: compactPlayers,
        round_snapshot_lite: compactRounds,
        busy_player_ids: [...allOccupiedIds].sort(),
        live_match_summary: {
          total: liveMatchRows.length,
          live: liveMatchRows.filter((match: any) => match?.status === 'live').length,
          suggested: liveMatchRows.filter((match: any) => match?.status === 'suggested').length,
          completed: liveMatchRows.filter((match: any) => match?.status === 'completed').length,
          cancelled: liveMatchRows.filter((match: any) => match?.status === 'cancelled').length,
        },
        raw_payloads_before_final_board_count: payloads.length,
        final_preview_board_count: finalPreviewBoard.length,
        selection_debug_count: selectionDebug.length,
        current_preview_board_lite: currentPreviewBoard.map(compactMatch),
        live_match_rows_lite: liveMatchRows.map(compactMatch),
        final_preview_board_lite: finalPreviewBoard.map(compactMatch),
        raw_payloads_before_final_board_lite: payloads.map(compactMatch),
        selection_debug_lite: compactSelectionDebug,
        round_records_lite: compactRoundRecords,
        chosen_courts: finalChosenMatches.map(match => match.court_idx),
        replaced_court_idxs: board.replaced_court_idxs,
        locked_court_idxs: board.locked_court_idxs,
        quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
        persisted_preview: true,
        persisted_preview_noop: persistedPreviewNoop,
        persisted_preview_live_state_version: persistedPreviewVersion,
        occupied_live_court_idxs: [...occupiedCourtIdxs].sort((left, right) => left - right),
        open_court_idxs: openCourtIdxs,
        target_court_idxs: targetCourtIdxs,
        requested_court_idxs: explicitTargetCourtIdxs,
        filled_court_idxs: [...finalFilledCourtIdxs].sort((left, right) => left - right),
        missing_open_courts: finalMissingOpenCourts,
        missing_target_courts: missingTargetCourts,
        partial_full_board_request: partialFullBoardRequest,
        target_expected_count: targetExpectedCount,
        filled_target_count: filledTargetCount,
        target_count_shortfall: targetCountShortfall,
        missing_courts: finalMissingOpenCourts,
      }
      const replayPayload = fullDumpEnabled
        ? {
            ...(latestDump && typeof latestDump.payload === 'object' && latestDump.payload !== null ? latestDump.payload : {}),
            ...baseReplayPayload,
            raw_request_body: body,
            session_history_snapshot: {
              captured_at: requestReceivedAt,
              player_rows: body.player_rows ?? [],
              pair_rows: body.pair_rows ?? [],
              round_rows: body.round_rows ?? [],
              live_match_rows: liveMatchRows,
              current_preview_board: currentPreviewBoard,
              avoid_pairs: avoidPairs ?? [],
            },
            live_match_rows: liveMatchRows,
            selection_debug: selectionDebug,
            intermediate_dumps: verifyDumps,
            raw_payloads_before_final_board: payloads,
            final_preview_board: finalPreviewBoard,
          }
        : baseReplayPayload

      const debugDumpWrite = serviceClient.from('debug_dumps').insert({
        session_id: sessionId,
        missing_courts: finalMissingOpenCourts,
        payload: replayPayload,
        chosen_matches: finalChosenMatches,
        pvna_tolerance: pvnaTolerance,
        rounds: latestDump?.rounds ?? [],
        decision_source: decisionSource,
      }).then(({ error }) => {
        if (error) {
          console.warn('[suggest] debug_dumps insert failed', {
            suggestion_request_id: suggestionRequestId,
            session_id: sessionId,
            error: error.message,
          })
        }
      })
      backgroundWrites.push(Promise.resolve(debugDumpWrite))
    }

    console.log('[suggest] request_done', {
      suggestion_request_id: suggestionRequestId,
      client_request_id: clientRequestId,
      session_id: sessionId,
      request_received_at: requestReceivedAt,
      decision_source: decisionSource,
      mode,
      requested_count: requestedCount,
      count,
      court_count: courtCount,
      live_state_version: liveStateVersion,
      persisted_preview: true,
      persisted_preview_noop: persistedPreviewNoop,
      persisted_preview_live_state_version: persistedPreviewVersion,
      output_payload_count: payloads.length,
      final_preview_board_count: finalPreviewBoard.length,
      occupied_live_court_idxs: [...occupiedCourtIdxs].sort((left, right) => left - right),
      missing_open_courts: finalMissingOpenCourts,
      missing_target_courts: missingTargetCourts,
      partial_full_board_request: partialFullBoardRequest,
      target_count_shortfall: targetCountShortfall,
      quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
      player_limited_courts: playerLimitedCourts,
      temp_limited_courts: tempLimitedCourts,
      real_limited_courts: realLimitedCourts,
      timing_ms: { ...timingMs, total: totalTimingMs },
      slow_request: slowRequest,
      slow_diagnostic: slowDiagnostic,
    })

    const auditWrite = writeSessionAuditEvent(serviceClient, {
      sessionId,
      eventType: 'live_match_suggest',
      edgeFunction: EDGE_FUNCTION_NAME,
      request,
      requestId: suggestionRequestId,
      clientRequestId,
      requestPayload: {
        requested_count: requestedCount,
        count,
        mode,
        court_count: courtCount,
        court_idxs: courtIdxs ?? null,
        prefer_available_pool: preferAvailablePool,
        live_state_version: liveStateVersion,
        completing_live_match_ids: [...completingLiveMatchIds],
        allow_full_board_rescue: allowReplacementFullBoardRescue,
        pvna_tolerance: pvnaTolerance,
        planned_total_rounds: plannedTotalRounds ?? null,
        court_preset: courtPreset ?? null,
        current_courts: currentCourts ?? null,
        avoid_pairs: avoidPairs ?? [],
      },
      responsePayload: {
        payload_count: payloads.length,
        final_preview_board_count: finalPreviewBoard.length,
        replaced_court_idxs: board.replaced_court_idxs,
        locked_court_idxs: board.locked_court_idxs,
        open_court_idxs: openCourtIdxs,
        target_court_idxs: targetCourtIdxs,
        requested_court_idxs: explicitTargetCourtIdxs,
        filled_court_idxs: [...finalFilledCourtIdxs].sort((left, right) => left - right),
        missing_open_courts: finalMissingOpenCourts,
        missing_target_courts: missingTargetCourts,
        partial_full_board_request: partialFullBoardRequest,
        target_expected_count: targetExpectedCount,
        filled_target_count: filledTargetCount,
        target_count_shortfall: targetCountShortfall,
        quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
        player_limited_courts: playerLimitedCourts,
        temp_limited_courts: tempLimitedCourts,
        real_limited_courts: realLimitedCourts,
        persisted_preview: true,
        persisted_preview_noop: persistedPreviewNoop,
        persisted_preview_live_state_version: persistedPreviewVersion,
        timing_ms: { ...timingMs, total: totalTimingMs },
        slow_request: slowRequest,
        slow_diagnostic: slowDiagnostic,
      },
      detail: {
        decision_source: decisionSource,
        selection_debug: selectionDebug,
      },
    }).catch((error) => {
      console.warn('[suggest] session audit insert failed after response', {
        suggestion_request_id: suggestionRequestId,
        client_request_id: clientRequestId,
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error ?? 'Unknown audit error'),
      })
    })
    const planAdvisoryWrite = Deno.env.get('SESSION_PLAN_ADVISORY_SHADOW') === '1'
      ? writePlanAdvisoryShadow({
          supabase: serviceClient,
          sessionId,
          actorId: auth.userId,
          requestId: suggestionRequestId,
          clientRequestId,
          state,
          liveStateVersion: persistedPreviewVersion,
          targetCourtIdxs: targetCourtIdxs.length > 0
            ? targetCourtIdxs
            : [...finalFilledCourtIdxs],
          finalPreviewBoard,
          liveBusyIds,
          activeManualMutationKind: authoritativeLiveMatchRows
            .filter(match => (
              match.status === 'suggested' || match.status === 'live'
            ) && match.suggestion_metadata?.manual_override === true)
            .map(match => String(match.suggestion_metadata?.manual_mutation_kind ?? 'manual_lineup_changed'))
            .at(-1) ?? null,
          authoritativeLiveMatchRows,
        })
      : null
    const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      for (const backgroundWrite of backgroundWrites) {
        edgeRuntime.waitUntil(backgroundWrite)
      }
      edgeRuntime.waitUntil(auditWrite)
      if (planAdvisoryWrite) edgeRuntime.waitUntil(planAdvisoryWrite)
    } else {
      for (const backgroundWrite of backgroundWrites) {
        void backgroundWrite
      }
      void auditWrite
      if (planAdvisoryWrite) void planAdvisoryWrite
    }

    return jsonResponse({
      ok: true,
      payloads,
      final_preview_board: finalPreviewBoard,
      request_live_state_version_used: requestLiveStateVersion,
      live_state_version_used: persistedPreviewVersion,
      persisted_preview: true,
      persisted_preview_noop: persistedPreviewNoop,
      replaced_court_idxs: board.replaced_court_idxs,
      locked_court_idxs: board.locked_court_idxs,
      open_court_idxs: openCourtIdxs,
      target_court_idxs: targetCourtIdxs,
      requested_court_idxs: explicitTargetCourtIdxs,
      filled_court_idxs: [...finalFilledCourtIdxs].sort((left, right) => left - right),
      missing_open_courts: finalMissingOpenCourts,
      missing_target_courts: missingTargetCourts,
      partial_full_board_request: partialFullBoardRequest,
      target_expected_count: targetExpectedCount,
      filled_target_count: filledTargetCount,
      target_count_shortfall: targetCountShortfall,
      quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
      player_limited_courts: playerLimitedCourts,
      temp_limited_courts: tempLimitedCourts,
      real_limited_courts: realLimitedCourts,
      debug: {
        authoritative_snapshot: true,
        playerCount: state.players.size,
        activePlayers: [...state.players.values()].filter(p => p.checked_out_at === null).map(p => p.player_id),
        count,
        courtCount,
        mode,
        replacementBoardIncomplete,
        selection_debug: selectionDebug,
      },
    })
  } catch (error) {
    console.error('[session-live-matches-suggest] error:', {
      suggestion_request_id: suggestionRequestId,
      client_request_id: clientRequestId,
      session_id: sessionId,
      request_received_at: requestReceivedAt,
      error,
    })
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
