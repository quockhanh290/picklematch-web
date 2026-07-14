/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type JsonBody = Record<string, unknown>

const LOCAL_DEV_ORIGINS = [
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:19006',
  'http://localhost:3000',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:8082',
  'http://127.0.0.1:19006',
  'http://127.0.0.1:3000',
]

function getAllowedOrigins(): string[] {
  const vercelUrl = Deno.env.get('VERCEL_URL')
  const configured = [
    Deno.env.get('APP_ALLOWED_ORIGINS'),
    Deno.env.get('ALLOWED_ORIGINS'),
    Deno.env.get('SITE_URL'),
    Deno.env.get('PUBLIC_SITE_URL'),
    Deno.env.get('EXPO_PUBLIC_APP_URL'),
    vercelUrl ? `https://${vercelUrl}` : null,
  ]
    .filter(Boolean)
    .join(',')

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function isLocalDevOrigin(origin: string): boolean {
  return LOCAL_DEV_ORIGINS.includes(origin)
}

function allowedOriginFor(request?: Request): string | null {
  const requestOrigin = request?.headers.get('Origin')
  return requestOrigin || '*'
}

function corsHeadersFor(request?: Request): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-client-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }

  const allowOrigin = allowedOriginFor(request)
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin
  }

  return headers
}

export function handleCorsPreflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null

  const requestOrigin = request.headers.get('Origin') ?? ''

  if (requestOrigin && !allowedOriginFor(request)) {
    return new Response(null, { status: 403 })
  }

  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(request),
  })
}

export function jsonResponse(body: JsonBody, status = 200, request?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersFor(request),
      'Content-Type': 'application/json',
    },
  })
}

export async function readJson(request: Request): Promise<JsonBody> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export function getSessionId(request: Request): string | null {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const sessionsIndex = parts.indexOf('sessions')

  if (sessionsIndex >= 0 && parts[sessionsIndex + 1]) {
    return parts[sessionsIndex + 1]
  }

  return url.searchParams.get('session_id')
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service configuration')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export function createUserClient(request: Request) {
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

export async function writeSessionAuditEvent(
  supabase: { from: (table: string) => any },
  input: {
    sessionId: string
    eventType: string
    edgeFunction: string
    request?: Request
    requestId?: string | null
    clientRequestId?: unknown
    actorId?: string | null
    requestPayload?: unknown
    responsePayload?: unknown
    detail?: unknown
    includeSnapshotAfter?: boolean
  },
) {
  const detail: Record<string, unknown> = input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail)
    ? { ...(input.detail as Record<string, unknown>) }
    : input.detail === undefined
      ? {}
      : { value: input.detail }
  let actorId = input.actorId ?? null

  if (!actorId && input.request) {
    actorId = await getRequestUserId(input.request)
  }

  if (input.includeSnapshotAfter && input.request) {
    detail.snapshot_after = await loadLiveSessionAuditSnapshot(input.request, input.sessionId)
  }

  const { error } = await supabase.from('session_audit_events').insert({
    session_id: input.sessionId,
    event_type: input.eventType,
    edge_function: input.edgeFunction,
    request_id: input.requestId ?? null,
    client_request_id: typeof input.clientRequestId === 'string' ? input.clientRequestId : null,
    actor_id: actorId,
    request_payload: input.requestPayload ?? {},
    response_payload: input.responsePayload ?? {},
    detail,
  })

  if (error) {
    console.warn('[session-audit] insert failed', {
      session_id: input.sessionId,
      event_type: input.eventType,
      edge_function: input.edgeFunction,
      request_id: input.requestId ?? null,
      error: error.message,
    })
  }
}

async function getRequestUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get('Authorization')
  if (!authorization) return null

  try {
    const token = authorization.replace(/^Bearer\s+/i, '')
    const supabase = createServiceClient()
    const { data, error } = await supabase.auth.getUser(token)
    if (error) return null
    return data.user?.id ?? null
  } catch {
    return null
  }
}

async function loadLiveSessionAuditSnapshot(request: Request, sessionId: string) {
  try {
    const supabase = createUserClient(request)
    const { data, error } = await supabase.rpc('get_live_session_snapshot_versioned', {
      p_session_id: sessionId,
    })
    if (error) {
      return {
        ok: false,
        error: error.message,
      }
    }
    return {
      ok: true,
      data,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown snapshot error',
    }
  }
}

export async function requireHost(request: Request, sessionId: string, traceLabel?: string) {
  const startedAt = Date.now()
  const authorization = request.headers.get('Authorization')

  if (!authorization) {
    if (traceLabel) {
      console.warn(`[${traceLabel}] requireHost detail`, {
        status: 'missing_authorization',
        total: Date.now() - startedAt,
      })
    }
    return {
      error: jsonResponse({ ok: false, error: 'Missing Authorization header' }, 401, request),
      supabase: null,
      userId: null,
    }
  }

  const clientStartedAt = Date.now()
  const supabase = createServiceClient()
  const createClientMs = Date.now() - clientStartedAt
  const token = authorization.replace(/^Bearer\s+/i, '')
  const getUserStartedAt = Date.now()
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const getUserMs = Date.now() - getUserStartedAt

  if (userError || !userData.user) {
    if (traceLabel) {
      console.warn(`[${traceLabel}] requireHost detail`, {
        status: 'invalid_access_token',
        createClient: createClientMs,
        getUser: getUserMs,
        total: Date.now() - startedAt,
      })
    }
    return {
      error: jsonResponse({ ok: false, error: 'Invalid access token' }, 401, request),
      supabase: null,
      userId: null,
    }
  }

  const userId = userData.user.id
  const sessionQueryStartedAt = Date.now()
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, host_id')
    .eq('id', sessionId)
    .maybeSingle()
  const sessionQueryMs = Date.now() - sessionQueryStartedAt

  if (sessionError) {
    if (traceLabel) {
      console.warn(`[${traceLabel}] requireHost detail`, {
        status: 'session_query_error',
        createClient: createClientMs,
        getUser: getUserMs,
        sessionQuery: sessionQueryMs,
        total: Date.now() - startedAt,
      })
    }
    return {
      error: jsonResponse({ ok: false, error: 'Unable to verify host access' }, 500, request),
      supabase: null,
      userId: null,
    }
  }

  if (!session) {
    if (traceLabel) {
      console.warn(`[${traceLabel}] requireHost detail`, {
        status: 'session_not_found',
        createClient: createClientMs,
        getUser: getUserMs,
        sessionQuery: sessionQueryMs,
        total: Date.now() - startedAt,
      })
    }
    return {
      error: jsonResponse({ ok: false, error: 'Session not found' }, 404, request),
      supabase: null,
      userId: null,
    }
  }

  if (session.host_id !== userId) {
    if (traceLabel) {
      console.warn(`[${traceLabel}] requireHost detail`, {
        status: 'forbidden',
        createClient: createClientMs,
        getUser: getUserMs,
        sessionQuery: sessionQueryMs,
        total: Date.now() - startedAt,
      })
    }
    return {
      error: jsonResponse({ ok: false, error: 'Only the host can manage live session state' }, 403, request),
      supabase: null,
      userId: null,
    }
  }

  if (traceLabel) {
    console.log(`[${traceLabel}] requireHost detail`, {
      status: 'ok',
      createClient: createClientMs,
      getUser: getUserMs,
      sessionQuery: sessionQueryMs,
      total: Date.now() - startedAt,
    })
  }

  return {
    error: null,
    supabase,
    userId,
  }
}
