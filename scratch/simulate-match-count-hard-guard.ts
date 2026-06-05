import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch } from '../lib/next-round-suggester/live-preview'
import { getRecentRepeatCost } from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type {
  Match,
  RoundRecord,
  SessionLiveMatchRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
} from '../lib/next-round-suggester/types'

type Variant = 'current' | 'hard_match_count' | 'guided_match_count'
type PlayerName = { name: string; pvna: number }

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/simulate-match-count-hard-guard.ts <session-id> --rounds=8')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const roundsToSimulate = Math.max(1, Number(argValue('--rounds', '8')))
const maxAlternatives = Math.max(1, Number(argValue('--max-alternatives', '80')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const courtCountArg = argValue('--courts', '')

function round(value: number, digits = 2) {
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
    avg: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: round(Math.max(0, ...values)),
  }
}

function teamLabel(team: [string, string], names: Map<string, PlayerName>) {
  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  return `${label(team[0])}+${label(team[1])}`
}

function matchLabel(match: Match, names: Map<string, PlayerName>) {
  return `${teamLabel(match.team_a, names)} vs ${teamLabel(match.team_b, names)}`
}

function intraGap(match: Match, state: SessionState) {
  const gap = (team: [string, string]) => Math.abs(
    (state.players.get(team[0])?.pvna ?? 0) - (state.players.get(team[1])?.pvna ?? 0),
  )
  return Math.max(gap(match.team_a), gap(match.team_b))
}

function playedIds(alternative: SuggestionAlternative) {
  return new Set(alternative.matches.flatMap(match => [...match.team_a, ...match.team_b]))
}

function projectedCountsAfter(alternative: SuggestionAlternative, state: SessionState) {
  const selected = playedIds(alternative)
  return [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .map(player => player.matches_played + (selected.has(player.player_id) ? 1 : 0))
}

function matchCountStats(state: SessionState) {
  const values = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .map(player => player.matches_played)
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
    range: Math.max(...values) - Math.min(...values),
    distribution: [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<number, number>()).entries()]
      .sort(([left], [right]) => left - right),
  }
}

function chooseAlternative(
  variant: Variant,
  alternatives: SuggestionAlternative[],
  state: SessionState,
  totalPlayers: number,
  nextMatchIndex: number,
) {
  const top = alternatives[0]
  if (variant === 'current' || !top) {
    return { alternative: top, relaxed: false, allowedMax: null, rejected: 0 }
  }

  const slotsAfter = nextMatchIndex * 4
  const allowedMax = Math.ceil(slotsAfter / Math.max(1, totalPlayers))
  const viable = alternatives.filter((alternative) => {
    const counts = projectedCountsAfter(alternative, state)
    return counts.every(count => count <= allowedMax)
  })

  return {
    alternative: viable[0] ?? top,
    relaxed: viable.length === 0,
    allowedMax,
    rejected: alternatives.length - viable.length,
  }
}

function getGuidedMatchCountControls(
  state: SessionState,
  totalPlayers: number,
  nextMatchIndex: number,
  roundBusyIds: Set<string>,
) {
  const activePlayers = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !roundBusyIds.has(player.player_id))
  const slotsAfter = nextMatchIndex * 4
  const targetMinAfter = Math.floor(slotsAfter / Math.max(1, totalPlayers))
  const targetMaxAfter = Math.ceil(slotsAfter / Math.max(1, totalPlayers))
  const underTarget = activePlayers
    .filter(player => player.matches_played < targetMinAfter)
    .sort((left, right) =>
      left.matches_played - right.matches_played ||
      right.consecutive_rest - left.consecutive_rest ||
      left.last_played_round - right.last_played_round ||
      left.player_id.localeCompare(right.player_id),
    )
  const capped = activePlayers
    .filter(player => player.matches_played >= targetMaxAfter)
    .map(player => player.player_id)
  const availableAfterCap = activePlayers.filter(player => !capped.includes(player.player_id))
  const excludedIds = availableAfterCap.length >= 4
    ? new Set(capped)
    : new Set<string>()

  const requiredIds = underTarget
    .filter(player => !excludedIds.has(player.player_id))
    .slice(0, 4)
    .map(player => player.player_id)

  return {
    targetMinAfter,
    targetMaxAfter,
    excludedIds,
    requiredIds,
  }
}

function projectMatch(state: SessionState, match: Match, roundNo: number, courtIdx: number): SessionState {
  const row: SessionLiveMatchRow = {
    id: `sim-${roundNo}-${courtIdx}`,
    session_id: state.session_id,
    sequence_no: roundNo * Math.max(1, state.config.courts) + courtIdx,
    round_no: roundNo,
    court_idx: courtIdx,
    status: 'completed',
    team_a: match.team_a,
    team_b: match.team_b,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date().toISOString(),
    started_at: null,
    ended_at: new Date().toISOString(),
  }
  return buildProjectedStateAfterLiveMatch(state, row, roundNo)
}

function runVariant(
  variant: Variant,
  baseState: SessionState,
  names: Map<string, PlayerName>,
  rounds: number,
  courts: number,
) {
  let state = {
    ...baseState,
    players: new Map([...baseState.players.entries()].map(([id, player]) => [id, {
      ...player,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: false,
    }])),
    rounds: [],
    current_round: 0,
  }
  const rows: Array<{
    round: number
    court: number
    match: string
    pvna: number
    intra: number
    recentTotal: number
    allowedMax: number | null
    relaxed: boolean
    selectedRank: number
  }> = []

  let relaxations = 0
  for (let roundNo = 0; roundNo < rounds; roundNo += 1) {
    let roundBusyIds = new Set<string>()
    const playedThisRound = new Set<string>()

    for (let courtIdx = 0; courtIdx < courts; courtIdx += 1) {
      const searchState = { ...state, current_round: roundNo }
      const nextMatchIndex = roundNo * courts + courtIdx + 1
      const guided = variant === 'guided_match_count'
        ? getGuidedMatchCountControls(searchState, state.players.size, nextMatchIndex, roundBusyIds)
        : null
      const busyIds = new Set([
        ...roundBusyIds,
        ...(guided?.excludedIds ?? []),
      ])
      const adjustment = correctForFairness(searchState)
      const adjustedState = applyFairnessAdjustment(searchState, adjustment)
      const result = suggestNextMatch(adjustedState, {
        busy_player_ids: busyIds,
        court_idx: courtIdx,
        tier_overrides: {
          ...adjustment.tier_overrides,
          ...Object.fromEntries((guided?.requiredIds ?? []).map(id => [id, 0])),
        },
        max_alternatives: maxAlternatives,
      })
      const choice = chooseAlternative(variant, result.alternatives, adjustedState, state.players.size, nextMatchIndex)
      const alternative = choice.alternative
      const match = alternative?.matches[0]
      if (!alternative || !match) throw new Error(`${variant}: no suggestion at R${roundNo + 1} C${courtIdx + 1}`)
      if (choice.relaxed) relaxations += 1

      const selectedKey = [...match.team_a, ...match.team_b].sort().join(':')
      const selectedRank = Math.max(1, result.alternatives.findIndex(item => {
        const other = item.matches[0]
        return other && [...other.team_a, ...other.team_b].sort().join(':') === selectedKey
      }) + 1)
      const recent = getRecentRepeatCost(match.team_a, match.team_b, adjustedState, roundNo)
      rows.push({
        round: roundNo + 1,
        court: courtIdx + 1,
        match: matchLabel(match, names),
        pvna: round(match.stats?.pvna_diff ?? 0),
        intra: round(intraGap(match, adjustedState)),
        recentTotal: round(recent.total),
        allowedMax: guided?.targetMaxAfter ?? choice.allowedMax,
        relaxed: choice.relaxed,
        selectedRank,
      })

      for (const id of [...match.team_a, ...match.team_b]) {
        roundBusyIds.add(id)
        playedThisRound.add(id)
      }
      state = projectMatch(state, match, roundNo, courtIdx)
    }

    state = buildProjectedStateAfterCompletedLiveRound({ ...state, current_round: roundNo + 1 }, playedThisRound)
  }

  const pvna = rows.map(row => row.pvna)
  const intra = rows.map(row => row.intra)
  const recent = rows.map(row => row.recentTotal)
  return {
    variant,
    matches: rows.length,
    matchCount: matchCountStats(state),
    relaxations,
    summary: {
      pvna: summarize(pvna),
      pvnaOverCap: pvna.filter(value => value > baseState.config.pvna_tolerance).length,
      intra: summarize(intra),
      intraOverPreferred: intra.filter(value => value > 0.75).length,
      intraOverHard: intra.filter(value => value > 1).length,
      recent: summarize(recent),
      recentCostMatches: recent.filter(value => value > 0).length,
      pickedNonTop: rows.filter(row => row.selectedRank > 1).length,
    },
    relaxedRows: rows.filter(row => row.relaxed).slice(0, 12),
    worstPvna: [...rows].sort((a, b) => b.pvna - a.pvna).slice(0, 8),
    worstIntra: [...rows].sort((a, b) => b.intra - a.intra).slice(0, 8),
    worstRecent: [...rows].sort((a, b) => b.recentTotal - a.recentTotal).slice(0, 8),
  }
}

async function main() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signIn.error) throw signIn.error

  const [playersRes, preferenceRes, namesRes] = await Promise.all([
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, created_at, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, players(name, pvna)')
      .eq('session_id', sessionId),
  ])
  if (playersRes.error) throw playersRes.error
  if (preferenceRes.error) throw preferenceRes.error
  if (namesRes.error) throw namesRes.error

  const preferenceRows = (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[]
  const stateRows = (playersRes.data ?? []) as SessionPlayerStateRow[]
  const playerRows = (stateRows.length > 0
    ? stateRows
    : (preferenceRes.data ?? []).map((row: any) => ({
      session_id: sessionId,
      player_id: row.player_id,
      group_id: null,
      checked_in_at: row.created_at ?? new Date().toISOString(),
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
      players: row.players,
      session_players: {
        status: 'confirmed',
        check_in_status: 'present',
        metadata: row.metadata ?? null,
      },
    }))).map(row => ({
      ...row,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
    }))
  const names = new Map<string, PlayerName>((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
    name: row.players?.name ?? String(row.player_id).slice(0, 8),
    pvna: Number(row.players?.pvna ?? 3),
  }]))
  const courtCalculator = calculateOptimalCourts({
    n_players: playerRows.length,
    session_duration_min: sessionDurationMin,
    match_duration_min: matchDurationMin,
    preset: courtPreset,
  })
  const courts = Math.max(1, Number(courtCountArg || courtCalculator.recommended.courts))
  const baseState = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: [],
    roundRows: [] as RoundRecord[],
    preferenceRows,
    courts,
    pvnaTolerance,
  })

  const current = runVariant('current', baseState, names, roundsToSimulate, courts)
  const hard = runVariant('hard_match_count', baseState, names, roundsToSimulate, courts)
  const guided = runVariant('guided_match_count', baseState, names, roundsToSimulate, courts)
  console.log(JSON.stringify({
    sessionId,
    rounds: roundsToSimulate,
    courts,
    players: playerRows.length,
    maxAlternatives,
    courtReasoning: courtCalculator.reasoning,
    current,
    hard,
    guided,
    delta: {
      matchRange: hard.matchCount.range - current.matchCount.range,
      pvnaAvg: round(hard.summary.pvna.avg - current.summary.pvna.avg),
      pvnaP95: round(hard.summary.pvna.p95 - current.summary.pvna.p95),
      pvnaOverCap: hard.summary.pvnaOverCap - current.summary.pvnaOverCap,
      intraAvg: round(hard.summary.intra.avg - current.summary.intra.avg),
      intraP95: round(hard.summary.intra.p95 - current.summary.intra.p95),
      intraOverPreferred: hard.summary.intraOverPreferred - current.summary.intraOverPreferred,
      recentAvg: round(hard.summary.recent.avg - current.summary.recent.avg),
      recentP95: round(hard.summary.recent.p95 - current.summary.recent.p95),
      pickedNonTop: hard.summary.pickedNonTop - current.summary.pickedNonTop,
    },
    guidedDelta: {
      matchRange: guided.matchCount.range - current.matchCount.range,
      pvnaAvg: round(guided.summary.pvna.avg - current.summary.pvna.avg),
      pvnaP95: round(guided.summary.pvna.p95 - current.summary.pvna.p95),
      pvnaOverCap: guided.summary.pvnaOverCap - current.summary.pvnaOverCap,
      intraAvg: round(guided.summary.intra.avg - current.summary.intra.avg),
      intraP95: round(guided.summary.intra.p95 - current.summary.intra.p95),
      intraOverPreferred: guided.summary.intraOverPreferred - current.summary.intraOverPreferred,
      recentAvg: round(guided.summary.recent.avg - current.summary.recent.avg),
      recentP95: round(guided.summary.recent.p95 - current.summary.recent.p95),
      pickedNonTop: guided.summary.pickedNonTop - current.summary.pickedNonTop,
    },
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
