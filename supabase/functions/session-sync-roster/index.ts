/* eslint-disable import/no-unresolved */
import { createUserClient, getSessionId, handleCorsPreflight, jsonResponse, readJson } from '../_shared/live-session.ts'

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

  const supabase = createUserClient(request)

  const body = await readJson(request)
  const playerIds = Array.isArray(body.player_ids)
    ? [...new Set(body.player_ids.filter((value): value is string => typeof value === 'string'))]
    : []
  const reviveCheckedOut = body.revive_checked_out === true

  if (playerIds.length === 0) {
    return jsonResponse({ ok: false, error: 'No player_ids provided for roster sync' }, 400)
  }

  const { data: payload, error } = await supabase.rpc('sync_live_session_roster_versioned', {
    p_session_id: sessionId,
    p_player_ids: playerIds,
    p_revive_checked_out: reviveCheckedOut,
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  return jsonResponse({
    ok: true,
    ...payload,
  })
})
