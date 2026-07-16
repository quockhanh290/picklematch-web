import 'dotenv/config'
import { performance } from 'node:perf_hooks'

import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { correctForFairness } from '../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads } from '../../lib/next-round-suggester/live-preview'
import { compareSessionQuality } from '../../lib/next-round-suggester/planner/quality-gate'
import {
  buildSessionQualityReport,
  type SessionQualityTraceMatch,
  type SessionQualityTraceRound,
} from '../../lib/next-round-suggester/planner/quality-report'
import type {
  PlayerSessionState,
  RoundRecord,
  SessionLiveMatchRow,
  SessionState,
  Team,
} from '../../lib/next-round-suggester/types'
import { projectPlannedBoard } from './evaluate-session-quality-counterfactual'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'

if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment')

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function hydrateState(raw: any): SessionState {
  const players = new Map<string, PlayerSessionState>()
  for (const serialized of raw.players ?? []) {
    players.set(String(serialized.player_id), {
      ...serialized,
      checked_in_at: new Date(serialized.checked_in_at),
      checked_out_at: serialized.checked_out_at ? new Date(serialized.checked_out_at) : null,
      partner_counts: new Map(serialized.partner_counts ?? []),
      opponent_counts: new Map(serialized.opponent_counts ?? []),
      avoid_ids: new Set(Array.isArray(serialized.avoid_ids) ? serialized.avoid_ids : []),
    })
  }
  const rounds = (raw.rounds ?? []).map((round: any): RoundRecord => ({
    ...round,
    started_at: round.started_at ? new Date(round.started_at) : null,
    ended_at: round.ended_at ? new Date(round.ended_at) : null,
  }))
  return {
    session_id: String(raw.session_id),
    current_round: Number(raw.current_round),
    status: raw.status,
    config: raw.config,
    players,
    rounds,
  }
}

function traceMatch(match: {
  team_a: Team
  team_b: Team
  warnings?: string[]
  tradeoffs?: Array<{ severity?: number; over_by?: number }>
}): SessionQualityTraceMatch {
  return {
    team_a: [...match.team_a] as Team,
    team_b: [...match.team_b] as Team,
    warnings: match.warnings ?? [],
    tradeoffs: match.tradeoffs ?? [],
  }
}

function completedRow(
  state: SessionState,
  match: SessionQualityTraceMatch,
  roundNo: number,
  courtIdx: number,
): SessionLiveMatchRow {
  return {
    id: `phase5b-quality-${roundNo}-${courtIdx}`,
    session_id: state.session_id,
    sequence_no: roundNo * state.config.courts + courtIdx,
    round_no: roundNo,
    cycle_no: roundNo,
    court_idx: courtIdx,
    status: 'completed',
    team_a: match.team_a,
    team_b: match.team_b,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    ended_at: new Date(0).toISOString(),
  }
}

function eligibleIds(state: SessionState) {
  return [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .map(player => player.player_id)
    .sort()
}

function simulateLiveOnly(initialState: SessionState, roundCount: number, courts: number) {
  let state = initialState
  const liveRows: SessionLiveMatchRow[] = []
  const rounds: SessionQualityTraceRound[] = []
  const timings: number[] = []
  let incompleteBoards = 0
  for (let offset = 0; offset < roundCount; offset += 1) {
    const startedAt = performance.now()
    const fairnessAdjustment = correctForFairness(state)
    const fairnessWarnings = detectFairnessIssues(state)
    const payloads = buildSuggestedMatchPayloads({
      count: courts,
      sessionId: state.session_id,
      courtCount: courts,
      state,
      rows: { liveMatchRows: liveRows, liveStateVersion: liveRows.length },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment,
      fairnessWarnings,
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: state.config.pvna_tolerance,
    })
    const matches = payloads.map(traceMatch)
    if (matches.length !== courts) incompleteBoards += 1
    rounds.push({ eligible_player_ids: eligibleIds(state), matches })
    const roundNo = state.current_round
    matches.forEach((match, courtIdx) => liveRows.push(completedRow(state, match, roundNo, courtIdx)))
    state = projectPlannedBoard(state, matches, roundNo)
    timings.push(performance.now() - startedAt)
  }
  return { rounds, timings, incompleteBoards }
}

function planTrace(
  initialState: SessionState,
  rows: Array<{ round_no: number; matches: Array<{ team_a: Team; team_b: Team }> }>,
) {
  let state = initialState
  return rows.sort((left, right) => left.round_no - right.round_no).map(row => {
    const matches = row.matches.map(match => {
      const pvna = (id: string) => Number(state.players.get(id)?.effective_pvna ?? state.players.get(id)?.pvna ?? 0)
      const teamGap = Math.abs(
        pvna(match.team_a[0]) + pvna(match.team_a[1])
        - pvna(match.team_b[0]) - pvna(match.team_b[1]),
      )
      const overBy = Math.max(0, teamGap - state.config.pvna_tolerance)
      return traceMatch({
        ...match,
        warnings: overBy > 0 ? ['PVNA_TOLERANCE_RELAXED'] : [],
        tradeoffs: overBy > 0 ? [{ severity: overBy, over_by: overBy }] : [],
      })
    })
    const trace = { eligible_player_ids: eligibleIds(state), matches }
    state = projectPlannedBoard(state, matches, state.current_round)
    return trace
  })
}

function worstPlayers(players: ReturnType<typeof buildSessionQualityReport>['players']) {
  return [...players]
    .sort((left, right) => (
      right.quality_debt - left.quality_debt
      || right.max_rest_streak - left.max_rest_streak
      || right.warning_match_exposure - left.warning_match_exposure
    ))
    .slice(0, 5)
}

async function main() {
  const sessionId = argument('--session-id')
  if (!sessionId) throw new Error('Usage: --session-id=<uuid>')
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.user) throw new Error(authError?.message ?? 'Unable to sign in')

  const { data: job, error: jobError } = await client
    .from('session_plan_jobs')
    .select('id, result_plan_version_id, planned_round_count, court_count, input_payload, runtime_summary')
    .eq('session_id', sessionId)
    .eq('status', 'completed')
    .eq('planned_round_count', 8)
    .not('result_plan_version_id', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()
  if (jobError || !job) throw new Error(jobError?.message ?? 'Completed eight-round plan not found')
  const { data: planRows, error: planRowsError } = await client
    .from('session_plan_rounds')
    .select('round_no, matches')
    .eq('plan_version_id', job.result_plan_version_id)
    .order('round_no')
  if (planRowsError || !planRows) throw new Error(planRowsError?.message ?? 'Plan rounds not found')

  const initialState = hydrateState(job.input_payload.state)
  const live = simulateLiveOnly(initialState, job.planned_round_count, job.court_count)
  const hybridRounds = planTrace(initialState, planRows as any)
  const playerIds = eligibleIds(initialState)
  const pvnaByPlayer = new Map(playerIds.map(id => [
    id,
    Number(initialState.players.get(id)?.effective_pvna ?? initialState.players.get(id)?.pvna ?? 0),
  ]))
  const reportOptions = {
    player_ids: playerIds,
    pvna_by_player: pvnaByPlayer,
    pvna_tolerance: initialState.config.pvna_tolerance,
    feasible_match_count_spread: 1,
    mathematical_rest_bound: 1,
  }
  const liveReport = buildSessionQualityReport({
    ...reportOptions,
    rounds: live.rounds,
    avoidable_incomplete_boards: live.incompleteBoards,
  })
  const hybridReport = buildSessionQualityReport({
    ...reportOptions,
    rounds: hybridRounds,
    avoidable_incomplete_boards: hybridRounds.filter(round => round.matches.length !== job.court_count).length,
  })
  const gate = compareSessionQuality(liveReport.summary, hybridReport.summary)
  console.log(JSON.stringify({
    passed: gate.passed,
    decisive_metric: gate.decisive_metric,
    regressions: gate.regressions,
    improvements: gate.improvements,
    session_id: sessionId,
    source_job_id: job.id,
    source_plan_version_id: job.result_plan_version_id,
    live_only: {
      summary: liveReport.summary,
      worst_players: worstPlayers(liveReport.players),
      wall_ms: Number(live.timings.reduce((sum, value) => sum + value, 0).toFixed(1)),
      max_round_ms: Number(Math.max(...live.timings).toFixed(1)),
    },
    hybrid: {
      summary: hybridReport.summary,
      worst_players: worstPlayers(hybridReport.players),
      planner_compute_ms: Number(job.runtime_summary?.planner_compute_ms ?? 0),
    },
    deltas: gate.deltas,
  }, null, 2))
  if (!gate.passed) process.exitCode = 1
}

void main()
