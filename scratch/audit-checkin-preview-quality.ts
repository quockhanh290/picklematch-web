import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator/index.ts'

const targets = process.argv.slice(2).map(value => {
  const [sessionId, rawCount] = value.split(':')
  return { sessionId, count: Number(rawCount) }
})
if (targets.length === 0 || targets.some(target => !target.sessionId || !Number.isFinite(target.count))) {
  throw new Error('Usage: npx tsx scratch/audit-checkin-preview-quality.ts <session-id>:<count> [...]')
}

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

function teamSum(team: [string, string], pvnaById: Map<string, number>) {
  return team.reduce((sum, playerId) => sum + (pvnaById.get(playerId) ?? 0), 0)
}

function intra(team: [string, string], pvnaById: Map<string, number>) {
  return Math.abs((pvnaById.get(team[0]) ?? 0) - (pvnaById.get(team[1]) ?? 0))
}

async function auditTarget(sessionId: string, requestedCount: number) {
  const { data: roster, error: rosterError } = await client
    .from('session_players')
    .select('player_id, created_at, players(name, pvna)')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (rosterError) throw rosterError
  if (!roster || roster.length < requestedCount) {
    throw new Error(`${sessionId}: requested ${requestedCount}, roster has ${roster?.length ?? 0}`)
  }

  const checkedIn = roster.slice(0, requestedCount)
  const checkedInIds = checkedIn.map(row => String(row.player_id))
  const checkedOutIds = roster.slice(requestedCount).map(row => String(row.player_id))

  const { error: presentError } = await client
    .from('session_players')
    .update({ check_in_status: 'present' })
    .eq('session_id', sessionId)
    .in('player_id', checkedInIds)
  if (presentError) throw presentError
  if (checkedOutIds.length > 0) {
    const { error: pendingError } = await client
      .from('session_players')
      .update({ check_in_status: 'pending' })
      .eq('session_id', sessionId)
      .in('player_id', checkedOutIds)
    if (pendingError) throw pendingError
  }

  const syncStartedAt = performance.now()
  const { error: syncError } = await client.rpc('sync_live_session_roster_versioned', {
    p_session_id: sessionId,
    p_player_ids: checkedInIds,
    p_revive_checked_out: false,
  })
  if (syncError) throw syncError
  const syncMs = performance.now() - syncStartedAt

  const { error: sessionError } = await client
    .from('sessions')
    .update({ status: 'playing', check_in_completed: true })
    .eq('id', sessionId)
  if (sessionError) throw sessionError

  const [sessionResult, playersResult, pairsResult, roundsResult, liveResult] = await Promise.all([
    client.from('sessions').select('live_state_version').eq('id', sessionId).single(),
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client.from('session_pair_history').select('session_id, player_a, player_b, partner_count, opponent_count').eq('session_id', sessionId),
    client.from('session_rounds').select('id, session_id, round_no, status, matches, resting, started_at, ended_at').eq('session_id', sessionId),
    client.from('session_live_matches').select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at').eq('session_id', sessionId),
  ])
  const loadError = sessionResult.error ?? playersResult.error ?? pairsResult.error ?? roundsResult.error ?? liveResult.error
  if (loadError) throw loadError

  const playerRows = playersResult.data ?? []
  const courts = calculateOptimalCourts({
    n_players: playerRows.length,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  }).recommended.courts
  const { data: auth } = await client.auth.getSession()
  const token = auth.session?.access_token
  if (!token) throw new Error('Missing access token')

  const edgeStartedAt = performance.now()
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
      live_match_rows: liveResult.data ?? [],
      live_state_version: Number(sessionResult.data?.live_state_version ?? 0),
      completing_live_match_ids: [],
      players: playerRows.map((row: any) => ({
        id: row.player_id,
        name: row.players?.name ?? String(row.player_id).slice(0, 8),
      })),
      player_rows: playerRows,
      pair_rows: pairsResult.data ?? [],
      round_rows: roundsResult.data ?? [],
    }),
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) throw new Error(`${sessionId}: ${payload.error ?? response.status}`)
  const edgeMs = performance.now() - edgeStartedAt

  const pvnaById = new Map(playerRows.map((row: any) => [String(row.player_id), Number(row.players?.pvna ?? 0)]))
  const matches = (payload.payloads ?? []).map((match: any) => {
    const pvna = Math.abs(teamSum(match.team_a, pvnaById) - teamSum(match.team_b, pvnaById))
    const maxIntra = Math.max(intra(match.team_a, pvnaById), intra(match.team_b, pvnaById))
    return {
      court: Number(match.court_idx) + 1,
      pvna: Number(pvna.toFixed(2)),
      intra: Number(maxIntra.toFixed(2)),
      warnings: match.warnings ?? [],
    }
  })

  return {
    sessionId,
    roster: roster.length,
    checkedIn: playerRows.length,
    courts,
    timingMs: { sync: Math.round(syncMs), edgeSuggest: Math.round(edgeMs) },
    quality: {
      matches: matches.length,
      pvnaAvg: Number((matches.reduce((sum: number, match: any) => sum + match.pvna, 0) / Math.max(1, matches.length)).toFixed(2)),
      pvnaMax: Math.max(0, ...matches.map((match: any) => match.pvna)),
      pvnaOverCap: matches.filter((match: any) => match.pvna > 0.5).length,
      intraAvg: Number((matches.reduce((sum: number, match: any) => sum + match.intra, 0) / Math.max(1, matches.length)).toFixed(2)),
      intraMax: Math.max(0, ...matches.map((match: any) => match.intra)),
      intraOverPreferred: matches.filter((match: any) => match.intra > 0.75).length,
      warningMatches: matches.filter((match: any) => match.warnings.length > 0).length,
    },
    matches,
  }
}

async function main() {
  const { error } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (error) throw error

  const reports = []
  for (const target of targets) {
    reports.push(await auditTarget(target.sessionId, target.count))
  }
  console.log(JSON.stringify(reports, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
