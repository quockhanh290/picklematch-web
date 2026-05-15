/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, requireHost } from '../_shared/live-session.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import { buildSessionSummary } from '../../../lib/next-round-suggester/fairness/summary.ts'
import { sanitizeSummaryForHost } from '../../../lib/next-round-suggester/fairness/sanitize.ts'

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'GET' && request.method !== 'POST') {
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
    return jsonResponse({
      ok: true,
      summary: sanitizeSummaryForHost(buildSessionSummary(state)),
    })
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
