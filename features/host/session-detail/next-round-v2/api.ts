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
  return functionName === 'session-live-matches-create'
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
  options: {
    signal?: AbortSignal
  } = {},
): Promise<{ response: Response; payload: any; parseFailed: boolean; responseText: string }> {
  if (options.signal?.aborted) {
    throw new Error('Request cancelled.')
  }

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
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const { payload, parseFailed, text } = await parseJsonPayload(response)
    return { response, payload, parseFailed, responseText: text }
  } catch (error) {
    if (isAbortError(error)) {
      if (options.signal?.aborted) {
        throw new Error('Request cancelled.')
      }
      throw new Error('Request timed out. Check your connection and try again.')
    }
    if (error instanceof TypeError) {
      throw new Error('Temporary network issue. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function invokeLiveSessionFunction(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown> = {},
  extraQuery: Record<string, string | number> = {},
  options: {
    requestId?: string
    signal?: AbortSignal
  } = {},
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
      ...(options.requestId ? { 'x-request-id': options.requestId, 'x-client-request-id': options.requestId } : {}),
    },
    body: JSON.stringify(body),
  }

  let response: Response | null = null
  let payload: any
  let parseFailed = false

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetchJsonWithTimeout(url, init, timeoutForFunction(functionName), {
        signal: options.signal,
      })
      response = result.response
      payload = result.payload
      parseFailed = result.parseFailed
      break
    } catch (error) {
      if (options.signal?.aborted) throw error
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

export type AvoidPairEntry = {
  player_a: string
  player_b: string
  reason?: string
}

export async function loadAvoidPairs(sessionId: string): Promise<AvoidPairEntry[]> {
  const { data, error } = await supabase
    .from('session_avoid_pairs')
    .select('player_a, player_b, reason')
    .eq('session_id', sessionId)
  if (error) throw error
  return (data ?? []) as AvoidPairEntry[]
}

// TODO(frontend): Wire these to UI — backend is live (session_avoid_pairs table with RLS).
// Suggested entry point: roster sheet player row long-press → "Avoid pairing" action.
// State management: call setAvoidPairs() from useNextRoundModel after each mutation.
export async function addAvoidPair(
  sessionId: string,
  pair: AvoidPairEntry,
): Promise<void> {
  const [a, b] = [pair.player_a, pair.player_b].sort()
  const { error } = await supabase
    .from('session_avoid_pairs')
    .upsert(
      { session_id: sessionId, player_a: a, player_b: b, reason: pair.reason ?? null },
      { onConflict: 'session_id,player_a,player_b' },
    )
  if (error) throw error
}

export async function removeAvoidPair(
  sessionId: string,
  playerA: string,
  playerB: string,
): Promise<void> {
  const [a, b] = [playerA, playerB].sort()
  const { error } = await supabase
    .from('session_avoid_pairs')
    .delete()
    .eq('session_id', sessionId)
    .eq('player_a', a)
    .eq('player_b', b)
  if (error) throw error
}

// TODO(frontend): Wire to UI — backend column effective_pvna on session_player_state is live.
// Suggested entry point: roster sheet player row → long-press → "Adjust skill for this session".
// null = remove override (revert to player's actual PVNA). Range: 1.0–6.0.
// State: update session_player_state row in live query cache after success.
export async function setEffectivePvna(
  sessionId: string,
  playerId: string,
  effectivePvna: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('session_player_state')
    .update({ effective_pvna: effectivePvna })
    .eq('session_id', sessionId)
    .eq('player_id', playerId)
  if (error) throw error
}

const liveMatchesPreviewInFlight = new Map<string, Promise<any>>()

export function createClientTraceId(prefix = 'client') {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${randomId}`
}

type ClientSessionAuditEventInput = {
  requestId?: string | null
  clientRequestId?: string | null
  requestPayload?: unknown
  responsePayload?: unknown
  detail?: unknown
}

type ClientSessionAuditQueueItem = {
  sessionId: string
  eventType: string
  clientEventId: string
  input: ClientSessionAuditEventInput
}

const CLIENT_AUDIT_BATCH_SIZE = 25
const CLIENT_AUDIT_FLUSH_MS = 1000
const CLIENT_AUDIT_RETRY_MS = 2500
const clientAuditQueue: ClientSessionAuditQueueItem[] = []
let clientAuditFlushTimer: ReturnType<typeof setTimeout> | null = null
let clientAuditFlushInFlight = false
let clientAuditActorIdPromise: Promise<string | null> | null = null
let clientAuditLifecycleFlushInstalled = false
let clientAuditMissingAuthWarned = false

function getClientAuditActorId() {
  if (!clientAuditActorIdPromise) {
    clientAuditActorIdPromise = supabase.auth.getSession()
      .then(async ({ data }) => {
        if (data.session?.user.id) return data.session.user.id
        const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null } }))
        return refreshed.session?.user.id ?? null
      })
      .catch(() => null)
      .finally(() => {
        clientAuditActorIdPromise = null
      })
  }
  return clientAuditActorIdPromise
}

function createClientAuditEventId(sessionId: string, eventType: string) {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `client_audit_${sessionId}_${eventType}_${randomPart}`
}

function scheduleClientAuditFlush(delayMs = CLIENT_AUDIT_FLUSH_MS) {
  if (delayMs <= 0 && clientAuditFlushTimer) {
    clearTimeout(clientAuditFlushTimer)
    clientAuditFlushTimer = null
  }
  if (clientAuditFlushTimer) return
  clientAuditFlushTimer = setTimeout(() => {
    clientAuditFlushTimer = null
    void flushClientAuditQueue()
  }, delayMs)
}

async function flushClientAuditQueue(): Promise<void> {
  if (clientAuditFlushInFlight || clientAuditQueue.length === 0) return
  clientAuditFlushInFlight = true
  const batch = clientAuditQueue.splice(0, CLIENT_AUDIT_BATCH_SIZE)
  let failed = false
  try {
    const actorId = await getClientAuditActorId()
    if (!actorId) {
      failed = true
      clientAuditQueue.unshift(...batch)
      if (__DEV__ && !clientAuditMissingAuthWarned) {
        clientAuditMissingAuthWarned = true
        console.warn('[NextRoundSuggesterV2] client audit skipped until auth session is available')
      }
      scheduleClientAuditFlush(CLIENT_AUDIT_RETRY_MS)
      return
    }
    const rows = batch.map(({ sessionId, eventType, clientEventId, input }) => ({
      client_event_id: clientEventId,
      session_id: sessionId,
      event_type: eventType,
      edge_function: 'client-next-round-v2',
      request_id: input.requestId ?? null,
      client_request_id: input.clientRequestId ?? input.requestId ?? null,
      actor_id: actorId,
      request_payload: input.requestPayload ?? {},
      response_payload: input.responsePayload ?? {},
      detail: input.detail ?? {},
    }))
    const { error } = await supabase.from('session_audit_events').insert(rows)
    if (error) {
      if (error.code === '23505') return
      throw error
    }
  } catch (error) {
    failed = true
    clientAuditQueue.unshift(...batch)
    if (__DEV__) console.warn('[NextRoundSuggesterV2] client audit batch insert failed', error)
    scheduleClientAuditFlush(CLIENT_AUDIT_RETRY_MS)
  } finally {
    clientAuditFlushInFlight = false
    if (!failed && clientAuditQueue.length > 0) {
      scheduleClientAuditFlush(0)
    }
  }
}

function flushClientAuditQueueSoon() {
  if (clientAuditFlushTimer) {
    clearTimeout(clientAuditFlushTimer)
    clientAuditFlushTimer = null
  }
  void flushClientAuditQueue()
}

function installClientAuditLifecycleFlush() {
  if (
    clientAuditLifecycleFlushInstalled
    || typeof window === 'undefined'
    || typeof window.addEventListener !== 'function'
  ) return
  clientAuditLifecycleFlushInstalled = true

  window.addEventListener('pagehide', flushClientAuditQueueSoon)
  window.addEventListener('beforeunload', flushClientAuditQueueSoon)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushClientAuditQueueSoon()
      }
    })
  }
}

export async function recordClientSessionAuditEvent(
  sessionId: string,
  eventType: string,
  input: ClientSessionAuditEventInput = {},
) {
  installClientAuditLifecycleFlush()
  clientAuditQueue.push({
    sessionId,
    eventType,
    clientEventId: createClientAuditEventId(sessionId, eventType),
    input,
  })
  scheduleClientAuditFlush(clientAuditQueue.length >= CLIENT_AUDIT_BATCH_SIZE ? 0 : CLIENT_AUDIT_FLUSH_MS)
}

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
    // Settings — optional, backward compatible
    planned_total_rounds?: number
    court_preset?: 'balanced' | 'play_more' | 'relaxed'
    current_courts?: number
    avoid_pairs?: AvoidPairEntry[]
    prefer_available_pool?: boolean
    allow_full_board_rescue?: boolean
  },
  options: {
    requestId?: string
    signal?: AbortSignal
  } = {},
) {
  const requestKey = `${sessionId}:${JSON.stringify(body)}`
  // An abortable request has a single owner. Sharing it across effect generations
  // lets cleanup from the older effect cancel the newer caller's preview as well.
  const canShareRequest = options.signal === undefined
  const existingRequest = canShareRequest ? liveMatchesPreviewInFlight.get(requestKey) : undefined
  if (existingRequest) return existingRequest

  const request = invokeLiveSessionFunction('session-live-matches-suggest', sessionId, body, {}, {
    requestId: options.requestId,
    signal: options.signal,
  })
    .finally(() => {
      if (canShareRequest && liveMatchesPreviewInFlight.get(requestKey) === request) {
        liveMatchesPreviewInFlight.delete(requestKey)
      }
    })
  if (canShareRequest) liveMatchesPreviewInFlight.set(requestKey, request)
  return request
}

export async function startPersistedLiveMatch(
  sessionId: string,
  body: {
    expected_live_state_version: number
    match_id: string
    audit_payload?: Record<string, unknown>
  },
) {
  return invokeLiveSessionFunction('session-live-matches-start', sessionId, body)
}

export async function persistAndStartLiveMatch(
  sessionId: string,
  {
    expectedLiveStateVersion,
    match,
    auditPayload,
  }: {
    expectedLiveStateVersion: number
    match: { court_idx: number | null; team_a: string[]; team_b: string[]; resting: string[]; round_no: number }
    auditPayload: Record<string, unknown>
  },
) {
  const { data, error } = await supabase.rpc('replace_live_session_suggestions_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: expectedLiveStateVersion,
    p_matches: [match],
    p_replace_court_idxs: match.court_idx === null ? [] : [match.court_idx],
    p_replace_all: false,
    p_audit_payload: { ...auditPayload, source: 'client-manual-lineup-persist' },
  })
  if (error) throw error
  const persistedMatch = Array.isArray(data?.matches) ? data.matches[0] : null
  const persistedVersion = Number(data?.live_state_version)
  if (!persistedMatch?.id || !Number.isFinite(persistedVersion)) {
    throw new Error('Manual lineup was not persisted as a startable match')
  }
  return startPersistedLiveMatch(sessionId, {
    expected_live_state_version: persistedVersion,
    match_id: persistedMatch.id,
    audit_payload: { ...auditPayload, source: 'client-manual-lineup-start-persisted' },
  })
}

export async function fetchLiveSessionVersion(sessionId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('live_state_version')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw error
  if (data?.live_state_version === null || data?.live_state_version === undefined) return null
  const version = Number(data.live_state_version)
  return Number.isFinite(version) ? version : null
}
