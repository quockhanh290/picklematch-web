import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { computeRestFairness } from '../lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow, SessionRoundRow } from '../lib/next-round-suggester/types'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

function sortLiveMatchesBySequence(matches: SessionLiveMatchRow[]): SessionLiveMatchRow[] {
  return [...matches].sort((a, b) => {
    if (a.sequence_no !== b.sequence_no) return a.sequence_no - b.sequence_no
    return (a.court_idx ?? 0) - (b.court_idx ?? 0)
  })
}

function buildCompletedRoundResting(
  matches: SessionLiveMatchRow[],
  playedIds: Set<string>,
  fallbackPresentIds: string[],
  fallbackOptedRestPlayerIds: Set<string>,
): string[] {
  const finalRoundSnapshot = sortLiveMatchesBySequence(matches).at(-1)?.resting ?? []
  const source = finalRoundSnapshot.length > 0
    ? finalRoundSnapshot
    : fallbackPresentIds.filter(id => !fallbackOptedRestPlayerIds.has(id))

  return [...new Set(source)].filter(id => !playedIds.has(id))
}

loadLocalEnv()

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/inspect-ui-rest-violations.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (authError) throw authError

  const snapshotRes = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
  if (snapshotRes.error) throw snapshotRes.error
  const raw = snapshotRes.data as {
    player_rows?: SessionPlayerStateRow[]
    pair_rows?: SessionPairHistoryRow[]
    round_rows?: SessionRoundRow[]
    live_match_rows?: SessionLiveMatchRow[]
  }

  const playersRes = await client
    .from('session_players')
    .select('player_id, players(name, pvna, current_elo, elo)')
    .eq('session_id', sessionId)
  if (playersRes.error) throw playersRes.error

  const names = new Map<string, string>()
  const pvnas = new Map<string, number>()
  for (const row of playersRes.data ?? []) {
    const player = (row as any).players
    names.set(String(row.player_id), String(player?.name ?? row.player_id))
    pvnas.set(String(row.player_id), Number(player?.pvna ?? player?.current_elo ?? player?.elo ?? 3))
  }

  const playerRows = ((raw.player_rows ?? []) as SessionPlayerStateRow[]).map(row => ({
    ...row,
    players: { ...row.players, pvna: pvnas.get(row.player_id) ?? row.players?.pvna ?? 3 },
  }))
  const liveMatchRows = ((raw.live_match_rows ?? []) as SessionLiveMatchRow[])
  const courtCount = Math.max(1, ...liveMatchRows.map(row => Number(row.court_idx ?? 0) + 1), 6)
  const legacyRows = (raw.round_rows ?? []) as SessionRoundRow[]
  const baseRoundNo = legacyRows.reduce((max, row) => Math.max(max, row.round_no), -1) + 1
  const completedLive = liveMatchRows.filter(row => row.status === 'completed')
  const byRound = new Map<number, SessionLiveMatchRow[]>()

  for (const match of completedLive.filter(row => row.round_no != null)) {
    const key = match.round_no!
    if (!byRound.has(key)) byRound.set(key, [])
    byRound.get(key)!.push(match)
  }

  const presentPlayerIds = playerRows.filter(row => !row.checked_out_at).map(row => row.player_id)
  const optedRestPlayerIds = new Set(playerRows.filter(row => !row.checked_out_at && row.opted_rest).map(row => row.player_id))
  const liveRoundRows = [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, matches]) => matches.length >= courtCount)
    .map(([dbRoundNo, unsortedMatches], index) => {
      const matches = sortLiveMatchesBySequence(unsortedMatches)
      const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
      const roundStartedAt = matches.map(match => match.started_at).filter(Boolean).sort()[0]
      const roundEndedAt = matches.map(match => match.ended_at).filter(Boolean).sort().reverse()[0]
      let roundPresentIds = presentPlayerIds
      if (roundStartedAt) {
        const roundStartMs = new Date(roundStartedAt).getTime()
        const roundEndMs = roundEndedAt ? new Date(roundEndedAt).getTime() : Infinity
        roundPresentIds = playerRows
          .filter(row => {
            const checkedIn = new Date(row.checked_in_at).getTime()
            const checkedOut = row.checked_out_at ? new Date(row.checked_out_at).getTime() : Infinity
            return checkedIn <= roundEndMs && checkedOut >= roundStartMs
          })
          .map(row => row.player_id)
      }
      return {
        dbRoundNo,
        row: {
          id: matches[0].id,
          session_id: sessionId,
          round_no: baseRoundNo + index,
          status: 'completed' as const,
          matches: matches.map(match => ({
            court_idx: match.court_idx ?? 0,
            team_a: match.team_a,
            team_b: match.team_b,
          })),
          resting: buildCompletedRoundResting(matches, playedIds, roundPresentIds, optedRestPlayerIds),
          started_at: roundStartedAt ?? null,
          ended_at: roundEndedAt ?? null,
        },
        sequenceNos: matches.map(match => match.sequence_no),
        matchCount: matches.length,
      }
    })

  const roundRows = [...legacyRows, ...liveRoundRows.map(item => item.row)]
  const state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: (raw.pair_rows ?? []) as SessionPairHistoryRow[],
    roundRows,
    courts: courtCount,
    pvnaTolerance: 0.5,
  })
  const rest = computeRestFairness(state)

  console.log(JSON.stringify({
    groupedRounds: liveRoundRows.map(item => ({
      dbRoundNo: item.dbRoundNo,
      uiRoundNo: item.row.round_no + 1,
      matchCount: item.matchCount,
      sequenceNos: item.sequenceNos,
      resting: item.row.resting.map(id => names.get(id)),
    })),
    violations: rest.violations.map(violation => ({
      name: names.get(violation.player_id),
      maxRest: violation.max_rest,
      restingUiRounds: roundRows
        .filter(round => round.resting.includes(violation.player_id))
        .map(round => round.round_no + 1),
    })),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
