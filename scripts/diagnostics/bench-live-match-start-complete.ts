import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import type { Match, SessionLiveMatchRow } from '@/lib/next-round-suggester/types'

type SupabaseAny = any

type Args = {
  yes: boolean
  sessionId: string | null
  iterations: number
  delayMs: number
  courtsOverride: number | null
  courtPreset: CourtPreset
  sessionDurationMin: number
  matchDurationMin: number
  pvnaTolerance: number
}

type Row = {
  iteration: number
  sessionId: string
  matchId: string
  courtIdx: number
  roundNo: number
  loadStateMs: number
  loadLiveMatchesMs: number
  suggestMs: number
  versionGuardMs: number
  startRpcMs: number
  scoreLoadStateMs: number
  fairnessMs: number
  completeRpcMs: number
  totalMs: number
  startVersion: number
  completeVersion: number
}

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const HOST_ACCESS_TOKEN = process.env.HOST_ACCESS_TOKEN

const CLIENT_OPTIONS = {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket as any },
}

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function parseArgs(): Args {
  const preset = (argValue('--court-preset', 'balanced') ?? 'balanced') as CourtPreset
  if (!['relaxed', 'balanced', 'play_more'].includes(preset)) {
    throw new Error('--court-preset must be one of: relaxed, balanced, play_more')
  }

  const courts = argValue('--courts')
  return {
    yes: process.argv.includes('--yes'),
    sessionId: argValue('--session-id'),
    iterations: Math.max(1, Number(argValue('--iterations', '5'))),
    delayMs: Math.max(0, Number(argValue('--delay-ms', '250'))),
    courtsOverride: courts == null ? null : Math.max(1, Number(courts)),
    courtPreset: preset,
    sessionDurationMin: Math.max(1, Number(argValue('--session-duration-min', '120'))),
    matchDurationMin: Math.max(1, Number(argValue('--match-duration-min', '15'))),
    pvnaTolerance: Math.max(0, Number(argValue('--pvna-tolerance', '0.5'))),
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(values: number[]) {
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return {
    min: Math.round(Math.min(...values)),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(Math.max(...values)),
    avg: Math.round(avg),
  }
}

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (HOST_ACCESS_TOKEN) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      ...CLIENT_OPTIONS,
      global: { headers: { Authorization: `Bearer ${HOST_ACCESS_TOKEN}` } },
    })
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTIONS)
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return client
}

async function getAccessToken(client: SupabaseAny) {
  if (HOST_ACCESS_TOKEN) return HOST_ACCESS_TOKEN
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Missing host access token')
  return token
}

async function getUserId(client: SupabaseAny) {
  if (HOST_ACCESS_TOKEN) {
    const { data, error } = await client.auth.getUser(HOST_ACCESS_TOKEN)
    if (error) throw error
    return data.user?.id
  }
  const { data, error } = await client.auth.getUser()
  if (error) throw error
  return data.user?.id
}

async function latestPlayableSessionId(client: SupabaseAny, hostUserId: string) {
  const { data, error } = await client
    .from('sessions')
    .select('id')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error

  for (const session of data ?? []) {
    const { count, error: countError } = await client
      .from('session_players')
      .select('player_id', { count: 'exact', head: true })
      .eq('session_id', session.id)
    if (countError) throw countError
    if ((count ?? 0) >= 8) return String(session.id)
  }
  throw new Error(`No playable session found for ${HOST_EMAIL}`)
}

async function getRoster(client: SupabaseAny, sessionId: string) {
  const [registered, state] = await Promise.all([
    client.from('session_players').select('player_id, status, check_in_status').eq('session_id', sessionId),
    client.from('session_player_state').select('player_id, checked_out_at').eq('session_id', sessionId),
  ])
  if (registered.error) throw registered.error
  if (state.error) throw state.error

  const registeredIds = [...new Set((registered.data ?? [])
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
  const presentIds = (state.data ?? [])
    .filter((row: any) => row.checked_out_at === null)
    .map((row: any) => String(row.player_id))
  return { registeredIds, presentIds }
}

async function invokeEdge(functionName: string, accessToken: string, sessionId: string, body: Record<string, unknown>) {
  const params = new URLSearchParams({ session_id: sessionId })
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? text)
  return payload
}

async function ensureRoster(client: SupabaseAny, accessToken: string, sessionId: string) {
  const roster = await getRoster(client, sessionId)
  if (roster.presentIds.length >= 8) return roster
  await invokeEdge('session-sync-roster', accessToken, sessionId, {
    player_ids: roster.registeredIds,
    revive_checked_out: true,
  })
  return getRoster(client, sessionId)
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', { p_session_id: sessionId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { liveStateVersion: Number(row.live_state_version) }
}

async function loadLiveMatches(client: SupabaseAny, sessionId: string): Promise<SessionLiveMatchRow[]> {
  const { data, error } = await client
    .from('session_live_matches')
    .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
    .eq('session_id', sessionId)
    .order('sequence_no', { ascending: true })
  if (error) throw error
  return (data ?? []) as SessionLiveMatchRow[]
}

function buildRoundNo(matches: SessionLiveMatchRow[], courts: number) {
  const countable = matches.filter((match) => match.status !== 'cancelled').length
  return Math.floor(countable / Math.max(1, courts))
}

function firstFreeCourtIdx(matches: SessionLiveMatchRow[], courts: number) {
  const liveCourts = new Set(
    matches
      .filter((match) => match.status === 'live' && match.court_idx != null)
      .map((match) => Number(match.court_idx)),
  )
  for (let index = 0; index < courts; index += 1) {
    if (!liveCourts.has(index)) return index
  }
  return null
}

function busyPlayerIds(matches: SessionLiveMatchRow[]) {
  return new Set(
    matches
      .filter((match) => match.status === 'live')
      .flatMap((match) => [...(match.team_a ?? []), ...(match.team_b ?? [])].map(String)),
  )
}

async function startOneMatch(client: SupabaseAny, sessionId: string, courts: number, pvnaTolerance: number, iteration: number) {
  const t0 = now()

  const loadStateT0 = now()
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance })
  const loadStateMs = now() - loadStateT0

  const loadLiveT0 = now()
  const liveMatches = await loadLiveMatches(client, sessionId)
  const loadLiveMatchesMs = now() - loadLiveT0

  const courtIdx = firstFreeCourtIdx(liveMatches, courts)
  if (courtIdx === null) throw new Error(`No free court among ${courts} courts`)

  const suggestT0 = now()
  const suggestion = suggestNextMatch(state, {
    busy_player_ids: busyPlayerIds(liveMatches),
    court_idx: courtIdx,
  })
  const match = suggestion.alternatives[0]?.matches[0]
  const suggestMs = now() - suggestT0
  if (!match) throw new Error(`No suggested match. warnings=${suggestion.warnings.join(',')}`)

  const roundNo = buildRoundNo(liveMatches, courts)
  const versionT0 = now()
  const guard = await getVersionGuard(client, sessionId)
  const versionGuardMs = now() - versionT0

  const pMatch: Match & { resting: string[]; round_no: number } = {
    ...match,
    court_idx: courtIdx,
    resting: suggestion.alternatives[0]?.resting ?? [],
    round_no: roundNo,
  }

  const startRpcT0 = now()
  const { data, error } = await client.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: guard.liveStateVersion,
    p_match: pMatch,
    p_audit_payload: {
      benchmark: true,
      source: 'scratch/bench-live-match-start-complete.ts',
      iteration,
    },
  })
  const startRpcMs = now() - startRpcT0
  if (error) throw error
  if (!data?.match?.id) throw new Error('Start RPC returned no match')

  return {
    loadStateMs,
    loadLiveMatchesMs,
    suggestMs,
    versionGuardMs,
    startRpcMs,
    startVersion: Number(data.live_state_version),
    startedMatch: data.match as SessionLiveMatchRow,
    totalStartMs: now() - t0,
  }
}

async function completeOneMatch(client: SupabaseAny, sessionId: string, startedMatch: SessionLiveMatchRow, expectedVersion: number, stateForScore: Awaited<ReturnType<typeof loadSessionState>>) {
  const fairnessT0 = now()
  const scoreAfter = Math.round(computeSessionFairness(stateForScore).total)
  const fairnessMs = now() - fairnessT0

  const completeRpcT0 = now()
  const { data, error } = await client.rpc('complete_live_session_match_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: expectedVersion,
    p_match_id: startedMatch.id,
    p_score_a: 0,
    p_score_b: 0,
    p_score_after: scoreAfter,
    p_audit_payload: {
      benchmark: true,
      source: 'scratch/bench-live-match-start-complete.ts',
      sequence_no: startedMatch.sequence_no,
      expected_round_matches: Math.max(1, Number(startedMatch.round_no == null ? 1 : stateForScore.config.courts)),
    },
  })
  const completeRpcMs = now() - completeRpcT0
  if (error) throw error

  return {
    fairnessMs,
    completeRpcMs,
    completeVersion: Number(data.live_state_version),
  }
}

async function main() {
  const args = parseArgs()
  if (!args.yes) throw new Error('This benchmark mutates live session data. Re-run with --yes to confirm.')

  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const userId = await getUserId(client)
  if (!userId) throw new Error('Missing host user id')

  const sessionId = args.sessionId ?? await latestPlayableSessionId(client, userId)
  const roster = await ensureRoster(client, accessToken, sessionId)
  if (roster.presentIds.length < 8) throw new Error(`Need at least 8 present players, got ${roster.presentIds.length}`)

  const courtSetup = calculateOptimalCourts({
    n_players: roster.presentIds.length,
    session_duration_min: args.sessionDurationMin,
    match_duration_min: args.matchDurationMin,
    preset: args.courtPreset,
  })
  const courts = args.courtsOverride ?? courtSetup.recommended.courts
  const rows: Row[] = []

  for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
    const totalT0 = now()
    const started = await startOneMatch(client, sessionId, courts, args.pvnaTolerance, iteration)
    const scoreLoadT0 = now()
    const scoreState = await loadSessionState(client, sessionId, { courts, pvnaTolerance: args.pvnaTolerance })
    const scoreLoadStateMs = now() - scoreLoadT0
    const completed = await completeOneMatch(client, sessionId, started.startedMatch, started.startVersion, scoreState)

    rows.push({
      iteration,
      sessionId,
      matchId: started.startedMatch.id,
      courtIdx: Number(started.startedMatch.court_idx ?? -1),
      roundNo: Number(started.startedMatch.round_no ?? -1),
      loadStateMs: started.loadStateMs,
      loadLiveMatchesMs: started.loadLiveMatchesMs,
      suggestMs: started.suggestMs,
      versionGuardMs: started.versionGuardMs,
      startRpcMs: started.startRpcMs,
      scoreLoadStateMs,
      fairnessMs: completed.fairnessMs,
      completeRpcMs: completed.completeRpcMs,
      totalMs: now() - totalT0,
      startVersion: started.startVersion,
      completeVersion: completed.completeVersion,
    })

    if (iteration < args.iterations && args.delayMs > 0) await sleep(args.delayMs)
  }

  const summary = {
    loadStateMs: summarize(rows.map((row) => row.loadStateMs)),
    loadLiveMatchesMs: summarize(rows.map((row) => row.loadLiveMatchesMs)),
    suggestMs: summarize(rows.map((row) => row.suggestMs)),
    versionGuardMs: summarize(rows.map((row) => row.versionGuardMs)),
    startRpcMs: summarize(rows.map((row) => row.startRpcMs)),
    scoreLoadStateMs: summarize(rows.map((row) => row.scoreLoadStateMs)),
    fairnessMs: summarize(rows.map((row) => row.fairnessMs)),
    completeRpcMs: summarize(rows.map((row) => row.completeRpcMs)),
    totalMs: summarize(rows.map((row) => row.totalMs)),
  }

  console.log(JSON.stringify({
    sessionId,
    host: HOST_EMAIL,
    iterations: args.iterations,
    courts,
    recommendedCourts: courtSetup.recommended.courts,
    rows: rows.map((row) => ({
      ...row,
      loadStateMs: Math.round(row.loadStateMs),
      loadLiveMatchesMs: Math.round(row.loadLiveMatchesMs),
      suggestMs: Math.round(row.suggestMs),
      versionGuardMs: Math.round(row.versionGuardMs),
      startRpcMs: Math.round(row.startRpcMs),
      scoreLoadStateMs: Math.round(row.scoreLoadStateMs),
      fairnessMs: Math.round(row.fairnessMs),
      completeRpcMs: Math.round(row.completeRpcMs),
      totalMs: Math.round(row.totalMs),
    })),
    summary,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
