/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSessionId, handleCorsPreflight, jsonResponse, readJson, writeSessionAuditEvent } from '../_shared/live-session.ts'

function createUserClient(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase public configuration')
  }
  if (!authorization) {
    throw new Error('Missing Authorization header')
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  })
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing ${label}`)
  }
  return value
}

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

  const t0 = Date.now()
  const requestId = crypto.randomUUID()
  let clientRequestId: unknown = null
  try {
    const body = await readJson(request)
    const auditPayload = body.audit_payload && typeof body.audit_payload === 'object' ? body.audit_payload : {}
    clientRequestId = (auditPayload as Record<string, unknown>).client_request_id ?? null
    const t1 = Date.now()
    const supabase = createUserClient(request)
    const t2 = Date.now()

    const { data, error } = await supabase.rpc('start_live_session_round_versioned', {
      p_session_id: sessionId,
      p_expected_live_state_version: requiredNumber(body.expected_live_state_version, 'expected_live_state_version'),
      p_round_no: requiredNumber(body.round_no, 'round_no'),
      p_matches: Array.isArray(body.matches) ? body.matches : [],
      p_resting: Array.isArray(body.resting) ? body.resting : [],
      p_audit_payload: {
        ...auditPayload,
        source: 'session-rounds-start-versioned',
      },
    })
    const t3 = Date.now()

    if (error) {
      console.error('[session-rounds-start-versioned] rpc failed', {
        requestId,
        clientRequestId,
        error: error.message,
        total: Date.now() - t0,
      })
      return jsonResponse({ ok: false, error: error.message }, 409, request)
    }

    console.log('[session-rounds-start-versioned] timing', {
      requestId,
      clientRequestId,
      readBody: t1 - t0,
      createClient: t2 - t1,
      rpc: t3 - t2,
      total: t3 - t0,
    })

    await writeSessionAuditEvent(supabase, {
      sessionId,
      eventType: 'round_start_versioned',
      edgeFunction: 'session-rounds-start-versioned',
      requestId,
      clientRequestId,
      requestPayload: {
        expected_live_state_version: body.expected_live_state_version,
        round_no: body.round_no,
        matches: Array.isArray(body.matches) ? body.matches : [],
        resting: Array.isArray(body.resting) ? body.resting : [],
        audit_payload: auditPayload,
      },
      responsePayload: data && typeof data === 'object' ? data : {},
      detail: {
        timing_ms: {
          read_body: t1 - t0,
          create_client: t2 - t1,
          rpc: t3 - t2,
          total: t3 - t0,
        },
      },
    })

    return jsonResponse({ ok: true, ...data }, 200, request)
  } catch (error) {
    console.error('[session-rounds-start-versioned] failed', {
      requestId,
      clientRequestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      total: Date.now() - t0,
    })
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Could not start round' },
      500,
      request,
    )
  }
})
