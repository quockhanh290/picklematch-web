/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createServiceClient, getSessionId, handleCorsPreflight, jsonResponse, readJson, writeSessionAuditEvent } from '../_shared/live-session.ts'
import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector.ts'
import { detectFairnessIssues } from '../../../lib/next-round-suggester/fairness/detector.ts'
import {
  buildFinalPreviewBoard,
  buildSuggestedMatchPayloads,
  hasFulfilledPreviewBoardReplacements,
  improvesPreviewBoardPvna,
  needsEarlyFullBoardPvnaRescue,
} from '../../../lib/next-round-suggester/live-preview.ts'
import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state.ts'

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const REPLAY_SCHEMA_VERSION = 2
const EDGE_FUNCTION_NAME = 'session-live-matches-suggest'

function getEngineBuildInfo() {
  return {
    function_name: EDGE_FUNCTION_NAME,
    replay_schema_version: REPLAY_SCHEMA_VERSION,
    build_label: 'live-suggest-session-audit-v2',
    git_sha: Deno.env.get('ENGINE_GIT_SHA')
      ?? Deno.env.get('GIT_COMMIT_SHA')
      ?? Deno.env.get('VERCEL_GIT_COMMIT_SHA')
      ?? null,
    deployment_id: Deno.env.get('DENO_DEPLOYMENT_ID') ?? null,
  }
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
  const suggestionRequestId = edgeRequestId
  const clientRequestId = request.headers.get('x-request-id')
    ?? request.headers.get('x-client-request-id')
    ?? null

  try {
    const body = await readJson(request)

    if (!Array.isArray(body.player_rows)) {
      return jsonResponse({ ok: false, error: 'Missing player_rows' }, 400)
    }

    // 1. Reconstruct state from client rows — no DB queries needed
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
      playerRows: body.player_rows ?? [],
      pairRows: body.pair_rows ?? [],
      roundRows: body.round_rows ?? [],
      courts: courtCount,
      pvnaTolerance,
      extraConfig: {
        planned_total_rounds: plannedTotalRounds,
        court_preset: courtPreset,
        current_courts: currentCourts,
        avoid_pairs: avoidPairs,
      },
    })

    // 2. Compute fairness (pure functions, no DB)
    const adjustment = correctForFairness(state)
    const warnings = detectFairnessIssues(state)

    // 3. Reconstruct request params
    const requestedCount = typeof body.count === 'number' ? body.count : 1
    const liveMatchRows = Array.isArray(body.live_match_rows) ? body.live_match_rows : []
    const liveStateVersion = optionalNumber(body.live_state_version) ?? null
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
    const currentPreviewBoard = Array.isArray(body.current_preview_board) ? body.current_preview_board : []
    const completingLiveMatchIds = new Set<string>(
      Array.isArray(body.completing_live_match_ids) ? body.completing_live_match_ids : []
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
    const onIncompleteDump = verifyDumpEnabled
      ? (dump: import('../../../lib/next-round-suggester/live-preview.ts').IncompleteDump) => {
          verifyDumps.push(dump)
        }
      : undefined
    const onInstrumentEvent = (event: { event: string; detail: string; court_count?: number; available?: number }) => {
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
      backgroundWrites.push(instrumentationWrite)
    }
    const selectionDebug: any[] = []
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
    const currentCountableMatchCount = liveMatchRows.filter((match: any) =>
      match?.status !== 'cancelled' && match?.status !== 'suggested'
    ).length
    const currentMaxSequenceNo = liveMatchRows.reduce((max: number, m: any) =>
      Math.max(max, typeof m?.sequence_no === 'number' ? m.sequence_no : -1), -1)
    const finalPreviewBoard = board.final_preview_board.map(payload => ({
      ...payload,
      preview_live_state_version: liveStateVersion,
      preview_countable_match_count: currentCountableMatchCount,
      preview_max_sequence_no: currentMaxSequenceNo,
    }))
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
      const replayPayload = {
        ...(latestDump && typeof latestDump.payload === 'object' && latestDump.payload !== null ? latestDump.payload : {}),
        replay_schema_version: REPLAY_SCHEMA_VERSION,
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
        live_match_rows: liveMatchRows,
        selection_debug: selectionDebug,
        intermediate_dumps: verifyDumps,
        raw_payloads_before_final_board: payloads,
        final_preview_board: finalPreviewBoard,
        replaced_court_idxs: board.replaced_court_idxs,
        locked_court_idxs: board.locked_court_idxs,
        quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
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
      backgroundWrites.push(debugDumpWrite)
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
    const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      for (const backgroundWrite of backgroundWrites) {
        edgeRuntime.waitUntil(backgroundWrite)
      }
      edgeRuntime.waitUntil(auditWrite)
    } else {
      for (const backgroundWrite of backgroundWrites) {
        void backgroundWrite
      }
      void auditWrite
    }

    return jsonResponse({
      ok: true,
      payloads,
      final_preview_board: finalPreviewBoard,
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
