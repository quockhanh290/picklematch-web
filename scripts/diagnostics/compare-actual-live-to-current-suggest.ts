import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState, SuggestionAlternative } from '@/lib/next-round-suggester/types'

const requestedSessionId = process.argv[2] ?? 'latest'
const roundsLimit = Number(process.argv.find(arg => arg.startsWith('--rounds='))?.split('=')[1] ?? '8')
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

type PlayerName = { name: string; pvna: number }

function format(n: number) {
  return Number(n.toFixed(2))
}

function key(ids: string[]) {
  return [...ids].sort().join(':')
}

function matchKey(match: { team_a: [string, string]; team_b: [string, string] }) {
  return key([...match.team_a, ...match.team_b])
}

function projectActual(state: SessionState, match: SessionLiveMatchRow, roundNo: number): SessionState {
  const alt: SuggestionAlternative = {
    matches: [{
      court_idx: match.court_idx ?? 0,
      team_a: match.team_a,
      team_b: match.team_b,
    }],
    resting: match.resting ?? [],
    score: 0,
    warnings: [],
    stats: {
      pvna_diff: 0,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
    },
  }
  return projectAlt(state, alt, roundNo)
}

function projectAlt(state: SessionState, alt: SuggestionAlternative, roundNo: number): SessionState {
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

  const incrementPair = (a: string, b: string, field: 'partner_counts' | 'opponent_counts') => {
    const left = players.get(a)
    const right = players.get(b)
    if (left) {
      const partnerCounts = new Map(left.partner_counts)
      const opponentCounts = new Map(left.opponent_counts)
      const counts = field === 'partner_counts' ? partnerCounts : opponentCounts
      counts.set(b, (counts.get(b) ?? 0) + 1)
      players.set(a, { ...left, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
    if (right) {
      const partnerCounts = new Map(right.partner_counts)
      const opponentCounts = new Map(right.opponent_counts)
      const counts = field === 'partner_counts' ? partnerCounts : opponentCounts
      counts.set(a, (counts.get(a) ?? 0) + 1)
      players.set(b, { ...right, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
  }

  incrementPair(match.team_a[0], match.team_a[1], 'partner_counts')
  incrementPair(match.team_b[0], match.team_b[1], 'partner_counts')
  for (const a of match.team_a) for (const b of match.team_b) incrementPair(a, b, 'opponent_counts')

  return { ...state, players }
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
    const latest = await client.from('sessions').select('id').eq('host_id', signIn.data.user!.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (latest.error) throw latest.error
    sessionId = String(latest.data?.id)
  }

  const [settingsRes, playersRes, preferenceRes, namesRes, liveRes] = await Promise.all([
    client.from('session_next_round_settings').select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds').eq('session_id', sessionId).maybeSingle(),
    client.from('session_player_state').select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)').eq('session_id', sessionId).order('checked_in_at', { ascending: true }),
    client.from('session_players').select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)').eq('session_id', sessionId),
    client.from('session_player_state').select('player_id, players(name, pvna)').eq('session_id', sessionId),
    client.from('session_live_matches').select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at').eq('session_id', sessionId).neq('status', 'cancelled').order('sequence_no', { ascending: true }),
  ])
  for (const res of [settingsRes, playersRes, preferenceRes, namesRes, liveRes]) {
    if (res.error) throw res.error
  }

  const settings = settingsRes.data as any
  const courts = Math.max(1, Number(settings?.court_count_override ?? 6))
  const pvnaTolerance = Number(settings?.pvna_tolerance ?? 0.5)
  const names = new Map<string, PlayerName>((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
    name: row.players?.name ?? String(row.player_id).slice(0, 8),
    pvna: Number(row.players?.pvna ?? 3),
  }]))
  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  const teamLabel = (team: [string, string]) => `${label(team[0])}+${label(team[1])}`
  const gapFor = (match: { team_a: [string, string]; team_b: [string, string] }) => Math.abs(
    match.team_a.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0) -
    match.team_b.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0),
  )

  let state = mapRowsToSessionState({
    sessionId,
    playerRows: ((playersRes.data ?? []) as SessionPlayerStateRow[]).map(row => ({
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
    preferenceRows: (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[],
    courts,
    pvnaTolerance,
  })

  const liveRows = ((liveRes.data ?? []) as SessionLiveMatchRow[]).slice(0, roundsLimit * courts)
  const rows: any[] = []
  for (let i = 0; i < liveRows.length; i += 1) {
    const actual = liveRows[i]
    const roundNo = actual.round_no ?? Math.floor(i / courts)
    const roundStart = Math.floor(i / courts) * courts
    const busy = new Set<string>()
    for (const previous of liveRows.slice(roundStart, i)) {
      previous.team_a.forEach(id => busy.add(id))
      previous.team_b.forEach(id => busy.add(id))
    }
    const adjustment = correctForFairness(state)
    const adjustedState = applyFairnessAdjustment(state, adjustment)
    const result = suggestNextMatch(adjustedState, {
      court_idx: actual.court_idx ?? (i % courts),
      busy_player_ids: busy,
      tier_overrides: adjustment.tier_overrides,
      max_alternatives: 12,
    })
    const actualKey = matchKey(actual)
    const rankIndex = result.alternatives.findIndex(alt => alt.matches[0] && matchKey(alt.matches[0]) === actualKey)
    const top = result.alternatives[0]?.matches[0] ?? null
    const actualGap = gapFor(actual)
    rows.push({
      seq: i + 1,
      round: roundNo + 1,
      court: (actual.court_idx ?? 0) + 1,
      actual: `${teamLabel(actual.team_a)} vs ${teamLabel(actual.team_b)}`,
      actualGap: format(actualGap),
      over05: actualGap > 0.5,
      currentEngineRank: rankIndex < 0 ? null : rankIndex + 1,
      top: top ? `${teamLabel(top.team_a)} vs ${teamLabel(top.team_b)}` : null,
      topGap: top ? format(gapFor(top)) : null,
      adjustedTolerance: adjustedState.config.pvna_tolerance,
      adjustment: adjustment.applied_for_warnings,
    })
    state = projectActual(state, actual, roundNo)
  }

  const over = rows.filter(row => row.over05)
  console.log(JSON.stringify({
    sessionId,
    settings,
    checked: rows.length,
    over05: over.length,
    over05Rows: over,
    notCurrentTop: rows.filter(row => row.currentEngineRank !== 1).length,
    firstNotTop: rows.filter(row => row.currentEngineRank !== 1).slice(0, 12),
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
