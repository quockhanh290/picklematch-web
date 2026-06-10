/* eslint-disable import/no-unresolved */
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
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400)
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
  }

  try {
    const body = await readJson(request)

    if (!Array.isArray(body.player_rows)) {
      return jsonResponse({ ok: false, error: 'Missing player_rows' }, 400)
    }

    // 1. Reconstruct state from client rows — no DB queries needed
    const courtCount = optionalNumber(body.court_count) ?? 1
    const pvnaTolerance = optionalNumber(body.pvna_tolerance) ?? 0.5
    const state = mapRowsToSessionState({
      sessionId,
      playerRows: body.player_rows ?? [],
      pairRows: body.pair_rows ?? [],
      roundRows: body.round_rows ?? [],
      courts: courtCount,
      pvnaTolerance,
    })

    // 2. Compute fairness (pure functions, no DB)
    const adjustment = correctForFairness(state)
    const warnings = detectFairnessIssues(state)

    // 3. Reconstruct request params
    const count = typeof body.count === 'number' ? body.count : 1
    const liveMatchRows = Array.isArray(body.live_match_rows) ? body.live_match_rows : []
    const liveStateVersion = optionalNumber(body.live_state_version) ?? null
    const courtIdxs = Array.isArray(body.court_idxs)
      ? body.court_idxs
          .map((value: unknown) => optionalNumber(value))
          .filter((value: number | undefined): value is number => value !== undefined)
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
      options: courtIdxs && courtIdxs.length > 0 ? { courtIdxs } : undefined,
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
    if (
      mode === 'replace_courts'
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
    const finalPreviewBoard = board.final_preview_board.map(payload => ({
      ...payload,
      preview_live_state_version: liveStateVersion,
      preview_countable_match_count: currentCountableMatchCount,
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
