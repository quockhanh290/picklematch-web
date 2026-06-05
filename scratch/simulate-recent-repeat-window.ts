import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch } from '../lib/next-round-suggester/live-preview'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type {
  Match,
  RoundRecord,
  SessionLiveMatchRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
} from '../lib/next-round-suggester/types'

type Variant = 'current' | 'window3'
type PlayerName = { name: string; pvna: number }
type RecentCost = {
  total: number
  partner: number
  opponent: number
  overlap2: number
  overlap3: number
  exact4: number
}

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/simulate-recent-repeat-window.ts <session-id> --rounds=8')

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const roundsToSimulate = Math.max(1, Number(argValue('--rounds', '8')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const courtCountArg = argValue('--courts', '')
const maxAlternatives = Math.max(1, Number(argValue('--max-alternatives', '24')))
const partnerRecentWeight = Number(argValue('--partner-recent-weight', '28'))
const opponentRecentWeight = Number(argValue('--opponent-recent-weight', '4'))
const overlap2Weight = Number(argValue('--overlap2-weight', '1.5'))
const overlap3Weight = Number(argValue('--overlap3-weight', '30'))
const exact4Weight = Number(argValue('--exact4-weight', '80'))
const partnerFirst = process.argv.includes('--partner-first')

function round(n: number, digits = 2) {
  return Number(n.toFixed(digits))
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function groupKey(match: Match) {
  return [...match.team_a, ...match.team_b].sort().join(':')
}

function overlap(left: Match, right: Match) {
  const rightIds = new Set([...right.team_a, ...right.team_b])
  return [...left.team_a, ...left.team_b].filter(id => rightIds.has(id)).length
}

function recentRounds(state: SessionState, roundNo: number, window: number) {
  return state.rounds
    .filter(round => round.status === 'completed')
    .filter(round => roundNo > round.round_no && roundNo <= round.round_no + window)
}

function decay(roundNo: number, previousRoundNo: number) {
  const distance = Math.max(1, roundNo - previousRoundNo)
  if (distance === 1) return 1
  if (distance === 2) return 0.65
  return 0.35
}

function recentRepeatCost(match: Match, state: SessionState, roundNo: number, window = 3): RecentCost {
  const cost: RecentCost = { total: 0, partner: 0, opponent: 0, overlap2: 0, overlap3: 0, exact4: 0 }
  const partners = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
  const opponents = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
  const matchGroupKey = groupKey(match)

  for (const round of recentRounds(state, roundNo, window)) {
    const weight = decay(roundNo, round.round_no)
    for (const previous of round.matches) {
      const previousPartners = [pairKey(previous.team_a[0], previous.team_a[1]), pairKey(previous.team_b[0], previous.team_b[1])]
      const previousOpponents = previous.team_a.flatMap(a => previous.team_b.map(b => pairKey(a, b)))
      const partnerHits = partners.filter(key => previousPartners.includes(key)).length
      const opponentHits = opponents.filter(key => previousOpponents.includes(key)).length
      const playerOverlap = overlap(match, previous)

      cost.partner += partnerHits * weight
      cost.opponent += opponentHits * weight
      if (playerOverlap === 2) cost.overlap2 += weight
      if (playerOverlap === 3) cost.overlap3 += weight
      if (playerOverlap === 4 || groupKey(previous) === matchGroupKey) cost.exact4 += weight
    }
  }

  cost.total =
    cost.partner * partnerRecentWeight +
    cost.opponent * opponentRecentWeight +
    cost.overlap2 * overlap2Weight +
    cost.overlap3 * overlap3Weight +
    cost.exact4 * exact4Weight
  return cost
}

function intraGap(match: Match, state: SessionState) {
  const teamGap = (team: [string, string]) => {
    const left = state.players.get(team[0])?.pvna ?? 0
    const right = state.players.get(team[1])?.pvna ?? 0
    return Math.abs(left - right)
  }
  return Math.max(teamGap(match.team_a), teamGap(match.team_b))
}

function tradeoffScore(alternative: SuggestionAlternative) {
  return alternative.tradeoffs?.reduce((sum, item) => sum + item.severity, 0) ?? 0
}

function chooseAlternative(
  variant: Variant,
  alternatives: SuggestionAlternative[],
  state: SessionState,
  roundNo: number,
) {
  if (variant === 'current') return alternatives[0]
  return [...alternatives].sort((a, b) => {
    const matchA = a.matches[0]
    const matchB = b.matches[0]
    if (!matchA || !matchB) return matchA ? -1 : 1
    const tradeoffDiff = tradeoffScore(a) - tradeoffScore(b)
    if (tradeoffDiff !== 0) return tradeoffDiff
    const recentA = recentRepeatCost(matchA, state, roundNo)
    const recentB = recentRepeatCost(matchB, state, roundNo)
    if (partnerFirst && recentA.partner !== recentB.partner) {
      return recentA.partner - recentB.partner
    }
    const recentDiff = recentA.total - recentB.total
    if (recentDiff !== 0) return recentDiff
    const pvnaOverA = Math.max(0, (matchA.stats?.pvna_diff ?? 0) - state.config.pvna_tolerance)
    const pvnaOverB = Math.max(0, (matchB.stats?.pvna_diff ?? 0) - state.config.pvna_tolerance)
    if (pvnaOverA !== pvnaOverB) return pvnaOverA - pvnaOverB
    const intraDiff = intraGap(matchA, state) - intraGap(matchB, state)
    if (Math.abs(intraDiff) > 0.25) return intraDiff
    return (matchA.stats?.pvna_diff ?? 0) - (matchB.stats?.pvna_diff ?? 0)
  })[0]
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

function summarize(values: number[]) {
  return {
    avg: round(avg(values)),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: round(Math.max(0, ...values)),
  }
}

function runVariant(
  variant: Variant,
  baseState: SessionState,
  names: Map<string, PlayerName>,
  rounds: number,
  courts: number,
) {
  let state = { ...baseState, players: new Map(baseState.players), rounds: [...baseState.rounds], current_round: 0 }
  const rows: Array<{
    round: number
    court: number
    match: string
    pvna: number
    intra: number
    currentRank: number
    recent: RecentCost
    alternatives: number
    suggestMs: number
  }> = []

  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  const teamLabel = (team: [string, string]) => `${label(team[0])}+${label(team[1])}`
  for (let roundNo = 0; roundNo < rounds; roundNo += 1) {
    let roundBusyIds = new Set<string>()
    const playedThisRound = new Set<string>()
    for (let courtIdx = 0; courtIdx < courts; courtIdx += 1) {
      const searchState = { ...state, current_round: roundNo }
      const busyState = {
        ...searchState,
        players: new Map([...searchState.players.entries()].map(([id, player]) => [
          id,
          roundBusyIds.has(id) ? { ...player, checked_out_at: new Date() } : player,
        ])),
      }
      const adjustment = correctForFairness(busyState)
      const adjustedState = applyFairnessAdjustment(searchState, adjustment)
      const startedAt = performance.now()
      const result = suggestNextMatch(adjustedState, {
        busy_player_ids: roundBusyIds,
        court_idx: courtIdx,
        tier_overrides: adjustment.tier_overrides,
        max_alternatives: maxAlternatives,
      })
      const suggestMs = performance.now() - startedAt
      const alt = chooseAlternative(variant, result.alternatives, adjustedState, roundNo)
      const match = alt?.matches[0]
      if (!alt || !match) throw new Error(`${variant}: no suggestion at R${roundNo + 1} C${courtIdx + 1}`)

      const selectedKey = groupKey(match)
      const currentRank = Math.max(1, result.alternatives.findIndex(item => {
        const other = item.matches[0]
        return other && groupKey(other) === selectedKey
      }) + 1)
      const recent = recentRepeatCost(match, adjustedState, roundNo)
      rows.push({
        round: roundNo + 1,
        court: courtIdx + 1,
        match: `${teamLabel(match.team_a)} vs ${teamLabel(match.team_b)}`,
        pvna: round(match.stats?.pvna_diff ?? 0),
        intra: round(intraGap(match, adjustedState)),
        currentRank,
        recent,
        alternatives: result.alternatives.length,
        suggestMs,
      })

      for (const id of [...match.team_a, ...match.team_b]) {
        roundBusyIds.add(id)
        playedThisRound.add(id)
      }
      state = projectMatch(state, match, roundNo, courtIdx)
    }
    state = buildProjectedStateAfterCompletedLiveRound({ ...state, current_round: roundNo + 1 }, playedThisRound)
  }

  const recentTotals = rows.map(row => row.recent.total)
  const pvna = rows.map(row => row.pvna)
  const intra = rows.map(row => row.intra)
  const timing = rows.map(row => row.suggestMs)
  return {
    variant,
    matches: rows.length,
    summary: {
      recentCost: summarize(recentTotals),
      recentPartnerWeighted: round(rows.reduce((sum, row) => sum + row.recent.partner, 0)),
      recentOpponentWeighted: round(rows.reduce((sum, row) => sum + row.recent.opponent, 0)),
      overlap2Weighted: round(rows.reduce((sum, row) => sum + row.recent.overlap2, 0)),
      overlap3Weighted: round(rows.reduce((sum, row) => sum + row.recent.overlap3, 0)),
      exact4Weighted: round(rows.reduce((sum, row) => sum + row.recent.exact4, 0)),
      matchesWithRecentCost: rows.filter(row => row.recent.total > 0).length,
      matchesWithPartnerRecent: rows.filter(row => row.recent.partner > 0).length,
      matchesWithOpponentRecent: rows.filter(row => row.recent.opponent > 0).length,
      matchesWithOverlap2: rows.filter(row => row.recent.overlap2 > 0).length,
      matchesWithOverlap3: rows.filter(row => row.recent.overlap3 > 0).length,
      pvna: summarize(pvna),
      intra: summarize(intra),
      pvnaOverCap: rows.filter(row => row.pvna > baseState.config.pvna_tolerance).length,
      intraOverPreferred: rows.filter(row => row.intra > 0.75).length,
      pickedNonTop: rows.filter(row => row.currentRank > 1).length,
      suggestTimingMs: summarize(timing),
    },
    worstRecent: rows
      .filter(row => row.recent.total > 0)
      .sort((a, b) => b.recent.total - a.recent.total)
      .slice(0, 8)
      .map(row => ({
        round: row.round,
        court: row.court,
        match: row.match,
        pvna: row.pvna,
        intra: row.intra,
        rank: row.currentRank,
        recent: {
          total: round(row.recent.total),
          partner: round(row.recent.partner),
          opponent: round(row.recent.opponent),
          overlap2: round(row.recent.overlap2),
          overlap3: round(row.recent.overlap3),
          exact4: round(row.recent.exact4),
        },
      })),
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
      .select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId),
    client
      .from('session_player_state')
      .select('player_id, players(name, pvna)')
      .eq('session_id', sessionId),
  ])
  if (playersRes.error) throw playersRes.error
  if (preferenceRes.error) throw preferenceRes.error
  if (namesRes.error) throw namesRes.error

  const sessionPlayerRows = (preferenceRes.data ?? []) as Array<SessionPlayerPreferenceRow & {
    session_id?: string
    created_at?: string
  }>
  const stateRows = (playersRes.data ?? []) as SessionPlayerStateRow[]
  const playerRows: SessionPlayerStateRow[] = (stateRows.length > 0
    ? stateRows
    : sessionPlayerRows.map((row: any) => ({
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
  const rawNameRows = (namesRes.data ?? []).length > 0 ? namesRes.data ?? [] : sessionPlayerRows
  const names = new Map<string, PlayerName>(rawNameRows.map((row: any) => [String(row.player_id), {
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
    preferenceRows: (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[],
    courts,
    pvnaTolerance,
  })

  const current = runVariant('current', baseState, names, roundsToSimulate, courts)
  const window3 = runVariant('window3', baseState, names, roundsToSimulate, courts)
  console.log(JSON.stringify({
    sessionId,
    rounds: roundsToSimulate,
    courts,
    players: playerRows.length,
    maxAlternatives,
    weights: {
      partnerRecentWeight,
      opponentRecentWeight,
      overlap2Weight,
      overlap3Weight,
      exact4Weight,
      partnerFirst,
    },
    courtReasoning: courtCalculator.reasoning,
    current,
    window3,
    delta: {
      recentCostAvg: round(window3.summary.recentCost.avg - current.summary.recentCost.avg),
      recentCostP95: round(window3.summary.recentCost.p95 - current.summary.recentCost.p95),
      matchesWithRecentCost: window3.summary.matchesWithRecentCost - current.summary.matchesWithRecentCost,
      partnerRecent: window3.summary.matchesWithPartnerRecent - current.summary.matchesWithPartnerRecent,
      opponentRecent: window3.summary.matchesWithOpponentRecent - current.summary.matchesWithOpponentRecent,
      overlap2: window3.summary.matchesWithOverlap2 - current.summary.matchesWithOverlap2,
      overlap3: window3.summary.matchesWithOverlap3 - current.summary.matchesWithOverlap3,
      pvnaAvg: round(window3.summary.pvna.avg - current.summary.pvna.avg),
      pvnaP95: round(window3.summary.pvna.p95 - current.summary.pvna.p95),
      intraAvg: round(window3.summary.intra.avg - current.summary.intra.avg),
      intraP95: round(window3.summary.intra.p95 - current.summary.intra.p95),
      pickedNonTop: window3.summary.pickedNonTop - current.summary.pickedNonTop,
      suggestAvgMs: round(window3.summary.suggestTimingMs.avg - current.summary.suggestTimingMs.avg),
    },
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
