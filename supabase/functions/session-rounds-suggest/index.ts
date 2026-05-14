/* eslint-disable import/no-unresolved */
import { getSessionId, jsonResponse, requireHost } from '../_shared/live-session.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest.ts'

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

  try {
    const state = await loadSessionState(auth.supabase, sessionId)
    const suggestion = suggestNextRound(state)
    return jsonResponse({ ok: true, suggestion })
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
