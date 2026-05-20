/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost } from '../_shared/live-session.ts'
import { insertSuggesterAuditEvent } from '../_shared/suggester-audit.ts'

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

  const auth = await requireHost(request, sessionId)
  if (auth.error) return auth.error

  const body = await readJson(request)
  const playerId = typeof body.player_id === 'string' ? body.player_id : null
  const optedRest = typeof body.opted_rest === 'boolean' ? body.opted_rest : true

  if (!playerId) {
    return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
  }

  const { data: payload, error } = await auth.supabase.rpc('set_live_session_player_rest_versioned', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_opted_rest: optedRest,
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'player_rest_changed',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      player_id: playerId,
      opted_rest: optedRest,
    },
  })

  return jsonResponse({ ok: true, ...payload, audit_error: auditError })
})
