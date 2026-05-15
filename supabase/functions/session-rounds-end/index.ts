/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, requireHost } from '../_shared/live-session.ts'
import { commitCompletedRound } from '../../../lib/next-round-suggester/commit.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import type { SessionPairHistoryRow } from '../../../lib/next-round-suggester/types.ts'
import { computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics.ts'

function getRoundNo(request: Request): number | null {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const roundsIndex = parts.indexOf('rounds')
  const roundValue = roundsIndex >= 0 ? parts[roundsIndex + 1] : null
  const parsed = roundValue ? Number(roundValue) : Number(url.searchParams.get('round_no'))

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
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

  const auth = await requireHost(request, sessionId)
  if (auth.error) return auth.error

  try {
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

    for (const player of committed.players.values()) {
      const { error } = await auth.supabase
        .from('session_player_state')
        .update({
          matches_played: player.matches_played,
          last_played_round: player.last_played_round,
          consecutive_rest: player.consecutive_rest,
          consecutive_play: player.consecutive_play,
          opted_rest: player.opted_rest,
        })
        .eq('session_id', sessionId)
        .eq('player_id', player.player_id)

      if (error) {
        return jsonResponse({ ok: false, error: error.message }, 500)
      }
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

    return jsonResponse({ ok: true, round: completedRound })
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
