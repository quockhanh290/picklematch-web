/// <reference lib="dom" />
import { supabase } from '@/lib/supabase'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const DEFAULT_FUNCTION_TIMEOUT_MS = 25_000
const LONG_FUNCTION_TIMEOUT_MS = 35_000
const RETRYABLE_ERROR_MESSAGES = new Set([
  'Request timed out. Check your connection and try again.',
  'Temporary network issue. Please try again.',
])

export type PersistedNextRoundSettings = {
  courtCountOverride: number | null
  courtPreset: 'balanced' | 'play_more' | 'relaxed'
  courtDurationMin: number
  pvnaTolerance: number
  targetRounds: number | null
}

function timeoutForFunction(functionName: string) {
  return functionName === 'session-rounds-start'
    || functionName === 'session-rounds-end'
    || functionName === 'session-rounds-start-versioned'
    || functionName === 'session-rounds-end-versioned'
    || functionName === 'session-rounds-swap-player'
    || functionName === 'session-live-matches-create'
    || functionName === 'session-live-matches-start'
    || functionName === 'session-live-matches-complete'
    || functionName === 'session-live-matches-cancel'
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

export async function prewarmLiveSessionVersionGuard(sessionId: string) {
  const { error } = await supabase.rpc('get_live_session_version_guard', {
    p_session_id: sessionId,
  })
  if (error) throw error
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
    .filter(row => row.check_in_status !== 'no_show' && row.check_in_status !== 'pending')
    .map(row => String(row.player_id))

  const preferredIds = presentIds.length > 0 ? presentIds : activeIds
  if (preferredIds.length > 0) return [...new Set(preferredIds)]
  if (localFallbackIds.length > 0) return [...new Set(localFallbackIds)]
  if (confirmedRows.length > 0) return []

  return [...new Set(localFallbackIds)]
}

export async function syncLiveRosterFromSessionPlayers(
  sessionId: string,
  localFallbackIds: string[] = [],
) {
  const playerIds = await loadLatestSyncablePlayerIds(sessionId, localFallbackIds)
  if (playerIds.length === 0) {
    return { synced: false, playerIds }
  }

  let payload: any
  try {
    payload = await invokeLiveSessionFunction('session-sync-roster', sessionId, { player_ids: playerIds })
  } catch (error) {
    if (!isRetryableError(error)) throw error

    const { data, error: rpcError } = await supabase.rpc('sync_live_session_roster_versioned', {
      p_session_id: sessionId,
      p_player_ids: playerIds,
      p_revive_checked_out: false,
    })
    if (rpcError) throw rpcError
    payload = data
  }

  return { synced: true, playerIds, payload }
}

export async function checkInLiveSessionPlayers(
  sessionId: string,
  playerIds: string[],
  groupWith: string[] = [],
) {
  const uniqueIds = [...new Set(playerIds)].filter(Boolean)
  if (uniqueIds.length === 0) {
    throw new Error('Missing player_id')
  }

  try {
    const { data, error: rpcError } = await supabase.rpc('checkin_live_session_players_versioned', {
      p_session_id: sessionId,
      p_player_ids: uniqueIds,
      p_group_with: groupWith,
    })
    if (rpcError) throw rpcError
    return data
  } catch (error) {
    if (!isRetryableError(error)) throw error

    return await invokeLiveSessionFunction('session-checkin', sessionId, {
      player_ids: uniqueIds,
      group_with: groupWith,
    })
  }
}

export async function checkOutLiveSessionPlayers(
  sessionId: string,
  playerIds: string[],
) {
  const uniqueIds = [...new Set(playerIds)].filter(Boolean)
  if (uniqueIds.length === 0) {
    throw new Error('Missing player_id')
  }

  try {
    const { data, error: rpcError } = await supabase.rpc('checkout_live_session_players_versioned', {
      p_session_id: sessionId,
      p_player_ids: uniqueIds,
    })
    if (rpcError) throw rpcError
    return data
  } catch (error) {
    if (!isRetryableError(error)) throw error

    return await invokeLiveSessionFunction('session-checkout', sessionId, {
      player_ids: uniqueIds,
    })
  }
}

export async function repairLiveSessionPlayerStateFromRounds(sessionId: string) {
  const { data, error } = await supabase.rpc('repair_live_session_player_state_from_rounds', {
    p_session_id: sessionId,
  })
  if (error) throw error
  return data
}

export async function loadNextRoundSessionSettings(sessionId: string): Promise<PersistedNextRoundSettings | null> {
  const { data, error } = await supabase
    .from('session_next_round_settings')
    .select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    courtCountOverride: data.court_count_override === null || data.court_count_override === undefined
      ? null
      : Number(data.court_count_override),
    courtPreset: data.court_preset,
    courtDurationMin: Number(data.court_duration_min),
    pvnaTolerance: Number(data.pvna_tolerance),
    targetRounds: data.target_rounds === null || data.target_rounds === undefined
      ? null
      : Number(data.target_rounds),
  }
}

export async function saveNextRoundSessionSettings(
  sessionId: string,
  settings: PersistedNextRoundSettings,
) {
  const { data: sessionData } = await supabase.auth.getSession()
  const updatedBy = sessionData.session?.user.id ?? null
  const { error } = await supabase
    .from('session_next_round_settings')
    .upsert({
      session_id: sessionId,
      court_count_override: settings.courtCountOverride,
      court_preset: settings.courtPreset,
      court_duration_min: settings.courtDurationMin,
      pvna_tolerance: settings.pvnaTolerance,
      target_rounds: settings.targetRounds,
      updated_by: updatedBy,
    }, { onConflict: 'session_id' })

  if (error) throw error
}

export async function markSessionPlayersPresent(sessionId: string, playerIds: string[]) {
  const uniqueIds = [...new Set(playerIds)].filter(Boolean)
  if (uniqueIds.length === 0) return

  const { error } = await supabase
    .from('session_players')
    .update({ check_in_status: 'present' })
    .eq('session_id', sessionId)
    .in('player_id', uniqueIds)

  if (error) throw error
}

const liveMatchesPreviewInFlight = new Map<string, Promise<any>>()

export async function fetchLiveMatchesPreview(
  sessionId: string,
  body: {
    mode?: 'full_board' | 'replace_courts'
    count: number
    court_count: number
    pvna_tolerance: number
    court_idxs?: number[]
    current_preview_board?: any[]
    live_match_rows: any[]
    live_state_version: number | null
    completing_live_match_ids: string[]
    players: { id: string; name: string }[]
    player_rows: any[]
    pair_rows: any[]
    round_rows: any[]
  }
) {
  const requestKey = `${sessionId}:${JSON.stringify(body)}`
  const existingRequest = liveMatchesPreviewInFlight.get(requestKey)
  if (existingRequest) return existingRequest

  const request = invokeLiveSessionFunction('session-live-matches-suggest', sessionId, body)
    .finally(() => {
      if (liveMatchesPreviewInFlight.get(requestKey) === request) {
        liveMatchesPreviewInFlight.delete(requestKey)
      }
    })
  liveMatchesPreviewInFlight.set(requestKey, request)
  return request
}
