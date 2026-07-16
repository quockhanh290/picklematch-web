// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna } from '../state.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { SessionLiveMatchRow, SessionState, SuggestionAlternative } from '../types.ts'

export type RollingHorizonDiagnostics = {
  candidate_count: number
  completion_orders: number
  horizon_events: number
  selected_score: number
  selected_worst_path_score: number
  paths_without_future_match: number
}

export type RollingHorizonChoice = {
  alternative: SuggestionAlternative
  diagnostics: RollingHorizonDiagnostics
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

function playerIds(alternative: SuggestionAlternative) {
  const match = alternative.matches[0]
  return match ? [...match.team_a, ...match.team_b] : []
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

function matchQualityCost(alternative: SuggestionAlternative, state: SessionState) {
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
  return inter * 7
    + intra * 7
    + pvnaOver * 80
    + intraOver * 25
    + partnerRepeats * 35
    + opponentRepeats * 4
}

function fairnessDebtCost(state: SessionState) {
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
  return spread * 30
    + Math.max(...debts) * 20
    + debts.reduce((sum, debt) => sum + debt * debt, 0) * 3
    + restRisk * 80
    + longPlayStreak * 8
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
  let best: (RollingHorizonChoice & { score: number }) | null = null

  for (const candidate of candidates) {
    const candidateMatch = asLiveMatch(candidate, options.state, 'rolling-horizon-candidate')
    if (!candidateMatch) continue
    const candidateIds = playerIds(candidate)
    const pathScores: number[] = []
    let pathsWithoutFutureMatch = 0

    for (const order of orders) {
      let simState = options.projectMatch(options.state, candidateMatch)
      const simBusy = new Set([...options.baseBusyIds, ...candidateIds])
      let pathScore = matchQualityCost(candidate, options.state) + fairnessDebtCost(simState)

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
        pathScore += matchQualityCost(future, simState)
        const futureMatch = asLiveMatch(future, simState, `rolling-horizon-future-${pathScores.length}`)
        if (!futureMatch) break
        simState = options.projectMatch(simState, futureMatch)
        for (const playerId of playerIds(future)) simBusy.add(playerId)
        pathScore += fairnessDebtCost(simState)
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
          selected_score: score,
          selected_worst_path_score: worst,
          paths_without_future_match: pathsWithoutFutureMatch,
        },
      }
    }
  }

  return best ? { alternative: best.alternative, diagnostics: best.diagnostics } : null
}
