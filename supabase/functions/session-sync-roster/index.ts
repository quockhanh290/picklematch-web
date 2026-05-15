/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost } from '../_shared/live-session.ts'

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

  const { data: existingRows, error: loadError } = await auth.supabase
    .from('session_player_state')
    .select('player_id')
    .eq('session_id', sessionId)

  if (loadError) {
    return jsonResponse({ ok: false, error: loadError.message }, 500)
  }

  const existingIds = new Set((existingRows ?? []).map((row) => row.player_id as string))
  const checkedInIds = new Set(playerIds)
  const staleIds = [...existingIds].filter((playerId) => !checkedInIds.has(playerId))
  const newIds = playerIds.filter((playerId) => !existingIds.has(playerId))

  if (staleIds.length > 0) {
    const { error } = await auth.supabase
      .from('session_player_state')
      .delete()
      .eq('session_id', sessionId)
      .in('player_id', staleIds)

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }
  }

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

  return jsonResponse({
    ok: true,
    inserted: newIds.length,
    removed: staleIds.length,
    total: playerIds.length,
  })
})
