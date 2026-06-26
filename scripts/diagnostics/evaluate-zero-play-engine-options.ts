import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch, buildSuggestedMatchPayloads } from '@/lib/next-round-suggester/live-preview'
import { bestPartitioning } from '@/lib/next-round-suggester/pair'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { getMatchGroupKey, scoreMatch, withRecentGroupRematchKeys } from '@/lib/next-round-suggester/score'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import { correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '@/lib/next-round-suggester/fairness/detector'
import { computeAvailabilityMetrics } from '@/lib/next-round-suggester/fairness/metrics'
import { Tier } from '@/lib/next-round-suggester/classify'

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

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/evaluate-zero-play-engine-options.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

function pairings(ids: string[]) {
  return [
    [[ids[0], ids[1]], [ids[2], ids[3]]],
    [[ids[0], ids[2]], [ids[1], ids[3]]],
    [[ids[0], ids[3]], [ids[1], ids[2]]],
  ] as Array<[[string, string], [string, string]]>
}

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
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

  const liveMatchRows = ((raw.live_match_rows ?? []) as SessionLiveMatchRow[])
    .map(row => ({ ...row, resting: row.resting ?? [], score_a: row.score_a ?? 0, score_b: row.score_b ?? 0 }))
  const courtCount = Math.max(6, ...liveMatchRows.map(row => Number(row.court_idx ?? 0) + 1))
  const liveBusyIds = new Set(
    liveMatchRows
      .filter(row => row.status === 'live' || row.status === 'suggested')
      .flatMap(row => [...row.team_a, ...row.team_b]),
  )
  const state = mapRowsToSessionState({
    sessionId,
    playerRows: ((raw.player_rows ?? []) as SessionPlayerStateRow[]).map(row => ({
      ...row,
      players: { ...row.players, pvna: playerPvna.get(row.player_id) ?? row.players?.pvna ?? 3 },
    })),
    pairRows: (raw.pair_rows ?? []) as SessionPairHistoryRow[],
    roundRows: raw.round_rows ?? [],
    courts: courtCount,
    pvnaTolerance: 0.5,
  })
  let projectedState = state
  const courtCapacity = Math.max(1, Math.floor(projectedState.config.courts || courtCount || 1))
  const countableMatches = liveMatchRows
    .filter(match => match.status !== 'cancelled')
    .sort((left, right) => left.sequence_no - right.sequence_no)
  const playerIdsByRound = new Map<number, Set<string>>()
  const roundCounts = new Map<number, number>()
  for (const [matchIndex, match] of countableMatches.entries()) {
    const roundNo = Math.floor(matchIndex / courtCapacity)
    roundCounts.set(roundNo, (roundCounts.get(roundNo) ?? 0) + 1)
    const playerIds = playerIdsByRound.get(roundNo) ?? new Set<string>()
    match.team_a.forEach(id => playerIds.add(id))
    match.team_b.forEach(id => playerIds.add(id))
    playerIdsByRound.set(roundNo, playerIds)
  }
  const projectedRoundNos = new Set<number>()
  for (const [matchIndex, match] of countableMatches.entries()) {
    if (match.status !== 'live' && match.status !== 'suggested') continue
    const roundNo = Math.floor(matchIndex / courtCapacity)
    projectedRoundNos.add(roundNo)
    projectedState = buildProjectedStateAfterLiveMatch(projectedState, match, roundNo)
  }
  for (const roundNo of projectedRoundNos) {
    if ((roundCounts.get(roundNo) ?? 0) >= courtCapacity) {
      projectedState = buildProjectedStateAfterCompletedLiveRound(projectedState, playerIdsByRound.get(roundNo) ?? new Set<string>())
    }
  }

  const availableZero = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .filter(player => !liveBusyIds.has(player.player_id))
    .filter(player => player.matches_played === 0)
  const projectedRoundNo = Math.floor(countableMatches.length / courtCapacity)
  const projectedMatchCount = countableMatches.length % courtCapacity
  const roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
  const hasCompletedRounds = projectedState.rounds.some(round => round.status === 'completed')
  const required = [...projectedState.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !liveBusyIds.has(player.player_id) && !roundBusyIds.has(player.player_id))
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
  const remainingCourtsInRound = Math.max(1, courtCapacity - projectedMatchCount)
  const requiredForThisCourtCount = required.length === 0
    ? 0
    : Math.min(4, Math.max(1, required.length - ((remainingCourtsInRound - 1) * 4)))
  const requiredForThisCourt = required.slice(0, requiredForThisCourtCount)

  const busyIds = new Set(liveBusyIds)
  const activePlayersForBias = [...projectedState.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
  const availabilityForBias = computeAvailabilityMetrics(projectedState)
  const availabilityDeltaByPlayer = new Map(
    availabilityForBias.per_player.map(player => [player.player_id, player.delta_from_expected]),
  )
  const avgMatchesForBias = activePlayersForBias.length === 0
    ? 0
    : activePlayersForBias.reduce((sum, player) => sum + player.matches_played, 0) / activePlayersForBias.length
  const getMatchBalanceForBias = (player: typeof activePlayersForBias[number]) => (
    availabilityForBias.rounds_tracked > 0
      ? (availabilityDeltaByPlayer.get(player.player_id) ?? 0)
      : player.matches_played - avgMatchesForBias
  )
  const adjustment = correctForFairness(projectedState)
  const softUnderplayedOverrides = Object.fromEntries(
    activePlayersForBias
      .filter(player => getMatchBalanceForBias(player) <= -0.25)
      .filter(player => adjustment.tier_overrides[player.player_id] === undefined)
      .map(player => [player.player_id, Tier.SHOULD_PLAY]),
  )
  const softOverplayedOverrides = Object.fromEntries(
    activePlayersForBias
      .filter(player => getMatchBalanceForBias(player) >= 0.75)
      .filter(player => adjustment.tier_overrides[player.player_id] === undefined)
      .map(player => [player.player_id, Tier.SHOULD_REST]),
  )
  const livePreviewTierOverrides = {
    ...adjustment.tier_overrides,
    ...softOverplayedOverrides,
    ...softUnderplayedOverrides,
  }
  const directLivePreview = suggestNextMatch(projectedState, {
    tier_overrides: livePreviewTierOverrides as any,
    busy_player_ids: busyIds,
    court_idx: 0,
    max_alternatives: 24,
  })
  const recentGroupKeys = new Set(
    countableMatches
      .filter(match => match.status === 'completed')
      .map(match => getMatchGroupKey(match.team_a, match.team_b)),
  )
  const diag = {
    ran: false,
    timedOut: false,
    eligibleCount: 0,
    combinationsEvaluated: 0,
    bestPvnaDiff: null,
    bestHasTradeoffs: false,
    elapsedMs: 0,
  }
  const directWithRecentGroup = suggestNextMatch(withRecentGroupRematchKeys(projectedState, recentGroupKeys), {
    tier_overrides: livePreviewTierOverrides as any,
    busy_player_ids: busyIds,
    court_idx: 0,
    max_alternatives: 24,
    _exhaustiveDiag: diag,
  })

  const evaluated = []
  for (let a = 0; a < availableZero.length; a += 1) {
    for (let b = a + 1; b < availableZero.length; b += 1) {
      for (let c = b + 1; c < availableZero.length; c += 1) {
        for (let d = c + 1; d < availableZero.length; d += 1) {
          const group = [availableZero[a], availableZero[b], availableZero[c], availableZero[d]]
          const projectedGroup = group.map(player => projectedState.players.get(player.player_id)!).filter(Boolean)
          const partition = bestPartitioning(projectedGroup, projectedState, {
            allowRelaxedTolerance: false,
            allowRepeatOverflow: false,
            allowIntraTeamGapOverflow: false,
          })
          if (!partition) continue
          const match = partition.matches[0]
          const scored = scoreMatch(match.team_a, match.team_b, projectedState)
          evaluated.push({
            match: `${names.get(match.team_a[0])} + ${names.get(match.team_a[1])} vs ${names.get(match.team_b[0])} + ${names.get(match.team_b[1])}`,
            pvnaGap: Number((match.stats?.pvna_diff ?? 0).toFixed(2)),
            intraGap: Number(Math.max(
              Math.abs((projectedState.players.get(match.team_a[0])?.pvna ?? 0) - (projectedState.players.get(match.team_a[1])?.pvna ?? 0)),
              Math.abs((projectedState.players.get(match.team_b[0])?.pvna ?? 0) - (projectedState.players.get(match.team_b[1])?.pvna ?? 0)),
            ).toFixed(2)),
            score: Number(scored.score.toFixed(2)),
          })
        }
      }
    }
  }

  const payloads = buildSuggestedMatchPayloads({
    count: Math.max(0, courtCount - liveMatchRows.filter(row => row.status === 'live').length),
    sessionId,
    courtCount,
    state,
    rows: { liveMatchRows, liveStateVersion: raw.live_state_version == null ? null : Number(raw.live_state_version) },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: adjustment,
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map([...names.entries()].map(([id, name]) => [id, { name }])),
    pvnaTolerance: 0.5,
  })
  const selected = payloads.find(row => Number(row.court_idx ?? -1) === 0) ?? payloads[0]

  console.log(JSON.stringify({
    availableZeroCount: availableZero.length,
    selected: selected ? `${names.get(selected.team_a[0])} + ${names.get(selected.team_a[1])} vs ${names.get(selected.team_b[0])} + ${names.get(selected.team_b[1])}` : null,
    selectedPayload: selected ? {
      courtIdx: selected.court_idx,
      warnings: selected.warnings,
      tradeoffs: selected.tradeoffs,
      recommended: selected.recommended_tradeoff_choice,
      choices: selected.tradeoff_choices?.map(choice => ({
        id: choice.id,
        match: `${names.get(choice.alternative.matches[0].team_a[0])} + ${names.get(choice.alternative.matches[0].team_a[1])} vs ${names.get(choice.alternative.matches[0].team_b[0])} + ${names.get(choice.alternative.matches[0].team_b[1])}`,
        metrics: choice.metrics,
      })),
    } : null,
    fairnessAdjustment: {
      applied: adjustment.applied_for_warnings,
      tierOverrides: Object.entries(adjustment.tier_overrides).map(([id, tier]) => ({ name: names.get(id), tier })),
    },
    softUnderplayed: Object.keys(softUnderplayedOverrides).map(id => names.get(id)),
    softOverplayed: Object.keys(softOverplayedOverrides).map(id => names.get(id)),
    directLivePreviewTop: directLivePreview.alternatives.slice(0, 12).map((alternative, index) => {
      const match = alternative.matches[0]
      return {
        rank: index + 1,
        match: `${names.get(match.team_a[0])} + ${names.get(match.team_a[1])} vs ${names.get(match.team_b[0])} + ${names.get(match.team_b[1])}`,
        score: Number(alternative.score.toFixed(2)),
        warnings: alternative.warnings,
        tradeoffs: alternative.tradeoffs,
      }
    }),
    directWithRecentGroupDiag: diag,
    directWithRecentGroupTop: directWithRecentGroup.alternatives.slice(0, 12).map((alternative, index) => {
      const match = alternative.matches[0]
      return {
        rank: index + 1,
        match: `${names.get(match.team_a[0])} + ${names.get(match.team_a[1])} vs ${names.get(match.team_b[0])} + ${names.get(match.team_b[1])}`,
        score: Number(alternative.score.toFixed(2)),
        warnings: alternative.warnings,
        tradeoffs: alternative.tradeoffs,
      }
    }),
    requiredProjectedRound: {
      projectedRoundNo,
      projectedMatchCount,
      remainingCourtsInRound,
      requiredCount: required.length,
      requiredForThisCourt: requiredForThisCourt.map(player => names.get(player.player_id)),
    },
    strictCleanCount: evaluated.length,
    strictCleanWithRequiredCount: evaluated.filter(option =>
      requiredForThisCourt.every(player => option.match.includes(names.get(player.player_id) ?? player.player_id)),
    ).length,
    topStrictClean: evaluated.sort((a, b) => a.score - b.score).slice(0, 20),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
