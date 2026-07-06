/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse } from '../_shared/live-session.ts'

const LEGACY_DISABLED_ERROR = 'Legacy round flow is disabled. Use live match cancel/recreate controls instead.'

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)
  }

  return jsonResponse({
    ok: false,
    error: LEGACY_DISABLED_ERROR,
    code: 'LEGACY_ROUND_FLOW_DISABLED',
  }, 410, request)
})
