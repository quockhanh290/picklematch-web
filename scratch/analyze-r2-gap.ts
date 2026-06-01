import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { SessionPairHistoryRow, SessionPlayerStateRow, SessionRoundRow } from '../lib/next-round-suggester/types'

async function main() {
const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/analyze-r2-gap.ts <session-id>')

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

const signIn = await client.auth.signInWithPassword({
  email: process.env.HOST_EMAIL ?? 'host@test.com',
  password: process.env.HOST_PASSWORD ?? '123456',
})
if (signIn.error) throw signIn.error

const [playersRes, preferencesRes, roundRes, namesRes] = await Promise.all([
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
    .from('session_rounds')
    .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
    .eq('session_id', sessionId)
    .in('round_no', [0, 1])
    .order('round_no', { ascending: true }),
  client
    .from('session_player_state')
    .select('player_id, players(name, pvna)')
    .eq('session_id', sessionId),
])
if (playersRes.error) throw playersRes.error
if (preferencesRes.error) throw preferencesRes.error
if (roundRes.error) throw roundRes.error
if (namesRes.error) throw namesRes.error

const names = new Map((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
  name: row.players?.name ?? String(row.player_id).slice(0, 8),
  pvna: Number(row.players?.pvna ?? 3),
}]))
const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
const sumPvna = (ids: string[]) => ids.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0)

const rounds = (roundRes.data ?? []) as SessionRoundRow[]
const r1 = rounds.find(row => row.round_no === 0)
const r2 = rounds.find(row => row.round_no === 1)
if (!r1 || !r2) throw new Error('Need R1/R2 rounds')

const pairRowsByKey = new Map<string, SessionPairHistoryRow>()
const inc = (a: string, b: string, kind: 'partner_count' | 'opponent_count') => {
  const [x, y] = a < b ? [a, b] : [b, a]
  const key = `${x}:${y}`
  const row = pairRowsByKey.get(key) ?? {
    session_id: sessionId,
    player_a: x,
    player_b: y,
    partner_count: 0,
    opponent_count: 0,
  }
  row[kind] += 1
  pairRowsByKey.set(key, row)
}
for (const match of r1.matches) {
  inc(match.team_a[0], match.team_a[1], 'partner_count')
  inc(match.team_b[0], match.team_b[1], 'partner_count')
  for (const a of match.team_a) for (const b of match.team_b) inc(a, b, 'opponent_count')
}

const r1Played = new Set(r1.matches.flatMap(match => [...match.team_a, ...match.team_b]))
const r1Resting = new Set(r1.resting)
const playerRowsBeforeR2 = ((playersRes.data ?? []) as SessionPlayerStateRow[]).map(row => {
  const played = r1Played.has(row.player_id)
  const rested = r1Resting.has(row.player_id)
  return {
    ...row,
    matches_played: played ? 1 : 0,
    last_played_round: played ? 0 : -1,
    consecutive_play: played ? 1 : 0,
    consecutive_rest: rested ? 1 : 0,
    opted_rest: false,
    checked_out_at: null,
  }
})
const state = mapRowsToSessionState({
  sessionId,
  playerRows: playerRowsBeforeR2,
  pairRows: [...pairRowsByKey.values()],
  roundRows: [r1],
  preferenceRows: preferencesRes.data ?? [],
  courts: 6,
  pvnaTolerance: 0.5,
})

for (const config of [
  { candidateLimit: 28, perStrategyLimit: 6 },
  { candidateLimit: 60, perStrategyLimit: 15 },
  { candidateLimit: 120, perStrategyLimit: 30 },
]) {
  const suggestion = suggestNextRoundExperimental(state, {
    mode: 'cached-production',
    candidateLimit: config.candidateLimit,
    perStrategyLimit: config.perStrategyLimit,
  })
  const alt = suggestion.alternatives[0]
  const gaps = alt?.matches.map(match => match.stats?.pvna_diff ?? 0) ?? []
  console.log(JSON.stringify({
    config,
    alternatives: suggestion.alternatives.length,
    diagnostics: suggestion.diagnostic,
    warnings: alt?.warnings ?? [],
    totalPvnaDiff: alt?.stats.pvna_diff,
    maxGap: Math.max(...gaps),
    over05: gaps.filter(gap => gap > 0.5).length,
    matches: alt?.matches.map(match => ({
      court: match.court_idx + 1,
      match: `${label(match.team_a[0])}+${label(match.team_a[1])} vs ${label(match.team_b[0])}+${label(match.team_b[1])}`,
      sum: `${sumPvna(match.team_a).toFixed(2)}-${sumPvna(match.team_b).toFixed(2)}`,
      gap: Number((match.stats?.pvna_diff ?? 0).toFixed(2)),
    })),
  }, null, 2))
}
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
