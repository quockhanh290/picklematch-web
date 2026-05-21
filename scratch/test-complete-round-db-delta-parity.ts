import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import type { Match } from '../lib/next-round-suggester/types'

type SupabaseAny = any

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

async function getHostClient() {
  if (!ANON_KEY) throw new Error('Missing Supabase anon key')
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await client.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
  if (error) throw error
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Host login failed')
  return { client, accessToken: token }
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', {
    p_session_id: sessionId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    liveStateVersion: Number(row.live_state_version),
    currentRound: Number(row.current_round),
    activeRoundNo: row.active_round_no == null ? null : Number(row.active_round_no),
  }
}

async function invokeFunction(
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
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? text)
  return payload
}

function simpleMatches(playerIds: string[], courts = 6): { matches: Match[]; resting: string[] } {
  const courtCount = Math.max(1, Math.min(courts, Math.floor(playerIds.length / 4)))
  const playingIds = playerIds.slice(0, courtCount * 4)
  const matches: Match[] = []
  for (let index = 0; index < playingIds.length; index += 4) {
    matches.push({
      court_idx: matches.length,
      team_a: [playingIds[index], playingIds[index + 1]],
      team_b: [playingIds[index + 2], playingIds[index + 3]],
    })
  }
  return { matches, resting: playerIds.slice(courtCount * 4) }
}

function pairKey(row: { player_a: string; player_b: string }) {
  return `${row.player_a}:${row.player_b}`
}

async function main() {
  const sessionId = argValue('--session-id')
  if (!sessionId) throw new Error('Missing --session-id')
  const courts = Math.max(1, Number(argValue('--courts', '6')))
  const { client, accessToken } = await getHostClient()

  const guard = await getVersionGuard(client, sessionId)
  if (guard.activeRoundNo !== null) throw new Error(`Session has active round ${guard.activeRoundNo}`)

  const beforeState = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const eligibleIds = [...beforeState.players.values()]
    .filter((player) => player.checked_out_at === null && !player.opted_rest)
    .map((player) => player.player_id)
  const { matches, resting } = simpleMatches(eligibleIds, courts)
  if (matches.length === 0) throw new Error('No matches available')

  const startPayload = await invokeFunction('session-rounds-start-versioned', accessToken, sessionId, {
    expected_live_state_version: guard.liveStateVersion,
    round_no: guard.currentRound,
    matches,
    resting,
    audit_payload: {
      benchmark: true,
      source: 'scratch/test-complete-round-db-delta-parity.ts',
    },
  })
  const roundNo = Number(startPayload.round?.round_no)

  const expectedStateAtStart = {
    ...beforeState,
    rounds: [
      ...beforeState.rounds,
      {
        id: String(startPayload.round?.id ?? ''),
        session_id: sessionId,
        round_no: roundNo,
        status: 'active' as const,
        matches,
        resting,
        started_at: startPayload.round?.started_at ?? null,
        ended_at: null,
      },
    ],
  }
  const existingPairs = pairHistoryRowsFromState(expectedStateAtStart)
  const expectedCommit = commitCompletedRound(expectedStateAtStart, {
    round_no: roundNo,
    matches,
    resting,
  }, existingPairs)
  const expectedPairRows = new Map(expectedCommit.pairHistory.map((row) => [pairKey(row), row]))
  const scoreAfter = computeSessionFairness({
    ...expectedStateAtStart,
    current_round: Math.max(expectedStateAtStart.current_round, roundNo + 1),
    players: expectedCommit.players,
  }).total

  const endPayload = await invokeFunction('session-rounds-end-versioned', accessToken, sessionId, {
    expected_live_state_version: Number(startPayload.live_state_version),
    round_no: roundNo,
    player_state: [],
    pair_history: [],
    score_after: scoreAfter,
    audit_payload: {
      benchmark: true,
      source: 'scratch/test-complete-round-db-delta-parity.ts',
    },
  }, { round_no: roundNo })

  const afterState = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const playerMismatches = []
  for (const [playerId, expected] of expectedCommit.players) {
    const actual = afterState.players.get(playerId)
    if (!actual) {
      playerMismatches.push({ playerId, missing: true })
      continue
    }
    for (const field of ['matches_played', 'last_played_round', 'consecutive_rest', 'consecutive_play', 'opted_rest'] as const) {
      if (actual[field] !== expected[field]) {
        playerMismatches.push({ playerId, field, expected: expected[field], actual: actual[field] })
      }
    }
  }

  const pairMismatches = []
  for (const [key, expected] of expectedPairRows) {
    const actual = pairHistoryRowsFromState(afterState).find((row) => pairKey(row) === key)
    if (!actual) {
      pairMismatches.push({ key, missing: true })
      continue
    }
    if (actual.partner_count !== expected.partner_count || actual.opponent_count !== expected.opponent_count) {
      pairMismatches.push({
        key,
        expected: {
          partner_count: expected.partner_count,
          opponent_count: expected.opponent_count,
        },
        actual: {
          partner_count: actual.partner_count,
          opponent_count: actual.opponent_count,
        },
      })
    }
  }

  const activeRound = afterState.rounds.find((round) => round.round_no === roundNo)
  const ok =
    Number(endPayload.live_state_version) === guard.liveStateVersion + 2
    && activeRound?.status === 'completed'
    && playerMismatches.length === 0
    && pairMismatches.length === 0

  console.log(JSON.stringify({
    ok,
    sessionId,
    roundNo,
    versionBefore: guard.liveStateVersion,
    versionAfter: Number(endPayload.live_state_version),
    changedPlayerStateRows: Array.isArray(endPayload.changed_player_state) ? endPayload.changed_player_state.length : null,
    changedPairHistoryRows: Array.isArray(endPayload.changed_pair_history) ? endPayload.changed_pair_history.length : null,
    playerMismatches: playerMismatches.slice(0, 20),
    pairMismatches: pairMismatches.slice(0, 20),
  }, null, 2))
  if (!ok) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
