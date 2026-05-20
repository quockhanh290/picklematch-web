import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'

type Args = {
  yes: boolean
  transport: 'rpc' | 'edge'
  sessionId: string
  iterations: number
  delayMs: number
  courtsOverride: number | null
  courtPreset: CourtPreset
  sessionDurationMin: number
  matchDurationMin: number
  pvnaTolerance: number
}

type SupabaseAny = any

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
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: WebSocket as any,
  },
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const getValue = (name: string) => {
    const prefix = `${name}=`
    const inline = args.find((arg) => arg.startsWith(prefix))
    if (inline) return inline.slice(prefix.length)
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const sessionId = getValue('--session-id')
  if (!sessionId) throw new Error('Missing --session-id')
  const preset = (getValue('--court-preset') ?? 'balanced') as CourtPreset
  if (!['relaxed', 'balanced', 'play_more'].includes(preset)) {
    throw new Error('--court-preset must be relaxed, balanced, or play_more')
  }
  const courts = getValue('--courts')
  return {
    yes: args.includes('--yes'),
    transport: (getValue('--transport') ?? 'rpc') as 'rpc' | 'edge',
    sessionId,
    iterations: Math.max(1, Number(getValue('--iterations') ?? '1')),
    delayMs: Math.max(0, Number(getValue('--delay-ms') ?? '600')),
    courtsOverride: courts === undefined ? null : Math.max(1, Number(courts)),
    courtPreset: preset,
    sessionDurationMin: Math.max(1, Number(getValue('--session-duration-min') ?? '120')),
    matchDurationMin: Math.max(1, Number(getValue('--match-duration-min') ?? '15')),
    pvnaTolerance: Math.max(0, Number(getValue('--pvna-tolerance') ?? '0.5')),
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

function printSummary(title: string, values: number[]) {
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  console.log(title, {
    count: values.length,
    min: `${Math.min(...values).toFixed(0)}ms`,
    p50: `${percentile(values, 50).toFixed(0)}ms`,
    p95: `${percentile(values, 95).toFixed(0)}ms`,
    max: `${Math.max(...values).toFixed(0)}ms`,
    avg: `${avg.toFixed(0)}ms`,
  })
}

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (HOST_ACCESS_TOKEN) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      ...CLIENT_OPTIONS,
      global: {
        headers: {
          Authorization: `Bearer ${HOST_ACCESS_TOKEN}`,
        },
      },
    })
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTIONS)
  const { error } = await client.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
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

async function invokeVersionedFunction(
  functionName: string,
  accessToken: string,
  sessionId: string,
  body: Record<string, unknown>,
  query: Record<string, string | number> = {},
) {
  const params = new URLSearchParams({ session_id: sessionId })
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? text)
  }
  return payload
}

async function getStatus(client: SupabaseAny, sessionId: string) {
  const [playersResult, roundsResult, pairsResult] = await Promise.all([
    client.from('session_player_state').select('player_id, checked_out_at, opted_rest').eq('session_id', sessionId),
    client.from('session_rounds').select('round_no, status').eq('session_id', sessionId).order('round_no', { ascending: true }),
    client.from('session_pair_history').select('player_a').eq('session_id', sessionId),
  ])
  if (playersResult.error) throw playersResult.error
  if (roundsResult.error) throw roundsResult.error
  if (pairsResult.error) throw pairsResult.error
  const players = playersResult.data ?? []
  const rounds = roundsResult.data ?? []
  const active = rounds.find((round: any) => round.status === 'active')
  return {
    players: players.length,
    present: players.filter((row: any) => !row.checked_out_at).length,
    eligible: players.filter((row: any) => !row.checked_out_at && !row.opted_rest).length,
    rounds: rounds.length,
    activeRound: active ? Number((active as any).round_no) : null,
    pairs: pairsResult.data?.length ?? 0,
  }
}

function changedPairHistoryRows(
  beforeRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
  afterRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
) {
  const beforeByKey = new Map(beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]))
  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before || before.partner_count !== row.partner_count || before.opponent_count !== row.opponent_count
  })
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', {
    p_session_id: sessionId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Missing version guard row')
  return {
    liveStateVersion: Number(row.live_state_version),
    currentRound: Number(row.current_round),
    activeRoundNo: row.active_round_no == null ? null : Number(row.active_round_no),
  }
}

async function buildPlan(client: SupabaseAny, args: Args, presentCount: number) {
  const courtSetup = calculateOptimalCourts({
    n_players: presentCount,
    session_duration_min: args.sessionDurationMin,
    match_duration_min: args.matchDurationMin,
    preset: args.courtPreset,
  })
  const courts = args.courtsOverride ?? courtSetup.recommended.courts
  const state = await loadSessionState(client, args.sessionId, {
    courts,
    pvnaTolerance: args.pvnaTolerance,
  })
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const suggestion = suggestNextRoundExperimental(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
    mode: 'global',
    candidateLimit: 28,
  })
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available. warnings=${suggestion.warnings.join(',')}`)
  return {
    state,
    alternative,
    scoreBefore: computeSessionFairness(state).total,
  }
}

async function runCycle(client: SupabaseAny, args: Args, accessToken: string) {
  const status = await getStatus(client, args.sessionId)
  if (status.activeRound !== null) throw new Error(`Cannot start: round ${status.activeRound} is active`)

  const planStartedAt = now()
  const plan = await buildPlan(client, args, status.present)
  const planMs = now() - planStartedAt

  const startGuard = await getVersionGuard(client, args.sessionId)
  if (startGuard.activeRoundNo !== null) throw new Error(`Cannot start: round ${startGuard.activeRoundNo} is active`)

  const startStartedAt = now()
  const startPayload = args.transport === 'edge'
    ? await invokeVersionedFunction('session-rounds-start-versioned', accessToken, args.sessionId, {
        expected_live_state_version: startGuard.liveStateVersion,
        round_no: startGuard.currentRound,
        matches: plan.alternative.matches,
        resting: plan.alternative.resting,
        audit_payload: {
          benchmark: true,
          source: 'scratch/bench-live-round-versioned-rpc.ts',
          transport: 'edge',
        },
      })
    : await (async () => {
        const { data, error } = await client.rpc('start_live_session_round_versioned', {
          p_session_id: args.sessionId,
          p_expected_live_state_version: startGuard.liveStateVersion,
          p_round_no: startGuard.currentRound,
          p_matches: plan.alternative.matches,
          p_resting: plan.alternative.resting,
          p_audit_payload: {
            benchmark: true,
            source: 'scratch/bench-live-round-versioned-rpc.ts',
            transport: 'rpc',
          },
        })
        if (error) throw error
        return data
      })()
  const startMs = now() - startStartedAt

  const startedVersion = Number(startPayload?.live_state_version)
  const reloadStartedAt = now()
  const startedState = await loadSessionState(client, args.sessionId, {
    courts: plan.state.config.courts,
    pvnaTolerance: plan.state.config.pvna_tolerance,
  })
  const reloadMs = now() - reloadStartedAt

  const activeRound = startedState.rounds.find((round) => round.round_no === startGuard.currentRound && round.status === 'active')
  if (!activeRound) throw new Error(`Round ${startGuard.currentRound} was not active after start`)

  const commitStartedAt = now()
  const existingPairs = pairHistoryRowsFromState(startedState)
  const committed = commitCompletedRound(
    startedState,
    {
      round_no: activeRound.round_no,
      matches: activeRound.matches,
      resting: activeRound.resting,
    },
    existingPairs,
  )
  const playerStatePayload = [...committed.players.values()].map((player) => ({
    player_id: player.player_id,
    matches_played: player.matches_played,
    last_played_round: player.last_played_round,
    consecutive_rest: player.consecutive_rest,
    consecutive_play: player.consecutive_play,
    opted_rest: player.opted_rest,
  }))
  const pairHistoryPayload = changedPairHistoryRows(existingPairs, committed.pairHistory).map((row) => ({
    player_a: row.player_a,
    player_b: row.player_b,
    partner_count: row.partner_count,
    opponent_count: row.opponent_count,
  }))
  const scoreAfter = computeSessionFairness({
    ...startedState,
    current_round: Math.max(startedState.current_round, activeRound.round_no + 1),
    players: committed.players,
    rounds: startedState.rounds.map((round) =>
      round.round_no === activeRound.round_no
        ? {
            ...round,
            status: 'completed',
            ended_at: new Date(),
          }
        : round,
    ),
  }).total
  const commitLocalMs = now() - commitStartedAt

  const endStartedAt = now()
  const endPayload = args.transport === 'edge'
    ? await invokeVersionedFunction('session-rounds-end-versioned', accessToken, args.sessionId, {
        expected_live_state_version: startedVersion,
        round_no: activeRound.round_no,
        player_state: playerStatePayload,
        pair_history: pairHistoryPayload,
        score_after: scoreAfter,
        audit_payload: {
          benchmark: true,
          source: 'scratch/bench-live-round-versioned-rpc.ts',
          transport: 'edge',
        },
      }, { round_no: activeRound.round_no })
    : await (async () => {
        const { data, error } = await client.rpc('complete_live_session_round_versioned', {
          p_session_id: args.sessionId,
          p_expected_live_state_version: startedVersion,
          p_round_no: activeRound.round_no,
          p_player_state: playerStatePayload,
          p_pair_history: pairHistoryPayload,
          p_score_after: scoreAfter,
          p_audit_payload: {
            benchmark: true,
            source: 'scratch/bench-live-round-versioned-rpc.ts',
            transport: 'rpc',
          },
        })
        if (error) throw error
        return data
      })()
  const endMs = now() - endStartedAt

  return {
    round: activeRound.round_no,
    planMs,
    startMs,
    reloadMs,
    commitLocalMs,
    endMs,
    startVersion: startGuard.liveStateVersion,
    endVersion: Number(endPayload?.live_state_version),
    playerUpdates: playerStatePayload.length,
    pairUpdates: pairHistoryPayload.length,
  }
}

async function main() {
  const args = parseArgs()
  if (!args.yes) throw new Error('This benchmark mutates live session data. Re-run with --yes to confirm.')
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)

  const planRows: number[] = []
  const startRows: number[] = []
  const reloadRows: number[] = []
  const commitRows: number[] = []
  const endRows: number[] = []

  for (let index = 0; index < args.iterations; index += 1) {
    const row = await runCycle(client, args, accessToken)
    planRows.push(row.planMs)
    startRows.push(row.startMs)
    reloadRows.push(row.reloadMs)
    commitRows.push(row.commitLocalMs)
    endRows.push(row.endMs)
    console.log(`iteration ${index + 1}/${args.iterations}`, {
      round: row.round,
      transport: args.transport,
      plan: `${row.planMs.toFixed(0)}ms`,
      startRpc: `${row.startMs.toFixed(0)}ms`,
      reload: `${row.reloadMs.toFixed(0)}ms`,
      commitLocal: `${row.commitLocalMs.toFixed(0)}ms`,
      endRpc: `${row.endMs.toFixed(0)}ms`,
      version: `${row.startVersion}->${row.endVersion}`,
      playerUpdates: row.playerUpdates,
      pairUpdates: row.pairUpdates,
    })
    await sleep(args.delayMs)
  }

  printSummary('plan summary', planRows)
  printSummary(`versioned start ${args.transport} summary`, startRows)
  printSummary('reload summary', reloadRows)
  printSummary('commit local summary', commitRows)
  printSummary(`versioned end ${args.transport} summary`, endRows)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
