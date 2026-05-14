/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type JsonBody = Record<string, unknown>

export function jsonResponse(body: JsonBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
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

export async function requireHost(request: Request, sessionId: string) {
  const authorization = request.headers.get('Authorization')

  if (!authorization) {
    return {
      error: jsonResponse({ ok: false, error: 'Missing Authorization header' }, 401),
      supabase: null,
      userId: null,
    }
  }

  const supabase = createServiceClient()
  const token = authorization.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userError } = await supabase.auth.getUser(token)

  if (userError || !userData.user) {
    return {
      error: jsonResponse({ ok: false, error: 'Invalid access token' }, 401),
      supabase: null,
      userId: null,
    }
  }

  const userId = userData.user.id
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, host_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessionError) {
    return {
      error: jsonResponse({ ok: false, error: sessionError.message }, 500),
      supabase: null,
      userId: null,
    }
  }

  if (!session) {
    return {
      error: jsonResponse({ ok: false, error: 'Session not found' }, 404),
      supabase: null,
      userId: null,
    }
  }

  if (session.host_id !== userId) {
    return {
      error: jsonResponse({ ok: false, error: 'Only the host can manage live session state' }, 403),
      supabase: null,
      userId: null,
    }
  }

  return {
    error: null,
    supabase,
    userId,
  }
}
