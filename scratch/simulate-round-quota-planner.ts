import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { commitCompletedRound } from '../lib/next-round-suggester/commit'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeOpponentRepeatBurden, computePartnerRepeatBurden } from '../lib/next-round-suggester/fairness/metrics'
import { bestPartitioning } from '../lib/next-round-suggester/pair'
import { getRecentRepeatCost } from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import { Tier } from '../lib/next-round-suggester/classify'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
} from '../lib/next-round-suggester/types'

type Variant = 'batch_current' | 'round_quota'
type PlayerName = { name: string; pvna: number }

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/simulate-round-quota-planner.ts <session-id> --rounds=8')

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
const maxAlternatives = Math.max(1, Number(argValue('--max-alternatives', '20')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const courtCountArg = argValue('--courts', '')

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
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

function summarize(values: number[]) {
  return {
    avg: round(avg(values)),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: round(Math.max(0, ...values)),
  }
}

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a - b)
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function teamPvna(team: [string, string], state: SessionState) {
  return (state.players.get(team[0])?.pvna ?? 0) + (state.players.get(team[1])?.pvna ?? 0)
}

function intraGap(match: Match, state: SessionState) {
  const gap = (team: [string, string]) => Math.abs(
    (state.players.get(team[0])?.pvna ?? 0) - (state.players.get(team[1])?.pvna ?? 0),
  )
  return Math.max(gap(match.team_a), gap(match.team_b))
}

function cloneInitialState(baseState: SessionState): SessionState {
  return {
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

function makeQuotaSearchState(state: SessionState, roundNo: number, slots: number) {
  const activePlayers = [...state.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest)
  const slotsAfterRound = (roundNo + 1) * slots
  const targetMinAfter = Math.floor(slotsAfterRound / Math.max(1, activePlayers.length))
  const targetMaxAfter = Math.ceil(slotsAfterRound / Math.max(1, activePlayers.length))
  const requiredIds = activePlayers
    .filter(player => player.matches_played < targetMinAfter)
    .sort((a, b) =>
      a.matches_played - b.matches_played ||
      b.consecutive_rest - a.consecutive_rest ||
      a.last_played_round - b.last_played_round ||
      a.player_id.localeCompare(b.player_id),
    )
    .map(player => player.player_id)

  let relaxedMax = targetMaxAfter
  let cappedIds = activePlayers
    .filter(player => player.matches_played >= relaxedMax && !requiredIds.includes(player.player_id))
    .map(player => player.player_id)

  while (activePlayers.length - cappedIds.length < slots && cappedIds.length > 0) {
    relaxedMax += 1
    cappedIds = activePlayers
      .filter(player => player.matches_played >= relaxedMax && !requiredIds.includes(player.player_id))
      .map(player => player.player_id)
  }

  const now = new Date()
  const capped = new Set(cappedIds)
  const players = new Map([...state.players.entries()].map(([id, player]) => [
    id,
    capped.has(id)
      ? { ...player, checked_out_at: player.checked_out_at ?? now, opted_rest: false }
      : player,
  ]))

  return {
    searchState: { ...state, players },
    targetMinAfter,
    targetMaxAfter,
    relaxedMax,
    requiredIds,
    cappedIds,
  }
}

function selectedIds(alternative: SuggestionAlternative) {
  return new Set(alternative.matches.flatMap(match => [...match.team_a, ...match.team_b]))
}

function quotaViolationScore(alternative: SuggestionAlternative, state: SessionState, targetMax: number, targetMin: number) {
  const selected = selectedIds(alternative)
  let over = 0
  let under = 0
  for (const player of state.players.values()) {
    if (player.checked_out_at !== null || player.opted_rest) continue
    const projected = player.matches_played + (selected.has(player.player_id) ? 1 : 0)
    over += Math.max(0, projected - targetMax)
    under += Math.max(0, targetMin - projected)
  }
  return { over, under, total: over * 100 + under }
}

function alternativeQuality(alternative: SuggestionAlternative, state: SessionState, roundNo: number) {
  const pvna = alternative.matches.map(match => Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)))
  const intra = alternative.matches.map(match => intraGap(match, state))
  const recent = alternative.matches.map(match => getRecentRepeatCost(match.team_a, match.team_b, state, roundNo).total)
  return {
    pvnaAvg: avg(pvna),
    pvnaMax: Math.max(0, ...pvna),
    intraAvg: avg(intra),
    intraMax: Math.max(0, ...intra),
    recentTotal: recent.reduce((sum, value) => sum + value, 0),
  }
}

function chooseRoundQuotaAlternative(
  alternatives: SuggestionAlternative[],
  originalState: SessionState,
  searchState: SessionState,
  roundNo: number,
  targetMaxAfter: number,
  targetMinAfter: number,
) {
  return [...alternatives].sort((a, b) => {
    const quotaA = quotaViolationScore(a, originalState, targetMaxAfter, targetMinAfter)
    const quotaB = quotaViolationScore(b, originalState, targetMaxAfter, targetMinAfter)
    if (quotaA.total !== quotaB.total) return quotaA.total - quotaB.total

    const tradeoffA = a.tradeoffs?.length ?? 0
    const tradeoffB = b.tradeoffs?.length ?? 0
    if (tradeoffA !== tradeoffB) return tradeoffA - tradeoffB

    const qualityA = alternativeQuality(a, searchState, roundNo)
    const qualityB = alternativeQuality(b, searchState, roundNo)
    if (qualityA.recentTotal !== qualityB.recentTotal) return qualityA.recentTotal - qualityB.recentTotal
    if (qualityA.pvnaMax !== qualityB.pvnaMax) return qualityA.pvnaMax - qualityB.pvnaMax
    if (qualityA.intraMax !== qualityB.intraMax) return qualityA.intraMax - qualityB.intraMax
    return qualityA.pvnaAvg + qualityA.intraAvg - qualityB.pvnaAvg - qualityB.intraAvg
  })[0] ?? null
}

function fallbackQuotaPartition(state: SessionState, roundNo: number, slots: number) {
  const activePlayers = [...state.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest)
  const slotsAfterRound = (roundNo + 1) * slots
  const targetMinAfter = Math.floor(slotsAfterRound / Math.max(1, activePlayers.length))
  const targetMaxAfter = Math.ceil(slotsAfterRound / Math.max(1, activePlayers.length))
  const selected = [...activePlayers]
    .sort((a, b) =>
      a.matches_played - b.matches_played ||
      b.consecutive_rest - a.consecutive_rest ||
      a.last_played_round - b.last_played_round ||
      a.player_id.localeCompare(b.player_id),
    )
    .slice(0, slots)
  const partition = bestPartitioning(selected, state, {
    allowRelaxedTolerance: true,
    allowRepeatOverflow: true,
    allowRecentGroupRematch: true,
  })
  if (!partition) return null
  const selectedSet = new Set(selected.map(player => player.player_id))
  const resting = activePlayers.filter(player => !selectedSet.has(player.player_id)).map(player => player.player_id).sort()
  return {
    alternative: {
      matches: partition.matches,
      resting,
      score: partition.score,
      warnings: ['QUOTA_FALLBACK_PARTITION'],
      tradeoffs: [],
      approval_required: false,
      stats: partition.stats,
      iterations: partition.iterations,
    } satisfies SuggestionAlternative,
    targetMinAfter,
    targetMaxAfter,
    relaxedMax: targetMaxAfter,
    requiredIds: activePlayers.filter(player => player.matches_played < targetMinAfter).map(player => player.player_id),
    cappedIds: activePlayers.filter(player => player.matches_played >= targetMaxAfter).map(player => player.player_id),
    usedFallback: true,
  }
}

function chooseAlternativeForVariant(variant: Variant, state: SessionState, roundNo: number, courts: number) {
  const slots = courts * 4
  if (variant === 'batch_current') {
    const adjustment = correctForFairness(state)
    const started = performance.now()
    const suggestion = suggestNextRound(state, {
      tier_overrides: adjustment.tier_overrides,
      max_alternatives: maxAlternatives,
    })
    const elapsedMs = performance.now() - started
    return {
      alternative: suggestion.alternatives[0] ?? null,
      elapsedMs,
      targetMinAfter: null,
      targetMaxAfter: null,
      relaxedMax: null,
      requiredIds: [],
      cappedIds: [],
      usedFallback: false,
    }
  }

  const quota = makeQuotaSearchState(state, roundNo, slots)
  const adjustment = correctForFairness(quota.searchState)
  const tierOverrides = {
    ...adjustment.tier_overrides,
    ...Object.fromEntries(quota.requiredIds.map(id => [id, Tier.MUST_PLAY])),
  }
  const started = performance.now()
  const suggestion = suggestNextRound(quota.searchState, {
    tier_overrides: tierOverrides,
    max_alternatives: maxAlternatives,
  })
  const elapsedMs = performance.now() - started
  const alternative = chooseRoundQuotaAlternative(
    suggestion.alternatives,
    state,
    quota.searchState,
    roundNo,
    quota.relaxedMax,
    quota.targetMinAfter,
  )

  if (alternative) {
    return {
      alternative,
      elapsedMs,
      targetMinAfter: quota.targetMinAfter,
      targetMaxAfter: quota.targetMaxAfter,
      relaxedMax: quota.relaxedMax,
      requiredIds: quota.requiredIds,
      cappedIds: quota.cappedIds,
      usedFallback: false,
    }
  }

  const fallback = fallbackQuotaPartition(state, roundNo, slots)
  if (!fallback) {
    return {
      alternative: null,
      elapsedMs,
      targetMinAfter: quota.targetMinAfter,
      targetMaxAfter: quota.targetMaxAfter,
      relaxedMax: quota.relaxedMax,
      requiredIds: quota.requiredIds,
      cappedIds: quota.cappedIds,
      usedFallback: false,
    }
  }
  return { ...fallback, elapsedMs, usedFallback: true }
}

function runVariant(variant: Variant, baseState: SessionState, rounds: number, courts: number) {
  let state = cloneInitialState(baseState)
  let pairRows: SessionPairHistoryRow[] = []
  const rows: Array<{
    round: number
    court: number
    pvna: number
    intra: number
    recent: number
    partnerMax: number
    opponentMax: number
  }> = []
  const roundRows: Array<{
    round: number
    targetMinAfter: number | null
    targetMaxAfter: number | null
    relaxedMax: number | null
    required: number
    capped: number
    fallback: boolean
    quotaOver: number
    quotaUnder: number
  }> = []
  const timings: number[] = []

  for (let roundNo = 0; roundNo < rounds; roundNo += 1) {
    const choice = chooseAlternativeForVariant(variant, state, roundNo, courts)
    if (!choice.alternative) throw new Error(`${variant}: no suggestion at round ${roundNo + 1}`)
    timings.push(choice.elapsedMs)
    const quota = choice.targetMaxAfter === null || choice.targetMinAfter === null
      ? { over: 0, under: 0 }
      : quotaViolationScore(choice.alternative, state, choice.relaxedMax ?? choice.targetMaxAfter, choice.targetMinAfter)

    for (const match of choice.alternative.matches) {
      const partnerCounts = [
        (state.players.get(match.team_a[0])?.partner_counts.get(match.team_a[1]) ?? 0) + 1,
        (state.players.get(match.team_b[0])?.partner_counts.get(match.team_b[1]) ?? 0) + 1,
      ]
      const opponentCounts = match.team_a.flatMap(a =>
        match.team_b.map(b => (state.players.get(a)?.opponent_counts.get(b) ?? 0) + 1),
      )
      rows.push({
        round: roundNo + 1,
        court: (match.court_idx ?? 0) + 1,
        pvna: round(Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state))),
        intra: round(intraGap(match, state)),
        recent: round(getRecentRepeatCost(match.team_a, match.team_b, state, roundNo).total),
        partnerMax: Math.max(...partnerCounts),
        opponentMax: Math.max(...opponentCounts),
      })
    }

    roundRows.push({
      round: roundNo + 1,
      targetMinAfter: choice.targetMinAfter,
      targetMaxAfter: choice.targetMaxAfter,
      relaxedMax: choice.relaxedMax,
      required: choice.requiredIds.length,
      capped: choice.cappedIds.length,
      fallback: choice.usedFallback,
      quotaOver: quota.over,
      quotaUnder: quota.under,
    })

    const completedRound: RoundRecord = {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed',
      matches: choice.alternative.matches,
      resting: choice.alternative.resting,
      started_at: new Date(),
      ended_at: new Date(),
    }
    const committed = commitCompletedRound(state, completedRound, pairRows)
    pairRows = committed.pairHistory
    state = {
      ...state,
      players: hydratePairHistory(committed.players, pairRows),
      rounds: [...state.rounds, completedRound],
      current_round: roundNo + 1,
    }
  }

  const activeCounts = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .map(player => player.matches_played)
  const partnerBurden = computePartnerRepeatBurden(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const pvna = rows.map(row => row.pvna)
  const intra = rows.map(row => row.intra)
  const recent = rows.map(row => row.recent)

  return {
    variant,
    playerDistribution: {
      min: Math.min(...activeCounts),
      max: Math.max(...activeCounts),
      range: Math.max(...activeCounts) - Math.min(...activeCounts),
      avg: round(avg(activeCounts)),
      bucket: bucket(activeCounts),
    },
    quality: {
      pvna: summarize(pvna),
      pvnaOverCap: pvna.filter(value => value > baseState.config.pvna_tolerance).length,
      intra: summarize(intra),
      intraOverPreferred: intra.filter(value => value > 0.75).length,
      intraOverHard: intra.filter(value => value > 1).length,
      recent: summarize(recent),
      recentCostMatches: recent.filter(value => value > 0).length,
      repeatCapMatches: rows.filter(row => row.partnerMax > 2 || row.opponentMax > 2).length,
      maxPartnerPair: Math.max(0, ...rows.map(row => row.partnerMax)),
      maxOpponentPair: Math.max(0, ...rows.map(row => row.opponentMax)),
      maxRepeatedPartnersPerPlayer: partnerBurden.max_repeated_partners,
      maxRepeatedOpponentsPerPlayer: opponentBurden.max_repeated_opponents,
    },
    timing: {
      avgMs: round(avg(timings)),
      p95Ms: round(percentile(timings, 95)),
      maxMs: round(Math.max(0, ...timings)),
    },
    roundRows,
    worstPvna: [...rows].sort((a, b) => b.pvna - a.pvna).slice(0, 8),
    worstIntra: [...rows].sort((a, b) => b.intra - a.intra).slice(0, 8),
    worstRecent: [...rows].sort((a, b) => b.recent - a.recent).slice(0, 8),
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

  const [playersRes, preferenceRes] = await Promise.all([
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
  ])
  if (playersRes.error) throw playersRes.error
  if (preferenceRes.error) throw preferenceRes.error

  const stateRows = (playersRes.data ?? []) as SessionPlayerStateRow[]
  const preferenceRows = (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[]
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
    roundRows: [],
    preferenceRows,
    courts,
    pvnaTolerance,
  })

  const batchCurrent = runVariant('batch_current', baseState, roundsToSimulate, courts)
  const roundQuota = runVariant('round_quota', baseState, roundsToSimulate, courts)

  console.log(JSON.stringify({
    sessionId,
    rounds: roundsToSimulate,
    courts,
    players: playerRows.length,
    maxAlternatives,
    courtReasoning: courtCalculator.reasoning,
    batchCurrent,
    roundQuota,
    delta: {
      matchRange: roundQuota.playerDistribution.range - batchCurrent.playerDistribution.range,
      pvnaAvg: round(roundQuota.quality.pvna.avg - batchCurrent.quality.pvna.avg),
      pvnaP95: round(roundQuota.quality.pvna.p95 - batchCurrent.quality.pvna.p95),
      pvnaOverCap: roundQuota.quality.pvnaOverCap - batchCurrent.quality.pvnaOverCap,
      intraAvg: round(roundQuota.quality.intra.avg - batchCurrent.quality.intra.avg),
      intraP95: round(roundQuota.quality.intra.p95 - batchCurrent.quality.intra.p95),
      intraOverPreferred: roundQuota.quality.intraOverPreferred - batchCurrent.quality.intraOverPreferred,
      recentAvg: round(roundQuota.quality.recent.avg - batchCurrent.quality.recent.avg),
      recentP95: round(roundQuota.quality.recent.p95 - batchCurrent.quality.recent.p95),
      repeatCapMatches: roundQuota.quality.repeatCapMatches - batchCurrent.quality.repeatCapMatches,
    },
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
