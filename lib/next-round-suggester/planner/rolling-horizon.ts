// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna } from '../state.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { SessionLiveMatchRow, SessionState, SuggestionAlternative } from '../types.ts'

export type RollingHorizonDiagnostics = {
  candidate_count: number
  completion_orders: number
  horizon_events: number
  selected_flexibility_cost: number
  selected_score: number
  selected_worst_path_score: number
  paths_without_future_match: number
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

function activePlanPlayerTargets(
  state: SessionState,
  planTarget?: RollingPlanTarget | null,
): Record<string, Partial<RollingPlanPlayerTarget> & { matches: number }> | null {
  if (!planTarget) return null
  const currentAppearances = Object.keys(planTarget.target_matches_by_player)
    .reduce((sum, playerId) => sum + (state.players.get(playerId)?.matches_played ?? 0), 0)
  const checkpoint = planTarget.checkpoints
    ?.find(item => item.target_total_appearances > currentAppearances)
  return checkpoint?.players ?? planTarget.players ?? Object.fromEntries(
    Object.entries(planTarget.target_matches_by_player).map(([id, matches]) => [id, { matches }]),
  )
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
  const planPlayers = activePlanPlayerTargets(state, planTarget)
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
  const courtFirst = [...rows].sort((left, right) => Number(left.court_idx ?? 0) - Number(right.court_idx ?? 0))
  const candidates = [oldestFirst, [...oldestFirst].reverse(), courtFirst]
  const seen = new Set<string>()
  return candidates.filter(order => {
    const key = order.map(row => row.id).join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function chooseRollingHorizonAlternative(options: {
  candidates: SuggestionAlternative[]
  state: SessionState
  baseBusyIds: ReadonlySet<string>
  liveCommitments: SessionLiveMatchRow[]
  budgetMs: number
  suggestFuture: FutureSuggestion
  projectMatch: ProjectMatch
  horizonEvents?: number
  planTarget?: RollingPlanTarget | null
}): RollingHorizonChoice | null {
  const candidates = options.candidates.filter(candidate => candidate.matches.length > 0)
  if (candidates.length <= 1) return null
  const orders = completionOrders(options.liveCommitments)
  if (orders.length === 0) return null
  const horizonEvents = Math.max(1, Math.min(
    options.horizonEvents ?? DEFAULT_HORIZON_EVENTS,
    options.liveCommitments.length,
  ))
  const pathCount = Math.max(1, candidates.length * orders.length * horizonEvents)
  const perStepBudgetMs = Math.max(12, Math.floor(options.budgetMs / pathCount))
  const flexibilityCosts = buildCandidateFlexibilityCosts(candidates)
  let best: (RollingHorizonChoice & { score: number }) | null = null

  for (const candidate of candidates) {
    const candidateMatch = asLiveMatch(candidate, options.state, 'rolling-horizon-candidate')
    if (!candidateMatch) continue
    const candidateIds = playerIds(candidate)
    const flexibilityCost = flexibilityCosts.get(candidate) ?? 0
    const pathScores: number[] = []
    let pathsWithoutFutureMatch = 0

    for (const order of orders) {
      let simState = options.projectMatch(options.state, candidateMatch)
      const simBusy = new Set([...options.baseBusyIds, ...candidateIds])
      let pathScore = matchQualityCost(candidate, options.state, options.planTarget)
        + flexibilityCost
        + fairnessDebtCost(simState, options.planTarget)

      for (const completion of order.slice(0, horizonEvents)) {
        simState = options.projectMatch(simState, completion)
        for (const playerId of [...completion.team_a, ...completion.team_b]) simBusy.delete(playerId)
        const playableCount = [...simState.players.values()].filter(player => (
          player.checked_out_at === null
          && !player.opted_rest
          && !simBusy.has(player.player_id)
        )).length
        const future = options.suggestFuture({
          state: simState,
          busyIds: new Set(simBusy),
          maxRuntimeMs: perStepBudgetMs,
        })
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

    const average = pathScores.reduce((sum, score) => sum + score, 0) / pathScores.length
    const worst = Math.max(...pathScores)
    const score = average + worst * 0.5
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && candidate.score < best.alternative.score)) {
      best = {
        alternative: candidate,
        score,
        diagnostics: {
          candidate_count: candidates.length,
          completion_orders: orders.length,
          horizon_events: horizonEvents,
          selected_flexibility_cost: flexibilityCost,
          selected_score: score,
          selected_worst_path_score: worst,
          paths_without_future_match: pathsWithoutFutureMatch,
        },
      }
    }
  }

  return best ? { alternative: best.alternative, diagnostics: best.diagnostics } : null
}
