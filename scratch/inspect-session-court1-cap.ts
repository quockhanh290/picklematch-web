import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads, getTradeoffChoiceMetrics } from '../lib/next-round-suggester/live-preview'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow, SuggestionAlternative } from '../lib/next-round-suggester/types'

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

loadLocalEnv()

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/inspect-session-court1-cap.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

function teamPvna(team: [string, string], state: ReturnType<typeof mapRowsToSessionState>) {
  return team.reduce((sum, id) => sum + (state.players.get(id)?.pvna ?? 0), 0)
}

function alternativeFromPayload(payload: any): SuggestionAlternative {
  return {
    matches: [{
      court_idx: payload.court_idx,
      team_a: payload.team_a,
      team_b: payload.team_b,
      stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 },
    }],
    resting: payload.resting ?? [],
    score: 0,
    warnings: payload.warnings ?? [],
    tradeoffs: payload.tradeoffs ?? [],
    approval_required: payload.approval_required,
    stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 },
  }
}

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (authError) throw authError

  const snapshotRes = await client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
  if (snapshotRes.error) throw snapshotRes.error
  const raw = snapshotRes.data as {
    live_state_version: number | string | null
    player_rows?: SessionPlayerStateRow[]
    pair_rows?: SessionPairHistoryRow[]
    round_rows?: any[]
    live_match_rows?: SessionLiveMatchRow[]
  }

  const playersRes = await client
    .from('session_players')
    .select('player_id, players(name, pvna, current_elo, elo)')
    .eq('session_id', sessionId)
  if (playersRes.error) throw playersRes.error

  const names = new Map<string, string>()
  const playerPvna = new Map<string, number>()
  for (const row of playersRes.data ?? []) {
    const player = (row as any).players
    names.set(String(row.player_id), String(player?.name ?? row.player_id))
    playerPvna.set(String(row.player_id), Number(player?.pvna ?? player?.current_elo ?? player?.elo ?? 3))
  }

  const playerRows = ((raw.player_rows ?? []) as SessionPlayerStateRow[]).map(row => ({
    ...row,
    players: {
      ...row.players,
      pvna: playerPvna.get(row.player_id) ?? row.players?.pvna ?? 3,
    },
  }))
  const liveMatchRows = ((raw.live_match_rows ?? []) as SessionLiveMatchRow[])
    .map(row => ({
      ...row,
      resting: row.resting ?? [],
      score_a: row.score_a ?? 0,
      score_b: row.score_b ?? 0,
    }))
  const courtCount = Math.max(1, ...liveMatchRows.map(row => (Number(row.court_idx ?? 0) + 1)), 6)
  const liveStateVersion = raw.live_state_version == null ? null : Number(raw.live_state_version)
  const state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: (raw.pair_rows ?? []) as SessionPairHistoryRow[],
    roundRows: raw.round_rows ?? [],
    courts: courtCount,
    pvnaTolerance: 0.5,
  })
  const adjustment = correctForFairness(state)
  const busyIds = new Set(
    liveMatchRows
      .filter(match => match.status === 'live' || match.status === 'suggested')
      .flatMap(match => [...match.team_a, ...match.team_b]),
  )
  const direct = suggestNextMatch(state, {
    tier_overrides: adjustment.tier_overrides,
    busy_player_ids: busyIds,
    court_idx: 0,
    max_alternatives: 12,
  })
  const payloads = buildSuggestedMatchPayloads({
    count: Math.max(0, courtCount - liveMatchRows.filter(match => match.status === 'live').length),
    sessionId,
    courtCount,
    state,
    rows: { liveMatchRows, liveStateVersion },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: adjustment,
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map([...names.entries()].map(([id, name]) => [id, { name }])),
    pvnaTolerance: 0.5,
  })

  const payload = payloads.find(row => Number(row.court_idx ?? -1) === 0) ?? payloads[0]
  if (!payload) {
    console.log(JSON.stringify({ liveStateVersion, courtCount, payloads: [] }, null, 2))
    return
  }

  const teamA = payload.team_a as [string, string]
  const teamB = payload.team_b as [string, string]
  const selectedIds = new Set([...teamA, ...teamB])
  const metrics = getTradeoffChoiceMetrics(alternativeFromPayload(payload), state, 0.5)

  console.log(JSON.stringify({
    liveStateVersion,
    courtCount,
    liveRows: liveMatchRows.map(row => ({
      court: Number(row.court_idx ?? 0) + 1,
      status: row.status,
      teamA: row.team_a.map(id => names.get(id) ?? id),
      teamB: row.team_b.map(id => names.get(id) ?? id),
    })),
    selected: {
      court: Number(payload.court_idx ?? 0) + 1,
      teamA: teamA.map(id => ({ name: names.get(id), pvna: state.players.get(id)?.pvna })),
      teamB: teamB.map(id => ({ name: names.get(id), pvna: state.players.get(id)?.pvna })),
      teamASum: teamPvna(teamA, state),
      teamBSum: teamPvna(teamB, state),
      pvnaGap: Math.abs(teamPvna(teamA, state) - teamPvna(teamB, state)),
      metrics,
      warnings: payload.warnings,
      tradeoffs: payload.tradeoffs,
      choices: payload.tradeoff_choices?.map(choice => ({
        id: choice.id,
        pvnaGap: choice.metrics.pvna_gap,
        intraGap: choice.metrics.intra_team_gap,
        intraOver: choice.metrics.intra_team_over_by,
        repeatOver: choice.metrics.repeat_over_by,
      })),
    },
    selectedPlayersState: [...selectedIds].map(id => {
      const player = state.players.get(id)
      return {
        name: names.get(id),
        pvna: player?.pvna,
        matchesPlayed: player?.matches_played,
        consecutiveRest: player?.consecutive_rest,
        consecutivePlay: player?.consecutive_play,
        checkedOut: Boolean(player?.checked_out_at),
      }
    }),
    directTopAlternatives: direct.alternatives.slice(0, 12).map((alternative, index) => {
      const match = alternative.matches[0]
      if (!match) return null
      return {
        rank: index + 1,
        match: `${names.get(match.team_a[0])}+${names.get(match.team_a[1])} vs ${names.get(match.team_b[0])}+${names.get(match.team_b[1])}`,
        teamASum: teamPvna(match.team_a, state),
        teamBSum: teamPvna(match.team_b, state),
        pvnaGap: Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)),
        intraGap: Math.max(
          Math.abs((state.players.get(match.team_a[0])?.pvna ?? 0) - (state.players.get(match.team_a[1])?.pvna ?? 0)),
          Math.abs((state.players.get(match.team_b[0])?.pvna ?? 0) - (state.players.get(match.team_b[1])?.pvna ?? 0)),
        ),
        score: alternative.score,
        warnings: alternative.warnings,
        tradeoffs: alternative.tradeoffs,
      }
    }).filter(Boolean),
    waitingPlayers: [...state.players.values()]
      .filter(player => player.checked_out_at === null)
      .filter(player => !liveMatchRows.some(match => match.status === 'live' && [...match.team_a, ...match.team_b].includes(player.player_id)))
      .map(player => ({
        name: names.get(player.player_id),
        pvna: player.pvna,
        matchesPlayed: player.matches_played,
        consecutiveRest: player.consecutive_rest,
        consecutivePlay: player.consecutive_play,
      }))
      .sort((a, b) => (a.matchesPlayed ?? 0) - (b.matchesPlayed ?? 0) || (b.consecutiveRest ?? 0) - (a.consecutiveRest ?? 0)),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
