import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch, buildSuggestedMatchPayloads } from '../lib/next-round-suggester/live-preview'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import type { SessionLiveMatchRow } from '../lib/next-round-suggester/types'

const sessionId = process.argv[2]
const targetName = process.argv.slice(3).join(' ')
if (!sessionId || !targetName) throw new Error('Usage: npx tsx scratch/sim-counterfactual-hard-required.ts <session-id> <player-name>')
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as any } })

async function main() {
  const { error: authError } = await client.auth.signInWithPassword({ email: process.env.HOST_EMAIL ?? 'host@test.com', password: process.env.HOST_PASSWORD ?? '123456' })
  if (authError) throw authError
  const [playerResult, liveResult] = await Promise.all([
    client.from('session_player_state').select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(name, pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)').eq('session_id', sessionId),
    client.from('session_live_matches').select('id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting, score_a, score_b, suggested_at, started_at, ended_at').eq('session_id', sessionId).neq('status', 'cancelled').order('sequence_no'),
  ])
  if (playerResult.error) throw playerResult.error
  if (liveResult.error) throw liveResult.error
  const playerRows = (playerResult.data ?? []).map((row: any) => ({ ...row, checked_out_at: null, matches_played: 0, last_played_round: -1, consecutive_rest: 0, consecutive_play: 0, opted_rest: false }))
  const target = playerRows.find((row: any) => row.players?.name === targetName)
  if (!target) throw new Error(`Player not found: ${targetName}`)
  const allRows = liveResult.data as SessionLiveMatchRow[]
  const courts = Math.max(1, ...allRows.map(row => Number(row.court_idx ?? 0) + 1))
  let state = mapRowsToSessionState({ sessionId, playerRows, pairRows: [], roundRows: [], courts, pvnaTolerance: 0.5 })
  const historyRows = allRows.slice(0, courts * 4)
  for (let roundNo = 0; roundNo < 4; roundNo += 1) {
    const roundRows = historyRows.slice(roundNo * courts, (roundNo + 1) * courts)
    for (const row of roundRows) state = buildProjectedStateAfterLiveMatch(state, row, roundNo)
    state = buildProjectedStateAfterCompletedLiveRound(state, new Set(roundRows.flatMap(row => [...row.team_a, ...row.team_b])))
  }
  const roundRequiredIds = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && player.consecutive_rest >= 1)
    .sort((a, b) => b.consecutive_rest - a.consecutive_rest || a.matches_played - b.matches_played || a.player_id.localeCompare(b.player_id))
    .map(player => player.player_id)
  const payloads: ReturnType<typeof buildSuggestedMatchPayloads> = []
  const steps: Array<{
    court: number
    forcedNames: string[]
    remainingRequiredNames: string[]
    selectedNames: string[]
  }> = []
  const namesById = new Map(playerRows.map((row: any) => [row.player_id, row.players?.name ?? row.player_id]))
  const planningRows = [...historyRows]
  while (payloads.length < courts) {
    const already = new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b]))
    const remaining = roundRequiredIds.filter(id => !already.has(id))
    const futureSlots = (courts - payloads.length - 1) * 4
    const forcedRequiredPlayerIds = remaining.slice(0, Math.min(4, Math.max(0, remaining.length - futureSlots)))
    const [next] = buildSuggestedMatchPayloads({
      count: 1,
      sessionId,
      courtCount: courts,
      state,
      rows: { liveMatchRows: planningRows, liveStateVersion: planningRows.length },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map(playerRows.map((row: any) => [row.player_id, { name: row.players?.name ?? row.player_id }])),
      pvnaTolerance: 0.5,
      options: { preserveRoundRequiredThroughRescue: true, forcedRequiredPlayerIds },
    })
    if (!next) break
    steps.push({
      court: payloads.length + 1,
      forcedNames: forcedRequiredPlayerIds.map(id => namesById.get(id) ?? id),
      remainingRequiredNames: remaining.map(id => namesById.get(id) ?? id),
      selectedNames: [...next.team_a, ...next.team_b].map(id => namesById.get(id) ?? id),
    })
    payloads.push(next)
    planningRows.push({
      id: `planned-${payloads.length}`,
      session_id: sessionId,
      sequence_no: planningRows.length,
      round_no: 4,
      court_idx: Number(next.court_idx ?? payloads.length - 1),
      status: 'completed',
      team_a: next.team_a,
      team_b: next.team_b,
      resting: next.resting,
      score_a: 0,
      score_b: 0,
      suggested_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    })
  }
  console.log(JSON.stringify({
    target: {
      name: targetName,
      before: state.players.get(target.player_id),
      requiredCount: roundRequiredIds.length,
      requiredNames: roundRequiredIds.map(id => namesById.get(id) ?? id),
    },
    includesTarget: payloads.some(payload => [...payload.team_a, ...payload.team_b].includes(target.player_id)),
    targetCourt: payloads.find(payload => [...payload.team_a, ...payload.team_b].includes(target.player_id))?.court_idx ?? null,
    matchCount: payloads.length,
    steps,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
