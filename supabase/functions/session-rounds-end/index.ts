/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, requireHost } from '../_shared/live-session.ts'
import { commitCompletedRound } from '../../../lib/next-round-suggester/commit.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import type { SessionPairHistoryRow } from '../../../lib/next-round-suggester/types.ts'
import { computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics.ts'
import { insertSuggesterAuditEvent } from '../_shared/suggester-audit.ts'

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

Deno.serve(async (request) => {
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
    const auth = await requireHost(request, sessionId)
    if (auth.error) return auth.error

    const { data: round, error: roundError } = await auth.supabase
      .from('session_rounds')
      .select('*')
      .eq('session_id', sessionId)
      .eq('round_no', roundNo)
      .eq('status', 'active')
      .single()

    if (roundError) {
      return jsonResponse({ ok: false, error: roundError.message }, 500)
    }

    const state = await loadSessionState(auth.supabase, sessionId)
    const scoreBefore = computeSessionFairness(state).total
    const playedIds = getPlayedIds(round.matches ?? [])
    const missingIds = [...playedIds].filter((playerId) => !state.players.has(playerId))
    if (missingIds.length > 0) {
      return jsonResponse({
        ok: false,
        error: 'Round matches contain players missing from session_player_state',
        missing_player_ids: missingIds,
      }, 409)
    }

    const { data: existingPairs, error: pairError } = await auth.supabase
      .from('session_pair_history')
      .select('*')
      .eq('session_id', sessionId)

    if (pairError) {
      return jsonResponse({ ok: false, error: pairError.message }, 500)
    }

    const committed = commitCompletedRound(
      state,
      {
        round_no: round.round_no,
        matches: round.matches,
      },
      (existingPairs ?? []) as SessionPairHistoryRow[],
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
      return jsonResponse({
        ok: false,
        error: 'Commit audit failed before database update',
        invalid_deltas: invalidDeltas,
      }, 500)
    }

    const playerStatePayload = [...committed.players.values()].map((player) => ({
      session_id: sessionId,
      player_id: player.player_id,
      matches_played: player.matches_played,
      last_played_round: player.last_played_round,
      consecutive_rest: player.consecutive_rest,
      consecutive_play: player.consecutive_play,
      opted_rest: player.opted_rest,
    }))
    const { error: playerStateError } = await auth.supabase
      .from('session_player_state')
      .upsert(playerStatePayload, { onConflict: 'session_id,player_id' })

    if (playerStateError) {
      return jsonResponse({ ok: false, error: playerStateError.message }, 500)
    }

    if (committed.pairHistory.length > 0) {
      const pairHistoryPayload = committed.pairHistory.map((row) => ({
        session_id: row.session_id,
        player_a: row.player_a,
        player_b: row.player_b,
        partner_count: row.partner_count,
        opponent_count: row.opponent_count,
      }))
      const { error } = await auth.supabase
        .from('session_pair_history')
        .upsert(pairHistoryPayload, { onConflict: 'session_id,player_a,player_b' })

      if (error) {
        return jsonResponse({ ok: false, error: error.message }, 500)
      }
    }

    const { data: completedRound, error: updateError } = await auth.supabase
      .from('session_rounds')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
      .eq('round_no', roundNo)
      .select('*')
      .single()

    if (updateError) {
      return jsonResponse({ ok: false, error: updateError.message }, 500)
    }

    const scoreAfter = computeSessionFairness({
      ...state,
      current_round: Math.max(state.current_round, roundNo + 1),
      players: committed.players,
      rounds: state.rounds.map((item) =>
        item.round_no === roundNo
          ? {
              ...item,
              status: 'completed',
              ended_at: completedRound.ended_at ? new Date(completedRound.ended_at) : new Date(),
            }
          : item,
      ),
    }).total

    const { error: adjustmentError } = await auth.supabase
      .from('suggester_adjustments')
      .update({ fairness_score_after: scoreAfter })
      .eq('session_id', sessionId)
      .eq('round_no', roundNo)

    if (adjustmentError) {
      return jsonResponse({ ok: false, error: adjustmentError.message }, 500)
    }

    const auditError = await insertSuggesterAuditEvent(auth.supabase, {
      session_id: sessionId,
      round_no: roundNo,
      event_type: 'round_ended',
      event_source: 'system',
      actor_id: auth.userId,
      payload: {
        round_id: completedRound.id,
        score_before: scoreBefore,
        score_after: scoreAfter,
        played_ids: [...playedIds].sort(),
        resting: round.resting ?? [],
        matches: round.matches ?? [],
        commit_audit: {
          deltas: commitAudit,
        },
      },
    })

    return jsonResponse({
      ok: true,
      round: completedRound,
      audit_error: auditError,
      commit_audit: {
        played_ids: [...playedIds].sort(),
        deltas: commitAudit,
      },
    })
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
