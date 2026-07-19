import 'dotenv/config'
import { performance } from 'node:perf_hooks'

import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts } from '../../lib/court-calculator'
import { correctForFairness } from '../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../lib/next-round-suggester/fairness/detector'
import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
  LIVE_PREVIEW_ALGORITHM_VERSION,
  type CourtSelectionDebug,
  type SuggestedMatchPayload,
} from '../../lib/next-round-suggester/live-preview'
import { buildRollingPlanTarget } from '../../lib/next-round-suggester/planner/rolling-target'
import {
  getActiveRollingInvariantTarget,
  getRollingInvariantProtectedIds,
} from '../../lib/next-round-suggester/planner/rolling-invariants'
import { buildPrecomputedSessionPlan } from '../../lib/next-round-suggester/planner/session-plan'
import { getEffectivePvna, mapRowsToSessionState } from '../../lib/next-round-suggester/state'
import type {
  EngineInstrumentEvent,
} from '../../lib/next-round-suggester/suggest'
import {
  suggestNextMatch,
  type ExhaustiveFallbackDiagnostic,
} from '../../lib/next-round-suggester/suggest'
import type {
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
  Team,
} from '../../lib/next-round-suggester/types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'

if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment')

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

type Snapshot = {
  live_state_version: number
  player_rows: SessionPlayerStateRow[]
  pair_rows: SessionPairHistoryRow[]
  round_rows: SessionRoundRow[]
  live_match_rows: SessionLiveMatchRow[]
}

type MatchObservation = {
  court_idx: number
  lane_round: number
  team_a: Team
  team_b: Team
  team_gap: number
  intra_gap: number
  partner_repeats: number
  opponent_repeats: number
  warnings: string[]
}

type PlayerObservation = {
  matches: number
  quality_debt: number
  warning_exposure: number
  partner_repeats: number
  opponent_repeats: number
  max_rest: number
}

type ScenarioResult = {
  label: string
  order_samples: number[][]
  completed_matches: number
  incomplete_requests: number
  hard_wait_attempts: number
  deadlock: {
    completed_events: number
    target_total_appearances: number | null
    remaining_target_slots: number
    core_probe: {
      strict_alternatives: number
      rematch_relaxed_alternatives: number
      strict_diagnostic: {
        eligible_count: number
        combinations_evaluated: number
        best_pvna_diff: number | null
        timed_out: boolean
      }
      rematch_relaxed_diagnostic: {
        eligible_count: number
        combinations_evaluated: number
        best_pvna_diff: number | null
        timed_out: boolean
      }
      live_debug: CourtSelectionDebug[]
    }
    remaining_players: Array<{
      id: string
      name: string
      pvna: number
      matches: number
      target: number
      remaining: number
    }>
  } | null
  max_request_ms: number
  avg_request_ms: number
  avg_team_gap: number
  p95_team_gap: number
  max_team_gap: number
  avg_intra_gap: number
  max_intra_gap: number
  warning_matches: number
  repeat_warning_matches: number
  pvna_warning_matches: number
  unified_social_rescues: number
  exhaustive_fallback_matches: number
  match_count_min: number
  match_count_max: number
  match_count_spread: number
  max_consecutive_rest: number
  total_partner_repeats: number
  total_opponent_repeats: number
  worst_players: Array<{
    id: string
    name: string
    matches: number
    quality_debt: number
    warning_exposure: number
    partner_repeats: number
    opponent_repeats: number
    max_rest: number
  }>
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function cloneRows<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function playerIds(payload: SuggestedMatchPayload) {
  return [...payload.team_a, ...payload.team_b]
}

function projectedPairRepeats(state: SessionState, teamA: Team, teamB: Team) {
  const partnerPairs: Array<[string, string]> = [
    [teamA[0], teamA[1]],
    [teamB[0], teamB[1]],
  ]
  const opponentPairs = teamA.flatMap(left => teamB.map(right => [left, right] as [string, string]))
  return {
    partner: partnerPairs.filter(([left, right]) =>
      (state.players.get(left)?.partner_counts.get(right) ?? 0) > 0
    ).length,
    opponent: opponentPairs.filter(([left, right]) =>
      (state.players.get(left)?.opponent_counts.get(right) ?? 0) > 0
    ).length,
  }
}

function observeMatch(
  payload: SuggestedMatchPayload,
  state: SessionState,
  laneRound: number,
): MatchObservation {
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  const teamGap = Math.abs(
    pvna(payload.team_a[0]) + pvna(payload.team_a[1])
      - pvna(payload.team_b[0]) - pvna(payload.team_b[1]),
  )
  const intraGap = Math.max(
    Math.abs(pvna(payload.team_a[0]) - pvna(payload.team_a[1])),
    Math.abs(pvna(payload.team_b[0]) - pvna(payload.team_b[1])),
  )
  const repeats = projectedPairRepeats(state, payload.team_a, payload.team_b)
  return {
    court_idx: payload.court_idx,
    lane_round: laneRound,
    team_a: payload.team_a,
    team_b: payload.team_b,
    team_gap: teamGap,
    intra_gap: intraGap,
    partner_repeats: repeats.partner,
    opponent_repeats: repeats.opponent,
    warnings: payload.warnings ?? [],
  }
}

function asLiveRow(
  payload: SuggestedMatchPayload,
  sessionId: string,
  sequenceNo: number,
  laneRound: number,
): SessionLiveMatchRow {
  const timestamp = new Date(sequenceNo * 1000).toISOString()
  return {
    id: `offline-${sequenceNo}`,
    session_id: sessionId,
    sequence_no: sequenceNo,
    round_no: laneRound,
    cycle_no: laneRound,
    court_idx: payload.court_idx,
    status: 'live',
    team_a: payload.team_a,
    team_b: payload.team_b,
    resting: payload.resting,
    score_a: 0,
    score_b: 0,
    suggested_at: timestamp,
    started_at: timestamp,
    ended_at: null,
  }
}

function seededOrders(courts: number, rounds: number) {
  let seed = 0x4b25960d
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
  return Array.from({ length: rounds }, () => {
    const order = Array.from({ length: courts }, (_, index) => index)
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1))
      ;[order[index], order[swap]] = [order[swap], order[index]]
    }
    return order
  })
}

function scenarioOrders(courts: number, rounds: number) {
  const forward = Array.from({ length: courts }, (_, index) => index)
  const reverse = [...forward].reverse()
  const zigzag = forward.flatMap((_, index) => {
    if (index >= Math.ceil(courts / 2)) return []
    const right = courts - 1 - index
    return index === right ? [index] : [index, right]
  })
  return [
    { label: 'forward', orders: Array.from({ length: rounds }, () => [...forward]) },
    { label: 'reverse', orders: Array.from({ length: rounds }, () => [...reverse]) },
    { label: 'zigzag', orders: Array.from({ length: rounds }, () => [...zigzag]) },
    { label: 'seeded-random', orders: seededOrders(courts, rounds) },
  ]
}

function createPlayerSummary(state: SessionState) {
  return new Map([...state.players.keys()].map(id => [id, {
    matches: 0,
    quality_debt: 0,
    warning_exposure: 0,
    partner_repeats: 0,
    opponent_repeats: 0,
    max_rest: 0,
  } satisfies PlayerObservation]))
}

function updatePlayerSummary(
  observations: Map<string, PlayerObservation>,
  match: MatchObservation,
  state: SessionState,
) {
  const warning = match.warnings.length > 0 ? 1 : 0
  const updateTeam = (team: Team) => {
    const intra = Math.abs(
      getEffectivePvna(state.players.get(team[0])!)
        - getEffectivePvna(state.players.get(team[1])!),
    )
    team.forEach(id => {
      const item = observations.get(id)
      if (!item) return
      item.matches += 1
      item.warning_exposure += warning
      item.quality_debt += Math.max(0, match.team_gap - state.config.pvna_tolerance) * 2
        + Math.max(0, intra - 1)
    })
  }
  updateTeam(match.team_a)
  updateTeam(match.team_b)
  const partnerPairs: Array<[string, string]> = [
    [match.team_a[0], match.team_a[1]],
    [match.team_b[0], match.team_b[1]],
  ]
  partnerPairs.forEach(([left, right]) => {
    if ((state.players.get(left)?.partner_counts.get(right) ?? 0) <= 0) return
    const leftObservation = observations.get(left)
    const rightObservation = observations.get(right)
    if (leftObservation) leftObservation.partner_repeats += 1
    if (rightObservation) rightObservation.partner_repeats += 1
  })
  match.team_a.forEach(left => match.team_b.forEach(right => {
    if ((state.players.get(left)?.opponent_counts.get(right) ?? 0) <= 0) return
    const leftObservation = observations.get(left)
    const rightObservation = observations.get(right)
    if (leftObservation) leftObservation.opponent_repeats += 1
    if (rightObservation) rightObservation.opponent_repeats += 1
  }))
}

function updateMaxRest(observations: Map<string, PlayerObservation>, state: SessionState) {
  state.players.forEach((player, id) => {
    const item = observations.get(id)
    if (item) item.max_rest = Math.max(item.max_rest, player.consecutive_rest)
  })
}

function buildState(snapshot: Snapshot, sessionId: string, courts: number, pvnaTolerance: number) {
  return mapRowsToSessionState({
    sessionId,
    playerRows: cloneRows(snapshot.player_rows),
    pairRows: cloneRows(snapshot.pair_rows),
    roundRows: cloneRows(snapshot.round_rows),
    courts,
    pvnaTolerance,
  })
}

function buildPlanTarget(initialState: SessionState, rounds: number, courts: number) {
  const plan = buildPrecomputedSessionPlan(initialState, rounds, courts, {
    localSearchPasses: 3,
    maxRoundRuntimeMs: 500,
  })
  const baselinePlayers = [...initialState.players.values()].map(player => ({
    ...player,
    checked_in_at: player.checked_in_at.toISOString(),
    checked_out_at: player.checked_out_at?.toISOString() ?? null,
    partner_counts: [...player.partner_counts],
    opponent_counts: [...player.opponent_counts],
  }))
  const target = buildRollingPlanTarget({
    planVersionId: 'offline-real-session-plan',
    baselinePlayers,
    baselineRounds: initialState.rounds,
    plannedRounds: plan.rounds.map(round => ({
      round_no: round.round,
      matches: round.matches,
      resting: round.resting,
    })),
    pvnaByPlayer: new Map([...initialState.players].map(([id, player]) => [
      id,
      getEffectivePvna(player),
    ])),
    pvnaTolerance: initialState.config.pvna_tolerance,
  })
  return { plan, target }
}

function suggest({
  state,
  liveRows,
  count,
  courts,
  pvnaTolerance,
  target,
  courtIdxs,
  events,
}: {
  state: SessionState
  liveRows: SessionLiveMatchRow[]
  count: number
  courts: number
  pvnaTolerance: number
  target: ReturnType<typeof buildRollingPlanTarget>
  courtIdxs?: number[]
  events: EngineInstrumentEvent[]
}) {
  const startedAt = performance.now()
  const debug: CourtSelectionDebug[] = []
  const payloads = buildSuggestedMatchPayloads({
    count,
    sessionId: state.session_id,
    courtCount: courts,
    state,
    rows: { liveMatchRows: liveRows, liveStateVersion: liveRows.length },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: correctForFairness(state),
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
    pvnaTolerance,
    options: {
      courtIdxs,
      ignoreCapacityLock: true,
      rollingHorizon: count === 1,
      rollingPlanTarget: target,
      onInstrumentEvent: event => events.push(event),
    },
    debugOut: debug,
  })
  return { payloads, elapsedMs: performance.now() - startedAt, debug }
}

function simulateScenario({
  initialState,
  target,
  courts,
  rounds,
  label,
  orders,
  names,
}: {
  initialState: SessionState
  target: ReturnType<typeof buildRollingPlanTarget>
  courts: number
  rounds: number
  label: string
  orders: number[][]
  names: ReadonlyMap<string, string>
}): ScenarioResult {
  let state = initialState
  let liveRows: SessionLiveMatchRow[] = []
  let sequenceNo = 0
  const laneCompleted = new Map(Array.from({ length: courts }, (_, court) => [court, 0]))
  const observations: MatchObservation[] = []
  const playerSummary = createPlayerSummary(state)
  const timings: number[] = []
  const events: EngineInstrumentEvent[] = []
  let incompleteRequests = 0
  let hardWaitAttempts = 0
  let deadlock: ScenarioResult['deadlock'] = null
  let lastWaitDebug: CourtSelectionDebug[] = []

  const initial = suggest({
    state,
    liveRows,
    count: courts,
    courts,
    pvnaTolerance: state.config.pvna_tolerance,
    target,
    events,
  })
  timings.push(initial.elapsedMs)
  if (initial.payloads.length !== courts) {
    throw new Error(`${label}: initial board ${initial.payloads.length}/${courts}`)
  }
  initial.payloads.forEach(payload => {
    const match = observeMatch(payload, state, 0)
    observations.push(match)
    updatePlayerSummary(playerSummary, match, state)
    liveRows.push(asLiveRow(payload, state.session_id, sequenceNo++, 0))
  })

  let completionBatchPlayerIds = new Set<string>()
  let completedEvents = 0
  let scheduleCycle = 0
  const targetCompletedEvents = courts * rounds
  while (completedEvents < targetCompletedEvents) {
    let madeProgress = false
    const order = orders[scheduleCycle % orders.length]
    for (const courtIdx of order) {
      if ((laneCompleted.get(courtIdx) ?? 0) >= rounds) continue
      const live = liveRows.find(row => row.status === 'live' && row.court_idx === courtIdx)
      if (!live) continue
      madeProgress = true
      const completedAt = new Date((sequenceNo + 1) * 1000).toISOString()
      const completed: SessionLiveMatchRow = {
        ...live,
        status: 'completed',
        ended_at: completedAt,
      }
      state = buildProjectedStateAfterLiveMatch(
        state,
        completed,
        completed.round_no ?? laneCompleted.get(courtIdx) ?? 0,
      )
      ;[...completed.team_a, ...completed.team_b].forEach(id => completionBatchPlayerIds.add(id))
      liveRows = liveRows.filter(row => row.id !== live.id)
      laneCompleted.set(courtIdx, (laneCompleted.get(courtIdx) ?? 0) + 1)
      completedEvents += 1
      if (completedEvents % courts === 0) {
        state = {
          ...buildProjectedStateAfterCompletedLiveRound(state, completionBatchPlayerIds),
          current_round: Math.max(state.current_round, Math.floor(completedEvents / courts)),
        }
        completionBatchPlayerIds = new Set<string>()
      }
      updateMaxRest(playerSummary, state)

      const idleCourts = [
        courtIdx,
        ...Array.from({ length: courts }, (_, index) => index).filter(index => index !== courtIdx),
      ].filter(index => (
        (laneCompleted.get(index) ?? 0) < rounds
        && !liveRows.some(row => row.status === 'live' && row.court_idx === index)
      ))
      for (const idleCourtIdx of idleCourts) {
        const next = suggest({
          state,
          liveRows,
          count: 1,
          courts,
          pvnaTolerance: state.config.pvna_tolerance,
          target,
          courtIdxs: [idleCourtIdx],
          events,
        })
        timings.push(next.elapsedMs)
        if (next.payloads.length !== 1) {
          hardWaitAttempts += 1
          lastWaitDebug = next.debug
          continue
        }
        const payload = next.payloads[0]
        const busy = new Set(liveRows.flatMap(row => [...row.team_a, ...row.team_b]))
        if (playerIds(payload).some(id => busy.has(id))) {
          throw new Error(`${label}: court ${idleCourtIdx} reused a busy player`)
        }
        const laneRound = laneCompleted.get(idleCourtIdx) ?? 0
        const match = observeMatch(payload, state, laneRound)
        observations.push(match)
        updatePlayerSummary(playerSummary, match, state)
        liveRows.push(asLiveRow(payload, state.session_id, sequenceNo++, laneRound))
      }
    }
    if (!madeProgress) {
      incompleteRequests = Array.from({ length: courts }, (_, courtIdx) => courtIdx)
        .filter(courtIdx => (laneCompleted.get(courtIdx) ?? 0) < rounds)
        .length
      const activeTarget = getActiveRollingInvariantTarget(state, target)
      const remainingPlayers = Object.entries(activeTarget?.players ?? {})
        .map(([id, playerTarget]) => {
          const player = state.players.get(id)
          const matches = player?.matches_played ?? 0
          return {
            id,
            name: names.get(id) ?? id.slice(0, 8),
            pvna: player ? getEffectivePvna(player) : 0,
            matches,
            target: playerTarget.matches,
            remaining: Math.max(0, playerTarget.matches - matches),
          }
        })
        .filter(player => player.remaining > 0)
        .sort((left, right) => right.remaining - left.remaining || left.pvna - right.pvna)
      const protectedIds = getRollingInvariantProtectedIds(state, target)
      const strictDiagnostic: ExhaustiveFallbackDiagnostic = {
        ran: false,
        timedOut: false,
        eligibleCount: 0,
        combinationsEvaluated: 0,
        bestPvnaDiff: null,
        bestHasTradeoffs: false,
        elapsedMs: 0,
      }
      const rematchRelaxedDiagnostic: ExhaustiveFallbackDiagnostic = {
        ran: false,
        timedOut: false,
        eligibleCount: 0,
        combinationsEvaluated: 0,
        bestPvnaDiff: null,
        bestHasTradeoffs: false,
        elapsedMs: 0,
      }
      const strictProbe = suggestNextMatch(state, {
        busy_player_ids: protectedIds,
        exhaustive_fallback: true,
        max_alternatives: 80,
        max_runtime_ms: 1200,
        _exhaustiveDiag: strictDiagnostic,
      })
      const rematchRelaxedProbe = suggestNextMatch(state, {
        busy_player_ids: protectedIds,
        exhaustive_fallback: true,
        allow_recent_group_rematch: true,
        max_alternatives: 80,
        max_runtime_ms: 1200,
        _exhaustiveDiag: rematchRelaxedDiagnostic,
      })
      deadlock = {
        completed_events: completedEvents,
        target_total_appearances: activeTarget?.target_total_appearances ?? null,
        remaining_target_slots: remainingPlayers.reduce((sum, player) => sum + player.remaining, 0),
        core_probe: {
          strict_alternatives: strictProbe.alternatives.length,
          rematch_relaxed_alternatives: rematchRelaxedProbe.alternatives.length,
          strict_diagnostic: {
            eligible_count: strictDiagnostic.eligibleCount,
            combinations_evaluated: strictDiagnostic.combinationsEvaluated,
            best_pvna_diff: strictDiagnostic.bestPvnaDiff,
            timed_out: strictDiagnostic.timedOut,
          },
          rematch_relaxed_diagnostic: {
            eligible_count: rematchRelaxedDiagnostic.eligibleCount,
            combinations_evaluated: rematchRelaxedDiagnostic.combinationsEvaluated,
            best_pvna_diff: rematchRelaxedDiagnostic.bestPvnaDiff,
            timed_out: rematchRelaxedDiagnostic.timedOut,
          },
          live_debug: lastWaitDebug,
        },
        remaining_players: remainingPlayers,
      }
      break
    }
    scheduleCycle += 1
    if (scheduleCycle > targetCompletedEvents * 3) {
      incompleteRequests = 1
      break
    }
  }

  const matchCounts = [...playerSummary.values()].map(player => player.matches)
  const worstPlayers = [...playerSummary]
    .map(([id, player]) => ({ id, name: names.get(id) ?? id.slice(0, 8), ...player }))
    .sort((left, right) =>
      right.quality_debt - left.quality_debt
      || right.warning_exposure - left.warning_exposure
      || right.partner_repeats - left.partner_repeats
    )
    .slice(0, 8)
  const teamGaps = observations.map(match => match.team_gap)
  const intraGaps = observations.map(match => match.intra_gap)
  return {
    label,
    order_samples: orders.slice(0, 3),
    completed_matches: observations.length,
    incomplete_requests: incompleteRequests,
    hard_wait_attempts: hardWaitAttempts,
    deadlock,
    max_request_ms: Number(Math.max(...timings).toFixed(1)),
    avg_request_ms: Number(average(timings).toFixed(1)),
    avg_team_gap: Number(average(teamGaps).toFixed(3)),
    p95_team_gap: Number(percentile(teamGaps, 0.95).toFixed(3)),
    max_team_gap: Number(Math.max(...teamGaps).toFixed(3)),
    avg_intra_gap: Number(average(intraGaps).toFixed(3)),
    max_intra_gap: Number(Math.max(...intraGaps).toFixed(3)),
    warning_matches: observations.filter(match => match.warnings.length > 0).length,
    repeat_warning_matches: observations.filter(match =>
      match.warnings.some(warning => warning.includes('REPEAT') || warning.includes('REMATCH'))
    ).length,
    pvna_warning_matches: observations.filter(match =>
      match.warnings.some(warning => warning.includes('PVNA'))
    ).length,
    unified_social_rescues: events.filter(event =>
      event.event === 'rescue' && event.detail.startsWith('unified_social_tradeoff')
    ).length,
    exhaustive_fallback_matches: observations.filter(match =>
      match.warnings.includes('EXHAUSTIVE_FALLBACK')
    ).length,
    match_count_min: Math.min(...matchCounts),
    match_count_max: Math.max(...matchCounts),
    match_count_spread: Math.max(...matchCounts) - Math.min(...matchCounts),
    max_consecutive_rest: Math.max(...[...playerSummary.values()].map(player => player.max_rest)),
    total_partner_repeats: observations.reduce((sum, match) => sum + match.partner_repeats, 0),
    total_opponent_repeats: observations.reduce((sum, match) => sum + match.opponent_repeats, 0),
    worst_players: worstPlayers,
  }
}

async function main() {
  const sessionId = argument('--session-id')
  const requestedRounds = Number(argument('--rounds') ?? 8)
  if (!sessionId) throw new Error('Usage: --session-id=<uuid> [--rounds=8]')
  if (!Number.isInteger(requestedRounds) || requestedRounds <= 0) {
    throw new Error('--rounds must be a positive integer')
  }

  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.user) throw new Error(authError?.message ?? 'Unable to sign in')

  const [{ data: rawSnapshot, error: snapshotError }, { data: settings, error: settingsError }] = await Promise.all([
    client.rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId }),
    client
      .from('session_next_round_settings')
      .select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds')
      .eq('session_id', sessionId)
      .maybeSingle(),
  ])
  if (snapshotError) throw snapshotError
  if (settingsError) throw settingsError
  const snapshot = rawSnapshot as Snapshot
  const startedOrCompletedRows = (snapshot.live_match_rows ?? []).filter(row =>
    row.status === 'live' || row.status === 'completed'
  )
  const ignoredSuggestedRows = (snapshot.live_match_rows ?? []).filter(row =>
    row.status === 'suggested'
  ).length
  if (startedOrCompletedRows.length > 0 || (snapshot.round_rows ?? []).length > 0) {
    throw new Error(
      `Session is not clean: started_or_completed=${startedOrCompletedRows.length} rounds=${snapshot.round_rows?.length ?? 0}`,
    )
  }
  const activePlayerCount = (snapshot.player_rows ?? []).filter(row =>
    row.checked_out_at === null && !row.opted_rest
  ).length
  const preset = settings?.court_preset ?? 'balanced'
  const recommended = calculateOptimalCourts({
    n_players: activePlayerCount,
    session_duration_min: Number(settings?.court_duration_min ?? 120),
    match_duration_min: 15,
    preset,
  }).recommended.courts
  const courts = Number(settings?.court_count_override ?? recommended)
  const pvnaTolerance = Number(settings?.pvna_tolerance ?? 0.5)
  const initialState = buildState(snapshot, sessionId, courts, pvnaTolerance)
  const names = new Map((snapshot.player_rows ?? []).map(row => [
    row.player_id,
    String((row.players as { name?: unknown } | null)?.name ?? row.player_id.slice(0, 8)),
  ]))
  const planStartedAt = performance.now()
  const { plan, target } = buildPlanTarget(initialState, requestedRounds, courts)
  const plannerWallMs = performance.now() - planStartedAt
  if (!target) throw new Error('Unable to build rolling target')

  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (args[0] === '[next-round-suggester] live round projection drift monitor') return
    originalWarn(...args)
  }
  let results: ReturnType<typeof simulateScenario>[]
  try {
    results = scenarioOrders(courts, requestedRounds).map(scenario => simulateScenario({
      initialState: buildState(snapshot, sessionId, courts, pvnaTolerance),
      target,
      courts,
      rounds: requestedRounds,
      label: scenario.label,
      orders: scenario.orders,
      names,
    }))
  } finally {
    console.warn = originalWarn
  }
  const maxGaps = results.map(result => result.max_team_gap)
  const averageGaps = results.map(result => result.avg_team_gap)
  const partnerRepeats = results.map(result => result.total_partner_repeats)
  const opponentRepeats = results.map(result => result.total_opponent_repeats)
  const operationalPass = results.every(result =>
    result.completed_matches === courts * requestedRounds
    && result.incomplete_requests === 0
    && result.max_request_ms < 2000
    && result.match_count_spread <= 2
    && result.max_consecutive_rest <= 1
  )

  console.log(JSON.stringify({
    session_id: sessionId,
    read_only: true,
    algorithm_version: LIVE_PREVIEW_ALGORITHM_VERSION,
    ignored_persisted_suggestions: ignoredSuggestedRows,
    roster: {
      active_players: activePlayerCount,
      courts,
      court_source: settings?.court_count_override == null ? 'court_calculator' : 'persisted_override',
      recommended_courts: recommended,
      pvna_tolerance: pvnaTolerance,
      rounds: requestedRounds,
    },
    planner: {
      passes: 3,
      wall_ms: Number(plannerWallMs.toFixed(1)),
      active_compute_ms: Number(plan.timings.total_ms.toFixed(1)),
      invariants: plan.invariants,
      preferred_team_gap: target.preferred_team_gap,
      preferred_intra_team_gap: target.preferred_intra_team_gap,
    },
    operational_pass: operationalPass,
    consistency: {
      avg_team_gap_range: Number((Math.max(...averageGaps) - Math.min(...averageGaps)).toFixed(3)),
      max_team_gap_range: Number((Math.max(...maxGaps) - Math.min(...maxGaps)).toFixed(3)),
      partner_repeat_range: Math.max(...partnerRepeats) - Math.min(...partnerRepeats),
      opponent_repeat_range: Math.max(...opponentRepeats) - Math.min(...opponentRepeats),
    },
    scenarios: results,
  }, null, 2))
  if (!operationalPass) process.exitCode = 1
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
