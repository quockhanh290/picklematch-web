import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { getProjectedRepeatSummary } from '../lib/next-round-suggester/score'
import type { Match, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

const requestedSessionId = process.argv[2] ?? 'latest'
const roundsToSimulate = Number(argValue('--rounds', '10'))
const targetPartner = argValue('--partner', 'P5+P3')
const targetOpponent = argValue('--opponent', 'P5+P2')
const alternativesToInspect = Number(argValue('--alternatives', '8'))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

type PlayerName = { name: string; pvna: number }
type TargetPair = { leftName: string; rightName: string; leftId: string; rightId: string }

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function splitPair(value: string): [string, string] {
  const parts = value.split(/[+:,]/).map(item => item.trim()).filter(Boolean)
  if (parts.length !== 2) throw new Error(`Invalid pair: ${value}`)
  return [parts[0], parts[1]]
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

function teamSum(team: [string, string], names: Map<string, PlayerName>) {
  return team.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0)
}

function label(id: string, names: Map<string, PlayerName>) {
  return names.get(id)?.name ?? id.slice(0, 8)
}

function teamLabel(team: [string, string], names: Map<string, PlayerName>) {
  return `${label(team[0], names)}+${label(team[1], names)}`
}

function matchLabel(match: Match, names: Map<string, PlayerName>) {
  return `${teamLabel(match.team_a, names)} vs ${teamLabel(match.team_b, names)}`
}

function isPartnerPair(match: Match, target: TargetPair) {
  return pairKey(match.team_a[0], match.team_a[1]) === pairKey(target.leftId, target.rightId)
    || pairKey(match.team_b[0], match.team_b[1]) === pairKey(target.leftId, target.rightId)
}

function isOpponentPair(match: Match, target: TargetPair) {
  return match.team_a.some(id => id === target.leftId || id === target.rightId)
    && match.team_b.some(id => id === target.leftId || id === target.rightId)
}

function alternativeSummary(
  alternative: SuggestionAlternative,
  state: SessionState,
  names: Map<string, PlayerName>,
  partnerTarget: TargetPair,
  opponentTarget: TargetPair,
) {
  const match = alternative.matches[0]
  const repeat = getProjectedRepeatSummary(match.team_a, match.team_b, state)
  return {
    match: matchLabel(match, names),
    pvnaGap: Number(Math.abs(teamSum(match.team_a, names) - teamSum(match.team_b, names)).toFixed(2)),
    score: Number(alternative.score.toFixed(2)),
    partnerRepeats: alternative.stats.partner_repeats,
    opponentRepeats: alternative.stats.opponent_repeats,
    pairOverBy: repeat.pair_over_by,
    affectedPairs: repeat.affected_pairs,
    maxPartnerPair: repeat.max_partner_pair_count,
    maxOpponentPair: repeat.max_opponent_pair_count,
    containsPartnerTarget: isPartnerPair(match, partnerTarget),
    containsOpponentTarget: isOpponentPair(match, opponentTarget),
    warnings: alternative.warnings,
    tradeoffs: alternative.tradeoffs ?? [],
  }
}

function resolveTargetPair(pairText: string, nameToId: Map<string, string>): TargetPair {
  const [leftName, rightName] = splitPair(pairText)
  const leftId = nameToId.get(leftName)
  const rightId = nameToId.get(rightName)
  if (!leftId || !rightId) throw new Error(`Could not resolve pair ${pairText}`)
  return { leftName, rightName, leftId, rightId }
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
  const nameToId = new Map([...names.entries()].map(([id, item]) => [item.name, id]))
  const partnerTarget = resolveTargetPair(targetPartner, nameToId)
  const opponentTarget = resolveTargetPair(targetOpponent, nameToId)
  const calc = calculateOptimalCourts({
    n_players: playerRows.length,
    session_duration_min: 120,
    match_duration_min: 15,
    preset: 'balanced',
  })
  const courts = calc.recommended.courts
  let state = resetState({
    sessionId,
    playerRows,
    preferenceRows,
    courts,
  })
  const events: unknown[] = []
  const selectedMatches: unknown[] = []

  for (let roundNo = 0; roundNo < roundsToSimulate; roundNo += 1) {
    const preRoundState = state
    let suggestionState = state
    const busy = new Set<string>()
    const matches: Match[] = []

    for (let courtIdx = 0; courtIdx < courts; courtIdx += 1) {
      const adjustment = correctForFairness(suggestionState)
      const adjustedState = applyFairnessAdjustment(suggestionState, adjustment)
      const result = suggestNextMatch(adjustedState, {
        court_idx: courtIdx,
        busy_player_ids: busy,
        tier_overrides: adjustment.tier_overrides,
        max_alternatives: alternativesToInspect,
      })
      const alternative = result.alternatives[0]
      const match = alternative?.matches[0]
      if (!alternative || !match) {
        events.push({ round: roundNo + 1, court: courtIdx + 1, stopped: result.warnings })
        break
      }

      const selected = alternativeSummary(alternative, suggestionState, names, partnerTarget, opponentTarget)
      if (selected.containsPartnerTarget || selected.containsOpponentTarget) {
        const alternatives = result.alternatives.map(alt =>
          alternativeSummary(alt, suggestionState, names, partnerTarget, opponentTarget),
        )
        events.push({
          round: roundNo + 1,
          court: courtIdx + 1,
          selected,
          alternatives,
          hasAlternativeWithoutPartnerTarget: alternatives.some(item => !item.containsPartnerTarget),
          hasAlternativeWithoutOpponentTarget: alternatives.some(item => !item.containsOpponentTarget),
          bestWithoutPartnerTarget: alternatives.find(item => !item.containsPartnerTarget) ?? null,
          bestWithoutOpponentTarget: alternatives.find(item => !item.containsOpponentTarget) ?? null,
        })
      }

      selectedMatches.push({
        round: roundNo + 1,
        court: courtIdx + 1,
        ...selected,
      })
      matches.push(match)
      match.team_a.forEach(id => busy.add(id))
      match.team_b.forEach(id => busy.add(id))
      suggestionState = projectMatch(suggestionState, alternative, roundNo)
    }

    if (matches.length === 0) break
    const resting = [...state.players.keys()].filter(id => !busy.has(id))
    const round = {
      session_id: sessionId,
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

  console.log(JSON.stringify({
    sessionId,
    playerCount: playerRows.length,
    courts,
    roundsToSimulate,
    targetPartner,
    targetOpponent,
    alternativesToInspect,
    eventCount: events.length,
    events,
    selectedMatches: selectedMatches.filter((item: any) => item.containsPartnerTarget || item.containsOpponentTarget),
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
