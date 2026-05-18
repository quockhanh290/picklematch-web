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
  const playerIds = Array.isArray(body.player_ids)
    ? [...new Set(body.player_ids.filter((value): value is string => typeof value === 'string'))]
    : typeof body.player_id === 'string'
      ? [body.player_id]
      : []

  if (playerIds.length === 0) {
    return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
  }

  const checkedOutAt = new Date().toISOString()
  const { data, error } = await auth.supabase
    .from('session_player_state')
    .update({
      checked_out_at: checkedOutAt,
      opted_rest: false,
    })
    .eq('session_id', sessionId)
    .in('player_id', playerIds)
    .select('*')

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'player_checked_out',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      player_id: playerIds.length === 1 ? playerIds[0] : undefined,
      player_ids: playerIds,
      checked_out_at: checkedOutAt,
    },
  })

  return jsonResponse({ ok: true, player: data?.[0] ?? null, players: data ?? [], audit_error: auditError })
})
