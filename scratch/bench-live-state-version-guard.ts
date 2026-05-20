import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { buildSessionStateFingerprint } from '../lib/next-round-suggester/state-version'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'

type Args = {
  sessionId: string
  iterations: number
  delayMs: number
  courts: number
}

type Measurement = {
  fullFingerprintMs: number
  versionGuardMs: number
  versionQueries: {
    sessionVersion: number
    activeRound: number
    selectedAvailability: number
  }
  selectedPlayers: number
  fullFingerprintSizes: {
    players: number
    rounds: number
  }
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
  return {
    sessionId,
    iterations: Math.max(1, Number(getValue('--iterations') ?? '10')),
    delayMs: Math.max(0, Number(getValue('--delay-ms') ?? '250')),
    courts: Math.max(1, Number(getValue('--courts') ?? '6')),
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

function summary(values: number[]) {
  if (values.length === 0) return null
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
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

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = now()
  const value = await fn()
  return {
    value,
    ms: now() - startedAt,
  }
}

async function buildSelectedPlayerIds(client: any, sessionId: string, courts: number) {
  const state = await loadSessionState(client, sessionId, { courts })
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
    selectedPlayerIds: [...new Set(alternative.matches.flatMap((match) => [...match.team_a, ...match.team_b]))],
  }
}

async function fullFingerprintGuard(client: any, sessionId: string, courts: number) {
  const state = await loadSessionState(client, sessionId, { courts })
  const fingerprint = buildSessionStateFingerprint(state)
  return {
    players: fingerprint.players.length,
    rounds: fingerprint.rounds.length,
  }
}

async function versionStyleGuard(client: any, sessionId: string, selectedPlayerIds: string[]) {
  const [sessionVersion, activeRound, selectedAvailability] = await Promise.all([
    timed(async () => {
      // Experiment stand-in for a future sessions.live_state_version column.
      const { data, error } = await client
        .from('sessions')
        .select('id, created_at')
        .eq('id', sessionId)
        .maybeSingle()
      if (error) throw error
      return data
    }),
    timed(async () => {
      const { data, error } = await client
        .from('session_rounds')
        .select('round_no')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .limit(1)
      if (error) throw error
      return data
    }),
    timed(async () => {
      const { data, error } = await client
        .from('session_player_state')
        .select('player_id, checked_out_at, opted_rest')
        .eq('session_id', sessionId)
        .in('player_id', selectedPlayerIds)
      if (error) throw error
      return data
    }),
  ])

  return {
    sessionVersionMs: sessionVersion.ms,
    activeRoundMs: activeRound.ms,
    selectedAvailabilityMs: selectedAvailability.ms,
  }
}

async function measure(client: any, args: Args): Promise<Measurement> {
  const { selectedPlayerIds } = await buildSelectedPlayerIds(client, args.sessionId, args.courts)

  const full = await timed(async () => fullFingerprintGuard(client, args.sessionId, args.courts))
  const version = await timed(async () => versionStyleGuard(client, args.sessionId, selectedPlayerIds))

  return {
    fullFingerprintMs: full.ms,
    versionGuardMs: version.ms,
    versionQueries: {
      sessionVersion: version.value.sessionVersionMs,
      activeRound: version.value.activeRoundMs,
      selectedAvailability: version.value.selectedAvailabilityMs,
    },
    selectedPlayers: selectedPlayerIds.length,
    fullFingerprintSizes: full.value,
  }
}

async function main() {
  const args = parseArgs()
  const client = await getHostClient()
  const rows: Measurement[] = []

  for (let index = 0; index < args.iterations; index += 1) {
    const row = await measure(client, args)
    rows.push(row)
    console.log(`iteration ${index + 1}/${args.iterations}`, {
      fullFingerprint: `${row.fullFingerprintMs.toFixed(0)}ms`,
      versionGuard: `${row.versionGuardMs.toFixed(0)}ms`,
      selectedPlayers: row.selectedPlayers,
      fullPlayers: row.fullFingerprintSizes.players,
      fullRounds: row.fullFingerprintSizes.rounds,
    })
    await sleep(args.delayMs)
  }

  console.log('\nsummary')
  console.table({
    fullFingerprint: summary(rows.map((row) => row.fullFingerprintMs)),
    versionStyleGuard: summary(rows.map((row) => row.versionGuardMs)),
    versionSessionQuery: summary(rows.map((row) => row.versionQueries.sessionVersion)),
    activeRoundQuery: summary(rows.map((row) => row.versionQueries.activeRound)),
    selectedAvailabilityQuery: summary(rows.map((row) => row.versionQueries.selectedAvailability)),
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
