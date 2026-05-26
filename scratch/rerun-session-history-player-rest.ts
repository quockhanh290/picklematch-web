import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { Tier } from '../lib/next-round-suggester/classify'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type {
  Match,
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
} from '../lib/next-round-suggester/types'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

type Args = {
  sessionId: string | null
  target: string
  rounds: number | null
  courts: number | null
  iterations: number
}

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function parseArgs(): Args {
  const rounds = argValue('--rounds')
  const courts = argValue('--courts')
  return {
    sessionId: argValue('--session-id'),
    target: argValue('--target', 'P25') ?? 'P25',
    rounds: rounds == null ? null : Math.max(1, Number(rounds)),
    courts: courts == null ? null : Math.max(1, Number(courts)),
    iterations: Math.max(1, Number(argValue('--iterations', '1'))),
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function cloneState(state: SessionState): SessionState {
  const players = new Map<string, PlayerSessionState>()
  for (const [id, player] of state.players) {
    players.set(id, {
      ...player,
      checked_in_at: new Date(player.checked_in_at),
      checked_out_at: player.checked_out_at ? new Date(player.checked_out_at) : null,
      partner_counts: new Map(player.partner_counts),
      opponent_counts: new Map(player.opponent_counts),
    })
  }
  return {
    ...state,
    players,
    rounds: state.rounds.map(round => ({
      ...round,
      matches: round.matches.map(match => ({
        ...match,
        team_a: [...match.team_a],
        team_b: [...match.team_b],
      })) as Match[],
      resting: [...round.resting],
      started_at: round.started_at ? new Date(round.started_at) : null,
      ended_at: round.ended_at ? new Date(round.ended_at) : null,
    })),
  }
}

function incrementPair(players: Map<string, PlayerSessionState>, a: string, b: string, type: 'partner' | 'opponent') {
  const left = players.get(a)
  const right = players.get(b)
  if (left) {
    const partnerCounts = new Map(left.partner_counts)
    const opponentCounts = new Map(left.opponent_counts)
    const counts = type === 'partner' ? partnerCounts : opponentCounts
    counts.set(b, (counts.get(b) ?? 0) + 1)
    players.set(a, { ...left, partner_counts: partnerCounts, opponent_counts: opponentCounts })
  }
  if (right) {
    const partnerCounts = new Map(right.partner_counts)
    const opponentCounts = new Map(right.opponent_counts)
    const counts = type === 'partner' ? partnerCounts : opponentCounts
    counts.set(a, (counts.get(a) ?? 0) + 1)
    players.set(b, { ...right, partner_counts: partnerCounts, opponent_counts: opponentCounts })
  }
}

function applyMatch(state: SessionState, match: Match, roundNo: number): SessionState {
  const players = new Map(state.players)
  const playedIds = new Set([...match.team_a, ...match.team_b])
  for (const playerId of playedIds) {
    const player = players.get(playerId)
    if (!player) continue
    players.set(playerId, {
      ...player,
      matches_played: player.matches_played + 1,
      last_played_round: roundNo,
      consecutive_play: player.consecutive_play + 1,
      consecutive_rest: 0,
      opted_rest: false,
    })
  }
  incrementPair(players, match.team_a[0], match.team_a[1], 'partner')
  incrementPair(players, match.team_b[0], match.team_b[1], 'partner')
  for (const a of match.team_a) {
    for (const b of match.team_b) incrementPair(players, a, b, 'opponent')
  }
  return { ...state, players }
}

function completeRound(state: SessionState, roundNo: number, matches: Match[], resting: string[]): SessionState {
  const players = new Map(state.players)
  const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
  for (const playerId of resting) {
    if (playedIds.has(playerId)) continue
    const player = players.get(playerId)
    if (!player || player.checked_out_at !== null || player.opted_rest) continue
    players.set(playerId, {
      ...player,
      consecutive_rest: player.consecutive_rest + 1,
      consecutive_play: 0,
    })
  }
  return {
    ...state,
    players,
    rounds: [
      ...state.rounds,
      {
        session_id: state.session_id,
        round_no: roundNo,
        status: 'completed',
        matches,
        resting,
        started_at: null,
        ended_at: new Date(roundNo),
      },
    ],
    current_round: Math.max(state.current_round, roundNo + 1),
  }
}

function buildRoundRequiredIds(state: SessionState, remainingCourts: number, busyIds: Set<string>) {
  const remainingRoundSlots = Math.max(0, remainingCourts * 4)
  if (remainingRoundSlots <= 0) return new Set<string>()
  const hasCompletedRounds = state.rounds.some(round => round.status === 'completed')
  const required = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
    .filter(player => {
      const isLateArrival = hasCompletedRounds && player.matches_played === 0
      return isLateArrival ? player.consecutive_rest >= 2 : player.consecutive_rest >= 1
    })
    .sort((left, right) => {
      if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
      if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
      if (left.last_played_round !== right.last_played_round) return left.last_played_round - right.last_played_round
      return left.player_id.localeCompare(right.player_id)
    })
    .map(player => player.player_id)
  return required.length <= remainingRoundSlots ? new Set(required) : new Set<string>()
}

function simulateRound(state: SessionState, roundNo: number, courts: number) {
  let nextState = state
  const matches: Match[] = []
  const roundBusyIds = new Set<string>()
  const roundRequiredIds = buildRoundRequiredIds(nextState, courts, roundBusyIds)
  const requiredAtStart = [...roundRequiredIds]
  const suggestMs: number[] = []

  for (let courtIdx = 0; courtIdx < courts; courtIdx += 1) {
    const requiredForThisCourt = [...roundRequiredIds].filter(id => !roundBusyIds.has(id)).slice(0, 4)
    const requiredForThisCourtIds = new Set(requiredForThisCourt)
    const deferredRequiredIds = [...roundRequiredIds]
      .filter(id => !requiredForThisCourtIds.has(id) && !roundBusyIds.has(id))
    const busyIds = new Set([...roundBusyIds, ...deferredRequiredIds])
    const tierOverrides = Object.fromEntries(requiredForThisCourt.map(id => [id, Tier.MUST_PLAY]))
    const suggestStartedAt = now()
    const result = suggestNextMatch(nextState, {
      tier_overrides: tierOverrides,
      busy_player_ids: busyIds,
      court_idx: courtIdx,
      max_alternatives: 8,
    })
    suggestMs.push(now() - suggestStartedAt)
    const alternative = result.alternatives[0]
    const match = alternative?.matches[0]
    if (!alternative || !match) break
    matches.push(match)
    for (const id of [...match.team_a, ...match.team_b]) {
      roundBusyIds.add(id)
      roundRequiredIds.delete(id)
    }
    nextState = applyMatch(nextState, match, roundNo)
  }

  const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
  const resting = [...nextState.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !playedIds.has(player.player_id))
    .map(player => player.player_id)
    .sort()

  return {
    state: completeRound(nextState, roundNo, matches, resting),
    matches,
    resting,
    requiredAtStart,
    suggestMs,
  }
}

function playerLabel(names: Map<string, string>, playerId: string) {
  return names.get(playerId) ?? playerId.slice(0, 8)
}

function matchLabel(names: Map<string, string>, match: Match) {
  return `${match.team_a.map(id => playerLabel(names, id)).join('+')} vs ${match.team_b.map(id => playerLabel(names, id)).join('+')}`
}

async function main() {
  const args = parseArgs()
  if (!ANON_KEY) throw new Error('Missing Supabase anon key')
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (signIn.error) throw signIn.error
  const hostId = signIn.data.user?.id
  if (!hostId) throw new Error('No host user')

  const sessionRes = args.sessionId
    ? await client.from('sessions').select('id, created_at, status').eq('id', args.sessionId).single()
    : await client.from('sessions').select('id, created_at, status').eq('host_id', hostId).order('created_at', { ascending: false }).limit(1).single()
  if (sessionRes.error) throw sessionRes.error
  const session = sessionRes.data as any

  const [settingsRes, playerRes, prefRes, liveRes] = await Promise.all([
    client.from('session_next_round_settings').select('*').eq('session_id', session.id).maybeSingle(),
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', session.id)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', session.id),
    client
      .from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at')
      .eq('session_id', session.id)
      .order('sequence_no', { ascending: true }),
  ])
  for (const res of [settingsRes, playerRes, prefRes, liveRes]) {
    if (res.error) throw res.error
  }

  const playerRows = (playerRes.data ?? []) as any[]
  const preferenceRows = (prefRes.data ?? []) as any[] as SessionPlayerPreferenceRow[]
  const liveRows = (liveRes.data ?? []) as any[] as SessionLiveMatchRow[]
  const names = new Map(playerRows.map(row => [String(row.player_id), String(row.players?.name ?? row.player_id)]))
  const targetRow = playerRows.find(row => String(row.players?.name ?? '').trim().toUpperCase() === args.target.toUpperCase())
  if (!targetRow) throw new Error(`Target ${args.target} not found`)
  const targetId = String(targetRow.player_id)
  const courts = args.courts ?? Math.max(1, Number((settingsRes.data as any)?.court_count_override ?? 6))
  const actualCompletedRoundCount = new Set(
    liveRows
      .filter(row => row.status === 'completed' && row.round_no !== null)
      .map(row => Number(row.round_no)),
  ).size
  const roundsToRun = args.rounds ?? actualCompletedRoundCount

  const initialPlayerRows = playerRows.map(row => ({
    ...row,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    checked_out_at: null,
  })) as SessionPlayerStateRow[]
  const initialState = mapRowsToSessionState({
    sessionId: session.id,
    playerRows: initialPlayerRows,
    pairRows: [] as SessionPairHistoryRow[],
    roundRows: [],
    preferenceRows,
    courts,
    pvnaTolerance: Number((settingsRes.data as any)?.pvna_tolerance ?? 0.5),
  })

  const runs = []
  for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
    let state = cloneState(initialState)
    const timeline = []
    let maxRest = 0
    for (let roundNo = 0; roundNo < roundsToRun; roundNo += 1) {
      const result = simulateRound(state, roundNo, courts)
      state = result.state
      const targetPlayed = result.matches.some(match => [...match.team_a, ...match.team_b].includes(targetId))
      const targetResting = result.resting.includes(targetId)
      const targetState = state.players.get(targetId)
      maxRest = Math.max(maxRest, targetState?.consecutive_rest ?? 0)
      timeline.push({
        round_no: roundNo,
        target_required_at_start: result.requiredAtStart.includes(targetId),
        target_played: targetPlayed,
        target_resting: targetResting,
        target_consecutive_rest_after: targetState?.consecutive_rest ?? null,
        target_match: result.matches.find(match => [...match.team_a, ...match.team_b].includes(targetId))
          ? matchLabel(names, result.matches.find(match => [...match.team_a, ...match.team_b].includes(targetId))!)
          : null,
        required_count_at_start: result.requiredAtStart.length,
        built_matches: result.matches.length,
        suggest_ms_total: Math.round(result.suggestMs.reduce((sum, value) => sum + value, 0)),
      })
    }
    const finalTarget = state.players.get(targetId)
    runs.push({
      iteration,
      max_target_consecutive_rest: maxRest,
      final_target: finalTarget ? {
        matches_played: finalTarget.matches_played,
        last_played_round: finalTarget.last_played_round,
        consecutive_rest: finalTarget.consecutive_rest,
        consecutive_play: finalTarget.consecutive_play,
      } : null,
      timeline,
    })
  }

  const actualTarget = targetRow
  console.log(JSON.stringify({
    session,
    target: {
      name: args.target,
      player_id: targetId,
      actual_db: {
        matches_played: actualTarget.matches_played,
        last_played_round: actualTarget.last_played_round,
        consecutive_rest: actualTarget.consecutive_rest,
        consecutive_play: actualTarget.consecutive_play,
        opted_rest: actualTarget.opted_rest,
      },
    },
    courts,
    roundsToRun,
    actualCompletedRoundCount,
    iterations: args.iterations,
    runs,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
