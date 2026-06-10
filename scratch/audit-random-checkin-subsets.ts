import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator/index.ts'

const targets = process.argv.slice(2).map(value => {
  const [sessionId, rawCount] = value.split(':')
  return { sessionId, count: Number(rawCount) }
})
const RUNS = Number(process.env.SUBSET_RUNS ?? 12)
if (targets.length === 0) throw new Error('Usage: npx tsx scratch/audit-random-checkin-subsets.ts <session-id>:<count> [...]')

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

function seededShuffle<T>(values: T[], seed: number) {
  const result = [...values]
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function teamSum(team: [string, string], pvnaById: Map<string, number>) {
  return team.reduce((sum, playerId) => sum + (pvnaById.get(playerId) ?? 0), 0)
}

function intra(team: [string, string], pvnaById: Map<string, number>) {
  return Math.abs((pvnaById.get(team[0]) ?? 0) - (pvnaById.get(team[1]) ?? 0))
}

async function invokeSubset(sessionId: string, roster: any[], count: number, seed: number, token: string) {
  const selected = seededShuffle(roster, seed).slice(0, count)
  const playerRows = selected.map(row => ({
    session_id: sessionId,
    player_id: row.player_id,
    group_id: null,
    checked_in_at: new Date(0).toISOString(),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    players: row.players,
    session_players: { metadata: row.metadata ?? null },
  }))
  const courts = calculateOptimalCourts({
    n_players: count,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  }).recommended.courts
  const { data: session, error: sessionError } = await client
    .from('sessions')
    .select('live_state_version')
    .eq('id', sessionId)
    .single()
  if (sessionError) throw sessionError

  const startedAt = performance.now()
  const response = await fetch(`${url}/functions/v1/session-live-matches-suggest?session_id=${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      count: courts,
      court_count: courts,
      pvna_tolerance: 0.5,
      live_match_rows: [],
      live_state_version: Number(session.live_state_version ?? 0),
      completing_live_match_ids: [],
      players: selected.map(row => ({ id: row.player_id, name: row.players?.name ?? row.player_id })),
      player_rows: playerRows,
      pair_rows: [],
      round_rows: [],
    }),
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) throw new Error(`${sessionId} seed ${seed}: ${payload.error ?? response.status}`)
  const elapsedMs = performance.now() - startedAt
  const pvnaById = new Map(selected.map(row => [String(row.player_id), Number(row.players?.pvna ?? 0)]))
  const matches = (payload.payloads ?? []).map((match: any) => ({
    pvna: Math.abs(teamSum(match.team_a, pvnaById) - teamSum(match.team_b, pvnaById)),
    intra: Math.max(intra(match.team_a, pvnaById), intra(match.team_b, pvnaById)),
    warnings: match.warnings ?? [],
  }))
  return {
    seed,
    elapsedMs: Math.round(elapsedMs),
    maxPvna: Number(Math.max(0, ...matches.map((match: any) => match.pvna)).toFixed(2)),
    maxIntra: Number(Math.max(0, ...matches.map((match: any) => match.intra)).toFixed(2)),
    pvnaOver: matches.filter((match: any) => match.pvna > 0.5).length,
    intraOver: matches.filter((match: any) => match.intra > 0.75).length,
    warningMatches: matches.filter((match: any) => match.warnings.length > 0).length,
    selectedPvna: selected.map(row => Number(row.players?.pvna ?? 0)),
  }
}

async function main() {
  const { data: auth, error } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (error) throw error
  const token = auth.session?.access_token
  if (!token) throw new Error('Missing access token')

  const reports = []
  for (const target of targets) {
    const { data: roster, error: rosterError } = await client
      .from('session_players')
      .select('player_id, metadata, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', target.sessionId)
    if (rosterError) throw rosterError
    if (!roster || roster.length < target.count) throw new Error(`${target.sessionId}: roster too small`)
    const runs = []
    for (let seed = 1; seed <= RUNS; seed += 1) {
      runs.push(await invokeSubset(target.sessionId, roster, target.count, seed, token))
    }
    reports.push({
      sessionId: target.sessionId,
      checkedIn: target.count,
      runs: runs.length,
      timingMs: {
        avg: Math.round(runs.reduce((sum, run) => sum + run.elapsedMs, 0) / runs.length),
        max: Math.max(...runs.map(run => run.elapsedMs)),
      },
      quality: {
        cleanRuns: runs.filter(run => run.pvnaOver === 0 && run.intraOver === 0).length,
        runsWithPvnaOver: runs.filter(run => run.pvnaOver > 0).length,
        runsWithIntraOver: runs.filter(run => run.intraOver > 0).length,
        worstPvna: Math.max(...runs.map(run => run.maxPvna)),
        worstIntra: Math.max(...runs.map(run => run.maxIntra)),
      },
      worstRuns: [...runs]
        .sort((left, right) =>
          right.intraOver - left.intraOver ||
          right.pvnaOver - left.pvnaOver ||
          right.maxIntra - left.maxIntra ||
          right.maxPvna - left.maxPvna)
        .slice(0, 3),
    })
  }
  console.log(JSON.stringify(reports, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
