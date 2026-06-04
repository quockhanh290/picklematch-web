import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { computeAvailabilityMetrics } from '../lib/next-round-suggester/fairness/metrics'
import {
  buildLiveTradeoffChoices,
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
  getTradeoffChoiceMetrics,
} from '../lib/next-round-suggester/live-preview'
import { MAX_PROJECTED_OPPONENT_PAIR_COUNT, getProjectedRepeatSummary, withRecentGroupRematchKeys } from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { Tier } from '../lib/next-round-suggester/classify'
import type { Match, PlayerSessionState, SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '../lib/next-round-suggester/types'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function getMatchGroupKey(teamA: [string, string], teamB: [string, string]) {
  return [...teamA, ...teamB].sort().join(':')
}

function getBlockedRecentGroupRematchKeys(
  completedMatchGroups: Array<{ round_no: number; team_a: [string, string]; team_b: [string, string] }>,
  projectedRoundNo: number,
) {
  return new Set(
    completedMatchGroups
      .filter(match => projectedRoundNo > match.round_no && projectedRoundNo <= match.round_no + 1)
      .map(match => getMatchGroupKey(match.team_a, match.team_b)),
  )
}

function pairName(a: string, b: string, names: Map<string, string>) {
  return `${names.get(a) ?? a.slice(0, 8)} - ${names.get(b) ?? b.slice(0, 8)}`
}

function matchLabel(match: Match, names: Map<string, string>) {
  return `${pairName(match.team_a[0], match.team_a[1], names)} vs ${pairName(match.team_b[0], match.team_b[1], names)}`
}

function teamPvna(team: [string, string], players: Map<string, PlayerSessionState>) {
  return team.reduce((sum, id) => sum + (players.get(id)?.pvna ?? 0), 0)
}

function repeatDetails(match: Match, state: ReturnType<typeof mapRowsToSessionState>, names: Map<string, string>) {
  const rows: Array<{ pair: string; current: number; projected: number; overCap: boolean }> = []
  for (const playerA of match.team_a) {
    for (const playerB of match.team_b) {
      const current = state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0
      const projected = current + 1
      if (projected >= 2) {
        rows.push({
          pair: pairName(playerA, playerB, names),
          current,
          projected,
          overCap: projected > MAX_PROJECTED_OPPONENT_PAIR_COUNT,
        })
      }
    }
  }
  return rows
}

async function main() {
  const sessionId = argValue('--session-id', 'a4aa4d77-d6ee-45f3-ba97-15fc4083b1f5')
  const targetCourtIdx = Number(argValue('--court-idx', '1'))
  const courtCount = Number(argValue('--courts', '4'))
  const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
  const ignoreLive = process.argv.includes('--ignore-live')

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (authError) throw authError

  const snapshotRes = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
  if (snapshotRes.error) throw snapshotRes.error
  const raw = snapshotRes.data as {
    live_state_version: number | string | null
    player_rows?: SessionPlayerStateRow[]
    pair_rows?: SessionPairHistoryRow[]
    round_rows?: any[]
    live_match_rows?: SessionLiveMatchRow[]
  }

  const playersRes = await client
    .from('session_players')
    .select('player_id, players(name, pvna, current_elo, elo)')
    .eq('session_id', sessionId)
  if (playersRes.error) throw playersRes.error

  const names = new Map<string, string>()
  const playerPvna = new Map<string, number>()
  for (const row of playersRes.data ?? []) {
    const player = (row as any).players
    names.set(String(row.player_id), String(player?.name ?? row.player_id))
    playerPvna.set(String(row.player_id), Number(player?.pvna ?? player?.current_elo ?? player?.elo ?? 3))
  }

  const playerRows = ((raw.player_rows ?? []) as SessionPlayerStateRow[]).map(row => ({
    ...row,
    players: {
      ...row.players,
      pvna: playerPvna.get(row.player_id) ?? row.players?.pvna ?? 3,
    },
  }))
  const liveMatchRows = ((raw.live_match_rows ?? []) as SessionLiveMatchRow[])
    .filter(row => !(ignoreLive && row.status === 'live'))
    .map(row => ({
      ...row,
      resting: row.resting ?? [],
      score_a: row.score_a ?? 0,
      score_b: row.score_b ?? 0,
    }))
  const pairRows = (raw.pair_rows ?? []) as SessionPairHistoryRow[]
  const roundRows = raw.round_rows ?? []
  const liveStateVersion = raw.live_state_version == null ? null : Number(raw.live_state_version)

  const state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows,
    roundRows,
    courts: courtCount,
    pvnaTolerance,
  })
  const adjustment = correctForFairness(state)
  const warnings = detectFairnessIssues(state)
  const activeLiveCount = liveMatchRows.filter(match => match.status === 'live').length
  const count = Math.max(0, courtCount - activeLiveCount)
  const completingLiveMatchIds = new Set<string>()

  const payloads = buildSuggestedMatchPayloads({
    count,
    sessionId,
    courtCount,
    state,
    rows: { liveMatchRows, liveStateVersion },
    completingLiveMatchIds,
    fairnessAdjustment: adjustment,
    fairnessWarnings: warnings,
    playersById: new Map([...names.entries()].map(([id, name]) => [id, { name }])),
    pvnaTolerance,
  })

  const idByName = new Map([...names.entries()].map(([id, name]) => [name, id]))
  const pairRowByNames = (leftName: string, rightName: string) => {
    const leftId = idByName.get(leftName)
    const rightId = idByName.get(rightName)
    if (!leftId || !rightId) return null
    return pairRows.find(row =>
      (row.player_a === leftId && row.player_b === rightId)
      || (row.player_a === rightId && row.player_b === leftId)
    ) ?? null
  }

  console.log('Session snapshot', JSON.stringify({
    liveStateVersion,
    liveRows: liveMatchRows.map(match => ({
      court: Number(match.court_idx ?? 0) + 1,
      status: match.status,
      teamA: match.team_a.map(id => names.get(id) ?? id),
      teamB: match.team_b.map(id => names.get(id) ?? id),
    })),
    screenshotPairs: {
      'Bùi Nga - Lê Phương': pairRowByNames('Bùi Nga', 'Lê Phương'),
      'Bùi Nga - Huỳnh Sơn': pairRowByNames('Bùi Nga', 'Huỳnh Sơn'),
      'Hồ Hương - Lê Phương': pairRowByNames('Hồ Hương', 'Lê Phương'),
      'Hồ Hương - Huỳnh Sơn': pairRowByNames('Hồ Hương', 'Huỳnh Sơn'),
    },
  }, null, 2))

  console.log('Preview payloads')
  for (const payload of payloads) {
    const match = { team_a: payload.team_a, team_b: payload.team_b, court_idx: payload.court_idx } as Match
    const repeat = getProjectedRepeatSummary(match.team_a, match.team_b, state)
    console.log({
      court: Number(payload.court_idx) + 1,
      match: matchLabel(match, names),
      pvna: Math.abs(teamPvna(match.team_a, state.players) - teamPvna(match.team_b, state.players)).toFixed(2),
      warnings: payload.warnings,
      tradeoffs: payload.tradeoffs,
      recommended: payload.recommended_tradeoff_choice,
      tradeoffChoices: payload.tradeoff_choices?.map(choice => ({
        id: choice.id,
        pvna: choice.metrics.pvna_gap,
        intraOver: choice.metrics.intra_team_over_by,
        repeatOver: choice.metrics.repeat_over_by,
        repeatMaxOpponent: choice.metrics.max_opponent_pair,
      })),
      repeatSummary: {
        maxOpponentPair: repeat.max_opponent_pair_count,
        opponentOverBy: repeat.opponent_pair_over_by,
      },
      repeatDetails: repeatDetails(match, state, names),
    })
  }

  let suggestionState = state
  const baseBusyIds = new Set(
    liveMatchRows
      .filter(match => match.status === 'live' || match.status === 'suggested' || completingLiveMatchIds.has(match.id))
      .flatMap(match => [...match.team_a, ...match.team_b]),
  )
  const liveCourtIdxs = new Set(
    liveMatchRows
      .filter(match => match.status === 'live' && !completingLiveMatchIds.has(match.id) && match.court_idx !== null && match.court_idx !== undefined)
      .map(match => Number(match.court_idx)),
  )
  const countableMatches = liveMatchRows.filter(match => match.status !== 'cancelled').sort((left, right) => left.sequence_no - right.sequence_no)
  const roundCounts = new Map<number, number>()
  const courtIdxsByRound = new Map<number, Set<number>>()
  const playerIdsByRound = new Map<number, Set<string>>()
  const logicalRoundByMatchId = new Map<string, number>()
  countableMatches.forEach((match, matchIndex) => {
    const roundNo = Math.floor(matchIndex / courtCount)
    logicalRoundByMatchId.set(match.id, match.round_no ?? roundNo)
    roundCounts.set(roundNo, (roundCounts.get(roundNo) ?? 0) + 1)
    const playerIds = playerIdsByRound.get(roundNo) ?? new Set<string>()
    match.team_a.forEach(playerId => playerIds.add(playerId))
    match.team_b.forEach(playerId => playerIds.add(playerId))
    playerIdsByRound.set(roundNo, playerIds)
    if (match.court_idx !== null && match.court_idx !== undefined) {
      const courtIdxs = courtIdxsByRound.get(roundNo) ?? new Set<number>()
      courtIdxs.add(Number(match.court_idx))
      courtIdxsByRound.set(roundNo, courtIdxs)
    }
  })
  const completedMatchGroups = countableMatches
    .filter(match => match.status === 'completed')
    .map((match, matchIndex) => ({
      round_no: logicalRoundByMatchId.get(match.id) ?? match.round_no ?? Math.floor(matchIndex / courtCount),
      team_a: match.team_a,
      team_b: match.team_b,
    }))
  const projectedExistingMatches = countableMatches.filter(match => match.status === 'live' || match.status === 'suggested' || completingLiveMatchIds.has(match.id))
  const projectedExistingRoundNos = new Set<number>()
  for (const match of projectedExistingMatches) {
    const projectedRoundNo = logicalRoundByMatchId.get(match.id) ?? match.round_no ?? match.sequence_no
    projectedExistingRoundNos.add(projectedRoundNo)
    suggestionState = buildProjectedStateAfterLiveMatch(suggestionState, match, projectedRoundNo)
  }
  for (const roundNo of projectedExistingRoundNos) {
    if ((roundCounts.get(roundNo) ?? 0) >= courtCount) {
      suggestionState = buildProjectedStateAfterCompletedLiveRound(suggestionState, playerIdsByRound.get(roundNo) ?? new Set<string>())
    }
  }

  const getInitialRoundCourtIdxs = (roundNo: number) => new Set([
    ...liveCourtIdxs,
    ...(courtIdxsByRound.get(roundNo) ?? []),
  ])
  const hasCompletedRounds = suggestionState.rounds.some(round => round.status === 'completed')
  const getRoundRequiredIds = (roundNo: number, remainingCourts: number, busyIds: Set<string>) => {
    const remainingRoundSlots = Math.max(0, remainingCourts * 4)
    if (remainingRoundSlots <= 0) return new Set<string>()
    const required = [...suggestionState.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
      .filter(player => {
        const isLateArrival = hasCompletedRounds && player.matches_played === 0
        if (isLateArrival) return player.consecutive_rest >= 2
        return player.consecutive_rest >= 1
      })
      .sort((left, right) => {
        if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
        if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
        if (left.last_played_round !== right.last_played_round) return left.last_played_round - right.last_played_round
        return left.player_id.localeCompare(right.player_id)
      })
      .map(player => player.player_id)
    return required.length > remainingRoundSlots ? new Set<string>() : new Set(required)
  }

  const queuedCourtIdxs = new Set(liveCourtIdxs)
  let projectedRoundNo = Math.floor(countableMatches.length / courtCount)
  let projectedRoundMatchCount = countableMatches.length % courtCount
  let roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
  let roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
  let roundRequiredIds = getRoundRequiredIds(projectedRoundNo, courtCount - projectedRoundMatchCount, roundBusyIds)

  for (let index = 0; index < count; index += 1) {
    if (projectedRoundMatchCount >= courtCount) {
      projectedRoundNo += 1
      projectedRoundMatchCount = 0
      roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
      roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
      roundRequiredIds = getRoundRequiredIds(projectedRoundNo, courtCount, roundBusyIds)
    }
    const nextCourtIdx = Array.from({ length: courtCount }, (_, idx) => idx).find(idx => !queuedCourtIdxs.has(idx) && !roundCourtIdxs.has(idx))
    const courtIdx = nextCourtIdx
    if (courtIdx === undefined) break
    const remainingCourtsInRound = Math.max(1, courtCount - projectedRoundMatchCount)
    const availableRequiredIds = [...roundRequiredIds].filter(playerId => !roundBusyIds.has(playerId) && !baseBusyIds.has(playerId))
    const minRequiredForThisCourt = availableRequiredIds.length === 0 ? 0 : Math.min(4, Math.max(1, availableRequiredIds.length - ((remainingCourtsInRound - 1) * 4)))
    const requiredForThisCourt = availableRequiredIds.slice(0, minRequiredForThisCourt)
    const requiredForThisCourtIds = new Set(requiredForThisCourt)
    const deferredRequiredIds = availableRequiredIds.filter(playerId => !requiredForThisCourtIds.has(playerId))
    const busyIds = new Set([...baseBusyIds, ...roundBusyIds])
    const activePlayersForBias = [...suggestionState.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
    const availabilityForBias = computeAvailabilityMetrics(suggestionState)
    const availabilityDeltaByPlayer = new Map(availabilityForBias.per_player.map(player => [player.player_id, player.delta_from_expected]))
    const avgMatchesForBias = activePlayersForBias.length === 0 ? 0 : activePlayersForBias.reduce((sum, player) => sum + player.matches_played, 0) / activePlayersForBias.length
    const getMatchBalanceForBias = (player: PlayerSessionState) => (
      availabilityForBias.rounds_tracked > 0 ? (availabilityDeltaByPlayer.get(player.player_id) ?? 0) : player.matches_played - avgMatchesForBias
    )
    const softUnderplayedOverrides = Object.fromEntries(
      activePlayersForBias
        .filter(player => getMatchBalanceForBias(player) <= -0.25)
        .filter(player => !requiredForThisCourtIds.has(player.player_id))
        .filter(player => !deferredRequiredIds.includes(player.player_id))
        .filter(player => adjustment.tier_overrides[player.player_id] === undefined)
        .map(player => [player.player_id, Tier.SHOULD_PLAY]),
    )
    const softOverplayedOverrides = Object.fromEntries(
      activePlayersForBias
        .filter(player => getMatchBalanceForBias(player) >= 0.75)
        .filter(player => !requiredForThisCourtIds.has(player.player_id))
        .filter(player => !deferredRequiredIds.includes(player.player_id))
        .filter(player => adjustment.tier_overrides[player.player_id] === undefined)
        .map(player => [player.player_id, Tier.SHOULD_REST]),
    )
    const tierOverrides = {
      ...adjustment.tier_overrides,
      ...softOverplayedOverrides,
      ...softUnderplayedOverrides,
      ...Object.fromEntries(deferredRequiredIds.map(playerId => [playerId, Tier.FLEXIBLE])),
      ...Object.fromEntries(requiredForThisCourt.map(playerId => [playerId, Tier.MUST_PLAY])),
    }
    const suggestionStateForCourt = withRecentGroupRematchKeys(suggestionState, getBlockedRecentGroupRematchKeys(completedMatchGroups, projectedRoundNo))
    const result = suggestNextMatch(suggestionStateForCourt, {
      tier_overrides: tierOverrides as any,
      busy_player_ids: busyIds,
      court_idx: courtIdx,
      max_alternatives: 8,
    })
    const choices = buildLiveTradeoffChoices(result.alternatives, suggestionStateForCourt, pvnaTolerance)

    if (courtIdx === targetCourtIdx) {
      const targetOutput = {
        court: courtIdx + 1,
        projectedRoundNo,
        busy: [...busyIds].map(id => names.get(id) ?? id),
        required: requiredForThisCourt.map(id => names.get(id) ?? id),
        deferredRequired: deferredRequiredIds.map(id => names.get(id) ?? id),
        tierOverrides: Object.fromEntries(Object.entries(tierOverrides).map(([id, tier]) => [names.get(id) ?? id, tier])),
        resultWarnings: result.warnings,
        recommended: choices?.recommended ?? null,
        choices: choices?.choices.map(choice => ({
          id: choice.id,
          match: matchLabel(choice.alternative.matches[0], names),
          metrics: choice.metrics,
        })) ?? null,
        alternatives: result.alternatives.map((alternative, rank) => {
          const match = alternative.matches[0]
          return {
            rank: rank + 1,
            match: matchLabel(match, names),
            pvna: Math.abs(teamPvna(match.team_a, suggestionStateForCourt.players) - teamPvna(match.team_b, suggestionStateForCourt.players)).toFixed(2),
            score: Number(alternative.score.toFixed(2)),
            warnings: alternative.warnings,
            tradeoffs: alternative.tradeoffs,
            metrics: getTradeoffChoiceMetrics(alternative, suggestionStateForCourt, pvnaTolerance),
            repeatDetails: repeatDetails(match, suggestionStateForCourt, names),
          }
        }),
      }
      console.log('Target court alternatives', JSON.stringify(targetOutput, null, 2))
      return
    }

    const selected = choices?.choices.find(choice => choice.id === choices.recommended)?.alternative ?? result.alternatives[0]
    const match = selected?.matches[0]
    if (!selected || !match) break
    match.team_a.forEach(playerId => roundBusyIds.add(playerId))
    match.team_b.forEach(playerId => roundBusyIds.add(playerId))
    match.team_a.forEach(playerId => roundRequiredIds.delete(playerId))
    match.team_b.forEach(playerId => roundRequiredIds.delete(playerId))
    roundCourtIdxs.add(courtIdx)
    queuedCourtIdxs.add(courtIdx)
    projectedRoundMatchCount += 1
    const projectedMatch: SessionLiveMatchRow = {
      id: `preview-projected-${index}`,
      session_id: sessionId,
      sequence_no: index,
      round_no: projectedRoundNo,
      court_idx: courtIdx,
      status: 'completed',
      team_a: match.team_a,
      team_b: match.team_b,
      resting: selected.resting,
      score_a: 0,
      score_b: 0,
      suggested_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    }
    suggestionState = buildProjectedStateAfterLiveMatch(suggestionState, projectedMatch, projectedRoundNo)
    completedMatchGroups.push({ round_no: projectedRoundNo, team_a: projectedMatch.team_a, team_b: projectedMatch.team_b })
    if (projectedRoundMatchCount >= courtCount) {
      suggestionState = buildProjectedStateAfterCompletedLiveRound(suggestionState, roundBusyIds)
    }
  }
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
