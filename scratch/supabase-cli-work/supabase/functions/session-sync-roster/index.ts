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
    : []
  const reviveCheckedOut = body.revive_checked_out === true

  if (playerIds.length === 0) {
    return jsonResponse({ ok: false, error: 'No player_ids provided for roster sync' }, 400)
  }

  const { data: payload, error } = await auth.supabase.rpc('sync_live_session_roster_versioned', {
    p_session_id: sessionId,
    p_player_ids: playerIds,
    p_revive_checked_out: reviveCheckedOut,
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'roster_synced',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      requested_player_ids: playerIds,
      revive_checked_out: reviveCheckedOut,
      inserted_player_ids: payload?.inserted_player_ids ?? [],
      revived_player_ids: payload?.revived_player_ids ?? [],
      checked_out_player_ids: payload?.checked_out_player_ids ?? [],
      inserted: payload?.inserted ?? 0,
      revived: payload?.revived ?? 0,
      removed: payload?.removed ?? 0,
      total: playerIds.length,
    },
  })

  return jsonResponse({
    ok: true,
    ...payload,
    audit_error: auditError,
  })
})
