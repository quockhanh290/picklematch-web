import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch, buildSuggestedMatchPayloads, getTradeoffChoiceMetrics } from '../lib/next-round-suggester/live-preview'
import { getRecentRepeatCost, PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type { Match, SessionLiveMatchRow, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

const sessionId = process.argv[2]
const sequenceNo = Number(process.argv[3] ?? '9')
if (!sessionId || !Number.isFinite(sequenceNo)) {
  throw new Error('Usage: tsx scratch/audit-live-match-at-sequence.ts <session-id> <sequence-no>')
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
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

function repeatBefore(match: Match, state: SessionState) {
  const partnerPairs = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
  const opponentPairs = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
  return {
    partner: Math.max(0, ...partnerPairs.map(key => {
      const [a, b] = key.split(':')
      return state.players.get(a)?.partner_counts.get(b) ?? 0
    })),
    opponent: Math.max(0, ...opponentPairs.map(key => {
      const [a, b] = key.split(':')
      return state.players.get(a)?.opponent_counts.get(b) ?? 0
    })),
  }
}

function alternativeForMatch(match: Match): SuggestionAlternative {
  return {
    matches: [match],
    resting: [],
    score: 0,
    warnings: [],
    tradeoffs: [],
    stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 },
  }
}

function describeAlternative(alternative: SuggestionAlternative, state: SessionState, names: Map<string, string>, roundNo: number) {
  const match = alternative.matches[0]
  const recent = getRecentRepeatCost(match.team_a, match.team_b, state, roundNo)
  const repeat = repeatBefore(match, state)
  const metrics = getTradeoffChoiceMetrics(alternative, state, 0.5)
  const pvnaGap = Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state))
  const intra = intraGap(match, state)
  return {
    match: `${match.team_a.map(id => names.get(id)).join('+')} vs ${match.team_b.map(id => names.get(id)).join('+')}`,
    teamA: round(teamPvna(match.team_a, state)),
    teamB: round(teamPvna(match.team_b, state)),
    pvnaGap: round(pvnaGap),
    pvnaOver: round(Math.max(0, pvnaGap - 0.5)),
    intra: round(intra),
    intraOver: round(Math.max(0, intra - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)),
    partnerRepeatBefore: repeat.partner,
    opponentRepeatBefore: repeat.opponent,
    repeatOver: metrics.repeat_over_by,
    recent: round(recent.total),
    score: round(alternative.score),
    warnings: alternative.warnings,
    tradeoffs: alternative.tradeoffs,
  }
}

function makeCompletedRow(row: any): SessionLiveMatchRow {
  return {
    ...row,
    status: 'completed',
    resting: row.resting ?? [],
    score_a: row.score_a ?? 0,
    score_b: row.score_b ?? 0,
  }
}

async function main() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (authError) throw authError

  const [stateRes, prefRes, matchRes, playerRes] = await Promise.all([
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
      .neq('status', 'cancelled')
      .order('sequence_no', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, players(name, pvna)')
      .eq('session_id', sessionId),
  ])
  if (stateRes.error) throw stateRes.error
  if (prefRes.error) throw prefRes.error
  if (matchRes.error) throw matchRes.error
  if (playerRes.error) throw playerRes.error

  const names = new Map<string, string>()
  for (const row of playerRes.data ?? []) names.set(String(row.player_id), String((row as any).players?.name ?? row.player_id))

  const playerRows = ((stateRes.data ?? []) as SessionPlayerStateRow[]).map(row => ({
    ...row,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    checked_out_at: null,
    opted_rest: false,
  }))
  let state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: [],
    roundRows: [],
    preferenceRows: (prefRes.data ?? []) as SessionPlayerPreferenceRow[],
    courts: 7,
    pvnaTolerance: 0.5,
  })

  const rows = (matchRes.data ?? []).map(makeCompletedRow)
  const history = rows.filter(row => Number(row.sequence_no) < sequenceNo)
  const target = rows.find(row => Number(row.sequence_no) === sequenceNo)
  if (!target) throw new Error(`No match at sequence ${sequenceNo}`)

  for (const row of history) {
    state = buildProjectedStateAfterLiveMatch(state, row, Number(row.round_no))
    const sameRoundRows = history.filter(other => Number(other.round_no) === Number(row.round_no))
    if (sameRoundRows.length === 7 && sameRoundRows.at(-1)?.id === row.id) {
      state = buildProjectedStateAfterCompletedLiveRound(
        state,
        new Set(sameRoundRows.flatMap(match => [...match.team_a, ...match.team_b])),
      )
    }
  }

  const roundNo = Number(target.round_no)
  const playedThisRound = new Set(
    history
      .filter(row => Number(row.round_no) === roundNo)
      .flatMap(row => [...row.team_a, ...row.team_b]),
  )
  const busyIds = new Set(playedThisRound)

  const result = suggestNextMatch(state, {
    busy_player_ids: busyIds,
    court_idx: Number(target.court_idx),
    max_alternatives: 120,
    max_runtime_ms: 2000,
  })
  const actualAlternative = alternativeForMatch({
    court_idx: Number(target.court_idx),
    team_a: target.team_a,
    team_b: target.team_b,
  })
  const alternatives = result.alternatives
  const targetMinMax = (() => {
    const nextMatchIndex = sequenceNo + 1
    const min = Math.floor(nextMatchIndex * 4 / Math.max(1, state.players.size))
    const max = Math.ceil(nextMatchIndex * 4 / Math.max(1, state.players.size))
    return { min, max }
  })()
  const selectedIds = new Set([...target.team_a, ...target.team_b])
  const generatedPayloads = buildSuggestedMatchPayloads({
    count: 1,
    sessionId,
    courtCount: 7,
    state,
    rows: { liveMatchRows: history, liveStateVersion: null },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
    fairnessWarnings: [],
    playersById: new Map([...names.entries()].map(([playerId, name]) => [playerId, { name }])),
    pvnaTolerance: 0.5,
    options: { courtIdx: Number(target.court_idx) },
  })
  const generated = generatedPayloads[0]
  const generatedAlternative = generated
    ? alternativeForMatch({
        court_idx: Number(generated.court_idx ?? target.court_idx),
        team_a: generated.team_a,
        team_b: generated.team_b,
      })
    : null
  const quota = [...state.players.values()].map(player => ({
    name: names.get(player.player_id),
    played: player.matches_played,
    selected: selectedIds.has(player.player_id),
    projected: player.matches_played + (selectedIds.has(player.player_id) ? 1 : 0),
  }))

  console.log(JSON.stringify({
    sessionId,
    sequenceNo,
    round: roundNo + 1,
    court: Number(target.court_idx) + 1,
    targetMinMax,
    historyCount: history.length,
    alreadyPlayedThisRound: [...busyIds].map(id => names.get(id)),
    actual: describeAlternative(actualAlternative, state, names, roundNo),
    generatedByBuildSuggestedMatchPayloads: generatedAlternative
      ? describeAlternative(generatedAlternative, state, names, roundNo)
      : null,
    generatedPayloadWarnings: generated?.warnings ?? null,
    generatedPayloadTradeoffs: generated?.tradeoffs ?? null,
    actualPlayersQuota: quota.filter(row => row.selected),
    topAlternatives: alternatives.slice(0, 20).map(alt => describeAlternative(alt, state, names, roundNo)),
    bestWithinCap: alternatives
      .map(alt => describeAlternative(alt, state, names, roundNo))
      .filter(alt => alt.pvnaGap <= 0.5 && alt.intra <= 1.75 && alt.repeatOver <= 0)
      .slice(0, 10),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
