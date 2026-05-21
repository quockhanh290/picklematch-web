/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSessionId, handleCorsPreflight, jsonResponse, readJson } from '../_shared/live-session.ts'

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

function getRoundNo(request: Request, body: Record<string, unknown>): number {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const roundsIndex = parts.indexOf('rounds')
  const roundValue = roundsIndex >= 0 ? parts[roundsIndex + 1] : null
  const parsed = roundValue ? Number(roundValue) : Number(url.searchParams.get('round_no') ?? body.round_no)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Missing round number')
  }
  return parsed
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
  let clientRequestId: unknown = null
  try {
    const body = await readJson(request)
    const auditPayload = body.audit_payload && typeof body.audit_payload === 'object' ? body.audit_payload : {}
    clientRequestId = (auditPayload as Record<string, unknown>).client_request_id ?? null
    const t1 = Date.now()
    const roundNo = getRoundNo(request, body)
    const supabase = createUserClient(request)
    const t2 = Date.now()

    const { data, error } = await supabase.rpc('complete_live_session_round_versioned', {
      p_session_id: sessionId,
      p_expected_live_state_version: requiredNumber(body.expected_live_state_version, 'expected_live_state_version'),
      p_round_no: roundNo,
      p_player_state: Array.isArray(body.player_state) ? body.player_state : [],
      p_pair_history: Array.isArray(body.pair_history) ? body.pair_history : [],
      p_score_after: requiredNumber(body.score_after, 'score_after'),
      p_audit_payload: {
        ...auditPayload,
        source: 'session-rounds-end-versioned',
      },
    })
    const t3 = Date.now()

    if (error) {
      console.error('[session-rounds-end-versioned] rpc failed', {
        clientRequestId,
        error: error.message,
        total: Date.now() - t0,
      })
      return jsonResponse({ ok: false, error: error.message }, 409, request)
    }

    console.log('[session-rounds-end-versioned] timing', {
      clientRequestId,
      readBody: t1 - t0,
      createClient: t2 - t1,
      rpc: t3 - t2,
      total: t3 - t0,
      round: roundNo,
    })

    return jsonResponse({ ok: true, ...data }, 200, request)
  } catch (error) {
    console.error('[session-rounds-end-versioned] failed', {
      clientRequestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      total: Date.now() - t0,
    })
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Could not end round' },
      500,
      request,
    )
  }
})
