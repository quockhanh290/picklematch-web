import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { computeAvailabilityMetrics, computeMatchCountMetrics, computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { Match, PlayerSessionState, RoundRecord, SessionLiveMatchRow, SessionPlayerStateRow, SessionRoundRow } from '../lib/next-round-suggester/types'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const TARGET_DISPLAY_ROUND = Number(process.argv[2] ?? process.env.TARGET_DISPLAY_ROUND ?? 5)

function clonePlayers(players: Map<string, PlayerSessionState>) {
  return new Map([...players].map(([id, player]) => [id, {
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }]))
}

function incrementPair(players: Map<string, PlayerSessionState>, a: string, b: string, field: 'partner_counts' | 'opponent_counts') {
  const pa = players.get(a)
  const pb = players.get(b)
  if (!pa || !pb) return
  pa[field].set(b, (pa[field].get(b) ?? 0) + 1)
  pb[field].set(a, (pb[field].get(a) ?? 0) + 1)
}

function applyRound(players: Map<string, PlayerSessionState>, round: RoundRecord) {
  const ids = new Set([...round.matches.flatMap(match => [...match.team_a, ...match.team_b]), ...round.resting])
  for (const id of ids) {
    if (players.has(id)) continue
  }
  const played = new Set(round.matches.flatMap(match => [...match.team_a, ...match.team_b]))
  for (const id of played) {
    const player = players.get(id)
    if (!player) continue
    player.matches_played += 1
    player.last_played_round = round.round_no
    player.consecutive_play += 1
    player.consecutive_rest = 0
  }
  for (const id of round.resting) {
    const player = players.get(id)
    if (!player || played.has(id)) continue
    player.consecutive_rest += 1
    player.consecutive_play = 0
  }
  for (const match of round.matches) {
    incrementPair(players, match.team_a[0], match.team_a[1], 'partner_counts')
    incrementPair(players, match.team_b[0], match.team_b[1], 'partner_counts')
    for (const a of match.team_a) {
      for (const b of match.team_b) incrementPair(players, a, b, 'opponent_counts')
    }
  }
}

function synthesizeLiveRoundRows(
  sessionId: string,
  playerRows: SessionPlayerStateRow[],
  legacyRows: SessionRoundRow[],
  liveMatchRows: SessionLiveMatchRow[],
  courts: number,
): SessionRoundRow[] {
  const baseRoundNo = legacyRows.reduce((max, row) => Math.max(max, row.round_no), -1) + 1
  const completedLive = liveMatchRows.filter(match => match.status === 'completed')
  const byRound = new Map<number, SessionLiveMatchRow[]>()
  for (const match of completedLive.filter(match => match.round_no != null)) {
    const key = match.round_no!
    byRound.set(key, [...(byRound.get(key) ?? []), match])
  }
  let nextFallbackRoundKey = Math.max(-1, ...byRound.keys()) + 1
  for (const match of completedLive.filter(match => match.round_no == null).sort((a, b) => a.sequence_no - b.sequence_no)) {
    const courtIdx = match.court_idx ?? match.sequence_no
    const existing = [...byRound.entries()]
      .filter(([key]) => key >= nextFallbackRoundKey)
      .find(([, matches]) => !matches.some(row => (row.court_idx ?? row.sequence_no) === courtIdx))
    const key = existing ? existing[0] : nextFallbackRoundKey++
    byRound.set(key, [...(byRound.get(key) ?? []), match])
  }
  const presentPlayerIds = playerRows.filter(row => !row.checked_out_at).map(row => row.player_id)
  const liveRoundRows = [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, matches], index): SessionRoundRow => {
      const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
      const startedAt = matches.map(match => match.started_at).filter(Boolean).sort()[0] ?? null
      const endedAt = matches.map(match => match.ended_at).filter(Boolean).sort().reverse()[0] ?? null
      let roundPresentIds = presentPlayerIds
      if (startedAt) {
        const startMs = new Date(startedAt).getTime()
        const endMs = endedAt ? new Date(endedAt).getTime() : Infinity
        roundPresentIds = playerRows
          .filter(row => {
            const checkedIn = new Date(row.checked_in_at).getTime()
            const checkedOut = row.checked_out_at ? new Date(row.checked_out_at).getTime() : Infinity
            return checkedIn <= endMs && checkedOut >= startMs
          })
          .map(row => row.player_id)
      }
      return {
        id: matches[0].id,
        session_id: sessionId,
        round_no: baseRoundNo + index,
        status: 'completed',
        matches: matches.map(match => ({
          court_idx: match.court_idx ?? 0,
          team_a: match.team_a,
          team_b: match.team_b,
        })) as Match[],
        resting: matches.length >= courts ? roundPresentIds.filter(id => !playedIds.has(id)) : [],
        started_at: startedAt,
        ended_at: endedAt,
      }
    })
  return [...legacyRows, ...liveRoundRows]
}

function nameFor(id: string, names: Map<string, string>) {
  return names.get(id) ?? id.slice(0, 8)
}

function matchLabel(match: Match, names: Map<string, string>) {
  return `${match.team_a.map(id => nameFor(id, names)).join('+')} vs ${match.team_b.map(id => nameFor(id, names)).join('+')}`
}

async function main() {
  if (!ANON_KEY) throw new Error('Missing Supabase anon key')
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (signIn.error) throw signIn.error
  const hostId = signIn.data.user?.id
  if (!hostId) throw new Error('No host user id')

  const sessionRes = await client
    .from('sessions')
    .select('id, status, created_at, host_id, owner_sessions(sub_court_numbers)')
    .eq('host_id', hostId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (sessionRes.error) throw sessionRes.error
  const session = sessionRes.data as any
  const owner = Array.isArray(session.owner_sessions) ? session.owner_sessions[0] : session.owner_sessions
  const courts = Math.max(1, (owner?.sub_court_numbers ?? []).length || 1)

  const [playerRes, pairRes, roundRes, liveRes, prefRes] = await Promise.all([
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', session.id)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_pair_history')
      .select('session_id, player_a, player_b, partner_count, opponent_count')
      .eq('session_id', session.id),
    client
      .from('session_rounds')
      .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
      .eq('session_id', session.id)
      .order('round_no', { ascending: true }),
    client
      .from('session_live_matches')
      .select('*')
      .eq('session_id', session.id)
      .order('sequence_no', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', session.id),
  ])
  for (const res of [playerRes, pairRes, roundRes, liveRes, prefRes]) {
    if (res.error) throw res.error
  }

  const playerRows = (playerRes.data ?? []) as any[] as SessionPlayerStateRow[]
  const pairRows = (pairRes.data ?? []) as any[]
  const legacyRows = (roundRes.data ?? []) as any[] as SessionRoundRow[]
  const liveRows = (liveRes.data ?? []) as any[] as SessionLiveMatchRow[]
  const names = new Map<string, string>()
  for (const row of (playerRes.data ?? []) as any[]) names.set(String(row.player_id), row.players?.name ?? String(row.player_id).slice(0, 8))

  const roundRows = synthesizeLiveRoundRows(session.id, playerRows, legacyRows, liveRows, courts)
  const fullState = mapRowsToSessionState({
    sessionId: session.id,
    playerRows,
    pairRows,
    roundRows,
    preferenceRows: (prefRes.data ?? []) as any[],
    courts,
  })

  const sortedRounds = [...fullState.rounds]
    .filter(round => round.status === 'completed' || round.status === 'active')
    .sort((a, b) => a.round_no - b.round_no)
  const snapshotPlayers = new Map<string, PlayerSessionState>()
  const snapshotRounds: RoundRecord[] = []
  const rows: any[] = []
  for (const round of sortedRounds) {
    const roundRosterIds = new Set([...round.matches.flatMap(match => [...match.team_a, ...match.team_b]), ...round.resting])
    for (const id of roundRosterIds) {
      if (snapshotPlayers.has(id)) continue
      const source = fullState.players.get(id)
      if (!source) continue
      snapshotPlayers.set(id, {
        ...source,
        matches_played: 0,
        last_played_round: -1,
        consecutive_rest: 0,
        consecutive_play: 0,
        partner_counts: new Map(),
        opponent_counts: new Map(),
        opted_rest: false,
        checked_out_at: null,
      })
    }
    applyRound(snapshotPlayers, round)
    snapshotRounds.push(round)
    const snapshotState = { ...fullState, players: clonePlayers(snapshotPlayers), rounds: [...snapshotRounds], current_round: round.round_no + 1 }
    const score = computeSessionFairness(snapshotState)
    const matchCount = computeMatchCountMetrics(snapshotState)
    const availability = computeAvailabilityMetrics(snapshotState)
    rows.push({
      displayRound: round.round_no + 1,
      dbRound: round.round_no,
      matches: round.matches.length,
      resting: round.resting.map(id => nameFor(id, names)),
      score,
      matchCount,
      availability,
      round,
      snapshotState,
    })
  }

  const target = rows.find(row => row.displayRound === TARGET_DISPLAY_ROUND) ?? rows[TARGET_DISPLAY_ROUND - 1] ?? rows[rows.length - 1]
  const previous = rows[rows.indexOf(target) - 1]
  const perPlayer = target.matchCount.per_player
    .map((row: any) => ({
      name: nameFor(row.player_id, names),
      player_id: row.player_id,
      matches: row.matches_played,
      expected: target.availability.per_player.find((p: any) => p.player_id === row.player_id)?.expected_matches,
      delta: target.availability.per_player.find((p: any) => p.player_id === row.player_id)?.delta_from_expected,
    }))
    .sort((a: any, b: any) => a.matches - b.matches || a.name.localeCompare(b.name))

  console.log(JSON.stringify({
    session: {
      id: session.id,
      created_at: session.created_at,
      status: session.status,
      courts,
      playerRows: playerRows.length,
      legacyRounds: legacyRows.length,
      liveMatches: liveRows.length,
      synthesizedRounds: roundRows.length,
    },
    fairnessTimeline: rows.map(row => ({
      displayRound: row.displayRound,
      total: row.score.total,
      breakdown: row.score.breakdown,
      matchRange: row.matchCount.range,
      matchBucket: Object.fromEntries([...new Set(row.matchCount.per_player.map((p: any) => p.matches_played))]
        .sort((a: any, b: any) => a - b)
        .map((count: any) => [count, row.matchCount.per_player.filter((p: any) => p.matches_played === count).length])),
      availabilityExpectedDeltaRange: row.availability.expected_match_delta_range,
      churn: row.availability.churn_level,
    })),
    targetRound: {
      displayRound: target.displayRound,
      dbRound: target.dbRound,
      matches: target.round.matches.map((match: Match) => matchLabel(match, names)),
      resting: target.resting,
      total: target.score.total,
      previousTotal: previous?.score.total,
      breakdown: target.score.breakdown,
      previousBreakdown: previous?.score.breakdown,
      matchCount: {
        min: target.matchCount.min,
        max: target.matchCount.max,
        avg: target.matchCount.avg,
        range: target.matchCount.range,
      },
      availability: {
        expectedMatchDeltaRange: target.availability.expected_match_delta_range,
        penaltyMultiplier: target.availability.penalty_multiplier,
        churnLevel: target.availability.churn_level,
        totalRosterChanges: target.availability.total_roster_changes,
      },
      perPlayer,
    },
  }, null, 2))
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
