import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator/index.ts'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector.ts'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector.ts'
import { buildSuggestedMatchPayloads } from '../lib/next-round-suggester/live-preview.ts'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state.ts'

type PlayerInfo = { id: string; name: string; pvna: number }
type SimMatch = {
  team_a: [string, string]
  team_b: [string, string]
  pvna: number
  intra: number
  repeatEvents: number
}
type BeamState = {
  matches: SimMatch[]
  used: Set<string>
  score: number
  maxPvna: number
  maxIntra: number
  softIntra: number
  repeatEvents: number
}

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/sim-early-batch-beam.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

const PVNA_CAP = 0.5
const PREFERRED_INTRA_CAP = 0.75
const BEAM_WIDTH = Number(process.env.EARLY_BATCH_BEAM_WIDTH ?? 2000)

function pairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

function teamSum(team: [string, string], pvnaById: Map<string, number>) {
  return team.reduce((sum, playerId) => sum + (pvnaById.get(playerId) ?? 0), 0)
}

function teamIntra(team: [string, string], pvnaById: Map<string, number>) {
  return Math.abs((pvnaById.get(team[0]) ?? 0) - (pvnaById.get(team[1]) ?? 0))
}

function matchStats(
  teamA: [string, string],
  teamB: [string, string],
  pvnaById: Map<string, number>,
  opponentCounts: Map<string, number>,
): SimMatch {
  const pvna = Math.abs(teamSum(teamA, pvnaById) - teamSum(teamB, pvnaById))
  const intra = Math.max(teamIntra(teamA, pvnaById), teamIntra(teamB, pvnaById))
  const repeatEvents = teamA
    .flatMap(left => teamB.map(right => opponentCounts.get(pairKey(left, right)) ?? 0))
    .filter(count => count > 0)
    .length
  return { team_a: teamA, team_b: teamB, pvna, intra, repeatEvents }
}

function scoreState(input: Pick<BeamState, 'maxPvna' | 'maxIntra' | 'softIntra' | 'repeatEvents'>) {
  if (input.maxPvna > PVNA_CAP + 1e-9) {
    return 1_000_000_000 + (input.maxPvna - PVNA_CAP) * 10_000_000
  }
  return (
    input.repeatEvents * 100_000 +
    input.maxIntra * 20_000 +
    input.softIntra * 3_000 +
    input.maxPvna * 100
  )
}

function describeMatches(
  matches: SimMatch[],
  names: Map<string, string>,
) {
  return matches.map((match, index) => ({
    court: index + 1,
    teamA: match.team_a.map(id => names.get(id) ?? id),
    teamB: match.team_b.map(id => names.get(id) ?? id),
    pvna: Number(match.pvna.toFixed(2)),
    intra: Number(match.intra.toFixed(2)),
    opponentRepeatEvents: match.repeatEvents,
  }))
}

function summarize(matches: SimMatch[]) {
  return {
    maxPvna: Number(Math.max(0, ...matches.map(match => match.pvna)).toFixed(2)),
    maxIntra: Number(Math.max(0, ...matches.map(match => match.intra)).toFixed(2)),
    softIntraOver: Number(matches
      .reduce((sum, match) => sum + Math.max(0, match.intra - PREFERRED_INTRA_CAP), 0)
      .toFixed(2)),
    matchesOverPreferredIntra: matches.filter(match => match.intra > PREFERRED_INTRA_CAP + 1e-9).length,
    opponentRepeatEvents: matches.reduce((sum, match) => sum + match.repeatEvents, 0),
  }
}

function generateCandidateMatches(
  selectedIds: string[],
  pvnaById: Map<string, number>,
  opponentCounts: Map<string, number>,
) {
  const candidates: SimMatch[] = []
  for (let a = 0; a < selectedIds.length; a += 1) {
    for (let b = a + 1; b < selectedIds.length; b += 1) {
      for (let c = b + 1; c < selectedIds.length; c += 1) {
        for (let d = c + 1; d < selectedIds.length; d += 1) {
          const ids = [selectedIds[a], selectedIds[b], selectedIds[c], selectedIds[d]]
          const splits: Array<[[string, string], [string, string]]> = [
            [[ids[0], ids[1]], [ids[2], ids[3]]],
            [[ids[0], ids[2]], [ids[1], ids[3]]],
            [[ids[0], ids[3]], [ids[1], ids[2]]],
          ]
          for (const [teamA, teamB] of splits) {
            const match = matchStats(teamA, teamB, pvnaById, opponentCounts)
            if (match.pvna <= PVNA_CAP + 1e-9) candidates.push(match)
          }
        }
      }
    }
  }
  return candidates.sort((left, right) => {
    if (left.repeatEvents !== right.repeatEvents) return left.repeatEvents - right.repeatEvents
    if (left.intra !== right.intra) return left.intra - right.intra
    return left.pvna - right.pvna
  })
}

function beamSearchBatch(
  selectedIds: string[],
  candidates: SimMatch[],
  courtCount: number,
) {
  let beam: BeamState[] = [{
    matches: [],
    used: new Set(),
    score: 0,
    maxPvna: 0,
    maxIntra: 0,
    softIntra: 0,
    repeatEvents: 0,
  }]

  for (let depth = 0; depth < courtCount; depth += 1) {
    const next: BeamState[] = []
    for (const state of beam) {
      for (const candidate of candidates) {
        const ids = [...candidate.team_a, ...candidate.team_b]
        if (ids.some(id => state.used.has(id))) continue
        const used = new Set([...state.used, ...ids])
        const maxPvna = Math.max(state.maxPvna, candidate.pvna)
        const maxIntra = Math.max(state.maxIntra, candidate.intra)
        const softIntra = state.softIntra + Math.max(0, candidate.intra - PREFERRED_INTRA_CAP)
        const repeatEvents = state.repeatEvents + candidate.repeatEvents
        const partial = {
          matches: [...state.matches, candidate],
          used,
          maxPvna,
          maxIntra,
          softIntra,
          repeatEvents,
          score: scoreState({ maxPvna, maxIntra, softIntra, repeatEvents }),
        }
        next.push(partial)
      }
    }
    const seen = new Set<string>()
    beam = next
      .sort((left, right) => left.score - right.score)
      .filter(state => {
        const key = [...state.used].sort().join(':')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, BEAM_WIDTH)
    if (beam.length === 0) break
  }

  return beam
    .filter(state => state.matches.length === courtCount && state.used.size === selectedIds.length)
    .sort((left, right) => left.score - right.score)[0] ?? null
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
    pvnaTolerance: PVNA_CAP,
  })
  const payloads = buildSuggestedMatchPayloads({
    count: courts,
    sessionId,
    courtCount: courts,
    state,
    rows: {
      liveMatchRows: liveResult.data ?? [],
      liveStateVersion: Number(sessionResult.data?.live_state_version ?? 0),
    },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: correctForFairness(state),
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map(playerRows.map((row: any) => [row.player_id, { name: row.players?.name ?? row.player_id }])),
    pvnaTolerance: PVNA_CAP,
  })

  const players: PlayerInfo[] = playerRows.map((row: any) => ({
    id: row.player_id,
    name: row.players?.name ?? row.player_id,
    pvna: Number(row.players?.pvna ?? 0),
  }))
  const names = new Map(players.map(player => [player.id, player.name]))
  const pvnaById = new Map(players.map(player => [player.id, player.pvna]))
  const opponentCounts = new Map<string, number>()
  for (const row of pairsResult.data ?? []) {
    opponentCounts.set(pairKey(row.player_a, row.player_b), Number(row.opponent_count ?? 0))
  }

  const currentMatches = payloads.map(payload =>
    matchStats(payload.team_a, payload.team_b, pvnaById, opponentCounts)
  )
  const selectedIds = [...new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b]))]
  const candidates = generateCandidateMatches(selectedIds, pvnaById, opponentCounts)
  const startedAt = performance.now()
  const optimized = beamSearchBatch(selectedIds, candidates, courts)
  const elapsedMs = performance.now() - startedAt

  console.log(JSON.stringify({
    sessionId,
    courts,
    selectedPlayers: selectedIds.length,
    candidateMatches: candidates.length,
    beamWidth: BEAM_WIDTH,
    elapsedMs: Math.round(elapsedMs),
    current: {
      summary: summarize(currentMatches),
      matches: describeMatches(currentMatches, names),
    },
    optimized: optimized ? {
      summary: summarize(optimized.matches),
      matches: describeMatches(optimized.matches, names),
    } : null,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
