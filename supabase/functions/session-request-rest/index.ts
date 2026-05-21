/* eslint-disable import/no-unresolved */
import { createUserClient, getSessionId, handleCorsPreflight, jsonResponse, readJson } from '../_shared/live-session.ts'

Deno.serve(async (request) => {
  const t0 = Date.now()
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400)
  }

  const createClientStartedAt = Date.now()
  const supabase = createUserClient(request)
  const createClientMs = Date.now() - createClientStartedAt

  const readBodyStartedAt = Date.now()
  const body = await readJson(request)
  const readBodyMs = Date.now() - readBodyStartedAt
  const playerId = typeof body.player_id === 'string' ? body.player_id : null
  const optedRest = typeof body.opted_rest === 'boolean' ? body.opted_rest : true

  if (!playerId) {
    return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
  }

  const rpcStartedAt = Date.now()
  const { data: payload, error } = await supabase.rpc('set_live_session_player_rest_versioned', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_opted_rest: optedRest,
  })
  const rpcMs = Date.now() - rpcStartedAt

  if (error) {
    console.error('[session-request-rest] rpc failed', {
      playerId,
      optedRest,
      createClient: createClientMs,
      readBody: readBodyMs,
      rpc: rpcMs,
      total: Date.now() - t0,
      error: error.message,
    })
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  console.log('[session-request-rest] timing', {
    playerId,
    optedRest,
    createClient: createClientMs,
    readBody: readBodyMs,
    rpc: rpcMs,
    total: Date.now() - t0,
  })

  return jsonResponse({ ok: true, ...payload })
})
