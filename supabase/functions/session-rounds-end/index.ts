/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, requireHost, writeSessionAuditEvent } from '../_shared/live-session.ts'
import { commitCompletedRound, pairHistoryRowsFromState } from '../../../lib/next-round-suggester/commit.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import { computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics.ts'

function getRoundNo(request: Request): number | null {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const roundsIndex = parts.indexOf('rounds')
  const roundValue = roundsIndex >= 0 ? parts[roundsIndex + 1] : null
  const parsed = roundValue ? Number(roundValue) : Number(url.searchParams.get('round_no'))

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function getPlayedIds(matches: Array<{ team_a: string[]; team_b: string[] }>): Set<string> {
  return new Set(matches.flatMap((match) => [...match.team_a, ...match.team_b]))
}

function changedPairHistoryRows(
  beforeRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
  afterRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
) {
  const beforeByKey = new Map(
    beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]),
  )

  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before ||
      before.partner_count !== row.partner_count ||
      before.opponent_count !== row.opponent_count
  })
}

Deno.serve(async (request) => {
  const t0 = Date.now()
  const requestId = crypto.randomUUID()
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const sessionId = getSessionId(request)
  const roundNo = getRoundNo(request)

  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400)
  }

  if (roundNo === null) {
    return jsonResponse({ ok: false, error: 'Missing round number' }, 400)
  }

  try {
    const auth = await requireHost(request, sessionId, 'session-rounds-end')
    if (auth.error) return auth.error
    const t1 = Date.now()

    const state = await loadSessionState(auth.supabase, sessionId, {
      traceLabel: 'session-rounds-end',
    })
    const t2 = Date.now()

    const round = state.rounds.find((item) => item.round_no === roundNo && item.status === 'active')
    if (!round) {
      const completedRound = state.rounds.find((item) => item.round_no === roundNo && item.status === 'completed')
      if (completedRound) {
        console.warn('[session-rounds-end] already completed', {
          sessionId,
          round: roundNo,
          loadSessionState: t2 - t1,
          total: Date.now() - t0,
        })
        return jsonResponse({
          ok: true,
          round: completedRound,
          audit_error: null,
          idempotent: true,
          commit_audit: {
            played_ids: [...getPlayedIds(completedRound.matches ?? [])].sort(),
            deltas: [],
          },
        })
      }

      console.warn('[session-rounds-end] no active round', {
        sessionId,
        round: roundNo,
        loadSessionState: t2 - t1,
        total: Date.now() - t0,
        rounds: state.rounds.map((item) => ({ round_no: item.round_no, status: item.status })),
      })
      return jsonResponse({ ok: false, error: 'Active round not found' }, 404)
    }

    const scoreBefore = computeSessionFairness(state).total
    const playedIds = getPlayedIds(round.matches ?? [])
    const missingIds = [...playedIds].filter((playerId) => !state.players.has(playerId))
    if (missingIds.length > 0) {
      console.error('[session-rounds-end] missing players', {
        sessionId,
        round: roundNo,
        missing_player_ids: missingIds,
        loadSessionState: t2 - t1,
        total: Date.now() - t0,
      })
      return jsonResponse({
        ok: false,
        error: 'Round matches contain players missing from session_player_state',
        missing_player_ids: missingIds,
      }, 409)
    }
    const t3 = Date.now()

    const commitStartedAt = Date.now()
    const existingPairs = pairHistoryRowsFromState(state)
    const committed = commitCompletedRound(
      state,
      {
        round_no: round.round_no,
        matches: round.matches,
      },
      existingPairs,
    )
    const commitAudit = [...committed.players.values()]
      .map((player) => {
        const before = state.players.get(player.player_id)?.matches_played ?? 0
        return {
          player_id: player.player_id,
          played: playedIds.has(player.player_id),
          before,
          after: player.matches_played,
          delta: player.matches_played - before,
        }
      })
      .sort((a, b) => a.player_id.localeCompare(b.player_id))
    const invalidDeltas = commitAudit.filter((row) =>
      row.played ? row.delta !== 1 : row.delta !== 0
    )

    if (invalidDeltas.length > 0) {
      console.error('[session-rounds-end] commit audit mismatch', {
        sessionId,
        round: roundNo,
        invalid_deltas: invalidDeltas,
        loadSessionState: t2 - t1,
        commitLocal: Date.now() - commitStartedAt,
        total: Date.now() - t0,
      })
      return jsonResponse({
        ok: false,
        error: 'Commit audit failed before database update',
        invalid_deltas: invalidDeltas,
      }, 500)
    }
    const commitLocalMs = Date.now() - commitStartedAt

    const playerStatePayload = [...committed.players.values()].map((player) => ({
      player_id: player.player_id,
      matches_played: player.matches_played,
      last_played_round: player.last_played_round,
      consecutive_rest: player.consecutive_rest,
      consecutive_play: player.consecutive_play,
      opted_rest: player.opted_rest,
    }))
    const scoreAfter = computeSessionFairness({
      ...state,
      current_round: Math.max(state.current_round, roundNo + 1),
      players: committed.players,
      rounds: state.rounds.map((item) =>
        item.round_no === roundNo
          ? {
              ...item,
              status: 'completed',
              ended_at: new Date(),
            }
          : item,
      ),
    }).total

    const changedPairHistory = changedPairHistoryRows(existingPairs, committed.pairHistory)
    const pairHistoryPayload = changedPairHistory.map((row) => ({
      player_a: row.player_a,
      player_b: row.player_b,
      partner_count: row.partner_count,
      opponent_count: row.opponent_count,
    }))
    const auditPayload = {
        score_before: scoreBefore,
        score_after: scoreAfter,
        played_ids: [...playedIds].sort(),
        resting: round.resting ?? [],
        matches: round.matches ?? [],
        commit_audit: {
          deltas: commitAudit,
        },
    }
    const commitWriteStartedAt = Date.now()
    const { data: completedRound, error: commitError } = await auth.supabase
      .rpc('complete_live_session_round', {
        p_session_id: sessionId,
        p_round_no: roundNo,
        p_player_state: playerStatePayload,
        p_pair_history: pairHistoryPayload,
        p_score_after: scoreAfter,
        p_actor_id: auth.userId,
        p_audit_payload: auditPayload,
      })
    const commitWriteMs = Date.now() - commitWriteStartedAt

    if (commitError) {
      console.error('[session-rounds-end] commit failed', {
        sessionId,
        round: roundNo,
        error: commitError.message,
        loadSessionState: t2 - t1,
        validateAndScoreBefore: t3 - t2,
        commitLocal: commitLocalMs,
        dbWrites: commitWriteMs,
        total: Date.now() - t0,
        players: state.players.size,
        pairs: existingPairs.length,
        pairUpdates: changedPairHistory.length,
        pairHistoryRows: committed.pairHistory.length,
      })
      return jsonResponse({ ok: false, error: commitError.message }, 500)
    }
    const t4 = Date.now()

    console.log('[session-rounds-end] timing', {
      auth: t1 - t0,
      loadSessionState: t2 - t1,
      validateAndScoreBefore: t3 - t2,
      commitLocal: commitLocalMs,
      dbWrites: commitWriteMs,
      dbWriteDetail: {
        commitRound: commitWriteMs,
      },
      total: t4 - t0,
      players: state.players.size,
      pairs: existingPairs.length,
      pairUpdates: changedPairHistory.length,
      pairHistoryRows: committed.pairHistory.length,
      round: roundNo,
    })

    await writeSessionAuditEvent(auth.supabase, {
      sessionId,
      eventType: 'round_end',
      edgeFunction: 'session-rounds-end',
      requestId,
      actorId: auth.userId,
      requestPayload: {
        round_no: roundNo,
      },
      responsePayload: {
        round: completedRound,
        commit_audit: {
          played_ids: [...playedIds].sort(),
          deltas: commitAudit,
        },
      },
      detail: {
        audit_payload: auditPayload,
        pair_history_updates: pairHistoryPayload,
        timing_ms: {
          auth: t1 - t0,
          load_session_state: t2 - t1,
          validate_and_score_before: t3 - t2,
          commit_local: commitLocalMs,
          db_writes: commitWriteMs,
          total: t4 - t0,
        },
      },
    })

    return jsonResponse({
      ok: true,
      round: completedRound,
      audit_error: null,
      commit_audit: {
        played_ids: [...playedIds].sort(),
        deltas: commitAudit,
      },
    })
  } catch (error) {
    console.error('[session-rounds-end] failed', {
      sessionId,
      round: roundNo,
      error: error instanceof Error ? error.message : 'Unknown error',
      total: Date.now() - t0,
    })
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
