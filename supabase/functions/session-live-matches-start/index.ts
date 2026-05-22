/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSessionId, handleCorsPreflight, jsonResponse, readJson } from '../_shared/live-session.ts'

function createUserClient(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase public configuration')
  if (!authorization) throw new Error('Missing Authorization header')
  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing ${label}`)
  return value
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${label}`)
  return value
}

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)

  const sessionId = getSessionId(request)
  if (!sessionId) return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)

  const t0 = Date.now()
  try {
    const body = await readJson(request)
    const auditPayload = body.audit_payload && typeof body.audit_payload === 'object' ? body.audit_payload : {}
    const supabase = createUserClient(request)
    const { data, error } = await supabase.rpc('start_live_session_match_versioned', {
      p_session_id: sessionId,
      p_expected_live_state_version: requiredNumber(body.expected_live_state_version, 'expected_live_state_version'),
      p_match_id: requiredString(body.match_id, 'match_id'),
      p_audit_payload: {
        ...auditPayload,
        source: 'session-live-matches-start',
      },
    })
    if (error) return jsonResponse({ ok: false, error: error.message }, 409, request)
    console.log('[session-live-matches-start] timing', { total: Date.now() - t0 })
    return jsonResponse({ ok: true, ...data }, 200, request)
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Could not start live match' },
      500,
      request,
    )
  }
})
