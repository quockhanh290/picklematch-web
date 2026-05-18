/// <reference lib="dom" />
import { supabase } from '@/lib/supabase'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const DEFAULT_FUNCTION_TIMEOUT_MS = 15_000
const LONG_FUNCTION_TIMEOUT_MS = 25_000
const RETRYABLE_ERROR_MESSAGES = new Set([
  'Request timed out. Check your connection and try again.',
  'Temporary network issue. Please try again.',
])

function timeoutForFunction(functionName: string) {
  return functionName === 'session-rounds-start' || functionName === 'session-rounds-end'
    ? LONG_FUNCTION_TIMEOUT_MS
    : DEFAULT_FUNCTION_TIMEOUT_MS
}

function isAbortError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function timeoutErrorAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timed out. Check your connection and try again.')), ms)
  })
}

function isRetryableError(error: unknown) {
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return RETRYABLE_ERROR_MESSAGES.has(message)
}

async function parseJsonPayload(response: Response): Promise<{ payload: any; parseFailed: boolean; text: string }> {
  const text = await response.text().catch(() => '')
  if (!text) return { payload: {}, parseFailed: false, text: '' }

  try {
    return { payload: JSON.parse(text), parseFailed: false, text }
  } catch {
    return { payload: {}, parseFailed: true, text }
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; payload: any; parseFailed: boolean; responseText: string }> {
  if (typeof AbortController === 'undefined') {
    const response = await Promise.race([
      fetch(url, init),
      timeoutErrorAfter(timeoutMs),
    ])
    const { payload, parseFailed, text } = await parseJsonPayload(response)
    return { response, payload, parseFailed, responseText: text }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const { payload, parseFailed, text } = await parseJsonPayload(response)
    return { response, payload, parseFailed, responseText: text }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Request timed out. Check your connection and try again.')
    }
    if (error instanceof TypeError) {
      throw new Error('Temporary network issue. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function invokeLiveSessionFunction(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown> = {},
  extraQuery: Record<string, string | number> = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase function configuration')
  }

  const { data } = await supabase.auth.getSession()
  let accessToken = data.session?.access_token
  if (!accessToken) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    accessToken = refreshed.session?.access_token
  }
  if (!accessToken) {
    throw new Error('Could not read login session. Open in Safari/Chrome or sign in again.')
  }

  const query = new URLSearchParams({ session_id: sessionId })
  Object.entries(extraQuery).forEach(([key, value]) => query.set(key, String(value)))

  const url = `${supabaseUrl}/functions/v1/${functionName}?${query.toString()}`
  const init = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }

  let response: Response | null = null
  let payload: any
  let parseFailed = false

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetchJsonWithTimeout(url, init, timeoutForFunction(functionName))
      response = result.response
      payload = result.payload
      parseFailed = result.parseFailed
      break
    } catch (error) {
      if (attempt === 0 && isRetryableError(error)) {
        await sleep(600)
        continue
      }
      throw error
    }
  }

  if (!response) {
    throw new Error(`Edge Function ${functionName} failed`)
  }
  payload ??= {}

  if (!response.ok || payload?.ok === false) {
    if (parseFailed) {
      throw new Error(`Edge Function ${functionName} returned a non-JSON response (${response.status})`)
    }
    throw new Error(payload?.error ?? `Edge Function ${functionName} failed`)
  }

  return payload
}

export async function loadLatestSyncablePlayerIds(
  sessionId: string,
  localFallbackIds: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)

  if (error) {
    throw error
  }

  const confirmedRows = (data ?? []).filter(row => row.status === 'confirmed' || row.status == null)
  const presentIds = confirmedRows
    .filter(row => row.check_in_status === 'present' || row.check_in_status === 'checked_in')
    .map(row => String(row.player_id))
  const activeIds = confirmedRows
    .filter(row => row.check_in_status !== 'no_show')
    .map(row => String(row.player_id))

  const preferredIds = presentIds.length > 0 ? presentIds : activeIds
  return [...new Set([...preferredIds, ...localFallbackIds])]
}
