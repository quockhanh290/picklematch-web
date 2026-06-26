import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '@/lib/court-calculator'
import { Tier } from '@/lib/next-round-suggester/classify'
import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
} from '@/lib/next-round-suggester/live-preview'
import { getRecentRepeatCost } from '@/lib/next-round-suggester/score'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextMatch, suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { Match, SessionLiveMatchRow, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState } from '@/lib/next-round-suggester/types'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/simulate-live-preview-policy.ts <session-id>')

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

const rounds = Math.max(1, Number(argValue('--rounds', '8')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const courtsArg = Number(argValue('--courts', '0'))
const policy = argValue('--policy', 'current') as any
const compact = argValue('--compact', '0') === '1'
const batchRepair = argValue('--batch-repair', '0') === '1'
const repeatRepair = argValue('--repeat-repair', '0') === '1'
const repeatRepairStartRound = Math.max(1, Number(argValue('--repeat-repair-start', '5')))
const finalPvnaRescue = argValue('--final-pvna-rescue', '0') === '1'
const targetedPvnaRescue = argValue('--targeted-pvna-rescue', '0') === '1'
const rosterMutation = argValue('--roster-mutation', 'none')
const quotaGuard = argValue('--quota-guard', '0') === '1'
const roundQuotaPlan = argValue('--round-quota-plan', '0') === '1'
const roundQuotaStart = Math.max(1, Number(argValue('--round-quota-start', '1')))
const requestBatchSize = Math.max(1, Number(argValue('--request-batch-size', '999')))
const hardRoundRequiredReservation = argValue('--hard-round-required-reservation', '0') === '1'

function round(n: number, digits = 2) {
  return Number(n.toFixed(digits))
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
    p90: round(percentile(values, 90)),
    p95: round(percentile(values, 95)),
    max: round(Math.max(0, ...values)),
  }
}

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([value, count]) => `${value}:${count}`).join(', ')
}

function getRequiredForRound(state: SessionState) {
  return [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .filter(player => player.consecutive_rest >= 1)
    .sort((left, right) =>
      right.consecutive_rest - left.consecutive_rest ||
      left.matches_played - right.matches_played ||
      left.last_played_round - right.last_played_round ||
      right.pvna - left.pvna ||
      left.player_id.localeCompare(right.player_id),
    )
    .map(player => player.player_id)
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
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

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function repeatBefore(match: Match, state: SessionState) {
  const partnerPairs = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
  const opponentPairs = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
  const partner = Math.max(0, ...partnerPairs.map(key => {
    const [a, b] = key.split(':')
    return state.players.get(a)?.partner_counts.get(b) ?? 0
  }))
  const opponent = Math.max(0, ...opponentPairs.map(key => {
    const [a, b] = key.split(':')
    return state.players.get(a)?.opponent_counts.get(b) ?? 0
  }))
  return { partner, opponent }
}

type SimPayload = ReturnType<typeof buildSuggestedMatchPayloads>[number]

function payloadMatch(payload: SimPayload, courtIdx: number): Match {
  return {
    court_idx: courtIdx,
    team_a: payload.team_a,
    team_b: payload.team_b,
  }
}

function batchStats(payloads: SimPayload[], state: SessionState) {
  const matches = payloads.map((payload, index) => payloadMatch(payload, index))
  const pvnaValues = matches.map(match => Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)))
  const intraValues = matches.map(match => intraGap(match, state))
  const repeatValues = matches.map(match => repeatBefore(match, state))
  return {
    maxPvna: Math.max(0, ...pvnaValues),
    pvnaOver: pvnaValues.filter(value => value > pvnaTolerance).length,
    maxIntra: Math.max(0, ...intraValues),
    intraOverHard: intraValues.filter(value => value > 1.5).length,
    repeatMatches: repeatValues.filter(value => value.partner > 0 || value.opponent > 0).length,
  }
}

function repeatExposureStats(payloads: SimPayload[], state: SessionState) {
  const basePlayerRepeat = new Map<string, {
    partnerEvents: number
    opponentEvents: number
  }>()
  for (const player of state.players.values()) {
    basePlayerRepeat.set(player.player_id, {
      partnerEvents: [...player.partner_counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      opponentEvents: [...player.opponent_counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    })
  }
  const partnerPairs = new Map<string, number>()
  const opponentPairs = new Map<string, number>()
  const perPlayer = new Map<string, {
    partnerMatches: number
    partnerEvents: number
    opponentMatches: number
    opponentEvents: number
    maxSamePartner: number
    maxSameOpponent: number
  }>()
  const ensure = (playerId: string) => {
    const existing = perPlayer.get(playerId)
    if (existing) return existing
    const next = {
      partnerMatches: 0,
      partnerEvents: 0,
      opponentMatches: 0,
      opponentEvents: 0,
      maxSamePartner: 0,
      maxSameOpponent: 0,
    }
    perPlayer.set(playerId, next)
    return next
  }
  for (const payload of payloads) {
    const partnerPayloadPairs: Array<[string, string]> = [payload.team_a, payload.team_b]
    for (const [left, right] of partnerPayloadPairs) {
      const before = state.players.get(left)?.partner_counts.get(right) ?? 0
      const key = pairKey(left, right)
      partnerPairs.set(key, Math.max(partnerPairs.get(key) ?? 0, before + 1))
      for (const playerId of [left, right]) {
        const player = ensure(playerId)
        if (before > 0) {
          player.partnerMatches += 1
          player.partnerEvents += before
        }
        player.maxSamePartner = Math.max(player.maxSamePartner, before + 1)
      }
    }
    for (const left of payload.team_a) {
      for (const right of payload.team_b) {
        const before = state.players.get(left)?.opponent_counts.get(right) ?? 0
        const key = pairKey(left, right)
        opponentPairs.set(key, Math.max(opponentPairs.get(key) ?? 0, before + 1))
        for (const playerId of [left, right]) {
          const player = ensure(playerId)
          if (before > 0) {
            player.opponentMatches += 1
            player.opponentEvents += before
          }
          player.maxSameOpponent = Math.max(player.maxSameOpponent, before + 1)
        }
      }
    }
  }
  const playerRows = [...perPlayer.values()]
  const totalPlayerRows = [...perPlayer.entries()].map(([playerId, player]) => ({
    partnerEvents: (basePlayerRepeat.get(playerId)?.partnerEvents ?? 0) + player.partnerEvents,
    opponentEvents: (basePlayerRepeat.get(playerId)?.opponentEvents ?? 0) + player.opponentEvents,
  }))
  return {
    partnerRepeatMatches: playerRows.reduce((sum, player) => sum + player.partnerMatches, 0),
    partnerRepeatEvents: playerRows.reduce((sum, player) => sum + player.partnerEvents, 0),
    opponentRepeatMatches: playerRows.reduce((sum, player) => sum + player.opponentMatches, 0),
    opponentRepeatEvents: playerRows.reduce((sum, player) => sum + player.opponentEvents, 0),
    maxPlayerPartnerMatches: Math.max(0, ...playerRows.map(player => player.partnerMatches)),
    maxPlayerOpponentMatches: Math.max(0, ...playerRows.map(player => player.opponentMatches)),
    maxSamePartner: Math.max(0, ...playerRows.map(player => player.maxSamePartner)),
    maxSameOpponent: Math.max(0, ...playerRows.map(player => player.maxSameOpponent)),
    maxTotalPlayerPartnerEvents: Math.max(0, ...totalPlayerRows.map(player => player.partnerEvents)),
    maxTotalPlayerOpponentEvents: Math.max(0, ...totalPlayerRows.map(player => player.opponentEvents)),
    partnerX3: [...partnerPairs.values()].filter(value => value >= 3).length,
    opponentX3: [...opponentPairs.values()].filter(value => value >= 3).length,
  }
}

function setPayloadPlayer(payload: SimPayload, position: number, playerId: string): SimPayload {
  const teamA: [string, string] = [...payload.team_a] as [string, string]
  const teamB: [string, string] = [...payload.team_b] as [string, string]
  if (position < 2) teamA[position] = playerId
  else teamB[position - 2] = playerId
  return { ...payload, team_a: teamA, team_b: teamB }
}

function getPayloadPlayer(payload: SimPayload, position: number) {
  return position < 2 ? payload.team_a[position] : payload.team_b[position - 2]
}

function repairBatchPvnaOutliers(payloads: SimPayload[], state: SessionState) {
  let current = payloads
  let currentStats = batchStats(current, state)
  for (let pass = 0; pass < 3; pass += 1) {
    let bestPayloads: SimPayload[] | null = null
    let bestStats = currentStats
    for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
        for (let leftPos = 0; leftPos < 4; leftPos += 1) {
          for (let rightPos = 0; rightPos < 4; rightPos += 1) {
            const leftPlayer = getPayloadPlayer(current[leftIndex], leftPos)
            const rightPlayer = getPayloadPlayer(current[rightIndex], rightPos)
            if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) continue
            const candidate = [...current]
            candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPos, rightPlayer)
            candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPos, leftPlayer)
            const candidateStats = batchStats(candidate, state)
            const improvesPvna =
              candidateStats.maxPvna < bestStats.maxPvna - 0.25 ||
              (
                candidateStats.maxPvna < bestStats.maxPvna - 0.05 &&
                candidateStats.pvnaOver < bestStats.pvnaOver
              )
            if (!improvesPvna) continue
            if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
            if (candidateStats.intraOverHard > currentStats.intraOverHard + 1) continue
            if (candidateStats.maxIntra > currentStats.maxIntra + 0.5) continue
            const currentRepeatRatio = current.length > 0 ? currentStats.repeatMatches / current.length : 0
            const candidatePvnaIsComfortable = candidateStats.maxPvna <= 0.8
            if (currentRepeatRatio >= 0.45 && candidateStats.repeatMatches > currentStats.repeatMatches) continue
            if (candidatePvnaIsComfortable && candidateStats.repeatMatches > currentStats.repeatMatches) continue
            if (candidateStats.repeatMatches > currentStats.repeatMatches + 1) continue
            bestPayloads = candidate
            bestStats = candidateStats
          }
        }
      }
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
  }
  return current
}

function repeatRepairScore(payloads: SimPayload[], state: SessionState) {
  const repeat = repeatExposureStats(payloads, state)
  return (
    repeat.partnerX3 * 1000 +
    repeat.maxSamePartner * 180 +
    repeat.maxPlayerPartnerMatches * 120 +
    repeat.partnerRepeatMatches * 60 +
    repeat.partnerRepeatEvents * 30 +
    repeat.maxTotalPlayerPartnerEvents * 80 +
    repeat.opponentX3 * 140 +
    repeat.maxSameOpponent * 80 +
    repeat.maxPlayerOpponentMatches * 50 +
    repeat.maxTotalPlayerOpponentEvents * 35 +
    repeat.opponentRepeatMatches * 18 +
    repeat.opponentRepeatEvents * 8
  )
}

function repairBatchRepeatExposure(payloads: SimPayload[], state: SessionState) {
  let current = payloads
  let currentStats = batchStats(current, state)
  let currentRepeat = repeatExposureStats(current, state)
  let currentScore = repeatRepairScore(current, state)

  for (let pass = 0; pass < 4; pass += 1) {
    let bestPayloads: SimPayload[] | null = null
    let bestStats = currentStats
    let bestRepeat = currentRepeat
    let bestScore = currentScore
    for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
        for (let leftPos = 0; leftPos < 4; leftPos += 1) {
          for (let rightPos = 0; rightPos < 4; rightPos += 1) {
            const leftPlayer = getPayloadPlayer(current[leftIndex], leftPos)
            const rightPlayer = getPayloadPlayer(current[rightIndex], rightPos)
            if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) continue
            const candidate = [...current]
            candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPos, rightPlayer)
            candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPos, leftPlayer)
            const candidateStats = batchStats(candidate, state)
            if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
            if (currentStats.pvnaOver === 0 && candidateStats.maxPvna > pvnaTolerance) continue
            if (candidateStats.maxPvna > currentStats.maxPvna + 0.15) continue
            if (candidateStats.intraOverHard > currentStats.intraOverHard + 1) continue
            if (candidateStats.maxIntra > currentStats.maxIntra + 0.45) continue
            const candidateRepeat = repeatExposureStats(candidate, state)
            const candidateScore = repeatRepairScore(candidate, state)
            if (candidateScore >= bestScore - 0.01) continue
            bestPayloads = candidate
            bestStats = candidateStats
            bestRepeat = candidateRepeat
            bestScore = candidateScore
          }
        }
      }
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
    currentRepeat = bestRepeat
    currentScore = bestScore
  }
  return current
}

function repairFinalPvnaOutlier(payloads: SimPayload[], state: SessionState) {
  let current = payloads
  let currentStats = batchStats(current, state)
  let currentRepeat = repeatExposureStats(current, state)
  if (currentStats.maxPvna <= 1.2) return current

  for (let pass = 0; pass < 3; pass += 1) {
    let bestPayloads: SimPayload[] | null = null
    let bestStats = currentStats
    let bestRepeat = currentRepeat
    for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
        for (let leftPos = 0; leftPos < 4; leftPos += 1) {
          for (let rightPos = 0; rightPos < 4; rightPos += 1) {
            const leftPlayer = getPayloadPlayer(current[leftIndex], leftPos)
            const rightPlayer = getPayloadPlayer(current[rightIndex], rightPos)
            if (!leftPlayer || !rightPlayer || leftPlayer === rightPlayer) continue
            const candidate = [...current]
            candidate[leftIndex] = setPayloadPlayer(candidate[leftIndex], leftPos, rightPlayer)
            candidate[rightIndex] = setPayloadPlayer(candidate[rightIndex], rightPos, leftPlayer)
            const candidateStats = batchStats(candidate, state)
            if (candidateStats.maxPvna >= bestStats.maxPvna - 0.2) continue
            if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
            if (candidateStats.pvnaOver > 0 && candidateStats.pvnaOver >= currentStats.pvnaOver && candidateStats.maxPvna > 0.9) continue
            if (candidateStats.intraOverHard > currentStats.intraOverHard + 1) continue
            if (candidateStats.maxIntra > currentStats.maxIntra + 0.5) continue
            const candidateRepeat = repeatExposureStats(candidate, state)
            if (candidateRepeat.partnerX3 > currentRepeat.partnerX3) continue
            if (candidateRepeat.opponentX3 > currentRepeat.opponentX3) continue
            if (candidateRepeat.maxSamePartner > Math.max(2, currentRepeat.maxSamePartner)) continue
            if (candidateRepeat.maxSameOpponent > Math.max(3, currentRepeat.maxSameOpponent)) continue
            if (candidateRepeat.partnerRepeatMatches > currentRepeat.partnerRepeatMatches + 2) continue
            if (candidateRepeat.opponentRepeatMatches > currentRepeat.opponentRepeatMatches + 4) continue
            bestPayloads = candidate
            bestStats = candidateStats
            bestRepeat = candidateRepeat
          }
        }
      }
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
    currentRepeat = bestRepeat
    if (currentStats.maxPvna <= 1) break
  }
  return current
}

function alternativeToPayload(alternative: ReturnType<typeof suggestNextMatch>['alternatives'][number], base: SimPayload): SimPayload {
  const match = alternative.matches[0]
  return {
    ...base,
    team_a: match.team_a,
    team_b: match.team_b,
    warnings: [...new Set([...(base.warnings ?? []), ...alternative.warnings])],
    tradeoffs: alternative.tradeoffs,
    approval_required: alternative.tradeoffs.length > 0,
  }
}

function rescueTargetedPvnaOutlier(payloads: SimPayload[], state: SessionState, roundNo: number) {
  if (roundNo + 1 < 6) return payloads
  let current = payloads
  let currentStats = batchStats(current, state)
  if (currentStats.maxPvna <= 1) return current

  for (let rescueCount = 0; rescueCount < 2; rescueCount += 1) {
    const indexed = current
      .map((payload, index) => ({ payload, index, pvna: getPayloadPvnaGap(payload, state) }))
      .sort((left, right) => right.pvna - left.pvna)
    const target = indexed.find(item => item.pvna > 1)
    if (!target) break
    const otherBusyIds = new Set(
      current
        .filter((_, index) => index !== target.index)
        .flatMap(payload => [...payload.team_a, ...payload.team_b]),
    )
    const result = suggestNextMatch(state, {
      busy_player_ids: otherBusyIds,
      court_idx: Number(target.payload.court_idx ?? target.index),
      max_alternatives: 80,
      max_runtime_ms: 600,
    })
    let bestPayloads: SimPayload[] | null = null
    let bestStats = currentStats
    let bestRepeat = repeatExposureStats(current, state)
    for (const alternative of result.alternatives) {
      if (!alternative.matches[0]) continue
      const candidate = [...current]
      candidate[target.index] = alternativeToPayload(alternative, target.payload)
      const candidateStats = batchStats(candidate, state)
      if (candidateStats.maxPvna >= bestStats.maxPvna - 0.35 && candidateStats.maxPvna > 1) continue
      if (candidateStats.pvnaOver > currentStats.pvnaOver) continue
      if (candidateStats.intraOverHard > currentStats.intraOverHard + 1) continue
      if (candidateStats.maxIntra > currentStats.maxIntra + 0.5) continue
      const candidateRepeat = repeatExposureStats(candidate, state)
      if (candidateRepeat.partnerX3 > bestRepeat.partnerX3) continue
      if (candidateRepeat.opponentX3 > bestRepeat.opponentX3) continue
      if (candidateRepeat.maxSamePartner > Math.max(2, bestRepeat.maxSamePartner)) continue
      if (candidateRepeat.maxSameOpponent > Math.max(3, bestRepeat.maxSameOpponent)) continue
      if (candidateRepeat.maxTotalPlayerPartnerEvents > bestRepeat.maxTotalPlayerPartnerEvents + 1) continue
      if (candidateRepeat.maxTotalPlayerOpponentEvents > bestRepeat.maxTotalPlayerOpponentEvents + 2) continue
      bestPayloads = candidate
      bestStats = candidateStats
      bestRepeat = candidateRepeat
    }
    if (!bestPayloads) break
    current = bestPayloads
    currentStats = bestStats
    if (currentStats.maxPvna <= 1) break
  }
  return current
}

function makeRow(match: Match, sessionState: SessionState, sequenceNo: number, roundNo: number, courtIdx: number): SessionLiveMatchRow {
  return {
    id: `sim-${sequenceNo}`,
    session_id: sessionState.session_id,
    sequence_no: sequenceNo,
    round_no: roundNo,
    court_idx: courtIdx,
    status: 'completed',
    team_a: match.team_a,
    team_b: match.team_b,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  }
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

  const [stateRes, preferenceRes] = await Promise.all([
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, created_at, metadata, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])
  if (stateRes.error) throw stateRes.error
  if (preferenceRes.error) throw preferenceRes.error

  const stateRows = (stateRes.data ?? []) as SessionPlayerStateRow[]
  const preferenceRows = (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[]
  const playerRows = (stateRows.length > 0 ? stateRows : preferenceRows.map((row: any) => ({
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
  }))).map(row => ({
    ...row,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
  }))

  const courts = courtsArg > 0
    ? Math.floor(courtsArg)
    : calculateOptimalCourts({
        n_players: playerRows.length,
        session_duration_min: 120,
        match_duration_min: 15,
        preset: 'balanced',
      }).recommended.courts

  let state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: [],
    roundRows: [],
    preferenceRows,
    courts,
    pvnaTolerance,
  })
  let liveRows: SessionLiveMatchRow[] = []
  const metrics: Array<{ round: number; court: number; pvna: number; intra: number; recent: number; partnerRepeat: number; opponentRepeat: number }> = []
  const timings: number[] = []
  const mutationEvents: Array<{ round: number; type: 'checkout' | 'checkin'; playerId: string }> = []
  const rosterByRound: Array<{ round: number; active: number; checkedOut: number }> = []
  const mutationCheckedOut = new Set<string>()
  const restStreakByPlayer = new Map<string, number>()
  const maxRestStreakByPlayer = new Map<string, number>()
  const selectMutationPlayers = (roundNo: number, count: number) => {
    return [...state.players.values()]
      .filter(player => player.checked_out_at === null && !mutationCheckedOut.has(player.player_id))
      .sort((left, right) => hashText(`${sessionId}:${roundNo}:${left.player_id}`) - hashText(`${sessionId}:${roundNo}:${right.player_id}`))
      .slice(0, count)
  }
  const applyRosterMutation = (roundNo: number) => {
    if (rosterMutation !== 'realistic') return
    const now = new Date(Date.UTC(2026, 0, 1, 0, roundNo, 0))
    if (roundNo === 2) {
      for (const player of selectMutationPlayers(roundNo, 2)) {
        player.checked_out_at = now
        mutationCheckedOut.add(player.player_id)
        mutationEvents.push({ round: roundNo + 1, type: 'checkout', playerId: player.player_id })
      }
    }
    if (roundNo === 4) {
      const returning = [...mutationCheckedOut].slice(0, 1)
      for (const playerId of returning) {
        const player = state.players.get(playerId)
        if (!player) continue
        player.checked_out_at = null
        mutationCheckedOut.delete(playerId)
        mutationEvents.push({ round: roundNo + 1, type: 'checkin', playerId })
      }
      for (const player of selectMutationPlayers(roundNo, 1)) {
        player.checked_out_at = now
        mutationCheckedOut.add(player.player_id)
        mutationEvents.push({ round: roundNo + 1, type: 'checkout', playerId: player.player_id })
      }
    }
    if (roundNo === 6) {
      for (const playerId of [...mutationCheckedOut]) {
        const player = state.players.get(playerId)
        if (!player) continue
        player.checked_out_at = null
        mutationCheckedOut.delete(playerId)
        mutationEvents.push({ round: roundNo + 1, type: 'checkin', playerId })
      }
    }
  }
  const playerRepeat = new Map<string, {
    partnerMatches: number
    partnerEvents: number
    opponentMatches: number
    opponentEvents: number
    maxSamePartner: number
    maxSameOpponent: number
  }>()
  const pairRepeat = {
    partner: new Map<string, number>(),
    opponent: new Map<string, number>(),
  }
  const ensurePlayerRepeat = (playerId: string) => {
    const existing = playerRepeat.get(playerId)
    if (existing) return existing
    const next = {
      partnerMatches: 0,
      partnerEvents: 0,
      opponentMatches: 0,
      opponentEvents: 0,
      maxSamePartner: 0,
      maxSameOpponent: 0,
    }
    playerRepeat.set(playerId, next)
    return next
  }

  for (let roundNo = 0; roundNo < rounds; roundNo += 1) {
    applyRosterMutation(roundNo)
    const activeCount = [...state.players.values()].filter(player => player.checked_out_at === null).length
    rosterByRound.push({ round: roundNo + 1, active: activeCount, checkedOut: state.players.size - activeCount })
    const startedAt = performance.now()
    const activePlayers = [...state.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest)
    const roundRequiredIds = hardRoundRequiredReservation ? getRequiredForRound(state) : []
    const projectedSlotsAfterRound = (roundNo + 1) * courts * 4
    const projectedMin = Math.floor(projectedSlotsAfterRound / Math.max(1, activePlayers.length))
    const projectedMax = Math.ceil(projectedSlotsAfterRound / Math.max(1, activePlayers.length))
    const quotaTierOverrides = quotaGuard
      ? Object.fromEntries(activePlayers.flatMap(player => {
        if (player.matches_played < projectedMin) return [[player.player_id, Tier.MUST_PLAY]]
        if (player.matches_played >= projectedMax) return [[player.player_id, Tier.MUST_REST]]
        return []
      }))
      : {}
    const useRoundQuotaPlan = roundQuotaPlan && roundNo + 1 >= roundQuotaStart
    let payloads = useRoundQuotaPlan
      ? (suggestNextRound(state, {
        tier_overrides: quotaTierOverrides,
        max_alternatives: 24,
        max_runtime_ms: 5000,
      }).alternatives[0]?.matches.map((match, index) => ({
        session_id: sessionId,
        sequence_no: liveRows.length + index,
        round_no: roundNo,
        court_idx: match.court_idx ?? index,
        team_a: match.team_a,
        team_b: match.team_b,
        resting: [],
        warnings: [],
        tradeoffs: [],
      })) as SimPayload[] ?? [])
      : []
    if (!useRoundQuotaPlan) {
      const planningRows = [...liveRows]
      while (payloads.length < courts) {
        const alreadyPlanned = new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b]))
        const requiredRemaining = roundRequiredIds.filter(playerId => !alreadyPlanned.has(playerId))
        const remainingCourts = courts - payloads.length
        const futureSlots = Math.max(0, (remainingCourts - 1) * 4)
        const forcedRequiredPlayerIds = requiredRemaining.slice(0, Math.min(4, Math.max(0, requiredRemaining.length - futureSlots)))
        const nextPayloads = buildSuggestedMatchPayloads({
          count: Math.min(requestBatchSize, courts - payloads.length),
          sessionId,
          courtCount: courts,
          state,
          rows: { liveMatchRows: planningRows, liveStateVersion: planningRows.length },
          completingLiveMatchIds: new Set(),
          fairnessAdjustment: { tier_overrides: quotaTierOverrides, applied_for_warnings: quotaGuard ? ['quota_guard_sim'] : [] },
          fairnessWarnings: [],
          playersById: new Map([...state.players.values()].map(player => [player.player_id, { name: player.player_id }])),
          pvnaTolerance,
          options: {
            liveQualityPolicy: policy,
            preserveRoundRequiredThroughRescue: hardRoundRequiredReservation,
            forcedRequiredPlayerIds,
          },
        })
        if (nextPayloads.length === 0) break
        for (const payload of nextPayloads) {
          payloads.push(payload)
          planningRows.push(makeRow(
            payloadMatch(payload, Number(payload.court_idx ?? payloads.length - 1)),
            state,
            planningRows.length,
            roundNo,
            Number(payload.court_idx ?? payloads.length - 1),
          ))
        }
      }
    }
    if (batchRepair) {
      payloads = repairBatchPvnaOutliers(payloads, state)
    }
    if (repeatRepair && roundNo + 1 >= repeatRepairStartRound) {
      payloads = repairBatchRepeatExposure(payloads, state)
    }
    if (finalPvnaRescue) {
      payloads = repairFinalPvnaOutlier(payloads, state)
    }
    if (targetedPvnaRescue) {
      payloads = rescueTargetedPvnaOutlier(payloads, state, roundNo)
    }
    const playedThisRound = new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b]))
    for (const player of state.players.values()) {
      if (player.checked_out_at !== null) continue
      const nextRest = playedThisRound.has(player.player_id)
        ? 0
        : (restStreakByPlayer.get(player.player_id) ?? 0) + 1
      restStreakByPlayer.set(player.player_id, nextRest)
      maxRestStreakByPlayer.set(
        player.player_id,
        Math.max(maxRestStreakByPlayer.get(player.player_id) ?? 0, nextRest),
      )
    }
    timings.push(performance.now() - startedAt)
    for (const [courtIdx, payload] of payloads.entries()) {
      const match: Match = {
        court_idx: courtIdx,
        team_a: payload.team_a,
        team_b: payload.team_b,
      }
      const repeat = repeatBefore(match, state)
      const partnerPairs: Array<[string, string]> = [match.team_a, match.team_b]
      for (const [left, right] of partnerPairs) {
        const before = state.players.get(left)?.partner_counts.get(right) ?? 0
        pairRepeat.partner.set(pairKey(left, right), Math.max(pairRepeat.partner.get(pairKey(left, right)) ?? 0, before + 1))
        for (const playerId of [left, right]) {
          const row = ensurePlayerRepeat(playerId)
          if (before > 0) {
            row.partnerMatches += 1
            row.partnerEvents += before
          }
          row.maxSamePartner = Math.max(row.maxSamePartner, before + 1)
        }
      }
      for (const left of match.team_a) {
        for (const right of match.team_b) {
          const before = state.players.get(left)?.opponent_counts.get(right) ?? 0
          pairRepeat.opponent.set(pairKey(left, right), Math.max(pairRepeat.opponent.get(pairKey(left, right)) ?? 0, before + 1))
          for (const playerId of [left, right]) {
            const row = ensurePlayerRepeat(playerId)
            if (before > 0) {
              row.opponentMatches += 1
              row.opponentEvents += before
            }
            row.maxSameOpponent = Math.max(row.maxSameOpponent, before + 1)
          }
        }
      }
      metrics.push({
        round: roundNo + 1,
        court: courtIdx + 1,
        pvna: Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)),
        intra: intraGap(match, state),
        recent: getRecentRepeatCost(match.team_a, match.team_b, state, roundNo).total,
        partnerRepeat: repeat.partner,
        opponentRepeat: repeat.opponent,
      })
      const row = makeRow(match, state, liveRows.length, roundNo, courtIdx)
      liveRows.push(row)
      state = buildProjectedStateAfterLiveMatch(state, row, roundNo)
    }
    state = buildProjectedStateAfterCompletedLiveRound(
      state,
      new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b])),
    )
  }

  const counts = [...state.players.values()].map(player => player.matches_played)
  const playerNames = new Map(playerRows.map((row: any) => [String(row.player_id), String(row.players?.name ?? row.player_id)]))
  const pvna = metrics.map(item => item.pvna)
  const intra = metrics.map(item => item.intra)
  const recent = metrics.map(item => item.recent)
  const playerRepeatRows = [...playerRepeat.values()]
  const topRepeatPlayers = [...playerRepeat.entries()]
    .map(([playerId, row]) => ({
      playerId,
      name: playerNames.get(playerId) ?? playerId,
      partnerMatches: row.partnerMatches,
      partnerEvents: row.partnerEvents,
      opponentMatches: row.opponentMatches,
      opponentEvents: row.opponentEvents,
      totalMatches: row.partnerMatches + row.opponentMatches,
      totalEvents: row.partnerEvents + row.opponentEvents,
      maxSamePartner: row.maxSamePartner,
      maxSameOpponent: row.maxSameOpponent,
    }))
    .filter(row => row.totalMatches > 0 || row.totalEvents > 0)
    .sort((left, right) => (
      right.totalEvents - left.totalEvents
      || right.totalMatches - left.totalMatches
      || right.opponentEvents - left.opponentEvents
      || right.partnerEvents - left.partnerEvents
    ))
    .slice(0, 10)
  const playerPartnerRepeatMatches = playerRepeatRows.map(row => row.partnerMatches)
  const playerOpponentRepeatMatches = playerRepeatRows.map(row => row.opponentMatches)
  const pairDistribution = (countsMap: Map<string, number>) => {
    const values = [...countsMap.values()]
    return {
      repeatedPairs: values.filter(value => value > 1).length,
      count2: values.filter(value => value === 2).length,
      count3: values.filter(value => value === 3).length,
      count4Plus: values.filter(value => value >= 4).length,
      max: Math.max(0, ...values),
    }
  }
  const report = {
    sessionId,
    policy,
    rosterMutation,
    batchRepair,
    repeatRepair,
    repeatRepairStartRound,
    finalPvnaRescue,
    targetedPvnaRescue,
    quotaGuard,
    roundQuotaPlan,
    roundQuotaStart,
    rounds,
    courts,
    players: playerRows.length,
    roster: {
      events: mutationEvents,
      byRound: rosterByRound,
    },
    distribution: {
      min: Math.min(...counts),
      max: Math.max(...counts),
      bucket: bucket(counts),
      maxConsecutiveRest: Math.max(0, ...maxRestStreakByPlayer.values()),
      playersRestedTwoOrMore: [...maxRestStreakByPlayer.values()].filter(value => value >= 2).length,
    },
    quality: {
      pvna: summarize(pvna),
      pvnaOverCap: pvna.filter(value => value > pvnaTolerance).length,
      intra: summarize(intra),
      intraOverPreferred: intra.filter(value => value > 0.75).length,
      intraOverHard: intra.filter(value => value > 1.5).length,
      recent: summarize(recent),
      partnerRepeatMatches: metrics.filter(item => item.partnerRepeat > 0).length,
      opponentRepeatMatches: metrics.filter(item => item.opponentRepeat > 0).length,
      repeat: {
        partner: {
          pairDistribution: pairDistribution(pairRepeat.partner),
          matchesByPlayer: {
            avg: round(playerPartnerRepeatMatches.reduce((sum, value) => sum + value, 0) / Math.max(1, playerPartnerRepeatMatches.length)),
            max: Math.max(0, ...playerPartnerRepeatMatches),
            playersWithAny: playerPartnerRepeatMatches.filter(value => value > 0).length,
          },
        },
        opponent: {
          pairDistribution: pairDistribution(pairRepeat.opponent),
          matchesByPlayer: {
            avg: round(playerOpponentRepeatMatches.reduce((sum, value) => sum + value, 0) / Math.max(1, playerOpponentRepeatMatches.length)),
            max: Math.max(0, ...playerOpponentRepeatMatches),
            playersWithAny: playerOpponentRepeatMatches.filter(value => value > 0).length,
          },
        },
      },
    },
    topRepeatPlayers,
    timing: summarize(timings),
    worstPvna: [...metrics].sort((a, b) => b.pvna - a.pvna).slice(0, 8).map(item => ({ ...item, pvna: round(item.pvna), intra: round(item.intra), recent: round(item.recent) })),
    worstIntra: [...metrics].sort((a, b) => b.intra - a.intra).slice(0, 8).map(item => ({ ...item, pvna: round(item.pvna), intra: round(item.intra), recent: round(item.recent) })),
  }
  if (compact) {
    console.log(JSON.stringify({
      sessionId,
      policy,
      rosterMutation,
      repeatRepair,
      repeatRepairStartRound,
      finalPvnaRescue,
      targetedPvnaRescue,
      quotaGuard,
      roundQuotaPlan,
      roundQuotaStart,
      roster: report.roster,
      distribution: report.distribution,
      pvna: report.quality.pvna,
      pvnaOverCap: report.quality.pvnaOverCap,
      intra: report.quality.intra,
      intraOverHard: report.quality.intraOverHard,
      partnerRepeatMatches: report.quality.partnerRepeatMatches,
      opponentRepeatMatches: report.quality.opponentRepeatMatches,
      repeat: report.quality.repeat,
      topRepeatPlayers: report.topRepeatPlayers,
      recent: report.quality.recent,
      timing: report.timing,
      worstPvna: report.worstPvna.slice(0, 3),
      worstIntra: report.worstIntra.slice(0, 3),
    }))
    return
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
