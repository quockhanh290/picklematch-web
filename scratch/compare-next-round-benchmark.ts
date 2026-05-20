import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { rebuildStateThroughRound } from '../lib/next-round-suggester/history'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRound, type SuggestionDiagnostic } from '../lib/next-round-suggester/suggest'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'
import type { Match, SessionState, SuggestionAlternative, SuggestionResult } from '../lib/next-round-suggester/types'

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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'
const DEFAULT_SESSION_ID = '47cb2127-3193-4613-a642-2ce1b0ecabec'

function argValue(name: string, fallback: string) {
  const args = process.argv.slice(2)
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? fallback : fallback
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const avg = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)
  const p50 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.5) - 1)] ?? 0
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
  return {
    min: Math.round(sorted[0] ?? 0),
    p50: Math.round(p50),
    p95: Math.round(p95),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    avg: Math.round(avg),
  }
}

function selectedIds(alternative: SuggestionAlternative | undefined) {
  return new Set((alternative?.matches ?? []).flatMap((match) => [...match.team_a, ...match.team_b]))
}

function matchCountFairness(state: SessionState, alternative: SuggestionAlternative | undefined) {
  const ids = selectedIds(alternative)
  const presentPlayers = [...state.players.values()].filter((player) => player.checked_out_at === null)
  const projected = presentPlayers.map((player) => player.matches_played + (ids.has(player.player_id) ? 1 : 0))
  if (projected.length === 0) return { min: 0, max: 0, range: 0 }
  const min = Math.min(...projected)
  const max = Math.max(...projected)
  return { min, max, range: max - min }
}

function groupNewPairs(state: SessionState, matches: Match[]) {
  let newPairs = 0
  let repeatedPairs = 0
  for (const match of matches) {
    for (const team of [match.team_a, match.team_b]) {
      const [a, b] = team
      const playerA = state.players.get(a)
      const playerB = state.players.get(b)
      if (!playerA?.group_id || playerA.group_id !== playerB?.group_id) continue
      const count = playerA.partner_counts.get(b) ?? 0
      if (count === 0) newPairs += 1
      else repeatedPairs += 1
    }
  }
  return { newPairs, repeatedPairs }
}

function firstAltMetrics(state: SessionState, result: SuggestionResult) {
  const alt = result.alternatives[0]
  const group = groupNewPairs(state, alt?.matches ?? [])
  return {
    has3Alternatives: result.alternatives.length >= 3,
    alternatives: result.alternatives.length,
    score: alt?.score ?? null,
    matchCountRange: matchCountFairness(state, alt).range,
    partnerRepeats: alt?.stats.partner_repeats ?? null,
    opponentRepeats: alt?.stats.opponent_repeats ?? null,
    pvnaDiff: alt?.stats.pvna_diff ?? null,
    groupBonus: alt?.stats.group_bonus ?? null,
    groupNewPairs: group.newPairs,
    groupRepeatedPairs: group.repeatedPairs,
    genderPenalty: alt?.stats.gender_pref_penalty ?? null,
  }
}

function numericDelta(a: number | null, b: number | null) {
  return a === null || b === null ? null : Number((b - a).toFixed(2))
}

function buildDelta(baselineMetrics: ReturnType<typeof firstAltMetrics> | null, experimentalMetrics: ReturnType<typeof firstAltMetrics> | null) {
  return baselineMetrics && experimentalMetrics ? {
    score: numericDelta(baselineMetrics.score, experimentalMetrics.score),
    matchCountRange: experimentalMetrics.matchCountRange - baselineMetrics.matchCountRange,
    partnerRepeats: numericDelta(baselineMetrics.partnerRepeats, experimentalMetrics.partnerRepeats),
    opponentRepeats: numericDelta(baselineMetrics.opponentRepeats, experimentalMetrics.opponentRepeats),
    pvnaDiff: numericDelta(baselineMetrics.pvnaDiff, experimentalMetrics.pvnaDiff),
    groupBonus: numericDelta(baselineMetrics.groupBonus, experimentalMetrics.groupBonus),
    groupNewPairs: experimentalMetrics.groupNewPairs - baselineMetrics.groupNewPairs,
    genderPenalty: numericDelta(baselineMetrics.genderPenalty, experimentalMetrics.genderPenalty),
    alternatives: experimentalMetrics.alternatives - baselineMetrics.alternatives,
  } : null
}

function benchmarkState(
  state: SessionState,
  iterations: number,
  candidateLimit?: number,
  candidateMode: 'global' | 'per-strategy' = 'global',
  perStrategyLimit?: number,
) {
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)

  const baselineMs: number[] = []
  const experimentalMs: number[] = []
  let baseline: ReturnType<typeof suggestNextRound> | null = null
  let experimental: ReturnType<typeof suggestNextRoundExperimental> | null = null
  let baselineDiagnostic: SuggestionDiagnostic | null = null

  for (let index = 0; index < iterations; index += 1) {
    const baselineStarted = now()
    baselineDiagnostic = {
      strategies: {},
      partition_count: 0,
      max_iterations: 0,
      exhaustive: false,
    }
    baseline = suggestNextRound(adjustedState, {
      tier_overrides: adjustment.tier_overrides,
      diagnostics: baselineDiagnostic,
    })
    baselineMs.push(now() - baselineStarted)

    const experimentalStarted = now()
    experimental = suggestNextRoundExperimental(adjustedState, {
      tier_overrides: adjustment.tier_overrides,
      candidateLimit,
      mode: candidateMode,
      perStrategyLimit,
    })
    experimentalMs.push(now() - experimentalStarted)
  }

  const baselineMetrics = baseline ? firstAltMetrics(adjustedState, baseline) : null
  const experimentalMetrics = experimental ? firstAltMetrics(adjustedState, experimental) : null
  const baselineTiming = summary(baselineMs)
  const experimentalTiming = summary(experimentalMs)

  return {
    baseline: {
      timing: baselineTiming,
      metrics: baselineMetrics,
      diagnostic: baselineDiagnostic,
    },
    experimental: {
      timing: experimentalTiming,
      metrics: experimentalMetrics,
      diagnostic: experimental?.diagnostic ?? null,
    },
    delta: buildDelta(baselineMetrics, experimentalMetrics),
    speedup: baselineTiming.avg > 0 && experimentalTiming.avg > 0
      ? Number((baselineTiming.avg / experimentalTiming.avg).toFixed(2))
      : null,
  }
}

function completedRoundNos(state: SessionState) {
  return state.rounds
    .filter((round) => round.status === 'completed')
    .map((round) => round.round_no)
    .sort((a, b) => a - b)
}

function throughRoundSummary(roundReports: Array<{
  throughRound: number
  baseline: { timing: ReturnType<typeof summary>; metrics: ReturnType<typeof firstAltMetrics> | null }
  experimental: { timing: ReturnType<typeof summary>; metrics: ReturnType<typeof firstAltMetrics> | null; diagnostic: unknown }
  delta: ReturnType<typeof buildDelta>
  speedup: number | null
}>) {
  const speedups = roundReports.map((row) => row.speedup ?? 0).filter((value) => value > 0)
  const scoreDeltas = roundReports.map((row) => row.delta?.score).filter((value): value is number => value !== null && value !== undefined)
  const avg = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
  const count = (predicate: (row: typeof roundReports[number]) => boolean) => roundReports.filter(predicate).length

  return {
    checkpoints: roundReports.length,
    speedup: {
      min: Number(Math.min(...speedups).toFixed(2)),
      max: Number(Math.max(...speedups).toFixed(2)),
      avg: Number(avg(speedups).toFixed(2)),
      experimentalFaster: count((row) => (row.speedup ?? 0) > 1),
    },
    quality: {
      scoreBetter: count((row) => (row.delta?.score ?? 0) < 0),
      scoreSame: count((row) => (row.delta?.score ?? 0) === 0),
      scoreWorse: count((row) => (row.delta?.score ?? 0) > 0),
      avgScoreDelta: Number(avg(scoreDeltas).toFixed(2)),
      worstScoreDelta: Number(Math.max(...scoreDeltas).toFixed(2)),
      bestScoreDelta: Number(Math.min(...scoreDeltas).toFixed(2)),
      alternativesRegressed: count((row) => (row.delta?.alternatives ?? 0) < 0),
      matchRangeWorse: count((row) => (row.delta?.matchCountRange ?? 0) > 0),
      partnerRepeatsWorse: count((row) => (row.delta?.partnerRepeats ?? 0) > 0),
      opponentRepeatsWorse: count((row) => (row.delta?.opponentRepeats ?? 0) > 0),
      pvnaWorse: count((row) => (row.delta?.pvnaDiff ?? 0) > 0),
      genderPenaltyWorse: count((row) => (row.delta?.genderPenalty ?? 0) > 0),
    },
    checkpointsWithScoreRegression: roundReports
      .filter((row) => (row.delta?.score ?? 0) > 0)
      .map((row) => ({
        throughRound: row.throughRound,
        speedup: row.speedup,
        delta: row.delta,
      })),
    compactRows: roundReports.map((row) => ({
      throughRound: row.throughRound,
      baselineMs: row.baseline.timing.avg,
      experimentalMs: row.experimental.timing.avg,
      speedup: row.speedup,
      scoreDelta: row.delta?.score,
      matchRangeDelta: row.delta?.matchCountRange,
      partnerRepeatDelta: row.delta?.partnerRepeats,
      opponentRepeatDelta: row.delta?.opponentRepeats,
      pvnaDelta: row.delta?.pvnaDiff,
      genderPenaltyDelta: row.delta?.genderPenalty,
      altDelta: row.delta?.alternatives,
    })),
  }
}

async function getHostUserId(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user?.id) throw new Error(error?.message ?? 'Missing host user')
  return data.user.id
}

async function candidateSessionIds(supabase: ReturnType<typeof createClient>, hostUserId: string, limit: number) {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, created_at')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) throw error

  const ids: string[] = []
  for (const session of data ?? []) {
    const sessionId = String((session as any).id)
    const { count, error: countError } = await supabase
      .from('session_player_state')
      .select('player_id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .is('checked_out_at', null)
    if (countError) throw countError
    if ((count ?? 0) >= 4) ids.push(sessionId)
    if (ids.length >= limit) break
  }
  return ids
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

  const sessionId = argValue('--session-id', DEFAULT_SESSION_ID)
  const iterations = Math.max(1, Number(argValue('--iterations', '10')))
  const sessionLimit = Math.max(1, Number(argValue('--sessions', '1')))
  const courts = Math.max(1, Number(argValue('--courts', '6')))
  const candidateLimit = Math.max(1, Number(argValue('--candidate-limit', '18')))
  const candidateMode = argValue('--candidate-mode', 'global') as 'global' | 'per-strategy'
  const perStrategyLimit = Math.max(1, Number(argValue('--per-strategy-limit', '6')))
  if (!['global', 'per-strategy'].includes(candidateMode)) {
    throw new Error('--candidate-mode must be global or per-strategy')
  }
  const throughRounds = process.argv.includes('--through-rounds')
  const summaryOnly = process.argv.includes('--summary-only')
  const onlyRounds = new Set(
    argValue('--only-rounds', '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number),
  )

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await supabase.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  })
  if (error) throw error

  const sessions = process.argv.includes('--multi-session')
    ? await candidateSessionIds(supabase, await getHostUserId(supabase), sessionLimit)
    : [sessionId]

  const reports = []
  for (const currentSessionId of sessions) {
    const loadStarted = now()
    const state = await loadSessionState(supabase as any, currentSessionId, { courts, pvnaTolerance: 0.5 })
    const loadMs = now() - loadStarted

    if (throughRounds) {
      const roundNos = completedRoundNos(state).filter((roundNo) => onlyRounds.size === 0 || onlyRounds.has(roundNo))
      const roundReports = roundNos.map((roundNo) => {
        const checkpointState = rebuildStateThroughRound(state, roundNo)
        return {
          throughRound: roundNo,
          rounds: checkpointState.rounds.length,
          ...benchmarkState(checkpointState, iterations, candidateLimit, candidateMode, perStrategyLimit),
        }
      })

      reports.push({
        sessionId: currentSessionId,
        mode: 'through-rounds',
        loadedRounds: state.rounds.length,
        players: state.players.size,
        courts,
        loadMs: Math.round(loadMs),
        iterations,
        candidateLimit,
        candidateMode,
        perStrategyLimit,
        summary: throughRoundSummary(roundReports),
        rounds: summaryOnly ? undefined : roundReports,
      })
      continue
    }

    const report = benchmarkState(state, iterations, candidateLimit, candidateMode, perStrategyLimit)

    reports.push({
      sessionId: currentSessionId,
      rounds: state.rounds.length,
      players: state.players.size,
      courts,
      loadMs: Math.round(loadMs),
      iterations,
      candidateLimit,
      candidateMode,
      perStrategyLimit,
      ...report,
    })
  }

  console.log(JSON.stringify({ reports }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
