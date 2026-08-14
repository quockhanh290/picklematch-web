// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch } from '../live-preview.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { scoreMatch } from '../score.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState, Team } from '../types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { isBetterSocialPlan, isWithinSocialPlannerCaps, type SocialPlannerMetrics } from './objective.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { runPairSwapSearch } from './pair-swap-search.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { buildBalancedRestSchedule } from './rest-schedule.ts'

export type SessionPlanMatch = { team_a: Team; team_b: Team }

type MatchMetrics = {
  inter: number
  intraA: number
  intraB: number
  maxIntra: number
  score: number
  partnerRepeats: number
  opponentRepeats: number
  genderPenalty: number
}

export type SessionPlanBoardMetrics = SocialPlannerMetrics & {
  avgInter: number
  avgIntra: number
}

export type SessionPlanOptions = {
  localSearchPasses?: number
  maxRoundSearchCandidates?: number
  startingRound?: number
  initialDebt?: ReadonlyMap<string, number>
}

export type SessionPlanTimings = {
  total_ms: number
  rest_schedule_ms: number
  rounds: Array<{
    round: number
    seed_ms: number
    optimize_ms: number
    projection_ms: number
    total_ms: number
    timed_out: boolean
    candidates_evaluated: number
  }>
}

export type SessionPlan = {
  state: SessionState
  debt: Map<string, number>
  rounds: Array<{
    round: number
    resting: string[]
    matches: SessionPlanMatch[]
    seedMetrics: SessionPlanBoardMetrics
    metrics: SessionPlanBoardMetrics
  }>
  invariants: {
    duplicate_player_rounds: number
    max_consecutive_rest: number
    full_rounds: number
    expected_rounds: number
  }
  timings: SessionPlanTimings
}

export type SessionPlanChunkCheckpoint = {
  version: 1
  rounds: SessionPlan['rounds']
  round_timings: SessionPlanTimings['rounds']
  rest_schedule_ms: number
}

export type SessionPlanChunkResult = {
  completed: boolean
  checkpoint: SessionPlanChunkCheckpoint
  plan: SessionPlan | null
  chunk_runtime_ms: number
}

const DEFAULT_LOCAL_SEARCH_PASSES = 1

export function resolveSessionPlanRoundCount(
  currentRound: number,
  targetRounds: number,
  requestedRounds?: number | null,
) {
  if (requestedRounds !== undefined && requestedRounds !== null) return Math.max(0, Math.floor(requestedRounds))
  return Math.max(0, Math.floor(targetRounds) - Math.max(0, Math.floor(currentRound)))
}

function effectivePvna(state: SessionState, playerId: string) {
  const player = state.players.get(playerId)
  return Number(player?.effective_pvna ?? player?.pvna ?? 0)
}

function metricsForMatch(match: SessionPlanMatch, state: SessionState): MatchMetrics {
  const tolerance = state.config.pvna_tolerance
  const teamASum = match.team_a.reduce((sum, id) => sum + effectivePvna(state, id), 0)
  const teamBSum = match.team_b.reduce((sum, id) => sum + effectivePvna(state, id), 0)
  const intraA = Math.abs(effectivePvna(state, match.team_a[0]) - effectivePvna(state, match.team_a[1]))
  const intraB = Math.abs(effectivePvna(state, match.team_b[0]) - effectivePvna(state, match.team_b[1]))
  const result = scoreMatch(match.team_a, match.team_b, state, {
    tolerance,
    allowPvnaToleranceOverflow: true,
    allowRepeatOverflow: true,
    allowIntraTeamGapOverflow: true,
    allowRecentGroupRematch: true,
  })
  return {
    inter: Math.abs(teamASum - teamBSum),
    intraA,
    intraB,
    maxIntra: Math.max(intraA, intraB),
    score: result.score,
    partnerRepeats: Number(result.stats.partner_repeats ?? 0),
    opponentRepeats: Number(result.stats.opponent_repeats ?? 0),
    genderPenalty: Number(result.stats.gender_pref_penalty ?? 0),
  }
}

function playerBurden(metrics: MatchMetrics, partnerIntra: number, tolerance: number) {
  return Math.max(0, metrics.inter - tolerance) * 2 + Math.max(0, partnerIntra - 1)
}

type DebtProjectionScratch = {
  indexById: ReadonlyMap<string, number>
  base: Float64Array
  projected: Float64Array
  touched: Uint8Array
  touchedIndices: number[]
}

function createDebtProjectionScratch(
  state: SessionState,
  debt: ReadonlyMap<string, number>,
): DebtProjectionScratch {
  const playerIds = [...new Set([...debt.keys(), ...state.players.keys()])]
  const indexById = new Map(playerIds.map((id, index) => [id, index]))
  const base = new Float64Array(playerIds.map(id => debt.get(id) ?? 0))
  return {
    indexById,
    base,
    projected: new Float64Array(base),
    touched: new Uint8Array(playerIds.length),
    touchedIndices: [],
  }
}

export function summarizeSessionPlanBoard(
  board: SessionPlanMatch[],
  state: SessionState,
  debt: ReadonlyMap<string, number>,
  resolveMetrics: (match: SessionPlanMatch) => MatchMetrics = match => metricsForMatch(match, state),
): SessionPlanBoardMetrics {
  return summarizeSessionPlanBoardParts([board], state, debt, resolveMetrics)
}

function summarizeSessionPlanBoardParts(
  parts: ReadonlyArray<ReadonlyArray<SessionPlanMatch>>,
  state: SessionState,
  debt: ReadonlyMap<string, number>,
  resolveMetrics: (match: SessionPlanMatch) => MatchMetrics,
  debtScratch?: DebtProjectionScratch,
): SessionPlanBoardMetrics {
  const tolerance = state.config.pvna_tolerance
  const burdenByPlayer = debtScratch ? null : new Map<string, number>()
  let matchCount = 0
  let interTotal = 0
  let intraTotal = 0
  let maxInter = 0
  let maxIntra = 0
  let interOverTolerance = 0
  let interOverOne = 0
  let intraOverOne = 0
  let intraOverTwo = 0
  let partnerRepeats = 0
  let opponentRepeats = 0
  let genderPenalty = 0
  let engineScore = 0
  const addBurden = (id: string, burden: number) => {
    if (!debtScratch) {
      burdenByPlayer!.set(id, (burdenByPlayer!.get(id) ?? 0) + burden)
      return
    }
    const index = debtScratch.indexById.get(id)
    if (index === undefined) return
    if (debtScratch.touched[index] === 0) {
      debtScratch.touched[index] = 1
      debtScratch.touchedIndices.push(index)
    }
    debtScratch.projected[index] += burden
  }

  for (const part of parts) {
    for (const match of part) {
      matchCount += 1
      const metrics = resolveMetrics(match)
      interTotal += metrics.inter
      intraTotal += metrics.maxIntra
      maxInter = Math.max(maxInter, metrics.inter)
      maxIntra = Math.max(maxIntra, metrics.maxIntra)
      if (metrics.inter > tolerance + 1e-9) interOverTolerance += 1
      if (metrics.inter > 1 + 1e-9) interOverOne += 1
      if (metrics.maxIntra > 1 + 1e-9) intraOverOne += 1
      if (metrics.maxIntra > 2 + 1e-9) intraOverTwo += 1
      partnerRepeats += metrics.partnerRepeats
      opponentRepeats += metrics.opponentRepeats
      genderPenalty += metrics.genderPenalty
      engineScore += metrics.score

      const teamABurden = playerBurden(metrics, metrics.intraA, tolerance)
      const teamBBurden = playerBurden(metrics, metrics.intraB, tolerance)
      for (const id of match.team_a) addBurden(id, teamABurden)
      for (const id of match.team_b) addBurden(id, teamBBurden)
    }
  }

  let maxProjectedDebt = 0
  let squaredProjectedDebt = 0
  if (debtScratch) {
    for (const projected of debtScratch.projected) {
      maxProjectedDebt = Math.max(maxProjectedDebt, projected)
      squaredProjectedDebt += projected * projected
    }
    for (const index of debtScratch.touchedIndices) {
      debtScratch.projected[index] = debtScratch.base[index]
      debtScratch.touched[index] = 0
    }
    debtScratch.touchedIndices.length = 0
  } else {
    for (const [id, value] of debt) {
      const projected = value + (burdenByPlayer!.get(id) ?? 0)
      maxProjectedDebt = Math.max(maxProjectedDebt, projected)
      squaredProjectedDebt += projected * projected
      burdenByPlayer!.delete(id)
    }
    for (const burden of burdenByPlayer!.values()) {
      maxProjectedDebt = Math.max(maxProjectedDebt, burden)
      squaredProjectedDebt += burden * burden
    }
  }

  return {
    matches: matchCount,
    avgInter: interTotal / Math.max(1, matchCount),
    maxInter,
    interOverTolerance,
    interOverOne,
    avgIntra: intraTotal / Math.max(1, matchCount),
    maxIntra,
    intraOverOne,
    intraOverTwo,
    partnerRepeats,
    opponentRepeats,
    genderPenalty,
    engineScore,
    maxProjectedDebt,
    squaredProjectedDebt,
  }
}

function optimizeBoard(
  initial: SessionPlanMatch[],
  state: SessionState,
  debt: ReadonlyMap<string, number>,
  localSearchPasses: number,
  maxCandidates: number | undefined,
  searchStats: { timedOut: boolean; candidatesEvaluated: number },
) {
  const matchMetricsCache = new Map<string, MatchMetrics>()
  const matchObjectMetricsCache = new WeakMap<SessionPlanMatch, MatchMetrics>()
  const debtScratch = createDebtProjectionScratch(state, debt)
  const matchKey = (match: SessionPlanMatch) => {
    const teamA = match.team_a[0] < match.team_a[1]
      ? `${match.team_a[0]},${match.team_a[1]}`
      : `${match.team_a[1]},${match.team_a[0]}`
    const teamB = match.team_b[0] < match.team_b[1]
      ? `${match.team_b[0]},${match.team_b[1]}`
      : `${match.team_b[1]},${match.team_b[0]}`
    return `${teamA}|${teamB}`
  }
  const resolveMetrics = (match: SessionPlanMatch) => {
    const objectCached = matchObjectMetricsCache.get(match)
    if (objectCached) return objectCached
    const key = matchKey(match)
    const cached = matchMetricsCache.get(key)
    if (cached) {
      matchObjectMetricsCache.set(match, cached)
      return cached
    }
    const metrics = metricsForMatch(match, state)
    matchMetricsCache.set(key, metrics)
    matchObjectMetricsCache.set(match, metrics)
    return metrics
  }
  const summarize = (candidate: SessionPlanMatch[]) => {
    return summarizeSessionPlanBoardParts([candidate], state, debt, resolveMetrics, debtScratch)
  }
  const invariantCaps = summarize(initial)
  const result = runPairSwapSearch({
    initialBoard: initial,
    passes: localSearchPasses,
    evaluate: summarize,
    evaluateReplacement: (otherMatches, replacement) => summarizeSessionPlanBoardParts(
      [otherMatches, replacement],
      state,
      debt,
      resolveMetrics,
      debtScratch,
    ),
    isAllowed: metrics => isWithinSocialPlannerCaps(metrics, invariantCaps),
    isBetter: isBetterSocialPlan,
    maxCandidates,
  })
  searchStats.timedOut = result.timedOut
  searchStats.candidatesEvaluated = result.candidatesEvaluated
  return result.board
}

export function projectSessionPlanBoard(state: SessionState, board: SessionPlanMatch[], roundNo: number) {
  let nextState = { ...state, current_round: roundNo }
  const playedIds = new Set<string>()
  board.forEach((match, index) => {
    match.team_a.forEach(id => playedIds.add(id))
    match.team_b.forEach(id => playedIds.add(id))
    nextState = buildProjectedStateAfterLiveMatch(nextState, {
      id: `session-plan-${roundNo}-${index}`,
      session_id: state.session_id,
      sequence_no: roundNo * state.config.courts + index,
      round_no: roundNo,
      court_idx: index,
      status: 'completed',
      team_a: match.team_a,
      team_b: match.team_b,
      resting: [],
      score_a: 0,
      score_b: 0,
      suggested_at: new Date(0).toISOString(),
      started_at: null,
      ended_at: new Date(0).toISOString(),
    }, roundNo)
  })
  return {
    ...buildProjectedStateAfterCompletedLiveRound(nextState, playedIds),
    current_round: roundNo + 1,
  }
}

export function projectSessionPlanDebt(
  debt: ReadonlyMap<string, number>,
  board: SessionPlanMatch[],
  state: SessionState,
) {
  const nextDebt = new Map(debt)
  for (const match of board) {
    const metrics = metricsForMatch(match, state)
    match.team_a.forEach(id => nextDebt.set(
      id,
      (nextDebt.get(id) ?? 0) + playerBurden(metrics, metrics.intraA, state.config.pvna_tolerance),
    ))
    match.team_b.forEach(id => nextDebt.set(
      id,
      (nextDebt.get(id) ?? 0) + playerBurden(metrics, metrics.intraB, state.config.pvna_tolerance),
    ))
  }
  return nextDebt
}

export function buildPrecomputedSessionPlan(
  initialState: SessionState,
  roundCount: number,
  courts: number,
  options: SessionPlanOptions = {},
): SessionPlan {
  const totalStartedAt = performance.now()
  const localSearchPasses = options.localSearchPasses ?? DEFAULT_LOCAL_SEARCH_PASSES
  const startingRound = options.startingRound ?? initialState.current_round
  const activePlayers = [...initialState.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .sort((left, right) => {
      const pvnaDelta = effectivePvna(initialState, left.player_id) - effectivePvna(initialState, right.player_id)
      return pvnaDelta || left.player_id.localeCompare(right.player_id)
    })
  const slotsPerRound = Math.min(courts * 4, Math.floor(activePlayers.length / 4) * 4)
  if (slotsPerRound !== courts * 4) {
    throw new Error(`Session planner requires enough players for all courts: players=${activePlayers.length} courts=${courts}`)
  }
  const restPerRound = activePlayers.length - slotsPerRound
  const restStartedAt = performance.now()
  const restSchedule = buildBalancedRestSchedule(
    activePlayers.map(player => player.player_id),
    roundCount,
    restPerRound,
    {
      startingRound,
      initialRestCounts: new Map(activePlayers.map(player => [
        player.player_id,
        (player.rounds_available ?? 0) - player.matches_played,
      ])),
      initialRestStreaks: new Map(activePlayers.map(player => [player.player_id, player.consecutive_rest])),
    },
  )
  const restScheduleMs = performance.now() - restStartedAt

  let state = initialState
  let debt = new Map([...state.players.keys()].map(id => [id, options.initialDebt?.get(id) ?? 0]))
  const maxRestByPlayer = new Map(activePlayers.map(player => [player.player_id, player.consecutive_rest]))
  const rounds: SessionPlan['rounds'] = []
  const roundTimings: SessionPlanTimings['rounds'] = []

  for (let roundOffset = 0; roundOffset < roundCount; roundOffset += 1) {
    const roundStartedAt = performance.now()
    const absoluteRound = startingRound + roundOffset
    const resting = new Set(restSchedule[roundOffset])
    const playing = activePlayers
      .filter(player => !resting.has(player.player_id))
      .map(player => player.player_id)
      .sort((left, right) => effectivePvna(state, left) - effectivePvna(state, right) || left.localeCompare(right))
    const seed: SessionPlanMatch[] = []
    for (let offset = 0; offset < playing.length; offset += 4) {
      const ids = playing.slice(offset, offset + 4)
      seed.push({ team_a: [ids[0], ids[3]], team_b: [ids[1], ids[2]] })
    }
    const seedMs = performance.now() - roundStartedAt
    const optimizeStartedAt = performance.now()
    const searchStats = { timedOut: false, candidatesEvaluated: 0 }
    const seedMetrics = summarizeSessionPlanBoard(seed, state, debt)
    const board = optimizeBoard(
      seed,
      state,
      debt,
      localSearchPasses,
      options.maxRoundSearchCandidates,
      searchStats,
    )
    const optimizeMs = performance.now() - optimizeStartedAt
    const metrics = summarizeSessionPlanBoard(board, state, debt)
    rounds.push({
      round: absoluteRound + 1,
      resting: [...resting].sort(),
      matches: board.map(match => ({
        team_a: [...match.team_a] as Team,
        team_b: [...match.team_b] as Team,
      })),
      seedMetrics,
      metrics,
    })
    const projectionStartedAt = performance.now()
    debt = projectSessionPlanDebt(debt, board, state)
    state = projectSessionPlanBoard(state, board, absoluteRound)
    activePlayers.forEach(player => {
      const current = state.players.get(player.player_id)?.consecutive_rest ?? 0
      maxRestByPlayer.set(player.player_id, Math.max(maxRestByPlayer.get(player.player_id) ?? 0, current))
    })
    const projectionMs = performance.now() - projectionStartedAt
    roundTimings.push({
      round: absoluteRound + 1,
      seed_ms: seedMs,
      optimize_ms: optimizeMs,
      projection_ms: projectionMs,
      total_ms: performance.now() - roundStartedAt,
      timed_out: searchStats.timedOut,
      candidates_evaluated: searchStats.candidatesEvaluated,
    })
  }

  const duplicatePlayerRounds = rounds.filter(round => {
    const ids = round.matches.flatMap(match => [...match.team_a, ...match.team_b])
    return ids.length !== new Set(ids).size
  }).length
  return {
    state,
    debt,
    rounds,
    invariants: {
      duplicate_player_rounds: duplicatePlayerRounds,
      max_consecutive_rest: Math.max(0, ...maxRestByPlayer.values()),
      full_rounds: rounds.filter(round => round.matches.length === courts).length,
      expected_rounds: roundCount,
    },
    timings: {
      total_ms: performance.now() - totalStartedAt,
      rest_schedule_ms: restScheduleMs,
      rounds: roundTimings,
    },
  }
}

export function buildPrecomputedSessionPlanChunk(
  initialState: SessionState,
  roundCount: number,
  courts: number,
  checkpoint: SessionPlanChunkCheckpoint | null,
  options: SessionPlanOptions = {},
): SessionPlanChunkResult {
  const chunkStartedAt = performance.now()
  const localSearchPasses = options.localSearchPasses ?? DEFAULT_LOCAL_SEARCH_PASSES
  const startingRound = options.startingRound ?? initialState.current_round
  const activePlayers = [...initialState.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .sort((left, right) => {
      const pvnaDelta = effectivePvna(initialState, left.player_id) - effectivePvna(initialState, right.player_id)
      return pvnaDelta || left.player_id.localeCompare(right.player_id)
    })
  const slotsPerRound = Math.min(courts * 4, Math.floor(activePlayers.length / 4) * 4)
  if (slotsPerRound !== courts * 4) {
    throw new Error(`Session planner requires enough players for all courts: players=${activePlayers.length} courts=${courts}`)
  }
  if (checkpoint && checkpoint.version !== 1) {
    throw new Error('Unsupported session planner checkpoint version')
  }
  if ((checkpoint?.rounds.length ?? 0) > roundCount) {
    throw new Error('Session planner checkpoint exceeds requested round count')
  }

  const restStartedAt = performance.now()
  const restSchedule = buildBalancedRestSchedule(
    activePlayers.map(player => player.player_id),
    roundCount,
    activePlayers.length - slotsPerRound,
    {
      startingRound,
      initialRestCounts: new Map(activePlayers.map(player => [
        player.player_id,
        (player.rounds_available ?? 0) - player.matches_played,
      ])),
      initialRestStreaks: new Map(activePlayers.map(player => [player.player_id, player.consecutive_rest])),
    },
  )
  const measuredRestScheduleMs = performance.now() - restStartedAt
  const restScheduleMs = checkpoint?.rest_schedule_ms ?? measuredRestScheduleMs

  let state = initialState
  let debt = new Map([...state.players.keys()].map(id => [id, options.initialDebt?.get(id) ?? 0]))
  const maxRestByPlayer = new Map(activePlayers.map(player => [player.player_id, player.consecutive_rest]))
  const rounds: SessionPlan['rounds'] = (checkpoint?.rounds ?? []).map(round => ({
    ...round,
    resting: [...round.resting],
    matches: round.matches.map(match => ({
      team_a: [...match.team_a] as Team,
      team_b: [...match.team_b] as Team,
    })),
  }))
  const roundTimings = [...(checkpoint?.round_timings ?? [])]
  if (roundTimings.length !== rounds.length) {
    throw new Error('Session planner checkpoint timing count does not match completed rounds')
  }

  for (let roundOffset = 0; roundOffset < rounds.length; roundOffset += 1) {
    const round = rounds[roundOffset]
    const expectedRound = startingRound + roundOffset + 1
    if (round.round !== expectedRound) {
      throw new Error(`Session planner checkpoint round mismatch: expected=${expectedRound} actual=${round.round}`)
    }
    const expectedResting = [...restSchedule[roundOffset]].sort()
    if (JSON.stringify([...round.resting].sort()) !== JSON.stringify(expectedResting)) {
      throw new Error(`Session planner checkpoint rest schedule mismatch at round ${round.round}`)
    }
    debt = projectSessionPlanDebt(debt, round.matches, state)
    state = projectSessionPlanBoard(state, round.matches, startingRound + roundOffset)
    activePlayers.forEach(player => {
      const current = state.players.get(player.player_id)?.consecutive_rest ?? 0
      maxRestByPlayer.set(player.player_id, Math.max(maxRestByPlayer.get(player.player_id) ?? 0, current))
    })
  }

  const roundOffset = rounds.length
  if (roundOffset < roundCount) {
    const roundStartedAt = performance.now()
    const absoluteRound = startingRound + roundOffset
    const resting = new Set(restSchedule[roundOffset])
    const playing = activePlayers
      .filter(player => !resting.has(player.player_id))
      .map(player => player.player_id)
      .sort((left, right) => effectivePvna(state, left) - effectivePvna(state, right) || left.localeCompare(right))
    const seed: SessionPlanMatch[] = []
    for (let offset = 0; offset < playing.length; offset += 4) {
      const ids = playing.slice(offset, offset + 4)
      seed.push({ team_a: [ids[0], ids[3]], team_b: [ids[1], ids[2]] })
    }
    const seedMs = performance.now() - roundStartedAt
    const optimizeStartedAt = performance.now()
    const searchStats = { timedOut: false, candidatesEvaluated: 0 }
    const seedMetrics = summarizeSessionPlanBoard(seed, state, debt)
    const board = optimizeBoard(
      seed,
      state,
      debt,
      localSearchPasses,
      options.maxRoundSearchCandidates,
      searchStats,
    )
    const optimizeMs = performance.now() - optimizeStartedAt
    const metrics = summarizeSessionPlanBoard(board, state, debt)
    rounds.push({
      round: absoluteRound + 1,
      resting: [...resting].sort(),
      matches: board.map(match => ({
        team_a: [...match.team_a] as Team,
        team_b: [...match.team_b] as Team,
      })),
      seedMetrics,
      metrics,
    })
    const projectionStartedAt = performance.now()
    debt = projectSessionPlanDebt(debt, board, state)
    state = projectSessionPlanBoard(state, board, absoluteRound)
    activePlayers.forEach(player => {
      const current = state.players.get(player.player_id)?.consecutive_rest ?? 0
      maxRestByPlayer.set(player.player_id, Math.max(maxRestByPlayer.get(player.player_id) ?? 0, current))
    })
    const projectionMs = performance.now() - projectionStartedAt
    roundTimings.push({
      round: absoluteRound + 1,
      seed_ms: seedMs,
      optimize_ms: optimizeMs,
      projection_ms: projectionMs,
      total_ms: performance.now() - roundStartedAt,
      timed_out: searchStats.timedOut,
      candidates_evaluated: searchStats.candidatesEvaluated,
    })
  }

  const nextCheckpoint: SessionPlanChunkCheckpoint = {
    version: 1,
    rounds,
    round_timings: roundTimings,
    rest_schedule_ms: restScheduleMs,
  }
  const completed = rounds.length === roundCount
  const duplicatePlayerRounds = rounds.filter(round => {
    const ids = round.matches.flatMap(match => [...match.team_a, ...match.team_b])
    return ids.length !== new Set(ids).size
  }).length
  const plan = completed ? {
    state,
    debt,
    rounds,
    invariants: {
      duplicate_player_rounds: duplicatePlayerRounds,
      max_consecutive_rest: Math.max(0, ...maxRestByPlayer.values()),
      full_rounds: rounds.filter(round => round.matches.length === courts).length,
      expected_rounds: roundCount,
    },
    timings: {
      total_ms: restScheduleMs + roundTimings.reduce((sum, round) => sum + round.total_ms, 0),
      rest_schedule_ms: restScheduleMs,
      rounds: roundTimings,
    },
  } satisfies SessionPlan : null

  return {
    completed,
    checkpoint: nextCheckpoint,
    plan,
    chunk_runtime_ms: performance.now() - chunkStartedAt,
  }
}

export function summarizeSessionPlan(plan: SessionPlan) {
  const totalMatches = plan.rounds.reduce((sum, round) => sum + round.metrics.matches, 0)
  const matchCounts = [...plan.state.players.values()].map(player => player.matches_played)
  const debtValues = [...plan.debt.values()]
  return {
    matches: totalMatches,
    avg_team_gap: plan.rounds.reduce((sum, round) => sum + round.metrics.avgInter * round.metrics.matches, 0) / totalMatches,
    max_team_gap: Math.max(...plan.rounds.map(round => round.metrics.maxInter)),
    team_gap_over_0_5: plan.rounds.reduce((sum, round) => sum + round.metrics.interOverTolerance, 0),
    team_gap_over_1: plan.rounds.reduce((sum, round) => sum + round.metrics.interOverOne, 0),
    avg_intra_gap: plan.rounds.reduce((sum, round) => sum + round.metrics.avgIntra * round.metrics.matches, 0) / totalMatches,
    max_intra_gap: Math.max(...plan.rounds.map(round => round.metrics.maxIntra)),
    intra_gap_over_1: plan.rounds.reduce((sum, round) => sum + round.metrics.intraOverOne, 0),
    intra_gap_over_2: plan.rounds.reduce((sum, round) => sum + round.metrics.intraOverTwo, 0),
    partner_repeats: plan.rounds.reduce((sum, round) => sum + round.metrics.partnerRepeats, 0),
    opponent_repeats: plan.rounds.reduce((sum, round) => sum + round.metrics.opponentRepeats, 0),
    match_count_min: Math.min(...matchCounts),
    match_count_max: Math.max(...matchCounts),
    player_quality_debt_max: Math.max(...debtValues),
    player_quality_debt_p95: [...debtValues].sort((left, right) => left - right)[Math.floor((debtValues.length - 1) * 0.95)],
  }
}
