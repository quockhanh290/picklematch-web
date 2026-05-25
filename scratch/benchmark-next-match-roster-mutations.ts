import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeOpponentRepeatBurden, computePartnerRepeatBurden, computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type { Match, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

type PlayerName = { name: string; pvna: number }
type ScenarioName =
  | 'baseline_no_mutation'
  | 'late_arrivals'
  | 'checkouts'
  | 'temporary_rest'
  | 'mixed_in_out'
  | 'high_churn'
  | 'small_roster_pressure'
  | 'large_roster_rotation'
  | 'group_static'
  | 'group_churn'
  | 'group_ungroup'
  | 'group_partial_absent'

type SetupCase = {
  name: string
  preset: CourtPreset
  durationMin: number
  targetRounds: number
  recommendedCourts: number
  courts: number
}

const requestedSessionId = process.argv[2] ?? 'latest'
const roundsToSimulate = Number(argValue('--rounds', '10'))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const matchDurationMin = Number(argValue('--match-duration-min', '15'))
const maxCases = Number(argValue('--max-cases', '9999'))
const scenarioFilter = new Set(argValue('--scenarios', '').split(',').map(item => item.trim()).filter(Boolean))
const setupFilter = new Set(argValue('--setups', '').split(',').map(item => item.trim()).filter(Boolean))

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

function format(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0] - b[0]))
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function teamSum(team: [string, string], names: Map<string, PlayerName>) {
  return team.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0)
}

function teamLabel(team: [string, string], names: Map<string, PlayerName>) {
  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  return `${label(team[0])}+${label(team[1])}`
}

function topPairRows(counts: Map<string, number>, names: Map<string, PlayerName>, limit = 5) {
  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  return [...counts.entries()]
    .map(([key, count]) => {
      const [playerA, playerB] = key.split(':')
      return {
        pair: `${label(playerA)} + ${label(playerB)}`,
        count,
      }
    })
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return left.pair.localeCompare(right.pair)
    })
    .slice(0, limit)
}

function cloneStateWithPlayers(state: SessionState, patch: (playerId: string, player: SessionState['players'] extends Map<string, infer P> ? P : never) => SessionState['players'] extends Map<string, infer P> ? P : never): SessionState {
  const players = new Map(state.players)
  for (const [playerId, player] of state.players) players.set(playerId, patch(playerId, player as never) as never)
  return { ...state, players }
}

function resetState(input: {
  sessionId: string
  playerRows: SessionPlayerStateRow[]
  preferenceRows: SessionPlayerPreferenceRow[]
  courts: number
}) {
  const state = mapRowsToSessionState({
    sessionId: input.sessionId,
    playerRows: input.playerRows.map(row => ({
      ...row,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
    })),
    pairRows: [],
    roundRows: [],
    preferenceRows: input.preferenceRows,
    courts: input.courts,
    pvnaTolerance,
  })
  return {
    ...state,
    config: {
      ...state.config,
    },
  }
}

function applyPairHistoryToState(state: SessionState, pairHistory = pairHistoryRowsFromState(state)): SessionState {
  const players = new Map(
    [...state.players.entries()].map(([playerId, player]) => [
      playerId,
      {
        ...player,
        partner_counts: new Map<string, number>(),
        opponent_counts: new Map<string, number>(),
      },
    ]),
  )

  for (const row of pairHistory) {
    const playerA = players.get(row.player_a)
    const playerB = players.get(row.player_b)
    if (playerA) {
      playerA.partner_counts.set(row.player_b, row.partner_count)
      playerA.opponent_counts.set(row.player_b, row.opponent_count)
    }
    if (playerB) {
      playerB.partner_counts.set(row.player_a, row.partner_count)
      playerB.opponent_counts.set(row.player_a, row.opponent_count)
    }
  }

  return { ...state, players }
}

function projectMatch(state: SessionState, alt: SuggestionAlternative, roundNo: number): SessionState {
  const match = alt.matches[0]
  const playedIds = new Set([...match.team_a, ...match.team_b])
  const players = new Map(state.players)

  players.forEach((player, playerId) => {
    if (!playedIds.has(playerId)) return
    players.set(playerId, {
      ...player,
      matches_played: player.matches_played + 1,
      last_played_round: roundNo,
      consecutive_play: player.consecutive_play + 1,
      consecutive_rest: 0,
      opted_rest: false,
    })
  })

  const incrementPair = (leftId: string, rightId: string, field: 'partner_counts' | 'opponent_counts') => {
    const left = players.get(leftId)
    const right = players.get(rightId)
    if (left) {
      const partnerCounts = new Map(left.partner_counts)
      const opponentCounts = new Map(left.opponent_counts)
      const counts = field === 'partner_counts' ? partnerCounts : opponentCounts
      counts.set(rightId, (counts.get(rightId) ?? 0) + 1)
      players.set(leftId, { ...left, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
    if (right) {
      const partnerCounts = new Map(right.partner_counts)
      const opponentCounts = new Map(right.opponent_counts)
      const counts = field === 'partner_counts' ? partnerCounts : opponentCounts
      counts.set(leftId, (counts.get(leftId) ?? 0) + 1)
      players.set(rightId, { ...right, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
  }

  incrementPair(match.team_a[0], match.team_a[1], 'partner_counts')
  incrementPair(match.team_b[0], match.team_b[1], 'partner_counts')
  for (const a of match.team_a) for (const b of match.team_b) incrementPair(a, b, 'opponent_counts')

  return { ...state, players }
}

function applyRosterMutation(base: SessionState, scenario: ScenarioName, roundIndex: number, rosterOrder: string[]) {
  const now = new Date(2026, 0, 1, 12, roundIndex)
  const n = rosterOrder.length
  const set = (ids: string[]) => new Set(ids)
  let present = set(rosterOrder)
  let optedRest = new Set<string>()
  const groupOverrides = new Map<string, string | null>()
  const setGroup = (ids: string[], groupId: string | null) => {
    for (const id of ids) groupOverrides.set(id, groupId)
  }
  const pairGroups = (start: number, pairs: Array<[number, number]>, prefix: string) => {
    pairs.forEach(([left, right], index) => {
      setGroup(
        [rosterOrder[start + left], rosterOrder[start + right]].filter(Boolean),
        `sim-${scenario}-${prefix}-${index}`,
      )
    })
  }

  if (scenario === 'late_arrivals') {
    const first = Math.floor(n * 0.75)
    const second = Math.floor(n * 0.88)
    present = roundIndex < 2
      ? set(rosterOrder.slice(0, first))
      : roundIndex < 5
        ? set(rosterOrder.slice(0, second))
        : set(rosterOrder)
  } else if (scenario === 'checkouts') {
    present = roundIndex < 3
      ? set(rosterOrder)
      : roundIndex < 6
        ? set(rosterOrder.slice(0, Math.max(4, n - 4)))
        : set(rosterOrder.slice(0, Math.max(4, n - 8)))
  } else if (scenario === 'temporary_rest') {
    optedRest = roundIndex % 3 === 1
      ? set(rosterOrder.slice(0, Math.min(4, n)))
      : roundIndex % 3 === 2
        ? set(rosterOrder.slice(4, Math.min(8, n)))
        : new Set<string>()
  } else if (scenario === 'mixed_in_out') {
    const lateStart = Math.floor(n * 0.82)
    present = roundIndex < 2 ? set(rosterOrder.slice(0, lateStart)) : set(rosterOrder)
    if (roundIndex >= 5) for (const id of rosterOrder.slice(0, Math.min(3, n))) present.delete(id)
    if (roundIndex % 4 === 3) optedRest = set(rosterOrder.slice(6, Math.min(10, n)).filter(id => present.has(id)))
  } else if (scenario === 'high_churn') {
    const absentCount = Math.min(Math.max(2, Math.floor(n * 0.15)), Math.max(0, n - 4))
    present = set(rosterOrder.filter((_, index) => ((index + roundIndex * 3) % n) >= absentCount))
    optedRest = set(rosterOrder.filter((_, index) => present.has(rosterOrder[index]) && (index + roundIndex) % 11 === 0).slice(0, 3))
  } else if (scenario === 'small_roster_pressure') {
    const pressureSize = Math.min(n, Math.max(8, base.config.courts * 4 + 2))
    present = set(rosterOrder.slice(0, pressureSize))
  } else if (scenario === 'large_roster_rotation') {
    const hidden = Math.max(0, Math.floor(n * 0.1))
    present = set(rosterOrder.slice(roundIndex < 4 ? hidden : 0))
  } else if (scenario === 'group_static') {
    pairGroups(0, [[0, 1], [2, 3], [4, 5], [6, 7]], 'static')
  } else if (scenario === 'group_churn') {
    if (roundIndex < 3) {
      pairGroups(0, [[0, 1], [2, 3], [4, 5], [6, 7]], 'a')
    } else if (roundIndex < 6) {
      pairGroups(0, [[0, 2], [1, 3], [4, 6], [5, 7]], 'b')
      pairGroups(8, [[0, 1], [2, 3]], 'late-b')
    } else {
      pairGroups(0, [[0, 4], [1, 5], [2, 6], [3, 7]], 'c')
      pairGroups(8, [[0, 2], [1, 3]], 'late-c')
    }
  } else if (scenario === 'group_ungroup') {
    if (roundIndex < 3) {
      pairGroups(0, [[0, 1], [2, 3], [4, 5]], 'early')
    } else if (roundIndex < 6) {
      setGroup(rosterOrder.slice(0, 12), null)
    } else {
      pairGroups(0, [[0, 2], [1, 4], [3, 5]], 'late')
    }
  } else if (scenario === 'group_partial_absent') {
    pairGroups(0, [[0, 1], [2, 3], [4, 5], [6, 7]], 'partial')
    if (roundIndex >= 2 && roundIndex < 5) {
      for (const id of rosterOrder.slice(1, 8, 2)) present.delete(id)
    }
    if (roundIndex >= 5 && roundIndex < 8) {
      optedRest = set(rosterOrder.slice(0, 4).filter(id => present.has(id)))
    }
  }

  return cloneStateWithPlayers(base, (playerId, player) => ({
    ...player,
    group_id: groupOverrides.has(playerId) ? groupOverrides.get(playerId) ?? null : player.group_id,
    checked_out_at: present.has(playerId) ? null : now,
    opted_rest: present.has(playerId) && optedRest.has(playerId),
  }))
}

function summarizeCase(input: {
  sessionId: string
  playerRows: SessionPlayerStateRow[]
  preferenceRows: SessionPlayerPreferenceRow[]
  names: Map<string, PlayerName>
  rosterOrder: string[]
  scenario: ScenarioName
  setup: SetupCase
}) {
  const startedAt = Date.now()
  let state = resetState({
    sessionId: input.sessionId,
    playerRows: input.playerRows,
    preferenceRows: input.preferenceRows,
    courts: input.setup.courts,
  })

  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  const gaps: number[] = []
  const intraTeamGaps: number[] = []
  const warningCounts = new Map<string, number>()
  const tradeoffCounts = new Map<string, number>()
  const repeatCapExamples: Array<{ round: number; court: number; partner: number; opponent: number; match: string }> = []
  const worstGaps: Array<{ round: number; court: number; gap: number; match: string }> = []
  const correctnessIssues: string[] = []
  let groupedPartnerMatches = 0
  let groupedPlayerSelections = 0
  const firstPresentRound = new Map<string, number>()
  const firstPlayedRound = new Map<string, number>()
  let stoppedAt: { round: number; court: number; warnings: string[] } | null = null

  for (let roundNo = 0; roundNo < roundsToSimulate; roundNo += 1) {
    const preRoundState = applyRosterMutation(state, input.scenario, roundNo, input.rosterOrder)
    const presentIds = new Set([...preRoundState.players.values()].filter(player => player.checked_out_at === null).map(player => player.player_id))
    const optedRestIds = new Set([...preRoundState.players.values()].filter(player => player.checked_out_at === null && player.opted_rest).map(player => player.player_id))
    for (const id of presentIds) if (!firstPresentRound.has(id)) firstPresentRound.set(id, roundNo + 1)

    let suggestionState = preRoundState
    const busy = new Set<string>()
    const matches: Match[] = []

    for (let courtIdx = 0; courtIdx < input.setup.courts; courtIdx += 1) {
      const adjustment = correctForFairness(suggestionState)
      const adjustedState = applyFairnessAdjustment(suggestionState, adjustment)
      const result = suggestNextMatch(adjustedState, {
        court_idx: courtIdx,
        busy_player_ids: busy,
        tier_overrides: adjustment.tier_overrides,
        max_alternatives: 1,
      })
      const alternative = result.alternatives[0]
      const match = alternative?.matches[0]
      if (!alternative || !match) {
        stoppedAt = { round: roundNo + 1, court: courtIdx + 1, warnings: result.warnings }
        break
      }

      const played = [...match.team_a, ...match.team_b]
      for (const id of played) {
        if (!presentIds.has(id)) correctnessIssues.push(`round ${roundNo + 1} court ${courtIdx + 1}: checked-out player selected ${id}`)
        if (optedRestIds.has(id)) correctnessIssues.push(`round ${roundNo + 1} court ${courtIdx + 1}: opted-rest player selected ${id}`)
        if (busy.has(id)) correctnessIssues.push(`round ${roundNo + 1} court ${courtIdx + 1}: duplicate player in logical round ${id}`)
        if (!firstPlayedRound.has(id)) firstPlayedRound.set(id, roundNo + 1)
      }

      for (const warning of alternative.warnings) warningCounts.set(warning, (warningCounts.get(warning) ?? 0) + 1)
      for (const tradeoff of alternative.tradeoffs ?? []) tradeoffCounts.set(tradeoff.type, (tradeoffCounts.get(tradeoff.type) ?? 0) + 1)
      groupedPlayerSelections += [...match.team_a, ...match.team_b].filter(id => suggestionState.players.get(id)?.group_id).length
      for (const team of [match.team_a, match.team_b]) {
        const groupA = suggestionState.players.get(team[0])?.group_id
        const groupB = suggestionState.players.get(team[1])?.group_id
        if (groupA && groupA === groupB) groupedPartnerMatches += 1
      }

      const partnerKeys = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
      const opponentKeys = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
      const projectedPartner = Math.max(...partnerKeys.map(key => (partnerCounts.get(key) ?? 0) + 1))
      const projectedOpponent = Math.max(...opponentKeys.map(key => (opponentCounts.get(key) ?? 0) + 1))
      if (projectedPartner > 2 || projectedOpponent > 2) {
        repeatCapExamples.push({
          round: roundNo + 1,
          court: courtIdx + 1,
          partner: projectedPartner,
          opponent: projectedOpponent,
          match: `${teamLabel(match.team_a, input.names)} vs ${teamLabel(match.team_b, input.names)}`,
        })
      }
      for (const key of partnerKeys) partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
      for (const key of opponentKeys) opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)

      const gap = Math.abs(teamSum(match.team_a, input.names) - teamSum(match.team_b, input.names))
      gaps.push(gap)
      intraTeamGaps.push(Math.max(
        Math.abs((input.names.get(match.team_a[0])?.pvna ?? 3) - (input.names.get(match.team_a[1])?.pvna ?? 3)),
        Math.abs((input.names.get(match.team_b[0])?.pvna ?? 3) - (input.names.get(match.team_b[1])?.pvna ?? 3)),
      ))
      worstGaps.push({
        round: roundNo + 1,
        court: courtIdx + 1,
        gap,
        match: `${teamLabel(match.team_a, input.names)} vs ${teamLabel(match.team_b, input.names)}`,
      })

      matches.push(match)
      played.forEach(id => busy.add(id))
      suggestionState = projectMatch(suggestionState, alternative, roundNo)
    }

    if (stoppedAt || matches.length === 0) break

    const resting = [...presentIds].filter(id => !busy.has(id) && !optedRestIds.has(id))
    const round = {
      session_id: input.sessionId,
      round_no: roundNo,
      status: 'completed' as const,
      matches,
      resting,
      started_at: new Date(),
      ended_at: new Date(),
    }
    const committed = commitCompletedRound(preRoundState, round, pairHistoryRowsFromState(preRoundState))
    state = applyPairHistoryToState({
      ...preRoundState,
      players: committed.players,
      rounds: [...preRoundState.rounds, round],
      current_round: roundNo + 1,
    }, committed.pairHistory)
  }

  const finalPresent = [...state.players.values()].filter(player => player.checked_out_at === null)
  const matchCounts = finalPresent.map(player => player.matches_played)
  const consecutiveRest = finalPresent.map(player => player.consecutive_rest)
  const partnerBurden = computePartnerRepeatBurden(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const fairness = computeSessionFairness(state)
  const lateArrivalWaits = [...firstPresentRound.entries()].flatMap(([id, presentRound]) => {
    if (presentRound <= 1) return []
    const playedRound = firstPlayedRound.get(id)
    return playedRound ? [playedRound - presentRound] : []
  })

  return {
    scenario: input.scenario,
    setup: input.setup.name,
    preset: input.setup.preset,
    durationMin: input.setup.durationMin,
    targetRounds: input.setup.targetRounds,
    recommendedCourts: input.setup.recommendedCourts,
    courts: input.setup.courts,
    rounds: state.rounds.length,
    matches: gaps.length,
    stoppedAt,
    runtimeMs: Date.now() - startedAt,
    pvna: {
      avg: format(avg(gaps)),
      p90: format(percentile(gaps, 90)),
      max: format(Math.max(0, ...gaps)),
      over05: gaps.filter(value => value > 0.5).length,
      over08: gaps.filter(value => value > 0.8).length,
    },
    intraTeam: {
      max: format(Math.max(0, ...intraTeamGaps)),
      over15: intraTeamGaps.filter(value => value > 1.5).length,
    },
    repeat: {
      overPairCap2Matches: repeatCapExamples.length,
      maxPartnerPair: Math.max(0, ...partnerCounts.values()),
      maxOpponentPair: Math.max(0, ...opponentCounts.values()),
      maxRepeatedPartnersPerPlayer: partnerBurden.max_repeated_partners,
      maxRepeatedOpponentsPerPlayer: opponentBurden.max_repeated_opponents,
      topPartnerPairs: topPairRows(partnerCounts, input.names),
      topOpponentPairs: topPairRows(opponentCounts, input.names),
    },
    distribution: {
      presentFinal: finalPresent.length,
      matchMin: matchCounts.length === 0 ? 0 : Math.min(...matchCounts),
      matchMax: Math.max(0, ...matchCounts),
      matchAvg: format(avg(matchCounts)),
      matchBucket: bucket(matchCounts),
      maxConsecutiveRest: Math.max(0, ...consecutiveRest),
      lateArrivalWaitMax: Math.max(0, ...lateArrivalWaits),
      lateArrivalWaitAvg: format(avg(lateArrivalWaits)),
    },
    group: {
      groupedPartnerMatches,
      groupedPlayerSelections,
    },
    fairness: {
      total: fairness.total,
      grade: fairness.grade,
    },
    warnings: Object.fromEntries([...warningCounts.entries()].sort()),
    tradeoffs: Object.fromEntries([...tradeoffCounts.entries()].sort()),
    correctness: {
      issueCount: correctnessIssues.length,
      issues: correctnessIssues.slice(0, 8),
    },
    worstGaps: worstGaps.sort((a, b) => b.gap - a.gap).slice(0, 3).map(row => ({
      ...row,
      gap: format(row.gap),
    })),
    repeatCapExamples: repeatCapExamples.slice(0, 3),
  }
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

  let sessionId = requestedSessionId
  if (requestedSessionId === 'latest') {
    const latest = await client
      .from('sessions')
      .select('id')
      .eq('host_id', signIn.data.user!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (latest.error) throw latest.error
    sessionId = String(latest.data.id)
  }

  const [playersRes, preferenceRes, namesRes, settingsRes] = await Promise.all([
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
    client
      .from('session_next_round_settings')
      .select('court_count_override, court_duration_min, court_preset, target_rounds, pvna_tolerance')
      .eq('session_id', sessionId)
      .maybeSingle(),
  ])
  if (playersRes.error) throw playersRes.error
  if (preferenceRes.error) throw preferenceRes.error
  if (namesRes.error) throw namesRes.error

  const playerRows = (playersRes.data ?? []) as SessionPlayerStateRow[]
  const preferenceRows = (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[]
  const names = new Map<string, PlayerName>((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
    name: row.players?.name ?? String(row.player_id).slice(0, 8),
    pvna: Number(row.players?.pvna ?? 3),
  }]))
  const rosterOrder = playerRows.map(row => row.player_id)
  const playerCount = playerRows.length
  const maxUsefulCourts = Math.max(1, Math.floor(playerCount / 4))
  const settings = settingsRes.data as null | {
    court_count_override?: number | null
    court_duration_min?: number | null
    court_preset?: CourtPreset | null
    target_rounds?: number | null
    pvna_tolerance?: number | null
  }
  const actualPreset = settings?.court_preset ?? 'balanced'
  const actualDuration = settings?.court_duration_min ?? 120
  const actualCalc = calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: actualDuration,
    match_duration_min: matchDurationMin,
    preset: actualPreset,
  })
  const balancedCalc = calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: 120,
    match_duration_min: matchDurationMin,
    preset: 'balanced',
  })
  const relaxedCalc = calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: 120,
    match_duration_min: matchDurationMin,
    preset: 'relaxed',
  })

  const setupCases: SetupCase[] = [
    {
      name: 'actual_settings',
      preset: actualPreset,
      durationMin: actualDuration,
      targetRounds: settings?.target_rounds ?? 8,
      recommendedCourts: actualCalc.recommended.courts,
      courts: Math.min(maxUsefulCourts, Math.max(1, settings?.court_count_override ?? actualCalc.recommended.courts)),
    },
    {
      name: 'balanced_recommended',
      preset: 'balanced',
      durationMin: 120,
      targetRounds: 8,
      recommendedCourts: balancedCalc.recommended.courts,
      courts: balancedCalc.recommended.courts,
    },
    {
      name: 'balanced_plus_one',
      preset: 'balanced',
      durationMin: 120,
      targetRounds: 8,
      recommendedCourts: balancedCalc.recommended.courts,
      courts: Math.min(maxUsefulCourts, balancedCalc.recommended.courts + 1),
    },
    {
      name: 'play_more_max',
      preset: 'play_more',
      durationMin: 120,
      targetRounds: 8,
      recommendedCourts: calculateOptimalCourts({
        n_players: playerCount,
        session_duration_min: 120,
        match_duration_min: matchDurationMin,
        preset: 'play_more',
      }).recommended.courts,
      courts: maxUsefulCourts,
    },
    {
      name: 'relaxed_recommended',
      preset: 'relaxed',
      durationMin: 120,
      targetRounds: 8,
      recommendedCourts: relaxedCalc.recommended.courts,
      courts: relaxedCalc.recommended.courts,
    },
  ]

  const scenarios: ScenarioName[] = [
    'baseline_no_mutation',
    'late_arrivals',
    'checkouts',
    'temporary_rest',
    'mixed_in_out',
    'high_churn',
    'small_roster_pressure',
    'large_roster_rotation',
    'group_static',
    'group_churn',
    'group_ungroup',
    'group_partial_absent',
  ].filter(scenario => scenarioFilter.size === 0 || scenarioFilter.has(scenario)) as ScenarioName[]

  const filteredSetupCases = setupCases.filter(setup => setupFilter.size === 0 || setupFilter.has(setup.name))
  const cases = scenarios.flatMap(scenario => filteredSetupCases.map(setup => ({ scenario, setup }))).slice(0, maxCases)
  const reports = cases.map((item, index) => ({
    caseNo: index + 1,
    ...summarizeCase({
      sessionId,
      playerRows,
      preferenceRows,
      names,
      rosterOrder,
      scenario: item.scenario,
      setup: item.setup,
    }),
  }))

  const aggregate = {
    cases: reports.length,
    pvnaOver05Total: reports.reduce((sum, row) => sum + row.pvna.over05, 0),
    repeatCapTotal: reports.reduce((sum, row) => sum + row.repeat.overPairCap2Matches, 0),
    stoppedCases: reports.filter(row => row.stoppedAt).length,
    correctnessIssueTotal: reports.reduce((sum, row) => sum + row.correctness.issueCount, 0),
    worstPvna: reports.reduce((best, row) => row.pvna.max > best.pvna.max ? row : best, reports[0]),
    worstRepeat: reports.reduce((best, row) => row.repeat.overPairCap2Matches > best.repeat.overPairCap2Matches ? row : best, reports[0]),
    worstRest: reports.reduce((best, row) => row.distribution.maxConsecutiveRest > best.distribution.maxConsecutiveRest ? row : best, reports[0]),
    slowest: reports.reduce((best, row) => row.runtimeMs > best.runtimeMs ? row : best, reports[0]),
  }

  console.log(JSON.stringify({
    sessionId,
    playerCount,
    roundsToSimulate,
    pvnaTolerance: settings?.pvna_tolerance ?? pvnaTolerance,
    matchDurationMin,
    scenarios,
    setupCases: filteredSetupCases,
    aggregate,
    reports,
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
