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

  if (playerIds.length === 0) {
    return jsonResponse({ ok: false, error: 'No player_ids provided for roster sync' }, 400)
  }

  const { data: existingRows, error: loadError } = await auth.supabase
    .from('session_player_state')
    .select('player_id, checked_out_at')
    .eq('session_id', sessionId)

  if (loadError) {
    return jsonResponse({ ok: false, error: loadError.message }, 500)
  }

  const existingIds = new Set((existingRows ?? []).map((row) => row.player_id as string))
  const newIds = playerIds.filter((playerId) => !existingIds.has(playerId))
  const reviveIds = (existingRows ?? [])
    .filter((row) => playerIds.includes(row.player_id as string) && row.checked_out_at !== null)
    .map((row) => row.player_id as string)

  if (newIds.length > 0) {
    const now = new Date().toISOString()
    const { error } = await auth.supabase
      .from('session_player_state')
      .upsert(
        newIds.map((playerId) => ({
          session_id: sessionId,
          player_id: playerId,
          checked_in_at: now,
          checked_out_at: null,
          opted_rest: false,
        })),
        { onConflict: 'session_id,player_id' },
      )

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }
  }

  if (reviveIds.length > 0) {
    const { error } = await auth.supabase
      .from('session_player_state')
      .update({
        checked_out_at: null,
        opted_rest: false,
      })
      .eq('session_id', sessionId)
      .in('player_id', reviveIds)

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'roster_synced',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      requested_player_ids: playerIds,
      inserted_player_ids: newIds,
      revived_player_ids: reviveIds,
      inserted: newIds.length,
      revived: reviveIds.length,
      removed: 0,
      total: playerIds.length,
    },
  })

  return jsonResponse({
    ok: true,
    inserted: newIds.length,
    revived: reviveIds.length,
    removed: 0,
    total: playerIds.length,
    audit_error: auditError,
  })
})
