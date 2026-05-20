import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'

import { calculateOptimalCourts, type CourtPreset } from '../lib/court-calculator'
import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRound, type SuggestionDiagnostic } from '../lib/next-round-suggester/suggest'

type Args = {
  yes: boolean
  sessionId: string
  courtsOverride: number | null
  courtPreset: CourtPreset
  sessionDurationMin: number
  matchDurationMin: number
  pvnaTolerance: number
}

type SupabaseAny = any

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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const getValue = (name: string) => {
    const prefix = `${name}=`
    const inline = args.find((arg) => arg.startsWith(prefix))
    if (inline) return inline.slice(prefix.length)
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }

  const sessionId = getValue('--session-id')
  if (!sessionId) throw new Error('Missing --session-id')

  const preset = (getValue('--court-preset') ?? 'balanced') as CourtPreset
  if (!['relaxed', 'balanced', 'play_more'].includes(preset)) {
    throw new Error('--court-preset must be one of: relaxed, balanced, play_more')
  }

  const courts = getValue('--courts')
  return {
    yes: args.includes('--yes'),
    sessionId,
    courtsOverride: courts === undefined ? null : Math.max(1, Number(courts)),
    courtPreset: preset,
    sessionDurationMin: Math.max(1, Number(getValue('--session-duration-min') ?? '120')),
    matchDurationMin: Math.max(1, Number(getValue('--match-duration-min') ?? '15')),
    pvnaTolerance: Math.max(0, Number(getValue('--pvna-tolerance') ?? '0.5')),
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

async function getSessionStatus(service: SupabaseAny, sessionId: string) {
  const [playersResult, roundsResult, pairsResult] = await Promise.all([
    service.from('session_player_state').select('player_id, checked_out_at, opted_rest').eq('session_id', sessionId),
    service.from('session_rounds').select('round_no, status').eq('session_id', sessionId).order('round_no', { ascending: true }),
    service.from('session_pair_history').select('player_a').eq('session_id', sessionId),
  ])
  if (playersResult.error) throw playersResult.error
  if (roundsResult.error) throw roundsResult.error
  if (pairsResult.error) throw pairsResult.error

  const players = playersResult.data ?? []
  const rounds = roundsResult.data ?? []
  const active = rounds.find((row: any) => row.status === 'active')
  return {
    players: players.length,
    present: players.filter((row: any) => !row.checked_out_at).length,
    eligible: players.filter((row: any) => !row.checked_out_at && !row.opted_rest).length,
    rounds: rounds.length,
    activeRound: active ? Number((active as any).round_no) : null,
    pairs: pairsResult.data?.length ?? 0,
  }
}

function changedPairHistoryRows(
  beforeRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
  afterRows: Array<{ player_a: string; player_b: string; partner_count: number; opponent_count: number }>,
) {
  const beforeByKey = new Map(beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]))
  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before || before.partner_count !== row.partner_count || before.opponent_count !== row.opponent_count
  })
}

async function main() {
  const args = parseArgs()
  if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  if (!args.yes) throw new Error('This benchmark mutates live session data. Re-run with --yes to confirm.')

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const status = await getSessionStatus(service, args.sessionId)
  if (status.activeRound !== null) throw new Error(`Cannot start: round ${status.activeRound} is active`)

  const courtSetupStartedAt = now()
  const courtSetup = calculateOptimalCourts({
    n_players: status.present,
    session_duration_min: args.sessionDurationMin,
    match_duration_min: args.matchDurationMin,
    preset: args.courtPreset,
  })
  const courts = args.courtsOverride ?? courtSetup.recommended.courts
  const courtCalculatorMs = now() - courtSetupStartedAt

  const loadStartedAt = now()
  const state = await loadSessionState(service as any, args.sessionId, {
    courts,
    pvnaTolerance: args.pvnaTolerance,
  })
  const loadSessionStateMs = now() - loadStartedAt

  const fairnessStartedAt = now()
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const fairnessScoreBefore = computeSessionFairness(state).total
  const correctForFairnessMs = now() - fairnessStartedAt

  const suggestStartedAt = now()
  const diagnostics: SuggestionDiagnostic = {
    strategies: {},
    partition_count: 0,
    max_iterations: 0,
    exhaustive: false,
  }
  const suggestion = suggestNextRound(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
    diagnostics,
  })
  const suggestNextRoundMs = now() - suggestStartedAt
  const alternative = suggestion.alternatives[0]
  if (!alternative) throw new Error(`No suggestion available. warnings=${suggestion.warnings.join(',')}`)

  const startRpcStartedAt = now()
  const { data: startedRound, error: startError } = await service.rpc('start_live_session_round', {
    p_session_id: args.sessionId,
    p_round_no: state.current_round,
    p_matches: alternative.matches,
    p_resting: alternative.resting,
    p_event_source: 'host',
    p_actor_id: null,
    p_audit_payload: {
      benchmark: true,
      source: 'scratch/bench-live-round-rpc-direct.ts',
      decision_mode: 'host_selected_alternative',
      selected_alternative_index: 0,
    },
    p_adjustment_warnings: adjustment.applied_for_warnings,
    p_adjustment_config_changes: adjustment.config_changes,
    p_adjustment_tier_overrides: adjustment.tier_overrides,
    p_fairness_score_before: fairnessScoreBefore,
  })
  const startRpcMs = now() - startRpcStartedAt
  if (startError) throw startError

  const reloadStartedAt = now()
  const startedState = await loadSessionState(service as any, args.sessionId, {
    courts,
    pvnaTolerance: args.pvnaTolerance,
  })
  const reloadAfterStartMs = now() - reloadStartedAt

  const activeRound = startedState.rounds.find((round) => round.round_no === state.current_round && round.status === 'active')
  if (!activeRound) throw new Error(`Round ${state.current_round} was not active after direct start RPC`)

  const commitLocalStartedAt = now()
  const existingPairs = pairHistoryRowsFromState(startedState)
  const committed = commitCompletedRound(
    startedState,
    {
      round_no: activeRound.round_no,
      matches: activeRound.matches,
      resting: activeRound.resting,
    },
    existingPairs,
  )
  const playedIds = new Set(activeRound.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
  const playerStatePayload = [...committed.players.values()].map((player) => ({
    player_id: player.player_id,
    matches_played: player.matches_played,
    last_played_round: player.last_played_round,
    consecutive_rest: player.consecutive_rest,
    consecutive_play: player.consecutive_play,
    opted_rest: player.opted_rest,
  }))
  const pairHistoryPayload = changedPairHistoryRows(existingPairs, committed.pairHistory).map((row) => ({
    player_a: row.player_a,
    player_b: row.player_b,
    partner_count: row.partner_count,
    opponent_count: row.opponent_count,
  }))
  const scoreAfter = computeSessionFairness({
    ...startedState,
    current_round: Math.max(startedState.current_round, activeRound.round_no + 1),
    players: committed.players,
    rounds: startedState.rounds.map((round) =>
      round.round_no === activeRound.round_no
        ? {
            ...round,
            status: 'completed',
            ended_at: new Date(),
          }
        : round,
    ),
  }).total
  const commitLocalMs = now() - commitLocalStartedAt

  const endRpcStartedAt = now()
  const { data: completedRound, error: endError } = await service.rpc('complete_live_session_round', {
    p_session_id: args.sessionId,
    p_round_no: activeRound.round_no,
    p_player_state: playerStatePayload,
    p_pair_history: pairHistoryPayload,
    p_score_after: scoreAfter,
    p_actor_id: null,
    p_audit_payload: {
      benchmark: true,
      source: 'scratch/bench-live-round-rpc-direct.ts',
      played_ids: [...playedIds].sort(),
      resting: activeRound.resting ?? [],
    },
  })
  const endRpcMs = now() - endRpcStartedAt
  if (endError) throw endError

  console.log(JSON.stringify({
    sessionId: args.sessionId,
    status,
    usedCourts: courts,
    roundStarted: startedRound?.round_no,
    roundCompleted: completedRound?.round_no,
    timings: {
      courtCalculatorMs,
      loadSessionStateMs,
      correctForFairnessMs,
      suggestNextRoundMs,
      startRpcMs,
      reloadAfterStartMs,
      commitLocalMs,
      endRpcMs,
    },
    diagnostics: {
      partitionCount: diagnostics.partition_count,
      maxIterationsPerPartition: diagnostics.max_iterations,
      exhaustive: diagnostics.exhaustive,
      alternatives: suggestion.alternatives.length,
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      playerStateRows: playerStatePayload.length,
      pairHistoryUpdates: pairHistoryPayload.length,
      pairHistoryRows: committed.pairHistory.length,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
