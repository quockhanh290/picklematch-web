import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  getAlternativeIntraTeamGap,
  getAlternativeRepeatMetrics,
} from '../lib/next-round-suggester/live-preview'
import { getRecentRepeatCost } from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type {
  Match,
  SessionLiveMatchRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
} from '../lib/next-round-suggester/types'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/audit-manual-session-alternatives.ts <session-id>')

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
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

function selectedCounts(alternative: SuggestionAlternative, state: SessionState) {
  const ids = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
  return ids.map(id => (state.players.get(id)?.matches_played ?? 0) + 1)
}

function metrics(alternative: SuggestionAlternative, state: SessionState, roundNo: number) {
  const match = alternative.matches[0]
  const repeat = getAlternativeRepeatMetrics(alternative, state)
  const recent = getRecentRepeatCost(match.team_a, match.team_b, state, roundNo)
  const projectedCounts = selectedCounts(alternative, state)
  const teamPvna = (team: [string, string]) => team.reduce(
    (sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0),
    0,
  )
  const pvna = Math.abs(teamPvna(match.team_a) - teamPvna(match.team_b))
  const intra = getAlternativeIntraTeamGap(alternative, state)
  return {
    pvna,
    pvnaOver: Math.max(0, pvna - state.config.pvna_tolerance),
    intra,
    intraOver: Math.max(0, intra - 1.5),
    repeatOver: repeat.repeat_over_by,
    partnerRepeat: repeat.max_partner_pair,
    opponentRepeat: repeat.max_opponent_pair,
    recent: recent.total,
    projectedMax: Math.max(...projectedCounts),
    projectedMin: Math.min(...projectedCounts),
  }
}

function noWorse(candidate: ReturnType<typeof metrics>, actual: ReturnType<typeof metrics>) {
  return (
    candidate.pvnaOver <= actual.pvnaOver + 0.001 &&
    candidate.intraOver <= actual.intraOver + 0.001 &&
    candidate.repeatOver <= actual.repeatOver &&
    candidate.partnerRepeat <= actual.partnerRepeat &&
    candidate.opponentRepeat <= actual.opponentRepeat &&
    candidate.recent <= actual.recent + 0.001 &&
    candidate.projectedMax <= actual.projectedMax
  )
}

function materiallyBetter(candidate: ReturnType<typeof metrics>, actual: ReturnType<typeof metrics>) {
  return (
    candidate.pvnaOver < actual.pvnaOver - 0.02 ||
    candidate.intraOver < actual.intraOver - 0.1 ||
    candidate.repeatOver < actual.repeatOver ||
    candidate.partnerRepeat < actual.partnerRepeat ||
    candidate.opponentRepeat < actual.opponentRepeat ||
    candidate.recent < actual.recent - 0.5 ||
    candidate.projectedMax < actual.projectedMax
  )
}

function labelMatch(match: Match, names: Map<string, string>) {
  const team = (ids: [string, string]) => ids.map(id => names.get(id) ?? id.slice(0, 8)).join('+')
  return `${team(match.team_a)} vs ${team(match.team_b)}`
}

function summarize(value: ReturnType<typeof metrics>) {
  return {
    pvna: round(value.pvna),
    intra: round(value.intra),
    partnerRepeat: value.partnerRepeat,
    opponentRepeat: value.opponentRepeat,
    recent: round(value.recent),
    projectedMax: value.projectedMax,
  }
}

async function main() {
  const auth = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (auth.error) throw auth.error

  const [stateRes, prefRes, matchRes, settingsRes, namesRes] = await Promise.all([
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
    client
      .from('session_live_matches')
      .select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at')
      .eq('session_id', sessionId)
      .eq('status', 'completed')
      .order('sequence_no', { ascending: true }),
    client
      .from('session_next_round_settings')
      .select('pvna_tolerance')
      .eq('session_id', sessionId)
      .maybeSingle(),
    client
      .from('session_player_state')
      .select('player_id, players(name)')
      .eq('session_id', sessionId),
  ])
  for (const result of [stateRes, prefRes, matchRes, settingsRes, namesRes]) {
    if (result.error) throw result.error
  }

  const rows = (matchRes.data ?? []) as SessionLiveMatchRow[]
  const courts = Math.max(...rows.map(row => Number(row.court_idx ?? 0))) + 1
  const names = new Map((namesRes.data ?? []).map((row: any) => [
    String(row.player_id),
    String(row.players?.name ?? row.player_id),
  ]))
  let state = mapRowsToSessionState({
    sessionId,
    playerRows: ((stateRes.data ?? []) as SessionPlayerStateRow[]).map(row => ({
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
    preferenceRows: (prefRes.data ?? []) as SessionPlayerPreferenceRow[],
    courts,
    pvnaTolerance: Number(settingsRes.data?.pvna_tolerance ?? 0.5),
  })

  const audited: any[] = []
  let activeRound = Number(rows[0]?.round_no ?? 0)
  let playedThisRound = new Set<string>()

  for (const row of rows) {
    const roundNo = Number(row.round_no ?? activeRound)
    if (roundNo !== activeRound) {
      state = buildProjectedStateAfterCompletedLiveRound(state, playedThisRound)
      activeRound = roundNo
      playedThisRound = new Set()
    }

    const actual = alternativeForMatch({
      court_idx: Number(row.court_idx ?? 0),
      team_a: row.team_a,
      team_b: row.team_b,
    })
    const actualMetrics = metrics(actual, state, roundNo)
    const result = suggestNextMatch(state, {
      busy_player_ids: playedThisRound,
      court_idx: Number(row.court_idx ?? 0),
      max_alternatives: 120,
      max_runtime_ms: 2000,
    })
    const alternatives = result.alternatives
      .map(alternative => ({ alternative, metrics: metrics(alternative, state, roundNo) }))
    const dominating = alternatives
      .filter(candidate => noWorse(candidate.metrics, actualMetrics) && materiallyBetter(candidate.metrics, actualMetrics))
      .sort((left, right) => left.alternative.score - right.alternative.score)
    const best = dominating[0]
    const lowerIntraWithinPvna = alternatives
      .filter(candidate => (
        candidate.metrics.pvna <= state.config.pvna_tolerance + 0.001 &&
        candidate.metrics.intra < actualMetrics.intra - 0.1 &&
        candidate.metrics.projectedMax <= actualMetrics.projectedMax
      ))
      .sort((left, right) => (
        left.metrics.intra - right.metrics.intra ||
        left.metrics.partnerRepeat - right.metrics.partnerRepeat ||
        left.metrics.opponentRepeat - right.metrics.opponentRepeat ||
        left.metrics.recent - right.metrics.recent
      ))[0]

    audited.push({
      sequence: Number(row.sequence_no),
      round: roundNo + 1,
      court: Number(row.court_idx ?? 0) + 1,
      actual: labelMatch(actual.matches[0], names),
      actualMetrics: summarize(actualMetrics),
      dominatingOptions: dominating.length,
      bestDominating: best ? {
        match: labelMatch(best.alternative.matches[0], names),
        metrics: summarize(best.metrics),
      } : null,
      bestLowerIntraWithinPvna: lowerIntraWithinPvna ? {
        match: labelMatch(lowerIntraWithinPvna.alternative.matches[0], names),
        metrics: summarize(lowerIntraWithinPvna.metrics),
      } : null,
    })

    for (const id of [...row.team_a, ...row.team_b]) playedThisRound.add(id)
    state = buildProjectedStateAfterLiveMatch(state, row, roundNo)
  }
  if (rows.length > 0) state = buildProjectedStateAfterCompletedLiveRound(state, playedThisRound)

  console.log(JSON.stringify({
    sessionId,
    courts,
    matches: rows.length,
    dominatedMatches: audited.filter(row => row.dominatingOptions > 0).length,
    dominatedByRound: [...new Set(audited.map(row => row.round))].map(roundNo => ({
      round: roundNo,
      matches: audited.filter(row => row.round === roundNo).length,
      dominated: audited.filter(row => row.round === roundNo && row.dominatingOptions > 0).length,
    })),
    dominatedDetails: audited.filter(row => row.dominatingOptions > 0),
    capConcernDetails: audited.filter(row => (
      row.actualMetrics.intra > 1.5 ||
      row.actualMetrics.partnerRepeat > 0 ||
      row.actualMetrics.opponentRepeat > 0
    )),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
