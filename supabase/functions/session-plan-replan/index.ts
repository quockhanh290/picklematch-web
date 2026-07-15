/* eslint-disable import/no-unresolved */
import {
  createServiceClient,
  getSessionId,
  handleCorsPreflight,
  jsonResponse,
  readJson,
  requireHost,
} from '../_shared/live-session.ts'

const FUNCTION_NAME = 'session-plan-replan'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function scheduleContinuation(request: Request, sessionId: string, delayMs: number) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !anonKey || !authorization) return
  await sleep(delayMs)
  await fetch(`${supabaseUrl}/functions/v1/${FUNCTION_NAME}?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_id: sessionId, continue_only: true }),
  })
}

Deno.serve(async request => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)

  const body = await readJson(request)
  const sessionId = getSessionId(request)
    ?? (typeof body.session_id === 'string' ? body.session_id : null)
  if (!sessionId) return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)
  const auth = await requireHost(request, sessionId, FUNCTION_NAME)
  if (auth.error) return auth.error

  const serviceClient = createServiceClient()
  const frontierFingerprint = typeof body.frontier_fingerprint === 'string'
    ? body.frontier_fingerprint
    : null
  if (body.continue_only !== true) {
    if (!frontierFingerprint) {
      return jsonResponse({ ok: false, error: 'Missing frontier fingerprint' }, 400, request)
    }
    const { error: requestError } = await serviceClient.rpc('request_session_plan_replan', {
      p_session_id: sessionId,
      p_requested_by: auth.userId,
      p_frontier_fingerprint: frontierFingerprint,
    })
    if (requestError) return jsonResponse({ ok: false, error: requestError.message }, 500, request)
  }

  const { data: claim, error: claimError } = await serviceClient.rpc('claim_session_plan_replan', {
    p_session_id: sessionId,
  })
  if (claimError) return jsonResponse({ ok: false, error: claimError.message }, 500, request)
  if (!claim) return jsonResponse({ ok: true, coalesced: true }, 202, request)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !anonKey || !authorization) {
    return jsonResponse({ ok: false, error: 'Missing Edge configuration' }, 500, request)
  }

  let result: 'completed' | 'resume' | 'deferred' | 'failed' = 'failed'
  let errorDetail: Record<string, unknown> | null = null
  try {
    const plannerResponse = await fetch(`${supabaseUrl}/functions/v1/session-plan-shadow?session_id=${sessionId}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionId,
        persist: true,
        chunked: true,
        local_search_passes: 3,
      }),
    })
    const responseText = await plannerResponse.text()
    const payload = responseText ? JSON.parse(responseText) : {}
    if (plannerResponse.ok && payload.completed === true) result = 'completed'
    else if (plannerResponse.ok && (payload.resume_required === true || payload.in_progress === true)) result = 'resume'
    else if (plannerResponse.status === 409 && payload.reason === 'manual_suggestion_pending') result = 'deferred'
    else {
      result = 'failed'
      errorDetail = {
        status: plannerResponse.status,
        error: payload.error ?? responseText,
      }
    }
  } catch (error) {
    errorDetail = { error: error instanceof Error ? error.message : String(error) }
  }

  const { data: finish, error: finishError } = await serviceClient.rpc('finish_session_plan_replan', {
    p_session_id: sessionId,
    p_generation: Number(claim.generation),
    p_result: result,
    p_error: errorDetail,
  })
  if (finishError) return jsonResponse({ ok: false, error: finishError.message }, 500, request)

  if (finish?.updated === true && (result === 'resume' || result === 'failed')) {
    const delayMs = result === 'resume'
      ? 1_500
      : Math.max(5_000, Date.parse(String(finish.next_attempt_at)) - Date.now())
    const continuation = scheduleContinuation(request, sessionId, delayMs)
    const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(continuation)
    else void continuation
  }

  return jsonResponse({
    ok: result !== 'failed',
    result,
    generation: Number(claim.generation),
    coordinator: finish,
  }, result === 'failed' ? 202 : 200, request)
})
