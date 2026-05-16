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
  const clearPlayerId = typeof body.clear_player_id === 'string' ? body.clear_player_id : null
  const clearGroupId = typeof body.clear_group_id === 'string' ? body.clear_group_id : null

  if (clearGroupId) {
    const { data, error } = await auth.supabase
      .from('session_player_state')
      .update({ group_id: null })
      .eq('session_id', sessionId)
      .eq('group_id', clearGroupId)
      .select('*')

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }

    const auditError = await insertSuggesterAuditEvent(auth.supabase, {
      session_id: sessionId,
      event_type: 'group_changed',
      event_source: 'host',
      actor_id: auth.userId,
      payload: {
        action: 'clear_group',
        group_id: clearGroupId,
        affected_player_ids: (data ?? []).map((row) => row.player_id),
      },
    })

    return jsonResponse({ ok: true, players: data ?? [], audit_error: auditError })
  }

  if (clearPlayerId) {
    const { data, error } = await auth.supabase
      .from('session_player_state')
      .update({ group_id: null })
      .eq('session_id', sessionId)
      .eq('player_id', clearPlayerId)
      .select('*')

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }

    const auditError = await insertSuggesterAuditEvent(auth.supabase, {
      session_id: sessionId,
      event_type: 'group_changed',
      event_source: 'host',
      actor_id: auth.userId,
      payload: {
        action: 'clear_player',
        player_id: clearPlayerId,
        affected_player_ids: (data ?? []).map((row) => row.player_id),
      },
    })

    return jsonResponse({ ok: true, players: data ?? [], audit_error: auditError })
  }

  const playerIds = Array.isArray(body.player_ids)
    ? [...new Set(body.player_ids.filter((value): value is string => typeof value === 'string'))].sort()
    : []

  if (playerIds.length < 2) {
    return jsonResponse({ ok: false, error: 'A group needs at least two players' }, 400)
  }

  const groupId = `${sessionId}:${playerIds.join(':')}`
  const { data, error } = await auth.supabase
    .from('session_player_state')
    .update({ group_id: groupId })
    .eq('session_id', sessionId)
    .in('player_id', playerIds)
    .select('*')

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const auditError = await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    event_type: 'group_changed',
    event_source: 'host',
    actor_id: auth.userId,
    payload: {
      action: 'set_group',
      group_id: groupId,
      player_ids: playerIds,
      affected_player_ids: (data ?? []).map((row) => row.player_id),
    },
  })

  return jsonResponse({ ok: true, group_id: groupId, players: data ?? [], audit_error: auditError })
})
