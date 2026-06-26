import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { commitCompletedRound } from '@/lib/next-round-suggester/commit'
import { correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { computeOpponentRepeatBurden, computePartnerRepeatBurden } from '@/lib/next-round-suggester/fairness/metrics'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import type { Match, PlayerSessionState, SessionPairHistoryRow, SessionPlayerPreferenceRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/simulate-next-round-session.ts <session-id> --rounds=40')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const roundsToSimulate = Math.max(1, Number(argValue('--rounds', '40')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const injectGroupCount = Math.max(0, Number(argValue('--inject-group-count', '0')))
const injectGroupSize = Math.max(2, Number(argValue('--inject-group-size', '2')))
const mutationScenario = argValue('--mutation-scenario', 'baseline')

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

type PlayerName = { name: string; pvna: number }

function format(n: number, digits = 2) {
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

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => `${value}:${count}`)
    .join(', ')
}

function timingSummary(values: number[]) {
  return {
    total_ms: format(values.reduce((sum, value) => sum + value, 0)),
    avg_ms: format(avg(values)),
    p50_ms: format(percentile(values, 50)),
    p95_ms: format(percentile(values, 95)),
    max_ms: format(Math.max(0, ...values)),
  }
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function hydratePairHistory(
  players: Map<string, PlayerSessionState>,
  pairRows: SessionPairHistoryRow[],
) {
  return new Map([...players.entries()].map(([playerId, player]) => [
    playerId,
    {
      ...player,
      partner_counts: new Map(
        pairRows
          .filter(row => row.player_a === playerId || row.player_b === playerId)
          .map(row => [
            row.player_a === playerId ? row.player_b : row.player_a,
            row.partner_count,
          ]),
      ),
      opponent_counts: new Map(
        pairRows
          .filter(row => row.player_a === playerId || row.player_b === playerId)
          .map(row => [
            row.player_a === playerId ? row.player_b : row.player_a,
            row.opponent_count,
          ]),
      ),
    },
  ]))
}

async function main() {
  const client = createClient(url!, anon!, {
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

  const names = new Map<string, PlayerName>((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
    name: row.players?.name ?? String(row.player_id).slice(0, 8),
    pvna: Number(row.players?.pvna ?? 3),
  }]))
  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  const teamSum = (team: [string, string]) => team.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0)
  const teamLabel = (team: [string, string]) => `${label(team[0])}+${label(team[1])}`

  const playerCount = ((playersRes.data ?? []) as SessionPlayerStateRow[]).length
  const courtCalculator = calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: sessionDurationMin,
    match_duration_min: matchDurationMin,
    preset: courtPreset,
  })
  const courtCount = courtCalculator.recommended.courts

  const basePlayerRows = ((playersRes.data ?? []) as SessionPlayerStateRow[]).map(row => ({
    ...row,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
  }))
  if (injectGroupCount > 0) {
    for (let groupIndex = 0; groupIndex < injectGroupCount; groupIndex += 1) {
      const groupId = `sim_group_${groupIndex + 1}`
      const start = groupIndex * injectGroupSize
      for (let offset = 0; offset < injectGroupSize; offset += 1) {
        const row = basePlayerRows[start + offset]
        if (row) row.group_id = groupId
      }
    }
  }
  if (mutationScenario === 'late_checkin_4_round3' || mutationScenario === 'mixed_late_checkout_rest') {
    for (const row of basePlayerRows.slice(0, 4)) row.checked_out_at = new Date().toISOString()
  }

  let pairRows: SessionPairHistoryRow[] = []
  let state = mapRowsToSessionState({
    sessionId,
    playerRows: basePlayerRows,
    pairRows,
    roundRows: [],
    preferenceRows: (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[],
    courts: courtCount,
    pvnaTolerance,
  })

  const matchCounts = new Map([...state.players.keys()].map(id => [id, 0]))
  const restCounts = new Map([...state.players.keys()].map(id => [id, 0]))
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  const matchStats: Array<{
    round: number
    court: number
    match: string
    sum: string
    gap: number
    maxProjectedPartnerPair: number
    maxProjectedOpponentPair: number
  }> = []
  const warningsByRound: Array<{ round: number; warnings: string[]; tradeoffs: number }> = []
  const roundSummaries: Array<{
    round: number
    overCapMatches: number
    maxProjectedPartnerPair: number
    maxProjectedOpponentPair: number
    warnings: string[]
    tradeoffs: number
  }> = []
  const suggestTimes: number[] = []

  for (let roundNo = 0; roundNo < roundsToSimulate; roundNo += 1) {
    applyMutationScenario(state, mutationScenario, roundNo)
    const adjustment = correctForFairness(state)
    const suggestStartedAt = performance.now()
    const suggestion = suggestNextRound(state, {
      tier_overrides: adjustment.tier_overrides,
      max_alternatives: 1,
    })
    suggestTimes.push(performance.now() - suggestStartedAt)
    const alternative = suggestion.alternatives[0]
    if (!alternative) throw new Error(`No suggestion at round ${roundNo + 1}: ${suggestion.warnings.join(', ')}`)

    warningsByRound.push({
      round: roundNo + 1,
      warnings: alternative.warnings,
      tradeoffs: alternative.tradeoffs?.length ?? 0,
    })
    let roundOverCapMatches = 0
    let roundMaxProjectedPartnerPair = 0
    let roundMaxProjectedOpponentPair = 0

    for (const match of alternative.matches) {
      const partnerKeys = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
      const opponentKeys = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
      const projectedPartner = Math.max(...partnerKeys.map(key => (partnerCounts.get(key) ?? 0) + 1))
      const projectedOpponent = Math.max(...opponentKeys.map(key => (opponentCounts.get(key) ?? 0) + 1))
      roundMaxProjectedPartnerPair = Math.max(roundMaxProjectedPartnerPair, projectedPartner)
      roundMaxProjectedOpponentPair = Math.max(roundMaxProjectedOpponentPair, projectedOpponent)
      if (projectedPartner > 2 || projectedOpponent > 2) roundOverCapMatches += 1
      for (const key of partnerKeys) partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
      for (const key of opponentKeys) opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)

      for (const id of [...match.team_a, ...match.team_b]) {
        matchCounts.set(id, (matchCounts.get(id) ?? 0) + 1)
      }

      const aSum = teamSum(match.team_a)
      const bSum = teamSum(match.team_b)
      matchStats.push({
        round: roundNo + 1,
        court: (match.court_idx ?? 0) + 1,
        match: `${teamLabel(match.team_a)} vs ${teamLabel(match.team_b)}`,
        sum: `${format(aSum)}-${format(bSum)}`,
        gap: Math.abs(aSum - bSum),
        maxProjectedPartnerPair: projectedPartner,
        maxProjectedOpponentPair: projectedOpponent,
      })
    }

    for (const id of alternative.resting) {
      restCounts.set(id, (restCounts.get(id) ?? 0) + 1)
    }

    const round = {
      session_id: sessionId,
      round_no: roundNo,
      status: 'completed' as const,
      matches: alternative.matches,
      resting: alternative.resting,
      started_at: new Date(),
      ended_at: new Date(),
    }
    const committed = commitCompletedRound(state, round, pairRows)
    pairRows = committed.pairHistory
    state = {
      ...state,
      players: hydratePairHistory(committed.players, pairRows),
      rounds: [...state.rounds, round],
      current_round: roundNo + 1,
    }
    roundSummaries.push({
      round: roundNo + 1,
      overCapMatches: roundOverCapMatches,
      maxProjectedPartnerPair: roundMaxProjectedPartnerPair,
      maxProjectedOpponentPair: roundMaxProjectedOpponentPair,
      warnings: alternative.warnings,
      tradeoffs: alternative.tradeoffs?.length ?? 0,
    })
  }

  const gaps = matchStats.map(row => row.gap)
  const matchValues = [...matchCounts.values()]
  const restValues = [...restCounts.values()]
  const partnerBurden = computePartnerRepeatBurden(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const repeatCapMatches = matchStats.filter(row => row.maxProjectedPartnerPair > 2 || row.maxProjectedOpponentPair > 2)
  const worstGaps = [...matchStats].sort((a, b) => b.gap - a.gap).slice(0, 10)
  const groupPartnerPairs = [...partnerCounts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split(':')
      const playerA = state.players.get(a)
      const playerB = state.players.get(b)
      return {
        pair: `${label(a)}+${label(b)}`,
        count,
        sameGroup: Boolean(playerA?.group_id && playerA.group_id === playerB?.group_id),
      }
    })
    .filter(row => row.sameGroup)

  console.log(JSON.stringify({
    sessionId,
    mode: 'next-round-batch-aware-local-simulation',
    mutationScenario,
    injectedGroups: {
      count: injectGroupCount,
      size: injectGroupSize,
      groupedPlayers: basePlayerRows.filter(row => row.group_id).length,
    },
    rounds: roundsToSimulate,
    matches: matchStats.length,
    players: state.players.size,
    courtCalculator: {
      preset: courtPreset,
      sessionDurationMin,
      matchDurationMin,
      recommendedCourts: courtCount,
      reasoning: courtCalculator.reasoning,
    },
    pvnaGap: {
      avg: format(avg(gaps)),
      p50: format(percentile(gaps, 50)),
      p90: format(percentile(gaps, 90)),
      max: format(Math.max(...gaps)),
      over_0_5: gaps.filter(value => value > 0.5).length,
      over_1_0: gaps.filter(value => value > 1).length,
    },
    repeat: {
      matchesOverProjectedPairCap2: repeatCapMatches.length,
      maxFinalPartnerPairCount: Math.max(0, ...partnerCounts.values()),
      maxFinalOpponentPairCount: Math.max(0, ...opponentCounts.values()),
      maxRepeatedPartnersPerPlayer: partnerBurden.max_repeated_partners,
      maxRepeatedOpponentsPerPlayer: opponentBurden.max_repeated_opponents,
      avgRepeatedPartnersPerPlayer: format(partnerBurden.avg_repeated_partners),
      avgRepeatedOpponentsPerPlayer: format(opponentBurden.avg_repeated_opponents),
    },
    groupService: {
      sameGroupPartnerPairCount: groupPartnerPairs.length,
      totalSameGroupPartnerMatches: groupPartnerPairs.reduce((sum, row) => sum + row.count, 0),
      maxSameGroupPartnerCount: Math.max(0, ...groupPartnerPairs.map(row => row.count)),
      sameGroupPairs: groupPartnerPairs.sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair)),
    },
    playerDistribution: {
      matchCount: {
        min: Math.min(...matchValues),
        max: Math.max(...matchValues),
        avg: format(avg(matchValues)),
        bucket: bucket(matchValues),
      },
      restCount: {
        min: Math.min(...restValues),
        max: Math.max(...restValues),
        avg: format(avg(restValues)),
        bucket: bucket(restValues),
      },
    },
    warnings: {
      roundsWithWarningsOrTradeoffs: warningsByRound.filter(row => row.warnings.length > 0 || row.tradeoffs > 0).length,
      warningCount: warningsByRound.reduce((sum, row) => sum + row.warnings.length, 0),
      tradeoffCount: warningsByRound.reduce((sum, row) => sum + row.tradeoffs, 0),
    },
    timing: timingSummary(suggestTimes),
    roundSummaries,
    worstGaps,
    repeatCapExamples: repeatCapMatches.slice(0, 10),
  }, null, 2))
}

function applyMutationScenario(state: ReturnType<typeof mapRowsToSessionState>, scenario: string, roundIndex: number) {
  const ids = [...state.players.keys()]
  const now = new Date()

  if (scenario === 'late_checkin_4_round3' && roundIndex === 2) {
    patchPlayers(state, ids.slice(0, 4), { checked_out_at: null, checked_in_at: now })
  }

  if (scenario === 'checkout_4_round4' && roundIndex === 3) {
    patchPlayers(state, ids.slice(-4), { checked_out_at: now })
  }

  if (scenario === 'opt_rest_4_round3_4') {
    if (roundIndex === 2) patchPlayers(state, ids.slice(0, 4), { opted_rest: true })
    if (roundIndex === 4) patchPlayers(state, ids.slice(0, 4), { opted_rest: false })
  }

  if (scenario === 'mixed_late_checkout_rest') {
    if (roundIndex === 2) patchPlayers(state, ids.slice(0, 4), { checked_out_at: null, checked_in_at: now })
    if (roundIndex === 4) patchPlayers(state, ids.slice(4, 8), { checked_out_at: now })
    if (roundIndex === 5) patchPlayers(state, ids.slice(8, 12), { opted_rest: true })
    if (roundIndex === 6) patchPlayers(state, ids.slice(8, 12), { opted_rest: false })
  }
}

function patchPlayers(
  state: ReturnType<typeof mapRowsToSessionState>,
  ids: string[],
  patch: Partial<PlayerSessionState>,
) {
  for (const id of ids) {
    const player = state.players.get(id)
    if (!player) continue
    state.players.set(id, { ...player, ...patch })
  }
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
