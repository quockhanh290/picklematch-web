import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '@/lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '@/lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRoundExperimental } from '@/features/host/session-detail/next-round-benchmark/experimental-suggest'

type SupabaseAny = any

type Args = {
  yes: boolean
  sessionId: string | null
  courts: number
}

type TestRow = {
  path: string
  ok: boolean
  ms: string
  before: number
  after: number
  delta: number
  detail: string
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

  const courts = Number(getValue('--courts') ?? '6')
  return {
    yes: args.includes('--yes'),
    sessionId: getValue('--session-id') ?? null,
    courts: Number.isFinite(courts) && courts > 0 ? Math.floor(courts) : 6,
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
    .select('id, created_at')
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
    if ((count ?? 0) >= 6) return String(session.id)
  }

  throw new Error(`No playable session found for ${HOST_EMAIL}`)
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
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? text)
  }
  return payload
}

async function getVersion(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('sessions')
    .select('live_state_version')
    .eq('id', sessionId)
    .single()
  if (error) throw error
  return Number(data.live_state_version)
}

async function getRoster(client: SupabaseAny, sessionId: string) {
  const [registeredResult, stateResult] = await Promise.all([
    client
      .from('session_players')
      .select('player_id, status, check_in_status')
      .eq('session_id', sessionId),
    client
      .from('session_player_state')
      .select('player_id, group_id, checked_out_at, opted_rest')
      .eq('session_id', sessionId)
      .order('player_id', { ascending: true }),
  ])
  if (registeredResult.error) throw registeredResult.error
  if (stateResult.error) throw stateResult.error

  const registeredIds = [...new Set((registeredResult.data ?? [])
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
  const rows = (stateResult.data ?? []).map((row: any) => ({
    player_id: String(row.player_id),
    group_id: row.group_id == null ? null : String(row.group_id),
    checked_out_at: row.checked_out_at,
    opted_rest: Boolean(row.opted_rest),
  }))
  const presentIds = rows.filter((row) => row.checked_out_at === null).map((row) => row.player_id)
  const checkedOutIds = rows.filter((row) => row.checked_out_at !== null).map((row) => row.player_id)
  return {
    registeredIds,
    rows,
    presentIds,
    checkedOutIds,
  }
}

async function ensureRoster(client: SupabaseAny, accessToken: string, sessionId: string) {
  const roster = await getRoster(client, sessionId)
  if (roster.registeredIds.length < 6) {
    throw new Error(`Need at least 6 registered players, found ${roster.registeredIds.length}`)
  }
  if (roster.presentIds.length < 6) {
    await invokeFunction('session-sync-roster', accessToken, sessionId, {
      player_ids: roster.registeredIds,
      revive_checked_out: true,
    })
  }
}

async function getStatus(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_rounds')
    .select('round_no, status')
    .eq('session_id', sessionId)
    .order('round_no', { ascending: true })
  if (error) throw error
  const active = (data ?? []).find((round: any) => round.status === 'active')
  return {
    activeRound: active ? Number(active.round_no) : null,
  }
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

async function buildPlan(client: SupabaseAny, sessionId: string, courts: number) {
  const state = await loadSessionState(client, sessionId, { courts })
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const suggestion = suggestNextRoundExperimental(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
    mode: 'cached-production',
  })
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available. warnings=${suggestion.warnings.join(',')}`)
  calculateOptimalCourts({
    n_players: [...state.players.values()].filter((player) => !player.checked_out_at).length,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  })
  return { state, alternative }
}

async function startVersioned(client: SupabaseAny, accessToken: string, sessionId: string, courts: number) {
  const plan = await buildPlan(client, sessionId, courts)
  const guard = await getVersionGuard(client, sessionId)
  const payload = await invokeFunction('session-rounds-start-versioned', accessToken, sessionId, {
    expected_live_state_version: guard.liveStateVersion,
    round_no: guard.currentRound,
    matches: plan.alternative.matches,
    resting: plan.alternative.resting,
    audit_payload: {
      benchmark: true,
      source: 'scratch/test-live-state-version-mutation-paths.ts',
    },
  })
  return Number(payload.round.round_no)
}

async function endVersioned(client: SupabaseAny, accessToken: string, sessionId: string, roundNo: number, courts: number) {
  const guard = await getVersionGuard(client, sessionId)
  const state = await loadSessionState(client, sessionId, { courts })
  const round = state.rounds.find((item) => item.round_no === roundNo && item.status === 'active')
  if (!round) throw new Error(`Active round ${roundNo} not found`)
  const existingPairs = pairHistoryRowsFromState(state)
  const committed = commitCompletedRound(state, round, existingPairs)
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
    ...state,
    current_round: Math.max(state.current_round, roundNo + 1),
    players: committed.players,
    rounds: state.rounds.map((item) =>
      item.round_no === roundNo
        ? {
            ...item,
            status: 'completed',
            ended_at: new Date(),
          }
        : item,
    ),
  }).total

  await invokeFunction('session-rounds-end-versioned', accessToken, sessionId, {
    expected_live_state_version: guard.liveStateVersion,
    round_no: roundNo,
    player_state: playerStatePayload,
    pair_history: pairHistoryPayload,
    score_after: scoreAfter,
    audit_payload: {
      benchmark: true,
      source: 'scratch/test-live-state-version-mutation-paths.ts',
    },
  }, { round_no: roundNo })
}

async function cleanupActiveRound(client: SupabaseAny, accessToken: string, sessionId: string, courts: number) {
  const status = await getStatus(client, sessionId)
  if (status.activeRound === null) return
  await endVersioned(client, accessToken, sessionId, status.activeRound, courts)
}

async function measure(
  client: SupabaseAny,
  sessionId: string,
  path: string,
  fn: () => Promise<string | void>,
): Promise<TestRow> {
  const before = await getVersion(client, sessionId)
  const startedAt = performance.now()
  let detail = ''
  try {
    detail = (await fn()) ?? ''
  } catch (error) {
    const after = await getVersion(client, sessionId)
    return {
      path,
      ok: false,
      ms: `${(performance.now() - startedAt).toFixed(0)}ms`,
      before,
      after,
      delta: after - before,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  const after = await getVersion(client, sessionId)
  const delta = after - before
  return {
    path,
    ok: delta === 1,
    ms: `${(performance.now() - startedAt).toFixed(0)}ms`,
    before,
    after,
    delta,
    detail,
  }
}

async function main() {
  const args = parseArgs()
  if (!args.yes) throw new Error('This test mutates live session data. Re-run with --yes to confirm.')

  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const userId = await getUserId(client)
  if (!userId) throw new Error('Missing host user id')
  const sessionId = args.sessionId ?? await latestPlayableSessionId(client, userId)

  await cleanupActiveRound(client, accessToken, sessionId, args.courts)
  await ensureRoster(client, accessToken, sessionId)

  const rows: TestRow[] = []
  let roster = await getRoster(client, sessionId)
  const [a, b, c, d, e, f] = roster.presentIds
  if (!a || !b || !c || !d || !e || !f) {
    throw new Error(`Need at least 6 present players, found ${roster.presentIds.length}`)
  }

  rows.push(await measure(client, sessionId, 'session-checkout', async () => {
    await invokeFunction('session-checkout', accessToken, sessionId, { player_id: f })
    return `player=${f}`
  }))

  rows.push(await measure(client, sessionId, 'session-checkin', async () => {
    await invokeFunction('session-checkin', accessToken, sessionId, { player_id: f })
    return `player=${f}`
  }))

  rows.push(await measure(client, sessionId, 'session-request-rest:on', async () => {
    await invokeFunction('session-request-rest', accessToken, sessionId, { player_id: e, opted_rest: true })
    return `player=${e}`
  }))

  rows.push(await measure(client, sessionId, 'session-request-rest:off', async () => {
    await invokeFunction('session-request-rest', accessToken, sessionId, { player_id: e, opted_rest: false })
    return `player=${e}`
  }))

  rows.push(await measure(client, sessionId, 'session-set-group:set', async () => {
    await invokeFunction('session-set-group', accessToken, sessionId, { player_ids: [a, b] })
    return `players=${a},${b}`
  }))

  const groupId = `${sessionId}:${[a, b].sort().join(':')}`
  rows.push(await measure(client, sessionId, 'session-set-group:clear-group', async () => {
    await invokeFunction('session-set-group', accessToken, sessionId, { clear_group_id: groupId })
    return `group=${groupId}`
  }))

  await invokeFunction('session-set-group', accessToken, sessionId, { player_ids: [c, d] })
  rows.push(await measure(client, sessionId, 'session-set-group:clear-player', async () => {
    await invokeFunction('session-set-group', accessToken, sessionId, { clear_player_id: c })
    return `player=${c}`
  }))
  await invokeFunction('session-set-group', accessToken, sessionId, {
    clear_group_id: `${sessionId}:${[c, d].sort().join(':')}`,
  })

  roster = await getRoster(client, sessionId)
  rows.push(await measure(client, sessionId, 'session-sync-roster:checkout-one', async () => {
    const withoutF = roster.registeredIds.filter((playerId) => playerId !== f)
    await invokeFunction('session-sync-roster', accessToken, sessionId, {
      player_ids: withoutF,
      revive_checked_out: false,
    })
    return `removed=${f}`
  }))

  rows.push(await measure(client, sessionId, 'session-sync-roster:revive-one', async () => {
    await invokeFunction('session-sync-roster', accessToken, sessionId, {
      player_ids: roster.registeredIds,
      revive_checked_out: true,
    })
    return `revived=${f}`
  }))

  rows.push(await measure(client, sessionId, 'session-rounds-start-versioned', async () => {
    const roundNo = await startVersioned(client, accessToken, sessionId, args.courts)
    return `round=${roundNo}`
  }))

  const activeAfterStart = await getStatus(client, sessionId)
  if (activeAfterStart.activeRound === null) {
    throw new Error('Expected active round after start-versioned test')
  }

  const state = await loadSessionState(client, sessionId, { courts: args.courts })
  const activeRound = state.rounds.find((round) => round.round_no === activeAfterStart.activeRound && round.status === 'active')
  if (!activeRound) throw new Error('Missing active round state')
  const playingIds = new Set(activeRound.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
  const outPlayerId = [...playingIds][0]
  const inPlayerId = roster.registeredIds.find((playerId) => !playingIds.has(playerId))
  if (!outPlayerId || !inPlayerId) {
    throw new Error('Need one playing player and one bench player for swap test')
  }

  rows.push(await measure(client, sessionId, 'session-rounds-swap-player', async () => {
    await invokeFunction('session-rounds-swap-player', accessToken, sessionId, {
      out_player_id: outPlayerId,
      in_player_id: inPlayerId,
    })
    return `out=${outPlayerId} in=${inPlayerId}`
  }))

  rows.push(await measure(client, sessionId, 'session-rounds-end-versioned', async () => {
    await endVersioned(client, accessToken, sessionId, activeAfterStart.activeRound!, args.courts)
    return `round=${activeAfterStart.activeRound}`
  }))
  await invokeFunction('session-checkin', accessToken, sessionId, { player_id: outPlayerId })

  console.log('Live state version mutation-path test')
  console.log({ sessionId, host: HOST_EMAIL })
  console.table(rows)

  const failed = rows.filter((row) => !row.ok)
  if (failed.length > 0) {
    throw new Error(`${failed.length}/${rows.length} mutation paths did not bump live_state_version by exactly 1`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
