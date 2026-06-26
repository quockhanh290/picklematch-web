import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

type AnyRow = Record<string, any>

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.EXPO_PUBLIC_SUPABASE_URL
  ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const HOST_ACCESS_TOKEN = process.env.HOST_ACCESS_TOKEN

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const sessionId = argValue('--session-id', '')
const courtCount = Math.max(1, Number(argValue('--courts', '6')))
const iterations = Math.max(1, Number(argValue('--iterations', '5')))
const currentRecoveryCalls = Math.max(1, Number(argValue('--current-recovery-calls', '14')))
const watchdogMs = Math.max(0, Number(argValue('--watchdog-ms', '2500')))

if (!sessionId) throw new Error('Usage: npx tsx scratch/simulate-preview-replacement-orchestration.ts --session-id=<id>')
if (!ANON_KEY) throw new Error('Missing Supabase anon key')

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

function summarize(values: number[]) {
  if (values.length === 0) return { n: 0, avg: 0, p50: 0, p95: 0, max: 0 }
  return {
    n: values.length,
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(Math.max(...values)),
  }
}

function playersIn(match: AnyRow) {
  return [...(match.team_a ?? []), ...(match.team_b ?? [])].map(String)
}

function hasPlayerOverlap(left: AnyRow, right: AnyRow) {
  const leftIds = new Set(playersIn(left))
  return playersIn(right).some(id => leftIds.has(id))
}

async function getClient() {
  if (HOST_ACCESS_TOKEN) {
    return createClient(SUPABASE_URL, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket as any },
      global: { headers: { Authorization: `Bearer ${HOST_ACCESS_TOKEN}` } },
    })
  }
  const client = createClient(SUPABASE_URL, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return client
}

async function getAccessToken(client: any) {
  if (HOST_ACCESS_TOKEN) return HOST_ACCESS_TOKEN
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  if (!data.session?.access_token) throw new Error('Missing access token')
  return data.session.access_token as string
}

async function loadSnapshot(client: any) {
  const { data, error } = await client.rpc('get_live_session_snapshot_versioned', {
    p_session_id: sessionId,
  })
  if (error) throw error
  return {
    liveStateVersion: Number(data.live_state_version ?? 0),
    playerRows: data.player_rows ?? [],
    pairRows: data.pair_rows ?? [],
    roundRows: data.round_rows ?? [],
    liveMatchRows: data.live_match_rows ?? [],
    players: (data.player_rows ?? []).map((row: AnyRow) => ({
      id: String(row.player_id),
      name: row.players?.name ?? String(row.player_id).slice(0, 8),
    })),
  }
}

async function invokeSuggest(accessToken: string, body: AnyRow) {
  const startedAt = now()
  const response = await fetch(`${SUPABASE_URL}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
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
    throw new Error(payload?.error ?? `Edge returned ${response.status}`)
  }
  return { payloads: payload.payloads ?? [], ms: now() - startedAt }
}

function buildSyntheticCompletingRows(snapshot: Awaited<ReturnType<typeof loadSnapshot>>, count: number) {
  const activeLiveRows = snapshot.liveMatchRows.filter((row: AnyRow) => row.status === 'live')
  const selected: AnyRow[] = []
  const usedCourts = new Set<number>()
  const usedPlayers = new Set<string>()

  for (const row of [...activeLiveRows, ...snapshot.liveMatchRows.slice().reverse()]) {
    const courtIdx = Number(row.court_idx)
    const playerIds = playersIn(row)
    if (!Number.isFinite(courtIdx) || usedCourts.has(courtIdx)) continue
    if (playerIds.length !== 4 || playerIds.some(id => usedPlayers.has(id))) continue
    selected.push({
      ...row,
      id: `sim-completing-${courtIdx}-${selected.length}`,
      status: 'live',
      court_idx: courtIdx,
      ended_at: null,
    })
    usedCourts.add(courtIdx)
    playerIds.forEach(id => usedPlayers.add(id))
    if (selected.length >= count) break
  }
  return selected
}

function baseBody(
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  liveRows: AnyRow[],
  completingIds: string[],
  count: number,
  courtIdxs: number[],
) {
  return {
    count,
    court_count: courtCount,
    pvna_tolerance: 0.5,
    court_idxs: courtIdxs,
    live_match_rows: liveRows,
    live_state_version: snapshot.liveStateVersion,
    completing_live_match_ids: completingIds,
    players: snapshot.players,
    player_rows: snapshot.playerRows,
    pair_rows: snapshot.pairRows,
    round_rows: snapshot.roundRows,
  }
}

async function simulateProposed(
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  accessToken: string,
  completingRows: AnyRow[],
) {
  const retained: AnyRow[] = []
  const edgeTimes: number[] = []
  let calls = 0
  let retries = 0
  let overlapFailures = 0
  let missing = 0
  const startedAt = now()

  for (const completing of completingRows) {
    const retainedBusyRows = retained.map((row, index) => ({
      ...row,
      id: `sim-retained-${index}-${row.court_idx}`,
      status: 'suggested',
    }))
    const liveRows = [
      ...snapshot.liveMatchRows.filter((row: AnyRow) =>
        row.status === 'live' && !completingRows.some(item => item.court_idx === row.court_idx),
      ),
      ...completingRows,
      ...retainedBusyRows,
    ]
    const body = baseBody(snapshot, liveRows, completingRows.map(row => row.id), 1, [Number(completing.court_idx)])
    let result = await invokeSuggest(accessToken, body)
    calls += 1
    edgeTimes.push(result.ms)
    if (result.payloads.length === 0) {
      result = await invokeSuggest(accessToken, body)
      calls += 1
      retries += 1
      edgeTimes.push(result.ms)
    }
    const match = result.payloads[0]
    if (!match) {
      missing += 1
      continue
    }
    if (retained.some(existing => hasPlayerOverlap(existing, match))) overlapFailures += 1
    retained.push(match)
  }

  return {
    totalMs: now() - startedAt,
    edgeTimes,
    calls,
    retries,
    missing,
    overlapFailures,
    returnedCourts: retained.map(row => Number(row.court_idx)),
  }
}

async function simulateCurrentRecovery(
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  accessToken: string,
  completingRows: AnyRow[],
) {
  const liveRows = [
    ...snapshot.liveMatchRows.filter((row: AnyRow) =>
      row.status === 'live' && !completingRows.some(item => item.court_idx === row.court_idx),
    ),
    ...completingRows,
  ]
  const body = baseBody(
    snapshot,
    liveRows,
    completingRows.map(row => row.id),
    completingRows.length,
    completingRows.map(row => Number(row.court_idx)),
  )
  const edgeTimes: number[] = []
  let missing = 0
  let overlapFailures = 0
  let firstPayloads: AnyRow[] = []
  const startedAt = now()

  for (let index = 0; index < currentRecoveryCalls; index += 1) {
    const result = await invokeSuggest(accessToken, body)
    edgeTimes.push(result.ms)
    if (index === 0) firstPayloads = result.payloads
    if (result.payloads.length < completingRows.length) missing += 1
    for (let left = 0; left < result.payloads.length; left += 1) {
      for (let right = left + 1; right < result.payloads.length; right += 1) {
        if (hasPlayerOverlap(result.payloads[left], result.payloads[right])) overlapFailures += 1
      }
    }
  }

  return {
    totalMs: watchdogMs + (now() - startedAt),
    edgeTimes,
    calls: currentRecoveryCalls,
    missing,
    overlapFailures,
    returnedCourts: firstPayloads.map(row => Number(row.court_idx)),
  }
}

async function main() {
  const client = await getClient()
  const accessToken = await getAccessToken(client)
  const snapshot = await loadSnapshot(client)
  const scenarioResults: AnyRow[] = []

  for (const completingCount of [1, 2, 3]) {
    const completingRows = buildSyntheticCompletingRows(snapshot, completingCount)
    if (completingRows.length < completingCount) continue
    const proposedRuns = []
    const currentRuns = []
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      proposedRuns.push(await simulateProposed(snapshot, accessToken, completingRows))
      currentRuns.push(await simulateCurrentRecovery(snapshot, accessToken, completingRows))
    }
    scenarioResults.push({
      completingCount,
      completingCourts: completingRows.map(row => Number(row.court_idx)),
      proposed: {
        totalMs: summarize(proposedRuns.map(run => run.totalMs)),
        edgeMs: summarize(proposedRuns.flatMap(run => run.edgeTimes)),
        callsPerCycle: summarize(proposedRuns.map(run => run.calls)),
        retries: proposedRuns.reduce((sum, run) => sum + run.retries, 0),
        missing: proposedRuns.reduce((sum, run) => sum + run.missing, 0),
        overlapFailures: proposedRuns.reduce((sum, run) => sum + run.overlapFailures, 0),
        returnedCourts: proposedRuns.map(run => run.returnedCourts),
      },
      currentRecovery: {
        totalMs: summarize(currentRuns.map(run => run.totalMs)),
        edgeMs: summarize(currentRuns.flatMap(run => run.edgeTimes)),
        callsPerCycle: summarize(currentRuns.map(run => run.calls)),
        missingRuns: currentRuns.reduce((sum, run) => sum + run.missing, 0),
        overlapFailures: currentRuns.reduce((sum, run) => sum + run.overlapFailures, 0),
        returnedCourts: currentRuns.map(run => run.returnedCourts),
      },
    })
  }

  console.log(JSON.stringify({
    sessionId,
    liveStateVersion: snapshot.liveStateVersion,
    snapshot: {
      players: snapshot.playerRows.length,
      live: snapshot.liveMatchRows.filter((row: AnyRow) => row.status === 'live').length,
      completed: snapshot.liveMatchRows.filter((row: AnyRow) => row.status === 'completed').length,
    },
    config: { courtCount, iterations, currentRecoveryCalls, watchdogMs },
    scenarios: scenarioResults,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
