/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSessionId, handleCorsPreflight, jsonResponse, readJson } from '../_shared/live-session.ts'
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
    return jsonResponse({ ok: true }, 200)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

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
    const maxEdgePreviewCount = body.allow_large_batch === true
      ? Math.max(1, courtCount)
      : Math.min(1, Math.max(1, courtCount))
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

    const playersById = new Map<string, { name: string }>()
    if (Array.isArray(body.players)) {
      for (const p of body.players) {
        if (p && typeof p.id === 'string' && typeof p.name === 'string') {
          playersById.set(p.id, { name: p.name })
        }
      }
    }

    // 4. Run suggestion algorithm
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

    return jsonResponse({
      ok: true,
      payloads,
      final_preview_board: finalPreviewBoard,
      replaced_court_idxs: board.replaced_court_idxs,
      locked_court_idxs: board.locked_court_idxs,
      quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
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
    console.error('[session-live-matches-suggest] error:', error)
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
