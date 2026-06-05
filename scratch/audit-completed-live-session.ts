import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { getRecentRepeatCost } from '../lib/next-round-suggester/score'
import { loadSessionState } from '../lib/next-round-suggester/state'
import type { Match, RoundRecord, SessionLiveMatchRow, SessionState, Team } from '../lib/next-round-suggester/types'

type SupabaseAny = any

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/audit-completed-live-session.ts <session-id> --courts=7')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const courts = Math.max(1, Number(argValue('--courts', '7')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))

function fmt(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(values: number[]) {
  return {
    avg: fmt(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
    p50: fmt(percentile(values, 50)),
    p95: fmt(percentile(values, 95)),
    max: fmt(Math.max(0, ...values)),
  }
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

function teamPvna(state: SessionState, team: Team) {
  return team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
}

function intraGap(state: SessionState, team: Team) {
  return Math.abs((state.players.get(team[0])?.pvna ?? 0) - (state.players.get(team[1])?.pvna ?? 0))
}

function matchPvnaDiff(state: SessionState, match: Match) {
  return Math.abs(teamPvna(state, match.team_a) - teamPvna(state, match.team_b))
}

function matchOverlap(left: Match, right: Match) {
  const rightIds = new Set([...right.team_a, ...right.team_b])
  return [...left.team_a, ...left.team_b].filter((playerId) => rightIds.has(playerId)).length
}

function flattenRounds(rounds: RoundRecord[]) {
  return rounds
    .filter((round) => round.status === 'completed')
    .sort((left, right) => left.round_no - right.round_no)
    .flatMap((round) => round.matches.map((match) => ({ roundNo: round.round_no, match })))
}

function emptyPreviousState(state: SessionState): SessionState {
  return {
    ...state,
    current_round: 0,
    rounds: [],
  }
}

function label(id: string, names: Map<string, string>) {
  return names.get(id) ?? id.slice(0, 8)
}

function matchLabel(match: Match, names: Map<string, string>) {
  return `${label(match.team_a[0], names)} + ${label(match.team_a[1], names)} vs ${label(match.team_b[0], names)} + ${label(match.team_b[1], names)}`
}

async function signInClient() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  return client
}

async function loadNames(client: SupabaseAny) {
  const { data, error } = await client
    .from('session_player_state')
    .select('player_id, players(name)')
    .eq('session_id', sessionId)
  if (error) throw error
  return new Map((data ?? []).map((row: any) => [String(row.player_id), String(row.players?.name ?? row.player_id)]))
}

async function loadCompletedLiveRounds(client: SupabaseAny): Promise<RoundRecord[]> {
  const { data, error } = await client
    .from('session_live_matches')
    .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
    .eq('session_id', sessionId)
    .eq('status', 'completed')
    .order('sequence_no', { ascending: true })
  if (error) throw error

  const byRound = new Map<number, SessionLiveMatchRow[]>()
  for (const row of (data ?? []) as SessionLiveMatchRow[]) {
    const roundNo = Number(row.round_no ?? Math.floor(Number(row.sequence_no ?? 0) / courts))
    byRound.set(roundNo, [...(byRound.get(roundNo) ?? []), row])
  }

  return [...byRound.entries()]
    .sort(([left], [right]) => left - right)
    .map(([roundNo, rows]) => ({
      session_id: sessionId,
      round_no: roundNo,
      status: 'completed' as const,
      matches: rows
        .sort((left, right) => Number(left.court_idx ?? 0) - Number(right.court_idx ?? 0))
        .map((row) => ({
          court_idx: row.court_idx ?? null,
          team_a: row.team_a,
          team_b: row.team_b,
          stats: {
            pvna_diff: 0,
            partner_repeats: 0,
            opponent_repeats: 0,
            group_bonus: 0,
            gender_pref_penalty: 0,
            consecutive_play_penalty: 0,
          },
        })),
      resting: rows.flatMap((row) => row.resting ?? []),
      started_at: rows[0]?.started_at ? new Date(rows[0].started_at) : null,
      ended_at: rows.at(-1)?.ended_at ? new Date(rows.at(-1)!.ended_at!) : null,
    }))
}

async function main() {
  const client = await signInClient()
  const [state, names, liveRounds] = await Promise.all([
    loadSessionState(client, sessionId, { courts, pvnaTolerance }),
    loadNames(client),
    loadCompletedLiveRounds(client),
  ])

  const completedRounds = liveRounds.length > 0
    ? liveRounds
    : state.rounds.filter((round) => round.status === 'completed')
  const flattened = flattenRounds(completedRounds)
  const playedCounts = new Map([...state.players.keys()].map((playerId) => [playerId, 0]))
  const maxConsecutiveRest = new Map([...state.players.keys()].map((playerId) => [playerId, 0]))
  const maxConsecutivePlay = new Map([...state.players.keys()].map((playerId) => [playerId, 0]))
  const currentRest = new Map([...state.players.keys()].map((playerId) => [playerId, 0]))
  const currentPlay = new Map([...state.players.keys()].map((playerId) => [playerId, 0]))
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  const pvnaDiffs: number[] = []
  const intraGaps: number[] = []
  const recentTotals: number[] = []
  const recentPartnerMatches: Array<{ round: number; match: string; partner: number; total: number }> = []
  const recentOpponentMatches: Array<{ round: number; match: string; opponent: number; total: number }> = []
  const recentOverlap3: Array<{ round: number; match: string; total: number }> = []
  const nearRematchWithin2: Array<{ round: number; match: string; previousRound: number; overlap: number }> = []
  let previousState = emptyPreviousState(state)

  for (const { roundNo, match } of flattened) {
    const pvna = matchPvnaDiff(state, match)
    const maxIntra = Math.max(intraGap(state, match.team_a), intraGap(state, match.team_b))
    const recent = getRecentRepeatCost(match.team_a, match.team_b, { ...previousState, current_round: roundNo })
    pvnaDiffs.push(pvna)
    intraGaps.push(maxIntra)
    recentTotals.push(recent.total)
    if (recent.partner > 0) recentPartnerMatches.push({ round: roundNo + 1, match: matchLabel(match, names), partner: fmt(recent.partner), total: fmt(recent.total) })
    if (recent.opponent > 0) recentOpponentMatches.push({ round: roundNo + 1, match: matchLabel(match, names), opponent: fmt(recent.opponent), total: fmt(recent.total) })
    if (recent.overlap3 > 0) recentOverlap3.push({ round: roundNo + 1, match: matchLabel(match, names), total: fmt(recent.total) })

    for (const previousRound of previousState.rounds.filter((item) => roundNo > item.round_no && roundNo <= item.round_no + 2)) {
      for (const previousMatch of previousRound.matches) {
        const overlap = matchOverlap(match, previousMatch)
        if (overlap >= 3) {
          nearRematchWithin2.push({
            round: roundNo + 1,
            match: matchLabel(match, names),
            previousRound: previousRound.round_no + 1,
            overlap,
          })
        }
      }
    }

    for (const playerId of [...match.team_a, ...match.team_b]) {
      playedCounts.set(playerId, (playedCounts.get(playerId) ?? 0) + 1)
    }
    for (const team of [match.team_a, match.team_b]) {
      const key = pairKey(team[0], team[1])
      partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
    }
    for (const playerA of match.team_a) {
      for (const playerB of match.team_b) {
        const key = pairKey(playerA, playerB)
        opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      }
    }

    const round = completedRounds.find((item) => item.round_no === roundNo)
    if (round && !previousState.rounds.some((item) => item.round_no === roundNo)) {
      previousState = {
        ...previousState,
        rounds: [...previousState.rounds, round],
        current_round: roundNo + 1,
      }
    }
  }

  const playedValues = [...playedCounts.values()]
  const rest2Plus = [...playedCounts.entries()]
    .filter(([, count]) => Math.max(0, completedRounds.length - count) >= 2)
    .map(([playerId, count]) => ({
      player: label(playerId, names),
      played: count,
      rested: completedRounds.length - count,
    }))
  const partnerValues = [...partnerCounts.values()]
  const opponentValues = [...opponentCounts.values()]

  for (const completedRound of completedRounds) {
    const roundPlayers = new Set(completedRound.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
    for (const playerId of state.players.keys()) {
      if (roundPlayers.has(playerId)) {
        const nextPlay = (currentPlay.get(playerId) ?? 0) + 1
        currentPlay.set(playerId, nextPlay)
        currentRest.set(playerId, 0)
        maxConsecutivePlay.set(playerId, Math.max(maxConsecutivePlay.get(playerId) ?? 0, nextPlay))
      } else {
        const nextRest = (currentRest.get(playerId) ?? 0) + 1
        currentRest.set(playerId, nextRest)
        currentPlay.set(playerId, 0)
        maxConsecutiveRest.set(playerId, Math.max(maxConsecutiveRest.get(playerId) ?? 0, nextRest))
      }
    }
  }

  console.log(JSON.stringify({
    sessionId,
    players: state.players.size,
    rounds: completedRounds.length,
    matches: flattened.length,
    courts,
    playDistribution: {
      min: Math.min(...playedValues),
      max: Math.max(...playedValues),
      avg: fmt(playedValues.reduce((sum, value) => sum + value, 0) / Math.max(1, playedValues.length)),
      maxConsecutiveRest: Math.max(0, ...maxConsecutiveRest.values()),
      maxConsecutivePlay: Math.max(0, ...maxConsecutivePlay.values()),
      played4OrLess: [...playedCounts.entries()]
        .filter(([, count]) => count <= 4)
        .map(([playerId, count]) => ({
          player: label(playerId, names),
          played: count,
          rested: completedRounds.length - count,
          maxConsecutiveRest: maxConsecutiveRest.get(playerId) ?? 0,
        })),
      rested2Plus: rest2Plus,
    },
    pvna: {
      ...summarize(pvnaDiffs),
      overCap: pvnaDiffs.filter((value) => value > pvnaTolerance).length,
      worst: flattened
        .map(({ roundNo, match }) => ({ round: roundNo + 1, match: matchLabel(match, names), pvna: fmt(matchPvnaDiff(state, match)) }))
        .sort((left, right) => right.pvna - left.pvna)
        .slice(0, 8),
    },
    intraTeam: {
      ...summarize(intraGaps),
      overPreferred075: intraGaps.filter((value) => value > 0.75).length,
      overHard100: intraGaps.filter((value) => value > 1).length,
      worst: flattened
        .map(({ roundNo, match }) => ({ round: roundNo + 1, match: matchLabel(match, names), intra: fmt(Math.max(intraGap(state, match.team_a), intraGap(state, match.team_b))) }))
        .sort((left, right) => right.intra - left.intra)
        .slice(0, 8),
    },
    repeats: {
      partner: {
        max: Math.max(0, ...partnerValues),
        pairs2Plus: partnerValues.filter((value) => value >= 2).length,
        pairs3Plus: partnerValues.filter((value) => value >= 3).length,
      },
      opponent: {
        max: Math.max(0, ...opponentValues),
        pairs2Plus: opponentValues.filter((value) => value >= 2).length,
        pairs3Plus: opponentValues.filter((value) => value >= 3).length,
      },
      nearRematchWithin2,
    },
    recentWindow3: {
      ...summarize(recentTotals),
      matchesWithPartnerRecent: recentPartnerMatches.length,
      matchesWithOpponentRecent: recentOpponentMatches.length,
      matchesWithOverlap3: recentOverlap3.length,
      partnerCases: recentPartnerMatches.slice(0, 12),
      opponentCases: recentOpponentMatches.slice(0, 12),
      overlap3Cases: recentOverlap3.slice(0, 12),
    },
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
