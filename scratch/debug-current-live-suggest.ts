import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads, getAlternativeIntraTeamGap } from '../lib/next-round-suggester/live-preview'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow } from '../lib/next-round-suggester/types'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/debug-current-live-suggest.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function teamSum(team: [string, string], players: Map<string, number>) {
  return team.reduce((sum, playerId) => sum + (players.get(playerId) ?? 0), 0)
}

async function main() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signInError) throw signInError

  const [sessionResult, playersResult, pairsResult, roundsResult, liveResult] = await Promise.all([
    client.from('sessions').select('live_state_version').eq('id', sessionId).single(),
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_pair_history')
      .select('session_id, player_a, player_b, partner_count, opponent_count')
      .eq('session_id', sessionId),
    client
      .from('session_rounds')
      .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
      .eq('session_id', sessionId)
      .order('round_no', { ascending: true }),
    client
      .from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: true }),
  ])
  const error = sessionResult.error ?? playersResult.error ?? pairsResult.error ?? roundsResult.error ?? liveResult.error
  if (error) throw error

  const playerRows = playersResult.data ?? []
  const liveMatchRows = (liveResult.data ?? []) as SessionLiveMatchRow[]
  const courts = calculateOptimalCourts({
    n_players: playerRows.length,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  }).recommended.courts
  const state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    courts,
    pvnaTolerance: 0.5,
  })
  const adjustment = correctForFairness(state)
  const warnings = detectFairnessIssues(state)
  const playersById = new Map(
    playerRows.map((row: any) => [row.player_id, { name: row.players?.name ?? row.player_id }]),
  )

  const startedAt = performance.now()
  const payloads = buildSuggestedMatchPayloads({
    count: Math.max(0, courts - liveMatchRows.filter(row => row.status === 'live').length),
    sessionId,
    courtCount: courts,
    state,
    rows: { liveMatchRows, liveStateVersion: Number(sessionResult.data?.live_state_version ?? 0) },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: adjustment,
    fairnessWarnings: warnings,
    playersById,
    pvnaTolerance: 0.5,
  })
  const elapsedMs = performance.now() - startedAt
  const pvnaById = new Map(playerRows.map((row: any) => [row.player_id, Number(row.players?.pvna ?? 0)]))

  console.log(JSON.stringify({
    sessionId,
    liveStateVersion: Number(sessionResult.data?.live_state_version ?? 0),
    courts,
    playerCount: playerRows.length,
    playerCountBucket: [...new Map(playerRows.map((row: any) => [row.matches_played, 0])).keys()]
      .sort((a, b) => Number(a) - Number(b))
      .map((matchesPlayed) => ({
        matchesPlayed,
        count: playerRows.filter((row: any) => row.matches_played === matchesPlayed).length,
      })),
    liveRows: {
      total: liveMatchRows.length,
      completed: liveMatchRows.filter(row => row.status === 'completed').length,
      live: liveMatchRows.filter(row => row.status === 'live').length,
      suggested: liveMatchRows.filter(row => row.status === 'suggested').length,
    },
    elapsedMs: Math.round(elapsedMs),
    payloadCount: payloads.length,
    payloads: payloads.map(payload => {
      const match = { court_idx: payload.court_idx, team_a: payload.team_a, team_b: payload.team_b }
      return {
        court: Number(payload.court_idx) + 1,
        round: Number(payload.round_no) + 1,
        pvna: Math.abs(teamSum(payload.team_a, pvnaById) - teamSum(payload.team_b, pvnaById)),
        intra: getAlternativeIntraTeamGap({ matches: [match], resting: [], score: 0, warnings: [], tradeoffs: [], stats: {} }, state),
        warnings: payload.warnings,
      }
    }),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
