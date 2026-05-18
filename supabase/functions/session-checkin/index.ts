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
  const groupWith = Array.isArray(body.group_with)
    ? body.group_with.filter((value): value is string => typeof value === 'string')
    : []

  if (playerIds.length === 0) {
    return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
  }

  if (playerIds.length > 1 && groupWith.length > 0) {
    return jsonResponse({ ok: false, error: 'group_with is only supported for single-player check-in' }, 400)
  }

  const checkedInAt = new Date().toISOString()
  const upsertRows = playerIds.map((playerId) => {
    const groupMembers = [...new Set([playerId, ...groupWith])].sort()
    const groupId = groupMembers.length > 1 ? `${sessionId}:${groupMembers.join(':')}` : null

    return {
      session_id: sessionId,
      player_id: playerId,
      group_id: groupId,
      checked_in_at: checkedInAt,
      checked_out_at: null,
      opted_rest: false,
    }
  })

  const { data, error } = await auth.supabase
    .from('session_player_state')
    .upsert(upsertRows, { onConflict: 'session_id,player_id' })
    .select('*')

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'player_checked_in',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      player_id: playerIds.length === 1 ? playerIds[0] : undefined,
      player_ids: playerIds,
      group_with: groupWith,
      group_id: upsertRows.length === 1 ? upsertRows[0].group_id : null,
      checked_in_at: checkedInAt,
    },
  })

  return jsonResponse({ ok: true, player: data?.[0] ?? null, players: data ?? [], audit_error: auditError })
})
