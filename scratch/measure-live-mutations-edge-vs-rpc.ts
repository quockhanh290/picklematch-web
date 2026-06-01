import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'

type SupabaseAny = any
type Row = { path: string; transport: 'edge' | 'rpc'; ms: number; before: number; after: number; delta: number; ok: boolean; detail?: string }

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

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
  const { data, error } = await client.from('sessions').select('id').eq('host_id', hostUserId).order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  for (const session of data ?? []) {
    const { count, error: countError } = await client.from('session_players').select('player_id', { count: 'exact', head: true }).eq('session_id', session.id)
    if (countError) throw countError
    if ((count ?? 0) >= 8) return String(session.id)
  }
  throw new Error(`No playable session found for ${HOST_EMAIL}`)
}

async function getVersion(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.from('sessions').select('live_state_version').eq('id', sessionId).single()
  if (error) throw error
  return Number(data.live_state_version)
}

async function getRoster(client: SupabaseAny, sessionId: string) {
  const [registered, state] = await Promise.all([
    client.from('session_players').select('player_id, status, check_in_status').eq('session_id', sessionId),
    client.from('session_player_state').select('player_id, checked_out_at').eq('session_id', sessionId).order('player_id', { ascending: true }),
  ])
  if (registered.error) throw registered.error
  if (state.error) throw state.error
  const registeredIds = [...new Set((registered.data ?? [])
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
  const presentIds = (state.data ?? []).filter((row: any) => row.checked_out_at === null).map((row: any) => String(row.player_id))
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

async function measure(client: SupabaseAny, sessionId: string, rows: Row[], path: string, transport: Row['transport'], fn: () => Promise<unknown>, expectedDelta = 1) {
  const before = await getVersion(client, sessionId)
  const startedAt = now()
  try {
    await fn()
    const ms = now() - startedAt
    const after = await getVersion(client, sessionId)
    rows.push({ path, transport, ms, before, after, delta: after - before, ok: after - before === expectedDelta })
  } catch (error) {
    const ms = now() - startedAt
    const after = await getVersion(client, sessionId).catch(() => before)
    rows.push({ path, transport, ms, before, after, delta: after - before, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

async function ensureRoster(client: SupabaseAny, accessToken: string, sessionId: string) {
  const roster = await getRoster(client, sessionId)
  if (roster.presentIds.length >= 8) return roster
  await invokeEdge('session-sync-roster', accessToken, sessionId, { player_ids: roster.registeredIds, revive_checked_out: true })
  return getRoster(client, sessionId)
}

async function rpc(client: SupabaseAny, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw error
  return data
}

async function getVersionGuard(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client.rpc('get_live_session_version_guard', { p_session_id: sessionId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { liveStateVersion: Number(row.live_state_version), currentRound: Number(row.current_round), activeRoundNo: row.active_round_no == null ? null : Number(row.active_round_no) }
}

function changedPairHistoryRows(beforeRows: any[], afterRows: any[]) {
  const beforeByKey = new Map(beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]))
  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before || before.partner_count !== row.partner_count || before.opponent_count !== row.opponent_count
  })
}

async function startRoundRpc(client: SupabaseAny, sessionId: string, courts: number) {
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const suggestion = suggestNextRoundExperimental(adjustedState, { tier_overrides: adjustment.tier_overrides, mode: 'cached-production' })
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error('No suggestion available')
  const guard = await getVersionGuard(client, sessionId)
  return rpc(client, 'start_live_session_round_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: guard.liveStateVersion,
    p_round_no: guard.currentRound,
    p_matches: alternative.matches,
    p_resting: alternative.resting,
    p_audit_payload: { benchmark: true, source: 'scratch/measure-live-mutations-edge-vs-rpc.ts' },
  })
}

async function endRoundRpc(client: SupabaseAny, sessionId: string, courts: number) {
  const guard = await getVersionGuard(client, sessionId)
  if (guard.activeRoundNo === null) return
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const round = state.rounds.find((item) => item.round_no === guard.activeRoundNo && item.status === 'active')
  if (!round) throw new Error('Missing active round')
  const existingPairs = pairHistoryRowsFromState(state)
  const committed = commitCompletedRound(state, round, existingPairs)
  const scoreAfter = computeSessionFairness({ ...state, current_round: Math.max(state.current_round, guard.activeRoundNo + 1), players: committed.players }).total
  return rpc(client, 'complete_live_session_round_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: guard.liveStateVersion,
    p_round_no: guard.activeRoundNo,
    p_player_state: [...committed.players.values()].map((player) => ({
      player_id: player.player_id,
      matches_played: player.matches_played,
      last_played_round: player.last_played_round,
      consecutive_rest: player.consecutive_rest,
      consecutive_play: player.consecutive_play,
      opted_rest: player.opted_rest,
    })),
    p_pair_history: changedPairHistoryRows(existingPairs, committed.pairHistory),
    p_score_after: scoreAfter,
    p_audit_payload: { benchmark: true, source: 'scratch/measure-live-mutations-edge-vs-rpc.ts' },
  })
}

async function main() {
  const sessionIdArg = argValue('--session-id')
  const courts = Math.max(1, Number(argValue('--courts', '6')))
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const userId = await getUserId(client)
  if (!userId) throw new Error('Missing host user id')
  const sessionId = sessionIdArg ?? await latestPlayableSessionId(client, userId)
  const rows: Row[] = []

  await endRoundRpc(client, sessionId, courts)
  let roster = await ensureRoster(client, accessToken, sessionId)
  const [a, b, c, d, e, f] = roster.presentIds
  if (!a || !b || !c || !d || !e || !f) throw new Error('Need at least 6 present players')

  await measure(client, sessionId, rows, 'checkout', 'edge', () => invokeEdge('session-checkout', accessToken, sessionId, { player_id: f }))
  await measure(client, sessionId, rows, 'checkin', 'edge', () => invokeEdge('session-checkin', accessToken, sessionId, { player_id: f }))
  await measure(client, sessionId, rows, 'checkout', 'rpc', () => rpc(client, 'checkout_live_session_players_versioned', { p_session_id: sessionId, p_player_ids: [f] }))
  await measure(client, sessionId, rows, 'checkin', 'rpc', () => rpc(client, 'checkin_live_session_players_versioned', { p_session_id: sessionId, p_player_ids: [f], p_group_with: [] }))

  await measure(client, sessionId, rows, 'request-rest:on', 'edge', () => invokeEdge('session-request-rest', accessToken, sessionId, { player_id: e, opted_rest: true }))
  await measure(client, sessionId, rows, 'request-rest:off', 'edge', () => invokeEdge('session-request-rest', accessToken, sessionId, { player_id: e, opted_rest: false }))
  await measure(client, sessionId, rows, 'request-rest:on', 'rpc', () => rpc(client, 'set_live_session_player_rest_versioned', { p_session_id: sessionId, p_player_id: e, p_opted_rest: true }))
  await measure(client, sessionId, rows, 'request-rest:off', 'rpc', () => rpc(client, 'set_live_session_player_rest_versioned', { p_session_id: sessionId, p_player_id: e, p_opted_rest: false }))

  await measure(client, sessionId, rows, 'set-group', 'edge', () => invokeEdge('session-set-group', accessToken, sessionId, { player_ids: [a, b] }))
  await measure(client, sessionId, rows, 'clear-group', 'edge', () => invokeEdge('session-set-group', accessToken, sessionId, { clear_group_id: `${sessionId}:${[a, b].sort().join(':')}` }))
  await measure(client, sessionId, rows, 'set-group', 'rpc', () => rpc(client, 'set_live_session_group_versioned', { p_session_id: sessionId, p_player_ids: [a, b] }))
  await measure(client, sessionId, rows, 'clear-group', 'rpc', () => rpc(client, 'set_live_session_group_versioned', { p_session_id: sessionId, p_clear_group_id: `${sessionId}:${[a, b].sort().join(':')}` }))

  roster = await getRoster(client, sessionId)
  await measure(client, sessionId, rows, 'sync-roster:checkout-one', 'edge', () => invokeEdge('session-sync-roster', accessToken, sessionId, { player_ids: roster.registeredIds.filter((id) => id !== f), revive_checked_out: false }))
  await measure(client, sessionId, rows, 'sync-roster:revive-one', 'edge', () => invokeEdge('session-sync-roster', accessToken, sessionId, { player_ids: roster.registeredIds, revive_checked_out: true }))
  await measure(client, sessionId, rows, 'sync-roster:checkout-one', 'rpc', () => rpc(client, 'sync_live_session_roster_versioned', { p_session_id: sessionId, p_player_ids: roster.registeredIds.filter((id) => id !== f), p_revive_checked_out: false }))
  await measure(client, sessionId, rows, 'sync-roster:revive-one', 'rpc', () => rpc(client, 'sync_live_session_roster_versioned', { p_session_id: sessionId, p_player_ids: roster.registeredIds, p_revive_checked_out: true }))

  await startRoundRpc(client, sessionId, courts)
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const active = state.rounds.find((round) => round.status === 'active')
  if (!active) throw new Error('Missing active round for swap test')
  const playing = new Set(active.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
  const outPlayer = [...playing][0]
  const inPlayer = roster.registeredIds.find((id) => !playing.has(id))
  if (!outPlayer || !inPlayer) throw new Error('Missing swap players')
  await measure(client, sessionId, rows, 'swap-player', 'edge', () => invokeEdge('session-rounds-swap-player', accessToken, sessionId, { out_player_id: outPlayer, in_player_id: inPlayer }))
  await endRoundRpc(client, sessionId, courts)

  await startRoundRpc(client, sessionId, courts)
  const state2 = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const active2 = state2.rounds.find((round) => round.status === 'active')
  if (!active2) throw new Error('Missing active round for direct swap test')
  const playing2 = new Set(active2.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
  const outPlayer2 = [...playing2][0]
  const inPlayer2 = roster.registeredIds.find((id) => !playing2.has(id))
  if (!outPlayer2 || !inPlayer2) throw new Error('Missing direct swap players')
  await measure(client, sessionId, rows, 'swap-player', 'rpc', () => rpc(client, 'swap_live_session_round_player_versioned', { p_session_id: sessionId, p_out_player_id: outPlayer2, p_in_player_id: inPlayer2 }))
  await endRoundRpc(client, sessionId, courts)

  console.log(JSON.stringify({
    sessionId,
    host: HOST_EMAIL,
    rows: rows.map((row) => ({ ...row, ms: Math.round(row.ms) })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
