/* eslint-disable import/no-unresolved */
import { createUserClient, getSessionId, handleCorsPreflight, jsonResponse, readJson, writeSessionAuditEvent } from '../_shared/live-session.ts'

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
  const requestId = crypto.randomUUID()

  const body = await readJson(request)
  const playerIds = Array.isArray(body.player_ids)
    ? [...new Set(body.player_ids.filter((value): value is string => typeof value === 'string'))]
    : typeof body.player_id === 'string'
      ? [body.player_id]
      : []
  const groupWith = Array.isArray(body.group_with)
    ? body.group_with.filter((value): value is string => typeof value === 'string')
    : []

  if (playerIds.length === 0) {
    return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
  }

  if (playerIds.length > 1 && groupWith.length > 0) {
    return jsonResponse({ ok: false, error: 'group_with is only supported for single-player check-in' }, 400)
  }

  const { data: payload, error } = await supabase.rpc('checkin_live_session_players_versioned', {
    p_session_id: sessionId,
    p_player_ids: playerIds,
    p_group_with: groupWith,
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  await writeSessionAuditEvent(supabase, {
    sessionId,
    eventType: 'roster_checkin',
    edgeFunction: 'session-checkin',
    requestId,
    requestPayload: {
      player_ids: playerIds,
      group_with: groupWith,
    },
    responsePayload: payload && typeof payload === 'object' ? payload : {},
  })

  return jsonResponse({ ok: true, ...payload })
})
