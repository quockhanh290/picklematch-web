import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { buildMatchCountConsistencyRows } from '../lib/next-round-suggester/fairness/audit'
import { rebuildStateThroughRound } from '../lib/next-round-suggester/history'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionPlayerStateRow, SessionRoundRow, SessionPairHistoryRow } from '../lib/next-round-suggester/types'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function synthesizeRoundRows(
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
  const presentPlayerIds = playerRows.filter(row => !row.checked_out_at).map(row => row.player_id)
  const optedRestPlayerIds = new Set(playerRows.filter(row => !row.checked_out_at && row.opted_rest).map(row => row.player_id))
  const liveRoundRows = [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, matches]) => matches.length >= courts)
    .map(([, matches], index): SessionRoundRow => {
      const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
      return {
        id: matches[0].id,
        session_id: sessionId,
        round_no: baseRoundNo + index,
        status: 'completed',
        matches: matches.map(match => ({
          court_idx: match.court_idx ?? 0,
          team_a: match.team_a,
          team_b: match.team_b,
        })),
        resting: presentPlayerIds.filter(id => !playedIds.has(id) && !optedRestPlayerIds.has(id)),
        started_at: matches.map(match => match.started_at).filter(Boolean).sort()[0] ?? null,
        ended_at: matches.map(match => match.ended_at).filter(Boolean).sort().reverse()[0] ?? null,
      }
    })
  return [...legacyRows, ...liveRoundRows]
}

async function main() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (signIn.error) throw signIn.error

  const latest = await client
    .from('sessions')
    .select('id, created_at')
    .eq('host_id', signIn.data.user!.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (latest.error) throw latest.error

  const sessionId = latest.data.id as string
  const [{ data: players, error: playersError }, { data: pairs, error: pairsError }, { data: rounds, error: roundsError }, { data: live, error: liveError }, { data: settings, error: settingsError }] = await Promise.all([
    client.from('session_player_state').select('*, players(pvna, elo, gender, partner_gender_pref, opponent_gender_pref)').eq('session_id', sessionId),
    client.from('session_pair_history').select('*').eq('session_id', sessionId),
    client.from('session_rounds').select('*').eq('session_id', sessionId),
    client.from('session_live_matches').select('*').eq('session_id', sessionId).order('sequence_no', { ascending: true }),
    client.from('session_next_round_settings').select('court_count_override').eq('session_id', sessionId).maybeSingle(),
  ])
  if (playersError) throw playersError
  if (pairsError) throw pairsError
  if (roundsError) throw roundsError
  if (liveError) throw liveError
  if (settingsError) throw settingsError

  const courts = Number((settings as any)?.court_count_override ?? 6)
  const roundRows = synthesizeRoundRows(sessionId, players as any, rounds as any, live as any, courts)
  const state = mapRowsToSessionState({
    sessionId,
    playerRows: players as SessionPlayerStateRow[],
    pairRows: pairs as SessionPairHistoryRow[],
    roundRows,
    courts,
    pvnaTolerance: 0.5,
  })
  const completedRounds = state.rounds.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no)
  const reportState = completedRounds.length > 0 ? rebuildStateThroughRound(state, completedRounds[0].round_no) : state
  const mismatches = buildMatchCountConsistencyRows(state, reportState)
  const latestFullRoundNo = completedRounds[0]?.round_no ?? null
  const fullRoundMatchIds = new Set(completedRounds.flatMap(round => round.matches.flatMap(match => [match.team_a.join(','), match.team_b.join(',')])))
  const completedLiveCount = (live as SessionLiveMatchRow[]).filter(match => match.status === 'completed').length
  const representedMatchCount = completedRounds.reduce((sum, round) => sum + round.matches.length, 0)

  console.log(JSON.stringify({
    sessionId,
    courts,
    liveMatches: (live as SessionLiveMatchRow[]).length,
    completedLiveCount,
    representedMatchCount,
    latestFullRoundNo,
    fullRounds: completedRounds.length,
    mismatchCount: mismatches.length,
    sample: mismatches.slice(0, 8),
    note: completedLiveCount > representedMatchCount ? 'DB includes completed partial matches beyond report replay' : 'No completed partial overflow detected',
    fullRoundMatchIdsCount: fullRoundMatchIds.size,
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
