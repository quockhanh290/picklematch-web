import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'

type SupabaseAny = any

type StepTiming = {
  step: string
  ms: number
  detail?: Record<string, unknown>
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

async function timed<T>(rows: StepTiming[], step: string, fn: () => Promise<{ value: T; detail?: Record<string, unknown> }>) {
  const startedAt = now()
  const result = await fn()
  rows.push({ step, ms: now() - startedAt, detail: result.detail })
  return result.value
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
    if ((count ?? 0) >= 8) return String(session.id)
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

async function getRoster(client: SupabaseAny, sessionId: string) {
  const [registeredResult, stateResult] = await Promise.all([
    client
      .from('session_players')
      .select('player_id, status, check_in_status')
      .eq('session_id', sessionId),
    client
      .from('session_player_state')
      .select('player_id, checked_out_at, opted_rest')
      .eq('session_id', sessionId)
      .order('player_id', { ascending: true }),
  ])
  if (registeredResult.error) throw registeredResult.error
  if (stateResult.error) throw stateResult.error

  const registeredIds = [...new Set<string>((registeredResult.data ?? [])
    .filter((row: any) => (row.status === 'confirmed' || row.status == null) && row.check_in_status !== 'no_show')
    .map((row: any) => String(row.player_id)))]
  const rows = (stateResult.data ?? []).map((row: any) => ({
    player_id: String(row.player_id),
    checked_out_at: row.checked_out_at,
    opted_rest: Boolean(row.opted_rest),
  }))
  const presentIds = rows
    .filter((row: { checked_out_at: string | null }) => row.checked_out_at === null)
    .map((row: { player_id: string }) => row.player_id)
  return { registeredIds, rows, presentIds }
}

async function ensureRoster(client: SupabaseAny, accessToken: string, sessionId: string) {
  const roster = await getRoster(client, sessionId)
  if (roster.registeredIds.length < 8) {
    throw new Error(`Need at least 8 registered players, found ${roster.registeredIds.length}`)
  }
  if (roster.presentIds.length < 8) {
    await invokeFunction('session-sync-roster', accessToken, sessionId, {
      player_ids: roster.registeredIds,
      revive_checked_out: true,
    })
  }
}

async function getActiveRound(client: SupabaseAny, sessionId: string) {
  const { data, error } = await client
    .from('session_rounds')
    .select('round_no, status')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data ? Number(data.round_no) : null
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

async function buildTimedPlan(client: SupabaseAny, sessionId: string, courts: number, label: string) {
  const rows: StepTiming[] = []
  const court = await timed(rows, `${label}:court-calculator`, async () => {
    const roster = await getRoster(client, sessionId)
    const result = calculateOptimalCourts({
      n_players: roster.presentIds.length,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })
    return {
      value: result,
      detail: {
        present: roster.presentIds.length,
        recommendedCourts: result.recommended.courts,
      },
    }
  })
  const state = await timed(rows, `${label}:load-session-state`, async () => {
    const value = await loadSessionState(client, sessionId, {
      courts,
      pvnaTolerance: 0.5,
    })
    return {
      value,
      detail: {
        players: value.players.size,
        rounds: value.rounds.length,
        courts,
      },
    }
  })
  const adjusted = await timed(rows, `${label}:fairness-correction`, async () => {
    const adjustment = correctForFairness(state)
    return {
      value: {
        adjustment,
        adjustedState: applyFairnessAdjustment(state, adjustment),
      },
      detail: {
        overrides: Object.keys(adjustment.tier_overrides).length,
      },
    }
  })
  const suggestion = await timed(rows, `${label}:suggest-next-round`, async () => {
    const value = suggestNextRoundExperimental(adjusted.adjustedState, {
      tier_overrides: adjusted.adjustment.tier_overrides,
      mode: 'cached-production',
    })
    return {
      value,
      detail: {
        alternatives: value.alternatives.length,
        generated: value.diagnostic.generated,
        evaluated: value.diagnostic.evaluatedCandidates,
        accepted: value.diagnostic.acceptedCandidates,
        partitionIterations: value.diagnostic.partitionIterations,
      },
    }
  })
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available. warnings=${suggestion.warnings.join(',')}`)
  return {
    court,
    state,
    suggestion,
    alternative,
    rows,
  }
}

async function cleanupActiveRound(client: SupabaseAny, accessToken: string, sessionId: string, courts: number) {
  const activeRound = await getActiveRound(client, sessionId)
  if (activeRound === null) return
  const guard = await getVersionGuard(client, sessionId)
  const state = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
  const round = state.rounds.find((item) => item.round_no === activeRound && item.status === 'active')
  if (!round) throw new Error(`Active round ${activeRound} not found`)
  const existingPairs = pairHistoryRowsFromState(state)
  const committed = commitCompletedRound(state, round, existingPairs)
  await invokeFunction('session-rounds-end-versioned', accessToken, sessionId, {
    expected_live_state_version: guard.liveStateVersion,
    round_no: activeRound,
    player_state: [...committed.players.values()].map((player) => ({
      player_id: player.player_id,
      matches_played: player.matches_played,
      last_played_round: player.last_played_round,
      consecutive_rest: player.consecutive_rest,
      consecutive_play: player.consecutive_play,
      opted_rest: player.opted_rest,
    })),
    pair_history: changedPairHistoryRows(existingPairs, committed.pairHistory),
    score_after: computeSessionFairness({
      ...state,
      current_round: Math.max(state.current_round, activeRound + 1),
      players: committed.players,
    }).total,
    audit_payload: { benchmark: true, source: 'scratch/measure-next-round-full-flow.ts', cleanup: true },
  }, { round_no: activeRound })
}

async function main() {
  const courts = Math.max(1, Number(argValue('--courts', '6')))
  const explicitSessionId = argValue('--session-id')
  const cases = (argValue(
    '--cases',
    'rest-on,checkout,late-checkin,set-group,clear-group,sync-checkout,sync-revive',
  ) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const client = await getHostClient()
  const accessToken = await getAccessToken(client)
  const userId = await getUserId(client)
  if (!userId) throw new Error('Missing host user id')
  const sessionId = explicitSessionId ?? await latestPlayableSessionId(client, userId)

  async function invokeMeasured(rows: StepTiming[], step: string, fn: () => Promise<Record<string, unknown>>) {
    const versionBefore = await timed(rows, `${step}:version-before`, async () => {
      const value = await getVersion(client, sessionId)
      return { value, detail: { live_state_version: value } }
    })
    const mutationDetail = await timed(rows, step, async () => {
      const detail = await fn()
      return { value: detail, detail }
    })
    const versionAfter = await timed(rows, `${step}:version-after`, async () => {
      const value = await getVersion(client, sessionId)
      return {
        value,
        detail: {
          live_state_version: value,
          versionBefore,
          delta: value - versionBefore,
        },
      }
    })
    return { ...mutationDetail, versionBefore, versionAfter, delta: versionAfter - versionBefore }
  }

  async function setupCase(caseName: string, rows: StepTiming[]) {
    await cleanupActiveRound(client, accessToken, sessionId, courts)
    await ensureRoster(client, accessToken, sessionId)
    let roster = await getRoster(client, sessionId)
    const [a, b, c] = roster.presentIds
    if (!a || !b || !c) throw new Error(`Case ${caseName} needs at least 3 present players`)

    if (caseName === 'late-checkin') {
      await invokeFunction('session-checkout', accessToken, sessionId, { player_id: c })
    }
    if (caseName === 'clear-group') {
      await invokeFunction('session-set-group', accessToken, sessionId, { player_ids: [a, b] })
    }
    if (caseName === 'sync-revive') {
      await invokeFunction('session-sync-roster', accessToken, sessionId, {
        player_ids: roster.registeredIds.filter((playerId) => playerId !== c),
        revive_checked_out: false,
      })
    }

    roster = await getRoster(client, sessionId)
    return {
      a: roster.presentIds[0],
      b: roster.presentIds[1],
      c: roster.presentIds[2] ?? roster.registeredIds[2],
      registeredIds: roster.registeredIds,
    }
  }

  async function runMutationCase(caseName: string, rows: StepTiming[], players: { a: string; b: string; c: string; registeredIds: string[] }) {
    if (caseName === 'rest-on') {
      await invokeMeasured(rows, 'mutation:request-rest-on', async () => {
        await invokeFunction('session-request-rest', accessToken, sessionId, { player_id: players.c, opted_rest: true })
        return { player: players.c }
      })
      return async () => invokeFunction('session-request-rest', accessToken, sessionId, { player_id: players.c, opted_rest: false })
    }

    if (caseName === 'checkout') {
      await invokeMeasured(rows, 'mutation:checkout', async () => {
        await invokeFunction('session-checkout', accessToken, sessionId, { player_id: players.c })
        return { player: players.c }
      })
      return async () => invokeFunction('session-checkin', accessToken, sessionId, { player_id: players.c })
    }

    if (caseName === 'late-checkin') {
      await invokeMeasured(rows, 'mutation:late-checkin', async () => {
        await invokeFunction('session-checkin', accessToken, sessionId, { player_id: players.c })
        return { player: players.c }
      })
      return async () => undefined
    }

    if (caseName === 'set-group') {
      await invokeMeasured(rows, 'mutation:set-group', async () => {
        await invokeFunction('session-set-group', accessToken, sessionId, { player_ids: [players.a, players.b] })
        return { players: [players.a, players.b] }
      })
      return async () => invokeFunction('session-set-group', accessToken, sessionId, { clear_group_id: `${sessionId}:${[players.a, players.b].sort().join(':')}` })
    }

    if (caseName === 'clear-group') {
      await invokeMeasured(rows, 'mutation:clear-group', async () => {
        await invokeFunction('session-set-group', accessToken, sessionId, { clear_group_id: `${sessionId}:${[players.a, players.b].sort().join(':')}` })
        return { players: [players.a, players.b] }
      })
      return async () => undefined
    }

    if (caseName === 'sync-checkout') {
      await invokeMeasured(rows, 'mutation:sync-roster-checkout-one', async () => {
        await invokeFunction('session-sync-roster', accessToken, sessionId, {
          player_ids: players.registeredIds.filter((playerId) => playerId !== players.c),
          revive_checked_out: false,
        })
        return { player: players.c }
      })
      return async () => invokeFunction('session-sync-roster', accessToken, sessionId, { player_ids: players.registeredIds, revive_checked_out: true })
    }

    if (caseName === 'sync-revive') {
      await invokeMeasured(rows, 'mutation:sync-roster-revive-one', async () => {
        await invokeFunction('session-sync-roster', accessToken, sessionId, { player_ids: players.registeredIds, revive_checked_out: true })
        return { player: players.c }
      })
      return async () => undefined
    }

    throw new Error(`Unknown case: ${caseName}`)
  }

  async function runRound(rows: StepTiming[], plan: Awaited<ReturnType<typeof buildTimedPlan>>) {
    const startPayload = await timed(rows, 'start-round-versioned', async () => {
      const guard = await getVersionGuard(client, sessionId)
      if (guard.activeRoundNo !== null) throw new Error(`Cannot start: round ${guard.activeRoundNo} active`)
      const payload = await invokeFunction('session-rounds-start-versioned', accessToken, sessionId, {
        expected_live_state_version: guard.liveStateVersion,
        round_no: guard.currentRound,
        matches: plan.alternative.matches,
        resting: plan.alternative.resting,
        audit_payload: {
          benchmark: true,
          source: 'scratch/measure-next-round-full-flow.ts',
        },
      })
      return { value: payload, detail: { round: payload.round?.round_no, live_state_version: payload.live_state_version } }
    })

    const startedState = await timed(rows, 'after-start:reload-live-state', async () => {
      const value = await loadSessionState(client, sessionId, { courts, pvnaTolerance: 0.5 })
      return { value, detail: { rounds: value.rounds.length, players: value.players.size } }
    })
    const activeRoundNo = Number(startPayload.round?.round_no)
    const activeRound = startedState.rounds.find((round) => round.round_no === activeRoundNo && round.status === 'active')
    if (!activeRound) throw new Error(`Round ${activeRoundNo} not active after start`)

    const endPayload = await timed(rows, 'end-round-versioned', async () => {
      const existingPairs = pairHistoryRowsFromState(startedState)
      const committed = commitCompletedRound(startedState, activeRound, existingPairs)
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
        current_round: Math.max(startedState.current_round, activeRoundNo + 1),
        players: committed.players,
        rounds: startedState.rounds.map((round) =>
          round.round_no === activeRoundNo
            ? { ...round, status: 'completed' as const, ended_at: new Date() }
            : round,
        ),
      }).total
      const payload = await invokeFunction('session-rounds-end-versioned', accessToken, sessionId, {
        expected_live_state_version: Number(startPayload.live_state_version),
        round_no: activeRoundNo,
        player_state: playerStatePayload,
        pair_history: pairHistoryPayload,
        score_after: scoreAfter,
        audit_payload: {
          benchmark: true,
          source: 'scratch/measure-next-round-full-flow.ts',
        },
      }, { round_no: activeRoundNo })
      return {
        value: payload,
        detail: {
          round: activeRoundNo,
          live_state_version: payload.live_state_version,
          playerUpdates: playerStatePayload.length,
          pairUpdates: pairHistoryPayload.length,
        },
      }
    })

    return { startRound: startPayload.round?.round_no, endVersion: endPayload.live_state_version }
  }

  const reports = []
  for (const caseName of cases) {
    const rows: StepTiming[] = []
    const caseStartedAt = now()

    const players = await timed(rows, 'ensure-roster', async () => {
      const value = await setupCase(caseName, rows)
      const roster = await getRoster(client, sessionId)
      return { value, detail: { present: roster.presentIds.length, registered: roster.registeredIds.length } }
    })

    const beforePlan = await buildTimedPlan(client, sessionId, courts, 'before-mutation')
    rows.push(...beforePlan.rows)
    const cleanup = await runMutationCase(caseName, rows, players)
    const afterMutationPlan = await buildTimedPlan(client, sessionId, courts, 'after-mutation')
    rows.push(...afterMutationPlan.rows)
    const round = await runRound(rows, afterMutationPlan)

    await timed(rows, `cleanup:${caseName}`, async () => {
      await cleanup()
      return { value: null }
    })

    reports.push({
      case: caseName,
      startRound: round.startRound,
      endVersion: round.endVersion,
      totalWallMs: Math.round(now() - caseStartedAt),
      totalMeasuredStepMs: Math.round(rows.reduce((sum, row) => sum + row.ms, 0)),
      steps: rows.map((row) => ({
        step: row.step,
        ms: Math.round(row.ms),
        detail: row.detail ?? {},
      })),
    })
  }

  console.log(JSON.stringify({
    sessionId,
    host: HOST_EMAIL,
    courts,
    cases,
    reports,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
