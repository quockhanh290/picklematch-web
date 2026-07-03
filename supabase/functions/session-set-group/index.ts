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
  const clearPlayerId = typeof body.clear_player_id === 'string' ? body.clear_player_id : null
  const clearGroupId = typeof body.clear_group_id === 'string' ? body.clear_group_id : null

  if (clearGroupId) {
    const { data: payload, error } = await supabase.rpc('set_live_session_group_versioned', {
      p_session_id: sessionId,
      p_clear_group_id: clearGroupId,
    })

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }

    await writeSessionAuditEvent(supabase, {
      sessionId,
      eventType: 'roster_group_clear',
      edgeFunction: 'session-set-group',
      request,
      requestId,
      includeSnapshotAfter: true,
      requestPayload: {
        clear_group_id: clearGroupId,
      },
      responsePayload: payload && typeof payload === 'object' ? payload : {},
    })

    return jsonResponse({ ok: true, ...payload })
  }

  if (clearPlayerId) {
    const { data: payload, error } = await supabase.rpc('set_live_session_group_versioned', {
      p_session_id: sessionId,
      p_clear_player_id: clearPlayerId,
    })

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }

    await writeSessionAuditEvent(supabase, {
      sessionId,
      eventType: 'roster_group_clear_player',
      edgeFunction: 'session-set-group',
      request,
      requestId,
      includeSnapshotAfter: true,
      requestPayload: {
        clear_player_id: clearPlayerId,
      },
      responsePayload: payload && typeof payload === 'object' ? payload : {},
    })

    return jsonResponse({ ok: true, ...payload })
  }

  const playerIds = Array.isArray(body.player_ids)
    ? [...new Set(body.player_ids.filter((value): value is string => typeof value === 'string'))].sort()
    : []

  if (playerIds.length < 2) {
    return jsonResponse({ ok: false, error: 'A group needs at least two players' }, 400)
  }

  const { data: payload, error } = await supabase.rpc('set_live_session_group_versioned', {
    p_session_id: sessionId,
    p_player_ids: playerIds,
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  await writeSessionAuditEvent(supabase, {
    sessionId,
    eventType: 'roster_group_set',
    edgeFunction: 'session-set-group',
    request,
    requestId,
    includeSnapshotAfter: true,
    requestPayload: {
      player_ids: playerIds,
    },
    responsePayload: payload && typeof payload === 'object' ? payload : {},
  })

  return jsonResponse({ ok: true, ...payload })
})
