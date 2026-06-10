import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import {
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
  getAlternativeIntraTeamGap,
  getAlternativePvnaGap,
  getAlternativeRepeatMetrics,
  getTradeoffChoiceMetrics,
} from '../lib/next-round-suggester/live-preview'
import {
  RECENT_GROUP_REMATCH_BLOCK_ROUNDS,
  getMatchGroupKey,
  getMatchNearRematchKeys,
  getRecentRepeatCost,
  withRecentGroupRematchKeys,
} from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type { Match, SessionLiveMatchRow, SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/audit-current-preview-options.ts <session-id>')

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

function round(value: number) {
  return Number(value.toFixed(2))
}

function alternativeForMatch(match: Match): SuggestionAlternative {
  return {
    matches: [match],
    resting: [],
    score: 0,
    warnings: [],
    tradeoffs: [],
    stats: {
      pvna_diff: 0,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
}

function playerIds(alternative: SuggestionAlternative) {
  return alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
}

function metrics(alternative: SuggestionAlternative, state: SessionState, roundNo: number) {
  const match = alternative.matches[0]
  const choice = getTradeoffChoiceMetrics(alternative, state, state.config.pvna_tolerance)
  const teamPvna = (team: [string, string]) => team.reduce(
    (sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0),
    0,
  )
  const pvna = Math.abs(teamPvna(match.team_a) - teamPvna(match.team_b))
  const repeat = getAlternativeRepeatMetrics(alternative, state)
  const recent = getRecentRepeatCost(match.team_a, match.team_b, state, roundNo)
  const projectedCounts = playerIds(alternative).map(id => (state.players.get(id)?.matches_played ?? 0) + 1)
  const projectedStreaks = playerIds(alternative).map(id => (state.players.get(id)?.consecutive_play ?? 0) + 1)
  const selectedIds = new Set(playerIds(alternative))
  const activePlayers = [...state.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest)
  const nextMatchIndex = 25
  const targetMin = Math.floor((nextMatchIndex * 4) / Math.max(1, activePlayers.length))
  const targetMax = Math.ceil((nextMatchIndex * 4) / Math.max(1, activePlayers.length))
  const projectedCountsAll = activePlayers.map(player => player.matches_played + (selectedIds.has(player.player_id) ? 1 : 0))
  return {
    pvna,
    pvnaOver: Math.max(0, pvna - state.config.pvna_tolerance),
    intra: getAlternativeIntraTeamGap(alternative, state),
    intraOver: choice.intra_team_over_by,
    repeatOver: repeat.repeat_over_by,
    affectedPlayers: repeat.affected_players,
    partnerRepeat: repeat.max_partner_pair,
    opponentRepeat: repeat.max_opponent_pair,
    recent: recent.total,
    projectedMax: Math.max(...projectedCounts),
    projectedMin: Math.min(...projectedCounts),
    projectedStreakMax: Math.max(...projectedStreaks),
    projectedStreakGte3: projectedStreaks.filter(streak => streak >= 3).length,
    projectedStreakGte4: projectedStreaks.filter(streak => streak >= 4).length,
    quotaOver: projectedCountsAll.reduce((sum, count) => sum + Math.max(0, count - targetMax), 0),
    quotaUnder: projectedCountsAll.reduce((sum, count) => sum + Math.max(0, targetMin - count), 0),
    totalCost: choice.total_cost,
  }
}

function noWorse(candidate: ReturnType<typeof metrics>, reference: ReturnType<typeof metrics>) {
  return candidate.pvnaOver <= reference.pvnaOver + 0.001
    && candidate.intraOver <= reference.intraOver + 0.001
    && candidate.repeatOver <= reference.repeatOver
    && candidate.affectedPlayers <= reference.affectedPlayers
    && candidate.partnerRepeat <= reference.partnerRepeat
    && candidate.opponentRepeat <= reference.opponentRepeat
    && candidate.recent <= reference.recent + 0.001
    && candidate.projectedMax <= reference.projectedMax
}

function materiallyBetter(candidate: ReturnType<typeof metrics>, reference: ReturnType<typeof metrics>) {
  return candidate.pvna < reference.pvna - 0.02
    || candidate.intra < reference.intra - 0.05
    || candidate.repeatOver < reference.repeatOver
    || candidate.affectedPlayers < reference.affectedPlayers
    || candidate.partnerRepeat < reference.partnerRepeat
    || candidate.opponentRepeat < reference.opponentRepeat
    || candidate.recent < reference.recent - 0.5
    || candidate.projectedMax < reference.projectedMax
}

async function main() {
  const auth = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (auth.error) throw auth.error

  const [sessionRes, playersRes, pairsRes, roundsRes, liveRes] = await Promise.all([
    client.from('sessions').select('live_state_version').eq('id', sessionId).single(),
    client.from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client.from('session_pair_history')
      .select('session_id, player_a, player_b, partner_count, opponent_count')
      .eq('session_id', sessionId),
    client.from('session_rounds')
      .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
      .eq('session_id', sessionId)
      .order('round_no', { ascending: true }),
    client.from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: true }),
  ])
  const error = sessionRes.error ?? playersRes.error ?? pairsRes.error ?? roundsRes.error ?? liveRes.error
  if (error) throw error

  const playerRows = playersRes.data ?? []
  const liveRows = (liveRes.data ?? []) as SessionLiveMatchRow[]
  const courts = calculateOptimalCourts({
    n_players: playerRows.length,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  }).recommended.courts
  const baseState = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: pairsRes.data ?? [],
    roundRows: roundsRes.data ?? [],
    courts,
    pvnaTolerance: 0.5,
  })
  const names = new Map(playerRows.map((row: any) => [String(row.player_id), String(row.players?.name ?? row.player_id)]))
  const adjustment = correctForFairness(baseState)
  const warnings = detectFairnessIssues(baseState)
  const activeLiveRows = liveRows.filter(row => row.status === 'live')
  const busyIds = new Set(activeLiveRows.flatMap(row => [...row.team_a, ...row.team_b]))
  let projectedState = baseState
  for (const row of activeLiveRows) {
    projectedState = buildProjectedStateAfterLiveMatch(projectedState, row, Number(row.round_no ?? row.sequence_no))
  }
  const courtIdx = Array.from({ length: courts }, (_, index) => index)
    .find(index => !activeLiveRows.some(row => Number(row.court_idx) === index)) ?? 0
  const countableRows = liveRows.filter(row => row.status !== 'cancelled')
  const projectedRoundNo = Math.floor(countableRows.length / courts)
  const blockedRecentGroupKeys = new Set<string>()
  countableRows.filter(row => row.status === 'completed').forEach((row, index) => {
    const roundNo = Math.floor(index / courts)
    if (projectedRoundNo <= roundNo || projectedRoundNo > roundNo + RECENT_GROUP_REMATCH_BLOCK_ROUNDS) return
    blockedRecentGroupKeys.add(getMatchGroupKey(row.team_a, row.team_b))
    getMatchNearRematchKeys(row.team_a, row.team_b).forEach(key => blockedRecentGroupKeys.add(key))
  })
  projectedState = withRecentGroupRematchKeys(
    { ...projectedState, current_round: projectedRoundNo },
    blockedRecentGroupKeys,
  )

  const payload = buildSuggestedMatchPayloads({
    count: 1,
    sessionId,
    courtCount: courts,
    state: baseState,
    rows: { liveMatchRows: liveRows, liveStateVersion: Number(sessionRes.data?.live_state_version ?? 0) },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: adjustment,
    fairnessWarnings: warnings,
    playersById: new Map([...names].map(([id, name]) => [id, { name }])),
    pvnaTolerance: 0.5,
  })[0]
  if (!payload) throw new Error('No current preview payload')

  const previewAlternative = alternativeForMatch({
    court_idx: Number(payload.court_idx ?? courtIdx),
    team_a: payload.team_a,
    team_b: payload.team_b,
  })
  const previewMetrics = metrics(previewAlternative, projectedState, projectedRoundNo)
  const diag: any = {}
  const startedAt = performance.now()
  const search = suggestNextMatch(projectedState, {
    busy_player_ids: busyIds,
    court_idx: courtIdx,
    tier_overrides: adjustment.tier_overrides,
    max_alternatives: 500,
    max_runtime_ms: 2500,
    exhaustive_fallback: true,
    _exhaustiveDiag: diag,
  })
  const elapsedMs = performance.now() - startedAt

  const rows = search.alternatives.map(alternative => ({
    alternative,
    metrics: metrics(alternative, projectedState, projectedRoundNo),
  }))
  const dominating = rows.filter(row => noWorse(row.metrics, previewMetrics) && materiallyBetter(row.metrics, previewMetrics))
  const reasonable = rows.filter(row =>
    row.metrics.pvna <= 0.8
    && row.metrics.intra < previewMetrics.intra - 0.05
    && row.metrics.repeatOver <= previewMetrics.repeatOver
    && row.metrics.projectedMax <= previewMetrics.projectedMax,
  )
  const conditionalRescueCandidates = rows.filter(row =>
    row.metrics.pvna <= baseState.config.pvna_tolerance + 0.001
    && row.metrics.pvnaOver <= previewMetrics.pvnaOver + 0.001
    && row.metrics.intra <= previewMetrics.intra + 0.001
    && row.metrics.intraOver <= previewMetrics.intraOver + 0.001
    && row.metrics.repeatOver <= previewMetrics.repeatOver
    && row.metrics.partnerRepeat <= previewMetrics.partnerRepeat
    && row.metrics.opponentRepeat <= previewMetrics.opponentRepeat
    && row.metrics.projectedMax <= previewMetrics.projectedMax
    && row.metrics.projectedMin >= previewMetrics.projectedMin
    && row.metrics.projectedStreakMax <= previewMetrics.projectedStreakMax
    && row.metrics.projectedStreakGte3 <= previewMetrics.projectedStreakGte3
    && row.metrics.projectedStreakGte4 <= previewMetrics.projectedStreakGte4
    && (
      row.metrics.intra < previewMetrics.intra - 0.05
      || row.metrics.pvna < previewMetrics.pvna - 0.05
      || row.metrics.partnerRepeat < previewMetrics.partnerRepeat
      || row.metrics.opponentRepeat < previewMetrics.opponentRepeat
    ),
  ).sort((left, right) =>
    left.metrics.repeatOver - right.metrics.repeatOver
    || left.metrics.partnerRepeat - right.metrics.partnerRepeat
    || left.metrics.opponentRepeat - right.metrics.opponentRepeat
    || left.metrics.intraOver - right.metrics.intraOver
    || left.metrics.pvnaOver - right.metrics.pvnaOver
    || left.metrics.totalCost - right.metrics.totalCost
    || left.metrics.projectedStreakGte4 - right.metrics.projectedStreakGte4
    || left.metrics.projectedStreakGte3 - right.metrics.projectedStreakGte3
    || left.metrics.pvna - right.metrics.pvna
    || left.alternative.score - right.alternative.score,
  )
  const pareto = rows.filter((row, index) => !rows.some((other, otherIndex) =>
    otherIndex !== index && noWorse(other.metrics, row.metrics) && materiallyBetter(other.metrics, row.metrics),
  ))

  const summarize = (row: { alternative: SuggestionAlternative; metrics: ReturnType<typeof metrics> }) => {
    const match = row.alternative.matches[0]
    const team = (ids: [string, string]) => ids.map(id => names.get(id) ?? id.slice(0, 8)).join(' + ')
    return {
      match: `${team(match.team_a)} vs ${team(match.team_b)}`,
      players: [...match.team_a, ...match.team_b].map(id => {
        const player = projectedState.players.get(id)
        return {
          name: names.get(id) ?? id.slice(0, 8),
          matches: player?.matches_played ?? 0,
          rest: player?.consecutive_rest ?? 0,
          play: player?.consecutive_play ?? 0,
          tier: adjustment.tier_overrides[id] ?? null,
        }
      }),
      metrics: Object.fromEntries(Object.entries(row.metrics).map(([key, value]) => [key, round(value)])),
    }
  }

  console.log(JSON.stringify({
    sessionId,
    court: courtIdx + 1,
    liveStateVersion: Number(sessionRes.data?.live_state_version ?? 0),
    busyPlayers: busyIds.size,
    availablePlayers: [...projectedState.players.values()].filter(player => player.checked_out_at === null && !busyIds.has(player.player_id)).length,
    elapsedMs: round(elapsedMs),
    exhaustiveDiag: diag,
    preview: summarize({ alternative: previewAlternative, metrics: previewMetrics }),
    surfacedChoices: (payload.tradeoff_choices ?? []).map(choice => ({
      id: choice.id,
      ...summarize({ alternative: choice.alternative, metrics: metrics(choice.alternative, projectedState, projectedRoundNo) }),
    })),
    candidateCount: rows.length,
    dominatingCount: dominating.length,
    dominating: dominating.slice(0, 10).map(summarize),
    reasonableIntraTradeoffs: reasonable.slice(0, 10).map(summarize),
    conditionalRescue: {
      trigger: previewMetrics.intra > 0.75
        || previewMetrics.partnerRepeat > 1
        || previewMetrics.opponentRepeat > 1
        || previewMetrics.pvna >= 0.4,
      eligibleCount: conditionalRescueCandidates.length,
      selected: conditionalRescueCandidates[0] ? summarize(conditionalRescueCandidates[0]) : null,
      top: conditionalRescueCandidates.slice(0, 10).map(summarize),
    },
    paretoCount: pareto.length,
    pareto: pareto.slice(0, 15).map(summarize),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
