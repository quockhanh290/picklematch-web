import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeOpponentRepeatBurden, computePartnerRepeatBurden, computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { Match, SessionPairHistoryRow, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

const requestedSessionId = process.argv[2] ?? 'latest'
const roundsToSimulate = Number(argValue('--rounds', '10'))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const matchDurationMin = Number(argValue('--match-duration-min', '15'))
const durationArgs = argValue('--durations', '90,120,150').split(',').map(Number).filter(Number.isFinite)
const targetRoundArgs = argValue('--target-rounds', '8,10,12').split(',').map(Number).filter(Number.isFinite)
const presets = argValue('--presets', 'play_more,balanced,relaxed').split(',') as CourtPreset[]
const maxCases = Number(argValue('--max-cases', '9999'))

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

type PlayerName = { name: string; pvna: number }

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

function resetState(input: {
  sessionId: string
  playerRows: SessionPlayerStateRow[]
  preferenceRows: SessionPlayerPreferenceRow[]
  courts: number
}) {
  return mapRowsToSessionState({
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
}

function summarizeCase(input: {
  sessionId: string
  playerRows: SessionPlayerStateRow[]
  preferenceRows: SessionPlayerPreferenceRow[]
  names: Map<string, PlayerName>
  preset: CourtPreset
  durationMin: number
  targetRounds: number
  courts: number
  recommendedCourts: number
}) {
  let state = resetState({
    sessionId: input.sessionId,
    playerRows: input.playerRows,
    preferenceRows: input.preferenceRows,
    courts: input.courts,
  })

  const allPlayerIds = [...state.players.keys()]
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  const gaps: number[] = []
  const intraTeamGaps: number[] = []
  const warningCounts = new Map<string, number>()
  const tradeoffCounts = new Map<string, number>()
  const repeatCapExamples: Array<{ round: number; court: number; partner: number; opponent: number }> = []
  const worstGaps: Array<{ round: number; court: number; gap: number; match: string }> = []
  let stoppedAt: { round: number; court: number; warnings: string[] } | null = null

  const label = (id: string) => input.names.get(id)?.name ?? id.slice(0, 8)
  const teamLabel = (team: [string, string]) => `${label(team[0])}+${label(team[1])}`

  for (let roundNo = 0; roundNo < roundsToSimulate; roundNo += 1) {
    const preRoundState = state
    let suggestionState = state
    const busy = new Set<string>()
    const matches: Match[] = []

    for (let courtIdx = 0; courtIdx < input.courts; courtIdx += 1) {
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

      for (const warning of alternative.warnings) warningCounts.set(warning, (warningCounts.get(warning) ?? 0) + 1)
      for (const tradeoff of alternative.tradeoffs ?? []) tradeoffCounts.set(tradeoff.type, (tradeoffCounts.get(tradeoff.type) ?? 0) + 1)

      const partnerKeys = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
      const opponentKeys = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
      const projectedPartner = Math.max(...partnerKeys.map(key => (partnerCounts.get(key) ?? 0) + 1))
      const projectedOpponent = Math.max(...opponentKeys.map(key => (opponentCounts.get(key) ?? 0) + 1))
      if (projectedPartner > 2 || projectedOpponent > 2) {
        repeatCapExamples.push({ round: roundNo + 1, court: courtIdx + 1, partner: projectedPartner, opponent: projectedOpponent })
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
        match: `${teamLabel(match.team_a)} vs ${teamLabel(match.team_b)}`,
      })

      matches.push(match)
      match.team_a.forEach(id => busy.add(id))
      match.team_b.forEach(id => busy.add(id))
      suggestionState = projectMatch(suggestionState, alternative, roundNo)
    }

    if (stoppedAt || matches.length === 0) break

    const resting = allPlayerIds.filter(id => !busy.has(id))
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
    state = {
      ...preRoundState,
      players: committed.players,
      rounds: [...preRoundState.rounds, round],
      current_round: roundNo + 1,
    }
  }

  const matchCounts = [...state.players.values()].map(player => player.matches_played)
  const restCounts = [...state.players.values()].map(player => Math.max(0, roundsToSimulate - player.matches_played))
  const partnerBurden = computePartnerRepeatBurden(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const fairness = computeSessionFairness(state)
  const sortedWorstGaps = worstGaps.sort((a, b) => b.gap - a.gap).slice(0, 3).map(row => ({
    ...row,
    gap: format(row.gap),
  }))

  return {
    preset: input.preset,
    durationMin: input.durationMin,
    targetRounds: input.targetRounds,
    recommendedCourts: input.recommendedCourts,
    courts: input.courts,
    rounds: state.rounds.length,
    matches: gaps.length,
    stoppedAt,
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
    },
    distribution: {
      matchMin: Math.min(...matchCounts),
      matchMax: Math.max(...matchCounts),
      matchAvg: format(avg(matchCounts)),
      matchBucket: bucket(matchCounts),
      restMin: Math.min(...restCounts),
      restMax: Math.max(...restCounts),
      restAvg: format(avg(restCounts)),
    },
    fairness: {
      total: fairness.total,
      grade: fairness.grade,
    },
    warnings: Object.fromEntries([...warningCounts.entries()].sort()),
    tradeoffs: Object.fromEntries([...tradeoffCounts.entries()].sort()),
    worstGaps: sortedWorstGaps,
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

  const playerRows = (playersRes.data ?? []) as SessionPlayerStateRow[]
  const preferenceRows = (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[]
  const names = new Map<string, PlayerName>((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
    name: row.players?.name ?? String(row.player_id).slice(0, 8),
    pvna: Number(row.players?.pvna ?? 3),
  }]))
  const playerCount = playerRows.length
  const maxUsefulCourts = Math.max(1, Math.floor(playerCount / 4))
  const cases: Array<{
    preset: CourtPreset
    durationMin: number
    targetRounds: number
    recommendedCourts: number
    courts: number
  }> = []

  for (const preset of presets) {
    for (const durationMin of durationArgs) {
      const calc = calculateOptimalCourts({
        n_players: playerCount,
        session_duration_min: durationMin,
        match_duration_min: matchDurationMin,
        preset,
      })
      for (const targetRounds of targetRoundArgs) {
        for (let courts = calc.recommended.courts; courts <= maxUsefulCourts; courts += 1) {
          cases.push({
            preset,
            durationMin,
            targetRounds,
            recommendedCourts: calc.recommended.courts,
            courts,
          })
        }
      }
    }
  }

  const reports = cases.slice(0, maxCases).map((scenario, index) => ({
    caseNo: index + 1,
    ...summarizeCase({
      sessionId,
      playerRows,
      preferenceRows,
      names,
      ...scenario,
    }),
  }))

  const aggregate = {
    cases: reports.length,
    pvnaOver05Total: reports.reduce((sum, row) => sum + row.pvna.over05, 0),
    repeatCapTotal: reports.reduce((sum, row) => sum + row.repeat.overPairCap2Matches, 0),
    stoppedCases: reports.filter(row => row.stoppedAt).length,
    worstPvna: reports.reduce((best, row) => row.pvna.max > best.pvna.max ? row : best, reports[0]),
    worstRepeat: reports.reduce((best, row) => row.repeat.overPairCap2Matches > best.repeat.overPairCap2Matches ? row : best, reports[0]),
  }

  console.log(JSON.stringify({
    sessionId,
    playerCount,
    roundsToSimulate,
    pvnaTolerance,
    matchDurationMin,
    durations: durationArgs,
    targetRounds: targetRoundArgs,
    presets,
    aggregate,
    reports,
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
