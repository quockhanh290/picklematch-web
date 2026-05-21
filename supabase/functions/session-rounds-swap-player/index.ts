/* eslint-disable import/no-unresolved */
import { createUserClient, getSessionId, handleCorsPreflight, jsonResponse, readJson } from '../_shared/live-session.ts'

Deno.serve(async (request) => {
  try {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)
  }

  const supabase = createUserClient(request)

  const body = await readJson(request)
  const outPlayerId = typeof body.out_player_id === 'string' ? body.out_player_id : null
  const inPlayerId = typeof body.in_player_id === 'string' ? body.in_player_id : null

  if (!outPlayerId || !inPlayerId) {
    return jsonResponse({ ok: false, error: 'Missing out_player_id or in_player_id' }, 400, request)
  }
  if (outPlayerId === inPlayerId) {
    return jsonResponse({ ok: false, error: 'out_player_id and in_player_id must be different' }, 400, request)
  }

  const { data: payload, error } = await supabase.rpc('swap_live_session_round_player_versioned', {
    p_session_id: sessionId,
    p_out_player_id: outPlayerId,
    p_in_player_id: inPlayerId,
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 409, request)
  }

  return jsonResponse({ ok: true, ...payload }, 200, request)
  } catch (err) {
    console.error('session-rounds-swap-player unhandled error', err)
    return jsonResponse({ ok: false, error: 'Could not swap player' }, 500, request)
  }
})
