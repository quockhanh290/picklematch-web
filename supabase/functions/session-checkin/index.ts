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
  const groupWith = Array.isArray(body.group_with)
    ? body.group_with.filter((value): value is string => typeof value === 'string')
    : []

  if (!playerId) {
    return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
  }

  const groupMembers = [...new Set([playerId, ...groupWith])].sort()
  const groupId = groupMembers.length > 1 ? `${sessionId}:${groupMembers.join(':')}` : null

  const { data, error } = await auth.supabase
    .from('session_player_state')
    .upsert(
      {
        session_id: sessionId,
        player_id: playerId,
        group_id: groupId,
        checked_in_at: new Date().toISOString(),
        checked_out_at: null,
        opted_rest: false,
      },
      { onConflict: 'session_id,player_id' },
    )
    .select('*')
    .single()

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'player_checked_in',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      player_id: playerId,
      group_with: groupWith,
      group_id: groupId,
      checked_in_at: data.checked_in_at,
    },
  })

  return jsonResponse({ ok: true, player: data, audit_error: auditError })
})
