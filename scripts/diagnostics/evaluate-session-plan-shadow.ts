import 'dotenv/config'
import { performance } from 'node:perf_hooks'

import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import {
  buildPrecomputedSessionPlan,
  summarizeSessionPlan,
  type SessionPlan,
} from '../../lib/next-round-suggester/planner/session-plan'
import type {
  PlayerSessionState,
  RoundRecord,
  SessionState,
} from '../../lib/next-round-suggester/types'

type SerializedPlayer = Omit<PlayerSessionState, 'checked_in_at' | 'checked_out_at' | 'partner_counts' | 'opponent_counts' | 'avoid_ids'> & {
  checked_in_at: string
  checked_out_at: string | null
  partner_counts?: Array<[string, number]>
  opponent_counts?: Array<[string, number]>
  avoid_ids?: string[] | Record<string, never>
}

type PairStats = {
  repeated_partner_pairs: number
  partner_repeat_events: number
  max_partner_meetings: number
  repeated_opponent_pairs: number
  opponent_repeat_events: number
  max_opponent_meetings: number
  players_with_opponent_repeats: number
  max_opponent_repeat_burden: number
}

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
  for (const serialized of (raw.players ?? []) as SerializedPlayer[]) {
    players.set(serialized.player_id, {
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

function pairKey(left: string, right: string) {
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

function increment(counts: Map<string, number>, left: string, right: string) {
  const key = pairKey(left, right)
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function repeatedEvents(counts: ReadonlyMap<string, number>) {
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
}

function pairStats(plan: SessionPlan): PairStats {
  const partners = new Map<string, number>()
  const opponents = new Map<string, number>()
  const opponentBurden = new Map<string, number>()
  for (const round of plan.rounds) {
    for (const match of round.matches) {
      increment(partners, match.team_a[0], match.team_a[1])
      increment(partners, match.team_b[0], match.team_b[1])
      for (const left of match.team_a) {
        for (const right of match.team_b) increment(opponents, left, right)
      }
    }
  }
  for (const [key, count] of opponents) {
    const repeatCount = Math.max(0, count - 1)
    if (repeatCount === 0) continue
    const [left, right] = key.split('|')
    opponentBurden.set(left, (opponentBurden.get(left) ?? 0) + repeatCount)
    opponentBurden.set(right, (opponentBurden.get(right) ?? 0) + repeatCount)
  }
  return {
    repeated_partner_pairs: [...partners.values()].filter(count => count > 1).length,
    partner_repeat_events: repeatedEvents(partners),
    max_partner_meetings: Math.max(0, ...partners.values()),
    repeated_opponent_pairs: [...opponents.values()].filter(count => count > 1).length,
    opponent_repeat_events: repeatedEvents(opponents),
    max_opponent_meetings: Math.max(0, ...opponents.values()),
    players_with_opponent_repeats: opponentBurden.size,
    max_opponent_repeat_burden: Math.max(0, ...opponentBurden.values()),
  }
}

function compactResult(plan: SessionPlan, passes: number, wallMs: number, roundBudgetMs?: number) {
  const quality = summarizeSessionPlan(plan)
  return {
    passes,
    round_budget_ms: roundBudgetMs ?? null,
    wall_ms: Math.round(wallMs),
    active_compute_ms: Math.round(plan.timings.total_ms),
    candidates_evaluated: plan.timings.rounds.reduce((sum, round) => sum + round.candidates_evaluated, 0),
    timed_out_rounds: plan.timings.rounds.filter(round => round.timed_out).length,
    invariants: plan.invariants,
    quality: {
      avg_team_gap: Number(quality.avg_team_gap.toFixed(3)),
      max_team_gap: Number(quality.max_team_gap.toFixed(3)),
      team_gap_over_0_5: quality.team_gap_over_0_5,
      team_gap_over_1: quality.team_gap_over_1,
      avg_intra_gap: Number(quality.avg_intra_gap.toFixed(3)),
      max_intra_gap: Number(quality.max_intra_gap.toFixed(3)),
      intra_gap_over_1: quality.intra_gap_over_1,
      intra_gap_over_2: quality.intra_gap_over_2,
      partner_repeats: quality.partner_repeats,
      opponent_repeats: quality.opponent_repeats,
      player_quality_debt_max: Number(quality.player_quality_debt_max.toFixed(3)),
      player_quality_debt_p95: Number(quality.player_quality_debt_p95.toFixed(3)),
    },
    pair_distribution: pairStats(plan),
  }
}

async function main() {
  const sessionId = argument('--session-id')
  if (!sessionId) throw new Error('Usage: --session-id=<uuid> [--passes=1,2,3,5]')
  const passes = (argument('--passes') ?? '1,2,3,5')
    .split(',')
    .map(Number)
    .filter(value => Number.isInteger(value) && value > 0)
  if (passes.length === 0) throw new Error('--passes must contain positive integers')
  const rawRoundBudgetMs = argument('--round-budget-ms')
  const roundBudgetMs = rawRoundBudgetMs === undefined ? undefined : Number(rawRoundBudgetMs)
  if (roundBudgetMs !== undefined && (!Number.isFinite(roundBudgetMs) || roundBudgetMs <= 0)) {
    throw new Error('--round-budget-ms must be a positive number')
  }

  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.user) throw new Error(authError?.message ?? 'Unable to sign in')

  const { data: job, error: jobError } = await client
    .from('session_plan_jobs')
    .select('id, engine_version, planned_round_count, court_count, input_payload, created_at')
    .eq('session_id', sessionId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (jobError || !job) throw new Error(jobError?.message ?? 'Completed shadow plan not found')

  const state = hydrateState(job.input_payload.state)
  const results = passes.map(passCount => {
    const startedAt = performance.now()
    const plan = buildPrecomputedSessionPlan(state, job.planned_round_count, job.court_count, {
      localSearchPasses: passCount,
      maxRoundRuntimeMs: roundBudgetMs,
      startingRound: state.current_round,
    })
    return compactResult(plan, passCount, performance.now() - startedAt, roundBudgetMs)
  })

  console.log(JSON.stringify({
    session_id: sessionId,
    source_job_id: job.id,
    engine_version: job.engine_version,
    players: state.players.size,
    courts: job.court_count,
    rounds: job.planned_round_count,
    results,
  }, null, 2))
}

main()
