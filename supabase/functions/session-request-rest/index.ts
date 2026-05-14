/* eslint-disable import/no-unresolved */
import { getSessionId, jsonResponse, readJson, requireHost } from '../_shared/live-session.ts'

Deno.serve(async (request) => {
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

  const { data, error } = await auth.supabase
    .from('session_player_state')
    .update({ opted_rest: optedRest })
    .eq('session_id', sessionId)
    .eq('player_id', playerId)
    .select('*')
    .single()

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  return jsonResponse({ ok: true, player: data })
})
