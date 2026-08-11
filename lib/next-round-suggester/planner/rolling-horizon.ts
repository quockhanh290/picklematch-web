// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna } from '../state.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { SessionLiveMatchRow, SessionState, SuggestionAlternative } from '../types.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import {
  filterRollingInvariantAlternatives,
  getActiveRollingInvariantTarget,
  // @ts-ignore Node's strip-only test runner needs the local .ts extension.
} from './rolling-invariants.ts'

export type RollingHorizonDiagnostics = {
  candidate_count: number
  frontier_candidate_count: number
  evaluated_candidate_count: number
  completion_orders: number
  horizon_events: number
  future_search_calls: number
  future_cache_hits: number
  budget_exhausted: boolean
  elapsed_ms: number
  selected_candidate_index: number
  selected_immediate_quality_cost: number
  selected_projected_fairness_cost: number
  selected_flexibility_cost: number
  selected_score: number
  selected_worst_path_score: number
  paths_without_future_match: number
  best_rejected_candidate_index: number | null
  best_rejected_score: number | null
  best_rejected_delta: number | null
  best_rejected_worst_path_score: number | null
}

export type RollingHorizonChoice = {
  alternative: SuggestionAlternative
  diagnostics: RollingHorizonDiagnostics
}

export type RollingPlanPlayerTarget = {
  matches: number
  rests: number
  quality_debt: number
  partner_diversity: number
  opponent_diversity: number
  partner_repeat_exposure: number
  opponent_repeat_exposure: number
  max_consecutive_rest: number
  max_consecutive_play: number
}

export type RollingPlanCheckpoint = {
  progress_ratio: number
  completed_plan_rounds: number
  target_total_appearances: number
  players: Record<string, RollingPlanPlayerTarget>
}

export type RollingPlanTarget = {
  plan_version_id?: string | null
  target_matches_by_player: Record<string, number>
  preferred_team_gap?: number | null
  preferred_intra_team_gap?: number | null
  players?: Record<string, RollingPlanPlayerTarget>
  checkpoints?: RollingPlanCheckpoint[]
}

type FutureSuggestion = (options: {
  state: SessionState
  busyIds: Set<string>
  maxRuntimeMs: number
}) => SuggestionAlternative | null

type ProjectMatch = (
  state: SessionState,
  match: SessionLiveMatchRow,
) => SessionState

const NO_FEASIBLE_FUTURE_PENALTY = 5_000
const DEFAULT_HORIZON_EVENTS = 2
const FLEXIBILITY_CONSUMPTION_WEIGHT = 1

function playerIds(alternative: SuggestionAlternative) {
  const match = alternative.matches[0]
  return match ? [...match.team_a, ...match.team_b] : []
}

type CandidateFrontierMetrics = {
  teamGap: number
  intraGap: number
  partnerRepeats: number
  opponentRepeats: number
  projectedFairnessCost: number
}

function candidateFrontierMetrics(
  alternative: SuggestionAlternative,
  state: SessionState,
  projectedFairnessCost: number,
): CandidateFrontierMetrics {
  const match = alternative.matches[0]
  if (!match) {
    return {
      teamGap: Infinity,
      intraGap: Infinity,
      partnerRepeats: Infinity,
      opponentRepeats: Infinity,
      projectedFairnessCost,
    }
  }
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  const teamGap = Math.abs(
    pvna(match.team_a[0]) + pvna(match.team_a[1])
      - pvna(match.team_b[0]) - pvna(match.team_b[1]),
  )
  const intraGap = Math.max(
    Math.abs(pvna(match.team_a[0]) - pvna(match.team_a[1])),
    Math.abs(pvna(match.team_b[0]) - pvna(match.team_b[1])),
  )
  const partnerRepeats = (
    (state.players.get(match.team_a[0])?.partner_counts.get(match.team_a[1]) ?? 0)
    + (state.players.get(match.team_b[0])?.partner_counts.get(match.team_b[1]) ?? 0)
  )
  const opponentRepeats = match.team_a.reduce((total, playerA) => (
    total + match.team_b.reduce((subtotal, playerB) => (
      subtotal + (state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0)
    ), 0)
  ), 0)
  return { teamGap, intraGap, partnerRepeats, opponentRepeats, projectedFairnessCost }
}

function dominatesCandidate(
  left: CandidateFrontierMetrics,
  right: CandidateFrontierMetrics,
) {
  const dimensions: Array<[number, number]> = [
    [left.teamGap, right.teamGap],
    [left.intraGap, right.intraGap],
    [left.partnerRepeats, right.partnerRepeats],
    [left.opponentRepeats, right.opponentRepeats],
    [left.projectedFairnessCost, right.projectedFairnessCost],
  ]
  return dimensions.every(([leftValue, rightValue]) => leftValue <= rightValue + 1e-9)
    && dimensions.some(([leftValue, rightValue]) => leftValue < rightValue - 1e-9)
}

function staysWithinRollingQualityGuard(
  candidate: CandidateFrontierMetrics,
  reference: CandidateFrontierMetrics,
  pvnaTolerance: number,
) {
  const teamGapCap = reference.teamGap <= pvnaTolerance
    ? pvnaTolerance
    : reference.teamGap + 0.1
  const intraGapCap = Math.max(1, reference.intraGap + 0.25)
  return candidate.teamGap <= teamGapCap + 1e-9
    && candidate.intraGap <= intraGapCap + 1e-9
    && candidate.partnerRepeats <= reference.partnerRepeats + 1
    && candidate.opponentRepeats <= reference.opponentRepeats + 2
}

export function buildCandidateFlexibilityCosts(candidates: SuggestionAlternative[]) {
  const frequencies = new Map<string, number>()
  const candidatePlayers = candidates.map(candidate => new Set(playerIds(candidate)))
  for (const ids of candidatePlayers) for (const playerId of ids) {
    frequencies.set(playerId, (frequencies.get(playerId) ?? 0) + 1)
  }
  const candidateCount = Math.max(1, candidates.length)
  return new Map(candidates.map((candidate, index) => {
    const ids = candidatePlayers[index]
    const connectorCost = [...ids].reduce((sum, playerId) => {
      const frequency = (frequencies.get(playerId) ?? 0) / candidateCount
      return sum + frequency * frequency * FLEXIBILITY_CONSUMPTION_WEIGHT
    }, 0)
    return [candidate, connectorCost]
  }))
}

function asLiveMatch(
  alternative: SuggestionAlternative,
  state: SessionState,
  id: string,
): SessionLiveMatchRow | null {
  const match = alternative.matches[0]
  if (!match) return null
  return {
    id,
    session_id: state.session_id,
    sequence_no: 0,
    round_no: state.current_round,
    court_idx: 0,
    status: 'completed',
    team_a: match.team_a,
    team_b: match.team_b,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date(0).toISOString(),
    started_at: null,
    ended_at: new Date(0).toISOString(),
  }
}

function matchQualityCost(
  alternative: SuggestionAlternative,
  state: SessionState,
  planTarget?: RollingPlanTarget | null,
) {
  const match = alternative.matches[0]
  if (!match) return NO_FEASIBLE_FUTURE_PENALTY
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  const inter = Math.abs(
    pvna(match.team_a[0]) + pvna(match.team_a[1])
      - pvna(match.team_b[0]) - pvna(match.team_b[1]),
  )
  const intra = Math.max(
    Math.abs(pvna(match.team_a[0]) - pvna(match.team_a[1])),
    Math.abs(pvna(match.team_b[0]) - pvna(match.team_b[1])),
  )
  const partnerRepeats = (
    (state.players.get(match.team_a[0])?.partner_counts.get(match.team_a[1]) ?? 0)
    + (state.players.get(match.team_b[0])?.partner_counts.get(match.team_b[1]) ?? 0)
  )
  const opponentRepeats = match.team_a.reduce((total, playerA) => (
    total + match.team_b.reduce((subtotal, playerB) => (
      subtotal + (state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0)
    ), 0)
  ), 0)
  const pvnaOver = Math.max(0, inter - state.config.pvna_tolerance)
  const intraOver = Math.max(0, intra - 1)
  const planTeamGapOver = Math.max(0, inter - Number(planTarget?.preferred_team_gap ?? inter))
  const planIntraGapOver = Math.max(0, intra - Number(planTarget?.preferred_intra_team_gap ?? intra))
  return inter * 7
    + intra * 7
    + pvnaOver * 80
    + intraOver * 25
    + partnerRepeats * 35
    + opponentRepeats * 4
    + planTeamGapOver * 12
    + planIntraGapOver * 8
}

function qualityDebtByPlayer(state: SessionState) {
  const debt = new Map([...state.players.keys()].map(id => [id, 0]))
  const pvna = (id: string) => {
    const player = state.players.get(id)
    return player ? getEffectivePvna(player) : 0
  }
  for (const round of state.rounds) for (const match of round.matches) {
    const teamGap = Math.abs(
      pvna(match.team_a[0]) + pvna(match.team_a[1])
        - pvna(match.team_b[0]) - pvna(match.team_b[1]),
    )
    const intraA = Math.abs(pvna(match.team_a[0]) - pvna(match.team_a[1]))
    const intraB = Math.abs(pvna(match.team_b[0]) - pvna(match.team_b[1]))
    match.team_a.forEach(id => debt.set(
      id,
      (debt.get(id) ?? 0)
        + Math.max(0, teamGap - state.config.pvna_tolerance) * 2
        + Math.max(0, intraA - 1),
    ))
    match.team_b.forEach(id => debt.set(
      id,
      (debt.get(id) ?? 0)
        + Math.max(0, teamGap - state.config.pvna_tolerance) * 2
        + Math.max(0, intraB - 1),
    ))
  }
  return debt
}

function repeatExposure(counts: ReadonlyMap<string, number>) {
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
}

function finiteOr(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function fairnessDebtCost(state: SessionState, planTarget?: RollingPlanTarget | null) {
  const active = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
  if (active.length === 0) return 0
  const averageMatches = active.reduce((sum, player) => sum + player.matches_played, 0) / active.length
  const debts = active.map(player => Math.abs(player.matches_played - averageMatches))
  const matchCounts = active.map(player => player.matches_played)
  const spread = Math.max(...matchCounts) - Math.min(...matchCounts)
  const restRisk = active.filter(player => player.consecutive_rest >= 2).length
  const longPlayStreak = active.reduce(
    (sum, player) => sum + Math.max(0, player.consecutive_play - 2),
    0,
  )
  const planPlayers = getActiveRollingInvariantTarget(state, planTarget)?.players ?? null
  const qualityDebt = planPlayers ? qualityDebtByPlayer(state) : null
  const planDebt = planPlayers
    ? active.reduce((sum, player) => {
        const target = planPlayers[player.player_id]
        if (!target || !Number.isFinite(target.matches)) return sum
        const remaining = Math.max(0, target.matches - player.matches_played)
        const over = Math.max(0, player.matches_played - target.matches)
        const rests = Math.max(0, finiteOr(player.rounds_available, player.matches_played) - player.matches_played)
        const restOver = Math.max(0, rests - finiteOr(target.rests, rests))
        const currentQualityDebt = qualityDebt?.get(player.player_id) ?? 0
        const qualityOver = Math.max(0, currentQualityDebt - finiteOr(target.quality_debt, currentQualityDebt))
        const partnerRepeatExposure = repeatExposure(player.partner_counts)
        const partnerRepeatOver = Math.max(
          0,
          partnerRepeatExposure - finiteOr(target.partner_repeat_exposure, partnerRepeatExposure),
        )
        const opponentRepeatExposure = repeatExposure(player.opponent_counts)
        const opponentRepeatOver = Math.max(
          0,
          opponentRepeatExposure - finiteOr(target.opponent_repeat_exposure, opponentRepeatExposure),
        )
        const partnerDiversityDebt = Math.max(
          0,
          finiteOr(target.partner_diversity, player.partner_counts.size) - player.partner_counts.size,
        )
        const opponentDiversityDebt = Math.max(
          0,
          finiteOr(target.opponent_diversity, player.opponent_counts.size) - player.opponent_counts.size,
        )
        const restStreakOver = Math.max(
          0,
          player.consecutive_rest - finiteOr(target.max_consecutive_rest, player.consecutive_rest),
        )
        const playStreakOver = Math.max(
          0,
          player.consecutive_play - finiteOr(target.max_consecutive_play, player.consecutive_play),
        )
        return sum
          + remaining * remaining * 12
          + over * over * 120
          + restOver * restOver * 40
          + qualityOver * qualityOver * 30
          + partnerRepeatOver * 35
          + opponentRepeatOver * 4
          + partnerDiversityDebt * 3
          + opponentDiversityDebt
          + restStreakOver * 80
          + playStreakOver * 8
      }, 0)
    : 0
  return spread * 30
    + Math.max(...debts) * 20
    + debts.reduce((sum, debt) => sum + debt * debt, 0) * 3
    + restRisk * 80
    + longPlayStreak * 8
    + planDebt
}

function completionOrders(commitments: SessionLiveMatchRow[]) {
  const uniqueByCourt = new Map<number, SessionLiveMatchRow>()
  for (const commitment of commitments) {
    const courtIdx = Number(commitment.court_idx ?? -1)
    const current = uniqueByCourt.get(courtIdx)
    if (!current || Number(commitment.sequence_no ?? 0) > Number(current.sequence_no ?? 0)) {
      uniqueByCourt.set(courtIdx, commitment)
    }
  }
  const rows = [...uniqueByCourt.values()]
  if (rows.length <= 1) return rows.length === 1 ? [rows] : []
  const oldestFirst = [...rows].sort((left, right) => (
    Date.parse(left.started_at ?? left.suggested_at ?? '') - Date.parse(right.started_at ?? right.suggested_at ?? '')
    || Number(left.court_idx ?? 0) - Number(right.court_idx ?? 0)
  ))
  const candidates = rows.map(first => [
    first,
    ...oldestFirst.filter(row => row.id !== first.id),
  ])
  const seen = new Set<string>()
  return candidates.filter(order => {
    const key = order.map(row => row.id).join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function futureCacheKey(state: SessionState, busyIds: ReadonlySet<string>) {
  const countsKey = (counts: ReadonlyMap<string, number>) => [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => `${id}:${count}`)
    .join(',')
  const playerState = [...state.players.values()]
    .sort((left, right) => left.player_id.localeCompare(right.player_id))
    .map(player => [
      player.player_id,
      player.matches_played,
      player.consecutive_play,
      player.consecutive_rest,
      countsKey(player.partner_counts),
      countsKey(player.opponent_counts),
    ].join(':'))
    .join('|')
  const matchHistory = state.rounds
    .flatMap(round => round.matches.map(match => [
      ...match.team_a,
      ...match.team_b,
    ].sort().join(',')))
    .sort()
    .join('|')
  return `${[...busyIds].sort().join(',')}#${playerState}#${matchHistory}`
}

export function chooseRollingHorizonAlternative(options: {
  candidates: SuggestionAlternative[]
  state: SessionState
  baseBusyIds: ReadonlySet<string>
  liveCommitments: SessionLiveMatchRow[]
  budgetMs: number
  suggestFuture: FutureSuggestion
  projectMatch: ProjectMatch
  candidateLimit?: number
  qualityReference?: SuggestionAlternative | null
  horizonEvents?: number
  planTarget?: RollingPlanTarget | null
  now?: () => number
}): RollingHorizonChoice | null {
  const clock = options.now ?? (() => (
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  ))
  const startedAt = clock()
  const deadline = startedAt + Math.max(1, options.budgetMs)
  const rawCandidates = options.candidates.filter(candidate => candidate.matches.length > 0)
  const allCandidates = filterRollingInvariantAlternatives({
    alternatives: rawCandidates,
    state: options.state,
    planTarget: options.planTarget,
  })
  if (allCandidates.length === 0) return null
  if (allCandidates.length === 1 && rawCandidates.length > 1) {
    return {
      alternative: allCandidates[0],
      diagnostics: {
        candidate_count: rawCandidates.length,
        frontier_candidate_count: 1,
        evaluated_candidate_count: 1,
        completion_orders: 0,
        horizon_events: 0,
        future_search_calls: 0,
        future_cache_hits: 0,
        budget_exhausted: false,
        elapsed_ms: clock() - startedAt,
        selected_candidate_index: rawCandidates.indexOf(allCandidates[0]),
        selected_immediate_quality_cost: matchQualityCost(
          allCandidates[0],
          options.state,
          options.planTarget,
        ),
        selected_projected_fairness_cost: 0,
        selected_flexibility_cost: 0,
        selected_score: 0,
        selected_worst_path_score: 0,
        paths_without_future_match: 0,
        best_rejected_candidate_index: null,
        best_rejected_score: null,
        best_rejected_delta: null,
        best_rejected_worst_path_score: null,
      },
    }
  }
  if (allCandidates.length <= 1) return null
  const orders = completionOrders(options.liveCommitments)
  if (orders.length === 0) return null
  const preparedCandidates = allCandidates.map((alternative, candidateIndex) => {
    const candidateMatch = asLiveMatch(alternative, options.state, `rolling-horizon-frontier-${candidateIndex}`)
    const projectedState = candidateMatch
      ? options.projectMatch(options.state, candidateMatch)
      : options.state
    const projectedFairnessCost = fairnessDebtCost(projectedState, options.planTarget)
    const immediateQualityCost = matchQualityCost(alternative, options.state, options.planTarget)
    return {
      alternative,
      candidateIndex,
      immediateQualityCost,
      projectedFairnessCost,
      metrics: candidateFrontierMetrics(alternative, options.state, projectedFairnessCost),
    }
  })
  const referenceAlternative = options.qualityReference ?? allCandidates[0]
  const referenceMetrics = candidateFrontierMetrics(referenceAlternative, options.state, 0)
  const guardedCandidates = preparedCandidates.filter(candidate => (
    candidate.alternative === referenceAlternative
    || staysWithinRollingQualityGuard(
      candidate.metrics,
      referenceMetrics,
      options.state.config.pvna_tolerance,
    )
  ))
  const candidatesForFrontier = guardedCandidates.length > 0
    ? guardedCandidates
    : preparedCandidates
  const frontier = candidatesForFrontier.filter((candidate, candidateIndex) => (
    !candidatesForFrontier.some((other, otherIndex) => (
      candidateIndex !== otherIndex && dominatesCandidate(other.metrics, candidate.metrics)
    ))
  ))
  const candidateLimit = Math.max(
    1,
    Math.min(options.candidateLimit ?? allCandidates.length, allCandidates.length),
  )
  const ranked = [...frontier].sort((left, right) => (
    left.immediateQualityCost + left.projectedFairnessCost
      - (right.immediateQualityCost + right.projectedFairnessCost)
    || left.alternative.score - right.alternative.score
    || left.candidateIndex - right.candidateIndex
  ))
  const selected = new Map<number, typeof preparedCandidates[number]>()
  const addCandidate = (candidate: typeof preparedCandidates[number] | undefined) => {
    if (candidate && selected.size < candidateLimit) selected.set(candidate.candidateIndex, candidate)
  }
  const metricKeys: Array<keyof CandidateFrontierMetrics> = [
    'teamGap',
    'intraGap',
    'projectedFairnessCost',
    'partnerRepeats',
    'opponentRepeats',
  ]
  for (const key of metricKeys) {
    addCandidate([...frontier].sort((left, right) => (
      left.metrics[key] - right.metrics[key]
      || left.immediateQualityCost - right.immediateQualityCost
      || left.candidateIndex - right.candidateIndex
    ))[0])
  }
  ranked.forEach(addCandidate)
  if (selected.size < candidateLimit) {
    [...candidatesForFrontier]
      .sort((left, right) => (
        left.immediateQualityCost + left.projectedFairnessCost
          - (right.immediateQualityCost + right.projectedFairnessCost)
        || left.candidateIndex - right.candidateIndex
      ))
      .forEach(addCandidate)
  }
  const candidates = [...selected.values()]
  const horizonEvents = Math.max(1, Math.min(
    options.horizonEvents ?? DEFAULT_HORIZON_EVENTS,
    options.liveCommitments.length,
  ))
  const pathCount = Math.max(1, candidates.length * orders.length * horizonEvents)
  const perStepBudgetMs = Math.max(12, Math.floor(options.budgetMs / pathCount))
  const flexibilityCosts = buildCandidateFlexibilityCosts(
    candidates.map(candidate => candidate.alternative),
  )
  const futureCache = new Map<string, SuggestionAlternative | null>()
  let evaluatedCandidateCount = 0
  let futureSearchCalls = 0
  let futureCacheHits = 0
  let budgetExhausted = false
  const evaluated: Array<{
    alternative: SuggestionAlternative
    candidateIndex: number
    immediateQualityCost: number
    projectedFairnessCost: number
    flexibilityCost: number
    score: number
    worst: number
  }> = []
  let best: (RollingHorizonChoice & { score: number }) | null = null

  for (const prepared of candidates) {
    const { alternative: candidate, candidateIndex } = prepared
    if (clock() >= deadline && evaluatedCandidateCount > 0) {
      budgetExhausted = true
      break
    }
    const candidateMatch = asLiveMatch(candidate, options.state, 'rolling-horizon-candidate')
    if (!candidateMatch) continue
    evaluatedCandidateCount += 1
    const candidateIds = playerIds(candidate)
    const flexibilityCost = flexibilityCosts.get(candidate) ?? 0
    const immediateQualityCost = prepared.immediateQualityCost
    const projectedCandidateState = options.projectMatch(options.state, candidateMatch)
    const projectedFairnessCost = prepared.projectedFairnessCost
    const pathScores: number[] = []
    let pathsWithoutFutureMatch = 0
    let truncatedPaths = false

    for (const order of orders) {
      if (clock() >= deadline && pathScores.length > 0) {
        budgetExhausted = true
        truncatedPaths = true
        break
      }
      let simState = projectedCandidateState
      const simBusy = new Set([...options.baseBusyIds, ...candidateIds])
      let pathScore = immediateQualityCost
        + flexibilityCost
        + projectedFairnessCost

      for (const completion of order.slice(0, horizonEvents)) {
        simState = options.projectMatch(simState, completion)
        for (const playerId of [...completion.team_a, ...completion.team_b]) simBusy.delete(playerId)
        const playableCount = [...simState.players.values()].filter(player => (
          player.checked_out_at === null
          && !player.opted_rest
          && !simBusy.has(player.player_id)
        )).length
        const remainingMs = Math.floor(deadline - clock())
        if (remainingMs <= 0) {
          budgetExhausted = true
          break
        }
        const cacheKey = futureCacheKey(simState, simBusy)
        let future = futureCache.get(cacheKey)
        if (futureCache.has(cacheKey)) {
          futureCacheHits += 1
        } else {
          futureSearchCalls += 1
          future = options.suggestFuture({
            state: simState,
            busyIds: new Set(simBusy),
            maxRuntimeMs: Math.max(4, Math.min(perStepBudgetMs, remainingMs)),
          })
          futureCache.set(cacheKey, future)
        }
        if (!future) {
          if (playableCount >= 4) {
            pathScore += NO_FEASIBLE_FUTURE_PENALTY
            pathsWithoutFutureMatch += 1
          }
          break
        }
        pathScore += matchQualityCost(future, simState, options.planTarget)
        const futureMatch = asLiveMatch(future, simState, `rolling-horizon-future-${pathScores.length}`)
        if (!futureMatch) break
        simState = options.projectMatch(simState, futureMatch)
        for (const playerId of playerIds(future)) simBusy.add(playerId)
        pathScore += fairnessDebtCost(simState, options.planTarget)
      }
      pathScores.push(pathScore)
    }

    if (pathScores.length === 0) continue
    // A candidate the clock interrupted was measured over fewer futures than the others, and the score
    // is average + worst/2 — the worst of two futures is milder than the worst of eight, so scoring a
    // truncated candidate against complete ones lets the LESS examined one win. Drop it instead, unless
    // nothing has been fully scored, in which case a partial answer still beats none.
    if (truncatedPaths && evaluated.length > 0) break

    const average = pathScores.reduce((sum, score) => sum + score, 0) / pathScores.length
    const worst = Math.max(...pathScores)
    const score = average + worst * 0.5
    evaluated.push({
      alternative: candidate,
      candidateIndex,
      immediateQualityCost,
      projectedFairnessCost,
      flexibilityCost,
      score,
      worst,
    })
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && candidate.score < best.alternative.score)) {
      best = {
        alternative: candidate,
        score,
        diagnostics: {
          candidate_count: allCandidates.length,
          frontier_candidate_count: frontier.length,
          evaluated_candidate_count: evaluatedCandidateCount,
          completion_orders: orders.length,
          horizon_events: horizonEvents,
          future_search_calls: futureSearchCalls,
          future_cache_hits: futureCacheHits,
          budget_exhausted: budgetExhausted,
          elapsed_ms: clock() - startedAt,
          selected_candidate_index: candidateIndex,
          selected_immediate_quality_cost: immediateQualityCost,
          selected_projected_fairness_cost: projectedFairnessCost,
          selected_flexibility_cost: flexibilityCost,
          selected_score: score,
          selected_worst_path_score: worst,
          paths_without_future_match: pathsWithoutFutureMatch,
          best_rejected_candidate_index: null,
          best_rejected_score: null,
          best_rejected_delta: null,
          best_rejected_worst_path_score: null,
        },
      }
    }
  }

  if (!best) return null
  const selectedBest = best
  selectedBest.diagnostics.evaluated_candidate_count = evaluatedCandidateCount
  selectedBest.diagnostics.future_search_calls = futureSearchCalls
  selectedBest.diagnostics.future_cache_hits = futureCacheHits
  selectedBest.diagnostics.budget_exhausted = budgetExhausted
  selectedBest.diagnostics.elapsed_ms = clock() - startedAt
  const rejected = evaluated
    .filter(item => item.alternative !== selectedBest.alternative)
    .sort((left, right) => left.score - right.score)[0]
  if (rejected) {
    selectedBest.diagnostics.best_rejected_candidate_index = rejected.candidateIndex
    selectedBest.diagnostics.best_rejected_score = rejected.score
    selectedBest.diagnostics.best_rejected_delta = rejected.score - selectedBest.score
    selectedBest.diagnostics.best_rejected_worst_path_score = rejected.worst
  }
  return { alternative: selectedBest.alternative, diagnostics: selectedBest.diagnostics }
}
