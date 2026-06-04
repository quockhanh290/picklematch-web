import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { bestPartitioning } from '../lib/next-round-suggester/pair'
import {
  getProjectedRepeatSummary,
  MAX_PROJECTED_OPPONENT_PAIR_COUNT,
  MAX_PROJECTED_PARTNER_PAIR_COUNT,
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
} from '../lib/next-round-suggester/score'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type {
  Match,
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
} from '../lib/next-round-suggester/types'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (key && process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
    }
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const SESSION_ID = process.argv[2] ?? 'b287c751-55c3-45c6-8bf9-25587fde77f4'
const COURT_IDX = Number(process.argv.find(arg => arg.startsWith('--court='))?.split('=')[1] ?? '4') - 1

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  function walk(start: number, selected: T[]) {
    if (selected.length === size) {
      result.push([...selected])
      return
    }
    for (let index = start; index < items.length; index += 1) {
      selected.push(items[index])
      walk(index + 1, selected)
      selected.pop()
    }
  }
  walk(0, [])
  return result
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(':')
}

function playerLabel(names: Map<string, string>, playerId: string) {
  return names.get(playerId) ?? playerId.slice(0, 8)
}

function teamLabel(names: Map<string, string>, team: [string, string]) {
  return `${playerLabel(names, team[0])}+${playerLabel(names, team[1])}`
}

function matchLabel(names: Map<string, string>, match: Match) {
  return `${teamLabel(names, match.team_a)} vs ${teamLabel(names, match.team_b)}`
}

function pvnaSum(players: Map<string, PlayerSessionState>, team: [string, string]) {
  return team.reduce((sum, id) => sum + (players.get(id)?.pvna ?? 0), 0)
}

function intraMax(players: Map<string, PlayerSessionState>, match: Match) {
  const gap = (team: [string, string]) => Math.abs((players.get(team[0])?.pvna ?? 0) - (players.get(team[1])?.pvna ?? 0))
  return Math.max(gap(match.team_a), gap(match.team_b))
}

function pairDetails(
  statePlayers: Map<string, PlayerSessionState>,
  names: Map<string, string>,
  match: Match,
) {
  const rows: string[] = []
  const partnerPairs: Array<[string, string, 'partner']> = [
    [match.team_a[0], match.team_a[1], 'partner'],
    [match.team_b[0], match.team_b[1], 'partner'],
  ]
  for (const [a, b, type] of partnerPairs) {
    const current = statePlayers.get(a)?.partner_counts.get(b) ?? 0
    if (current > 0) rows.push(`${type} ${playerLabel(names, a)}-${playerLabel(names, b)} ${current}->${current + 1}`)
  }
  for (const a of match.team_a) {
    for (const b of match.team_b) {
      const current = statePlayers.get(a)?.opponent_counts.get(b) ?? 0
      if (current > 0) rows.push(`opp ${playerLabel(names, a)}-${playerLabel(names, b)} ${current}->${current + 1}`)
    }
  }
  return rows
}

function quality(statePlayers: Map<string, PlayerSessionState>, match: Match) {
  const repeat = getProjectedRepeatSummary(match.team_a, match.team_b, { players: statePlayers } as any)
  const pvnaGap = Math.abs(pvnaSum(statePlayers, match.team_a) - pvnaSum(statePlayers, match.team_b))
  return {
    pvnaGap,
    intraMax: intraMax(statePlayers, match),
    partnerMax: repeat.max_partner_pair_count,
    opponentMax: repeat.max_opponent_pair_count,
    repeatedPerPlayer: `${repeat.max_repeated_partners_per_player}/${repeat.max_repeated_opponents_per_player}`,
    repeatOver:
      Math.max(0, repeat.max_partner_pair_count - MAX_PROJECTED_PARTNER_PAIR_COUNT) +
      Math.max(0, repeat.max_opponent_pair_count - MAX_PROJECTED_OPPONENT_PAIR_COUNT) +
      repeat.player_over_by,
  }
}

async function main() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const auth = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (auth.error) throw auth.error

  const [snapshotRes, settingsRes, namesRes] = await Promise.all([
    client.rpc('get_live_session_snapshot_versioned', { p_session_id: SESSION_ID }),
    client.from('session_next_round_settings').select('court_count_override, pvna_tolerance').eq('session_id', SESSION_ID).maybeSingle(),
    client.from('session_player_state').select('player_id, players(name, pvna, current_elo, elo)').eq('session_id', SESSION_ID),
  ])
  if (snapshotRes.error) throw snapshotRes.error
  if (settingsRes.error) throw settingsRes.error
  if (namesRes.error) throw namesRes.error

  const raw = snapshotRes.data as {
    player_rows?: SessionPlayerStateRow[]
    pair_rows?: SessionPairHistoryRow[]
    round_rows?: any[]
    live_match_rows?: SessionLiveMatchRow[]
  }
  const names = new Map<string, string>()
  const pvnas = new Map<string, number>()
  for (const row of namesRes.data ?? []) {
    const player = (row as any).players
    names.set(String(row.player_id), String(player?.name ?? row.player_id))
    pvnas.set(String(row.player_id), Number(player?.pvna ?? player?.current_elo ?? player?.elo ?? 3))
  }

  const courts = Number(settingsRes.data?.court_count_override ?? 7)
  const pvnaTolerance = Number(settingsRes.data?.pvna_tolerance ?? 0.5)
  const state = mapRowsToSessionState({
    sessionId: SESSION_ID,
    playerRows: (raw.player_rows ?? []).map(row => ({
      ...row,
      players: { ...row.players, pvna: pvnas.get(row.player_id) ?? row.players?.pvna ?? 3 },
    })),
    pairRows: raw.pair_rows ?? [],
    roundRows: raw.round_rows ?? [],
    courts,
    pvnaTolerance,
  })

  const liveRows = (raw.live_match_rows ?? [])
    .filter(row => row.status !== 'cancelled')
    .sort((a, b) => Number(a.sequence_no ?? 0) - Number(b.sequence_no ?? 0))
  const target = [...liveRows].reverse().find(row => Number(row.court_idx) === COURT_IDX && row.status === 'suggested')
    ?? [...liveRows].reverse().find(row => Number(row.court_idx) === COURT_IDX)
  if (!target) throw new Error(`No match found for court ${COURT_IDX + 1}`)

  const targetMatch: Match = {
    court_idx: COURT_IDX,
    team_a: target.team_a,
    team_b: target.team_b,
  }
  const busyElsewhere = new Set<string>()
  for (const row of liveRows) {
    if (row.id === target.id || row.status === 'completed') continue
    row.team_a.forEach(id => busyElsewhere.add(id))
    row.team_b.forEach(id => busyElsewhere.add(id))
  }
  const poolIds = [...new Set([...target.team_a, ...target.team_b, ...(target.resting ?? [])])]
    .filter(id => !busyElsewhere.has(id) || target.team_a.includes(id) || target.team_b.includes(id))
  const pool = poolIds.map(id => state.players.get(id)).filter((player): player is PlayerSessionState => Boolean(player))

  const rows = []
  for (const selected of combinations(pool, 4)) {
    const partition = bestPartitioning(selected, state, {
      court_idx: COURT_IDX,
      allowRelaxedTolerance: true,
      allowRepeatOverflow: true,
      allowIntraTeamGapOverflow: true,
      tolerance: pvnaTolerance,
    })
    const match = partition.matches[0]
    if (!match) continue
    const q = quality(state.players, match)
    rows.push({
      match,
      q,
      score: partition.score,
      isCurrent: pairKey(match.team_a[0], match.team_a[1]) === pairKey(target.team_a[0], target.team_a[1])
        && pairKey(match.team_b[0], match.team_b[1]) === pairKey(target.team_b[0], target.team_b[1]),
    })
  }

  rows.sort((a, b) =>
    a.q.repeatOver - b.q.repeatOver ||
    Math.max(0, a.q.partnerMax - 1) - Math.max(0, b.q.partnerMax - 1) ||
    Math.max(0, a.q.opponentMax - 1) - Math.max(0, b.q.opponentMax - 1) ||
    Math.max(0, a.q.intraMax - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT) - Math.max(0, b.q.intraMax - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT) ||
    a.q.pvnaGap - b.q.pvnaGap ||
    a.score - b.score
  )

  const current = rows.find(row => row.isCurrent)
  console.log(JSON.stringify({
    sessionId: SESSION_ID,
    court: COURT_IDX + 1,
    courts,
    pvnaTolerance,
    target: {
      id: target.id,
      status: target.status,
      sequence_no: target.sequence_no,
      round_no: target.round_no,
      match: matchLabel(names, targetMatch),
      resting: (target.resting ?? []).map(id => playerLabel(names, id)),
      quality: current?.q ?? quality(state.players, targetMatch),
      details: pairDetails(state.players, names, targetMatch),
    },
    busyElsewhere: [...busyElsewhere].map(id => playerLabel(names, id)),
    pool: poolIds.map(id => ({ name: playerLabel(names, id), pvna: pvnas.get(id) })),
    optionsChecked: rows.length,
    currentRankByRepeatFirst: current ? rows.indexOf(current) + 1 : null,
    topOptions: rows.slice(0, 12).map((row, index) => ({
      rank: index + 1,
      current: row.isCurrent,
      match: matchLabel(names, row.match),
      ...Object.fromEntries(Object.entries(row.q).map(([key, value]) => [key, typeof value === 'number' ? Number(value.toFixed(2)) : value])),
      score: Number(row.score.toFixed(1)),
      details: pairDetails(state.players, names, row.match),
    })),
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
