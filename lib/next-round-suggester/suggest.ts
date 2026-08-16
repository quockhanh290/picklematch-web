import {
  bestPartitioning,
  createPartitioningRuntimeCache,
  type PartitioningDiagnostic,
  type PartitioningRuntimeCache,
  // @ts-ignore Node's strip-only test runner needs the local .ts extension.
} from './pair.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getMatchBalanceFromAvailabilityMetrics, getPresentPlayers, pickPlayers, sortPlayersForStrategy } from './select.ts'
import type {
  Match,
  MatchStats,
  PlayerSessionState,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
  SuggestionTradeoff,
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
} from './types.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeDynamicThresholds, getAverageMatches, Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getBenchDepth, getEffectivePvna, getSessionPhase } from './state.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeAvailabilityMetrics, computeProjectedOpponentRepeatBurden, computeProjectedPartnerRepeatBurden, type AvailabilityMetrics } from './fairness/metrics.ts'
import {
  MAX_PROJECTED_OPPONENT_PAIR_COUNT,
  MAX_PROJECTED_PARTNER_PAIR_COUNT,
  MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER,
  MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER,
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  getRecentRepeatCost,
  getProjectedRepeatSummary,
  // @ts-ignore Node's strip-only test runner needs the local .ts extension.
} from './score.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { findMinCostFoursome } from './forced-tradeoff.ts'
import {
  createSearchBudget,
  searchBudgetExhausted,
  searchBudgetRemaining,
  searchBudgetSpent,
  spendSearchBudget,
  subSearchBudget,
  type SearchBudget,
  // @ts-ignore Deno edge-function bundling needs the local .ts extension.
} from './search-budget.ts'

export type EngineInstrumentEvent = {
  event: 'stage_resolved' | 'rescue' | 'repair' | 'forced_pass' | 'rolling_horizon'
  detail: string
  court_count?: number
  available?: number
}

export type SuggestNextRoundOptions = {
  tier_overrides?: Record<string, Tier>
  diagnostics?: SuggestionDiagnostic
  partition_cache?: boolean
  max_alternatives?: number
  // How much SEARCH the caller is willing to pay for, counted in partition evaluations. It used to be a
  // duration, which made the lineup depend on how loaded the machine was: the same bench re-requested
  // gave different teams, and no A/B measurement on the engine could be repeated.
  search_budget?: SearchBudget
  exhaustive_fallback?: boolean
  forced_required_player_ids?: string[]
  availability_metrics?: AvailabilityMetrics
  preview_seed?: string
  active_courts?: number      // override court count for this suggestion
  fixed_courts?: Match[]      // courts already assigned; suggest remaining courts only
  // What is left of the rescue allowance shared across all courts in one buildSuggestedMatchPayloads
  // call. Prevents each court from resetting the rescue work and stacking it up to the worker limit.
  // Shared object, not a number: the caller hands the same budget to every court and it drains as the
  // batch progresses.
  force_search_budget?: SearchBudget
  onInstrumentEvent?: (event: EngineInstrumentEvent) => void
}

export type ExhaustiveFallbackDiagnostic = {
  ran: boolean
  timedOut: boolean
  eligibleCount: number
  combinationsEvaluated: number
  bestPvnaDiff: number | null
  bestHasTradeoffs: boolean
  spentUnits: number
  deterministicFastPath?: boolean
  _seenAfterStage1?: number
  _altsAfterStage1?: number
  _combosAfterStage1?: number
  _combosAfterStage2?: number
  _combosAfterStage3?: number
  _alternatives?: { teamA: unknown; teamB: unknown; tradeoffs: unknown; warnings: unknown }[]
  _eligiblePvnas?: string[]
}

export type SuggestNextMatchOptions = SuggestNextRoundOptions & {
  busy_player_ids?: Iterable<string>
  court_idx?: number
  allow_recent_group_rematch?: boolean
  _exhaustiveDiag?: ExhaustiveFallbackDiagnostic
}

export type SuggestionDiagnostic = {
  strategies: Record<string, {
    candidates: number
    evaluated: number
    accepted: number
    skipped_seen: number
    skipped_required: number
    partition_iterations: number
    relaxed_partitions: number
    failed_partitions: number
  }>
  partition_count: number
  max_iterations: number
  exhaustive: boolean
  timed_out?: boolean
  budget_units?: number
  spent_units?: number
  // Trạng thái tại ĐIỂM QUYẾT ĐỊNH. Thêm sau khi một kèo thật trả về 0 sân dù 32 người rảnh, và dựng lại
  // từ dump với mọi đầu vào trích được đều lấp 6/6 — tức thứ quyết định KHÔNG nằm trong dump. Bốn con số
  // dưới đây là bốn thứ duy nhất còn thiếu để lần sau tự khai.
  slots?: number
  eligible_count?: number
  must_play_over_capacity?: boolean
  required_player_ids?: string[]
}

function combinationKey(players: PlayerSessionState[]): string {
  return players.map((player) => player.player_id).sort().join(':')
}

type Candidate = {
  indexes: number[]
  players: PlayerSessionState[]
  priority: number
  key: string
}

class CandidateHeap {
  private items: Candidate[] = []

  get length() {
    return this.items.length
  }

  push(candidate: Candidate) {
    this.items.push(candidate)
    this.bubbleUp(this.items.length - 1)
  }

  pop(): Candidate | null {
    if (this.items.length === 0) return null

    const result = this.items[0]
    const last = this.items.pop()
    if (last && this.items.length > 0) {
      this.items[0] = last
      this.sinkDown(0)
    }

    return result
  }

  private compare(a: Candidate, b: Candidate) {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.key.localeCompare(b.key)
  }

  private bubbleUp(index: number) {
    let current = index

    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (this.compare(this.items[current], this.items[parent]) >= 0) break

      const temp = this.items[current]
      this.items[current] = this.items[parent]
      this.items[parent] = temp
      current = parent
    }
  }

  private sinkDown(index: number) {
    let current = index

    while (true) {
      const left = current * 2 + 1
      const right = left + 1
      let smallest = current

      if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left
      }

      if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) {
        smallest = right
      }

      if (smallest === current) break

      const temp = this.items[current]
      this.items[current] = this.items[smallest]
      this.items[smallest] = temp
      current = smallest
    }
  }
}

function makeCandidate(players: PlayerSessionState[], indexes: number[]): Candidate {
  const selected = indexes.map((index) => players[index])

  return {
    indexes,
    players: selected,
    priority: indexes.reduce((sum, index) => sum + index, 0),
    key: combinationKey(selected),
  }
}

function getPriorityCandidates(
  players: PlayerSessionState[],
  size: number,
  limit: number,
): Candidate[] {
  if (size > players.length || size <= 0 || limit <= 0) return []

  const initialIndexes = Array.from({ length: size }, (_, index) => index)
  const heap = new CandidateHeap()
  const queued = new Set<string>()
  const result: Candidate[] = []

  heap.push(makeCandidate(players, initialIndexes))
  queued.add(initialIndexes.join(':'))

  while (heap.length > 0 && result.length < limit) {
    const candidate = heap.pop()
    if (!candidate) break

    result.push(candidate)

    for (let position = size - 1; position >= 0; position -= 1) {
      const nextIndexes = [...candidate.indexes]
      const nextValue = nextIndexes[position] + 1
      const upperBound = position === size - 1 ? players.length : nextIndexes[position + 1]
      if (nextValue >= upperBound) continue

      nextIndexes[position] = nextValue
      const key = nextIndexes.join(':')
      if (queued.has(key)) continue

      heap.push(makeCandidate(players, nextIndexes))
      queued.add(key)
    }
  }

  return result
}

function getAllCombinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []

  function walk(start: number, selected: T[]) {
    if (selected.length === size) {
      result.push([...selected])
      return
    }

    for (let index = start; index < items.length; index += 1) {
      selected.push(items[index])
      walk(index + 1, selected)
      selected.pop()
    }
  }

  walk(0, [])
  return result
}

function emptyStats(): MatchStats {
  return {
    pvna_diff: 0,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
    consecutive_play_penalty: 0,
  }
}

const MAX_CANDIDATES_PER_STRATEGY = 60
const MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY = 8
// One unit = one partition evaluated. The scale was fixed by measuring the old ms constants against
// real corpus sessions (~100 evaluations per ms), so a budget that used to read 1000ms reads 100k units.
export const SEARCH_UNITS_PER_LEGACY_MS = 100
export const DEFAULT_SUGGEST_NEXT_ROUND_SEARCH_UNITS = 1000 * SEARCH_UNITS_PER_LEGACY_MS
// Held back from the regular search so the forced/exhaustive rescue pass can always run.
const RESCUE_BUDGET_RESERVE_UNITS = 200 * SEARCH_UNITS_PER_LEGACY_MS
const MIN_REGULAR_SEARCH_UNITS = 50 * SEARCH_UNITS_PER_LEGACY_MS
const LARGE_BUDGET_REGULAR_SEARCH_UNITS = 100 * SEARCH_UNITS_PER_LEGACY_MS
const DEADLINE_RESCUE_CANDIDATE_SEARCH_UNITS = 400 * SEARCH_UNITS_PER_LEGACY_MS
const MAX_EXHAUSTIVE_FALLBACK_SEARCH_UNITS = 2500 * SEARCH_UNITS_PER_LEGACY_MS
const MIN_EXHAUSTIVE_FALLBACK_SEARCH_UNITS = 100 * SEARCH_UNITS_PER_LEGACY_MS
const BURDEN_TIE_BREAK_SCORE_WINDOW = 3
const PROJECTED_REPEAT_BURDEN_THRESHOLD = 3
const PVNA_TRADEOFF_WEIGHT = 10
const REPEAT_TRADEOFF_WEIGHT = 15
const INTRA_TEAM_GAP_TRADEOFF_WEIGHT = 8

export function detectGenderConflicts(players: PlayerSessionState[]): string[] {
  const counts = {
    M: players.filter((player) => player.gender === 'M').length,
    F: players.filter((player) => player.gender === 'F').length,
  }
  const warnings: string[] = []
  const wantFemalePartner = players.filter((player) => player.partner_gender_pref === 'F').length
  const wantMalePartner = players.filter((player) => player.partner_gender_pref === 'M').length

  if (wantFemalePartner > counts.F * 2) {
    warnings.push(`${wantFemalePartner} người muốn partner nữ nhưng chỉ có ${counts.F} nữ`)
  }

  if (wantMalePartner > counts.M * 2) {
    warnings.push(`${wantMalePartner} người muốn partner nam nhưng chỉ có ${counts.M} nam`)
  }

  return warnings
}

function getRepeatCapTradeoff(matches: Match[], state: SessionState): SuggestionTradeoff | null {
  let totalOverBy = 0
  let affectedPairs = 0
  let affectedPlayers = 0

  for (const match of matches) {
    const summary = getProjectedRepeatSummary(match.team_a, match.team_b, state)
    totalOverBy += summary.pair_over_by + summary.player_over_by
    affectedPairs += summary.affected_pairs
    affectedPlayers += summary.affected_players
  }

  if (totalOverBy <= 0) return null
  return {
    type: 'repeat_cap_relaxed',
    severity: totalOverBy * REPEAT_TRADEOFF_WEIGHT,
    over_by: totalOverBy,
    affected_pairs: affectedPairs,
    affected_players: affectedPlayers,
  }
}

function hasRepeatCapReached(matches: Match[], state: SessionState): boolean {
  for (const match of matches) {
    const summary = getProjectedRepeatSummary(match.team_a, match.team_b, state)
    if (summary.max_partner_pair_count >= MAX_PROJECTED_PARTNER_PAIR_COUNT) return true
    if (summary.max_opponent_pair_count >= MAX_PROJECTED_OPPONENT_PAIR_COUNT) return true
    if (summary.max_repeated_partners_per_player >= MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER) return true
    if (summary.max_repeated_opponents_per_player >= MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER) return true
  }

  return false
}

function getPvnaTradeoff(
  matches: Match[],
  state: SessionState,
  relaxationLevel?: 'soft' | 'open',
): SuggestionTradeoff | null {
  let maxOverBy = 0

  for (const match of matches) {
    const overBy = Math.max(0, (match.stats?.pvna_diff ?? 0) - state.config.pvna_tolerance)
    maxOverBy = Math.max(maxOverBy, overBy)
  }

  if (maxOverBy <= 0) return null
  return {
    type: 'pvna_tolerance_relaxed',
    severity: maxOverBy * PVNA_TRADEOFF_WEIGHT,
    over_by: maxOverBy,
    relaxation_level: relaxationLevel,
  }
}

function getTeamPvnaGap(team: [string, string], state: SessionState): number {
  const first = state.players.get(team[0])
  const second = state.players.get(team[1])
  if (!first || !second) return Number.POSITIVE_INFINITY
  return Math.abs(getEffectivePvna(first) - getEffectivePvna(second))
}

function getIntraTeamGapTradeoff(matches: Match[], state: SessionState): SuggestionTradeoff | null {
  let maxOverBy = 0
  let affectedPairs = 0

  for (const match of matches) {
    for (const team of [match.team_a, match.team_b]) {
      const overBy = Math.max(0, getTeamPvnaGap(team, state) - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
      if (overBy > 0) {
        affectedPairs += 1
        maxOverBy = Math.max(maxOverBy, overBy)
      }
    }
  }

  if (maxOverBy <= 0) return null
  return {
    type: 'intra_team_gap_relaxed',
    severity: maxOverBy * INTRA_TEAM_GAP_TRADEOFF_WEIGHT,
    over_by: maxOverBy,
    affected_pairs: affectedPairs,
    affected_players: affectedPairs * 2,
  }
}

function buildTradeoffs(partition: { matches: Match[]; pvna_relaxation_level?: 'soft' | 'open' }, state: SessionState): SuggestionTradeoff[] {
  return [
    getPvnaTradeoff(partition.matches, state, partition.pvna_relaxation_level),
    getIntraTeamGapTradeoff(partition.matches, state),
    getRepeatCapTradeoff(partition.matches, state),
  ].filter((tradeoff): tradeoff is SuggestionTradeoff => Boolean(tradeoff))
}

function getTradeoffScore(alternative: SuggestionAlternative) {
  return alternative.tradeoffs?.reduce((sum, tradeoff) => sum + tradeoff.severity, 0) ?? 0
}

function getTradeoffCount(alternative: SuggestionAlternative) {
  return alternative.tradeoffs?.length ?? 0
}

function getAlternativeRecentRepeatCost(alternative: SuggestionAlternative, state: SessionState) {
  return alternative.matches.reduce((sum, match) => {
    const cost = getRecentRepeatCost(match.team_a, match.team_b, state)
    return {
      total: sum.total + cost.total,
      partner: sum.partner + cost.partner,
      opponent: sum.opponent + cost.opponent,
      overlap2: sum.overlap2 + cost.overlap2,
      overlap3: sum.overlap3 + cost.overlap3,
      exact4: sum.exact4 + cost.exact4,
    }
  }, { total: 0, partner: 0, opponent: 0, overlap2: 0, overlap3: 0, exact4: 0 })
}

function compareRecentRepeatCost(a: SuggestionAlternative, b: SuggestionAlternative, state: SessionState) {
  const costA = getAlternativeRecentRepeatCost(a, state)
  const costB = getAlternativeRecentRepeatCost(b, state)
  if (costA.partner !== costB.partner) return costA.partner - costB.partner
  if (costA.total !== costB.total) return costA.total - costB.total
  if (costA.overlap3 !== costB.overlap3) return costA.overlap3 - costB.overlap3
  if (costA.exact4 !== costB.exact4) return costA.exact4 - costB.exact4
  if (costA.opponent !== costB.opponent) return costA.opponent - costB.opponent
  if (costA.overlap2 !== costB.overlap2) return costA.overlap2 - costB.overlap2
  return 0
}

function makeAlternative(
  selected: PlayerSessionState[],
  allPresent: PlayerSessionState[],
  state: SessionState,
  warnings: string[],
  diagnostics?: (diagnostic: PartitioningDiagnostic) => void,
  partitioningCache?: PartitioningRuntimeCache,
  allowRelaxedTolerance = true,
  allowRepeatOverflow = true,
  allowRecentGroupRematch = false,
  seedSalt?: string,
  thresholds?: { mustRestAt?: number; partnerRepeatCap?: number; opponentRepeatCap?: number },
  budget?: SearchBudget,
  deadlineRescue = false,
): SuggestionAlternative | null {
  const partition = bestPartitioning(selected, state, {
    diagnostics,
    cache: partitioningCache,
    seedSalt,
    allowRelaxedTolerance,
    allowRepeatOverflow,
    allowRecentGroupRematch,
    mustRestAt: thresholds?.mustRestAt,
    partnerRepeatCap: thresholds?.partnerRepeatCap,
    opponentRepeatCap: thresholds?.opponentRepeatCap,
    budget,
    deadlineRescue,
  })
  if (!partition) return null
  const tradeoffs = buildTradeoffs(partition, state)
  const repeatCapReached = hasRepeatCapReached(partition.matches, state)
  const alternativeWarnings = [...new Set([
    ...warnings,
    ...(partition.relaxed_tolerance ? ['PVNA_TOLERANCE_RELAXED'] : []),
    ...(partition.pvna_relaxation_level === 'open' ? ['PVNA_TOLERANCE_OPEN'] : []),
    ...(partition.repeat_overflow ? ['REPEAT_CAP_RELAXED'] : []),
    ...(partition.intra_team_gap_relaxed ? ['INTRA_TEAM_GAP_RELAXED'] : []),
    ...(repeatCapReached && !partition.repeat_overflow ? ['REPEAT_CAP_REACHED'] : []),
  ])]

  const selectedIds = new Set(selected.map((player) => player.player_id))
  const resting = allPresent
    .filter((player) => !selectedIds.has(player.player_id) && !player.opted_rest)
    .map((player) => player.player_id)
    .sort()

  return {
    matches: partition.matches,
    resting,
    score: partition.score,
    warnings: alternativeWarnings,
    tradeoffs,
    approval_required: tradeoffs.length > 0,
    stats: partition.stats,
    iterations: partition.iterations,
  }
}

export function suggestNextRound(
  state: SessionState,
  options: SuggestNextRoundOptions = {},
): SuggestionResult {
  const presentPlayers = getPresentPlayers(state)
  const fixedCourts = options.fixed_courts ?? []
  const busyFromFixed = new Set(fixedCourts.flatMap((m) => [...m.team_a, ...m.team_b]))
  const eligiblePlayers = presentPlayers.filter(
    (player) => !player.opted_rest && !busyFromFixed.has(player.player_id),
  )
  const courtsToSuggest = Math.max(0, (options.active_courts ?? state.config.courts) - fixedCourts.length)
  const courtCapacity = Math.max(1, courtsToSuggest) * 4
  const slots = Math.min(courtCapacity, Math.floor(eligiblePlayers.length / 4) * 4)
  const tierOverrides = options.tier_overrides ?? {}
  const availabilityMetrics = options.availability_metrics ?? computeAvailabilityMetrics(state)
  const hasCompletedRounds = state.rounds.some((r) => r.status === 'completed')
  const completedRoundsCount = state.rounds.filter((r) => r.status === 'completed').length
  const thresholds = computeDynamicThresholds(
    getBenchDepth(state),
    eligiblePlayers.length,
    state.config.court_preset,
  )
  const phase = getSessionPhase(state, completedRoundsCount)
  const classificationContext = {
    avgMatches: getAverageMatches(eligiblePlayers),
    matchBalance: getMatchBalanceFromAvailabilityMetrics(availabilityMetrics, eligiblePlayers, slots),
    thresholds,
    phase,
  }
  const basePick = pickPlayers(state, Math.max(4, slots), tierOverrides, classificationContext)
  const warnings = [...basePick.warnings, ...detectGenderConflicts(eligiblePlayers)]
  const mustPlayOverCapacity = warnings.includes('MUST_PLAY_OVER_CAPACITY')

  if (
    state.config.planned_total_rounds != null &&
    completedRoundsCount >= state.config.planned_total_rounds
  ) {
    return {
      alternatives: [],
      warnings: ['TARGET_ROUNDS_REACHED'],
      should_end: true,
    }
  }

  const requiredPlayerIds = mustPlayOverCapacity
    ? new Set<string>()
    : new Set(
        eligiblePlayers
          .filter((player) => tierOverrides[player.player_id] !== Tier.FLEXIBLE)
          .filter((player) => {
            // Late arrivals (never played yet in an ongoing session) get a 1-round grace period
            // before being required — only forced at consecutive_rest >= 2.
            // Regular players in rest rotation stay required at consecutive_rest >= 1.
            const isLateArrival = hasCompletedRounds && player.matches_played === 0
            if (isLateArrival) return player.consecutive_rest >= 2
            return player.consecutive_rest >= 1
          })
          .map((player) => player.player_id),
      )

  if (!mustPlayOverCapacity) {
    for (const [playerId, tier] of Object.entries(tierOverrides)) {
      if (tier === Tier.MUST_PLAY && eligiblePlayers.some((player) => player.player_id === playerId)) {
        requiredPlayerIds.add(playerId)
      }
    }
  }
  // suggestNextMatch filters its OUTPUT by this same list unconditionally, so dropping it from the
  // SEARCH only produces lineups the filter then throws away — the court sits empty while a valid
  // lineup exists. Over-capacity relief belongs to the tier-derived set above, not to a list the
  // caller has already trimmed to fit one court.
  for (const playerId of options.forced_required_player_ids ?? []) {
    if (eligiblePlayers.some((player) => player.player_id === playerId)) {
      requiredPlayerIds.add(playerId)
    }
  }

  if (slots < 4) {
    return {
      alternatives: [],
      warnings,
      should_end: true,
    }
  }

  if (slots < courtCapacity) {
    warnings.push('PARTIAL_COURTS')
  }

  const alternatives: SuggestionAlternative[] = []
  const maxAlternatives = Math.max(1, Math.floor(options.max_alternatives ?? 3))
  const maxAcceptedPerStrategy = Math.min(MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY, maxAlternatives)
  const seen = new Set<string>()
  const diagnostics = options.diagnostics
  const callerBudget = options.search_budget
  const maxSearchUnits = callerBudget
    ? searchBudgetRemaining(callerBudget)
    : DEFAULT_SUGGEST_NEXT_ROUND_SEARCH_UNITS
  const overallBudget = createSearchBudget(
    maxSearchUnits,
    [callerBudget, options.force_search_budget].filter(Boolean) as SearchBudget[],
  )
  // Always leave a reserve for the forced/exhaustive rescue pass. With a single shared budget the
  // regular search used to be able to eat all of it, and the rescue — the ONLY pass that caps the
  // required set and can seat an over-constrained rester foursome without a blowout — was skipped,
  // surfacing as a false NO_VALID_MATCH ("stuck"). Reserve a slice so the rescue always gets to run.
  // A caller that asks for more than the default is asking for rescue headroom, not a longer regular
  // search (see the sim runner): keep the regular slice small and leave the rest to the forced pass.
  const regularBudget = subSearchBudget(
    overallBudget,
    maxSearchUnits > DEFAULT_SUGGEST_NEXT_ROUND_SEARCH_UNITS
      ? LARGE_BUDGET_REGULAR_SEARCH_UNITS
      : Math.max(MIN_REGULAR_SEARCH_UNITS, maxSearchUnits - RESCUE_BUDGET_RESERVE_UNITS),
  )
  const timedOut = () => searchBudgetExhausted(regularBudget)
  const overallTimedOut = () => searchBudgetExhausted(overallBudget)
  const finalizeDiagnostics = () => {
    if (!diagnostics) return
    diagnostics.budget_units = maxSearchUnits
    diagnostics.spent_units = searchBudgetSpent(overallBudget)
    diagnostics.timed_out = timedOut()
    diagnostics.slots = slots
    diagnostics.eligible_count = eligiblePlayers.length
    diagnostics.must_play_over_capacity = mustPlayOverCapacity
    diagnostics.required_player_ids = [...requiredPlayerIds]
  }
  const partitioningCache = options.partition_cache === false
    ? undefined
    : createPartitioningRuntimeCache()
  const strategies: Array<'fairness' | 'rest' | 'diversity' | 'group'> = [
    'fairness',
    'rest',
    'diversity',
    'group',
  ]

  const collectAlternatives = (allowRelaxedTolerance: boolean, allowRepeatOverflow: boolean, force = false) => {
    const forceTimedOut = () => {
      if (!force) return false
      return overallTimedOut()
    }

    for (const strategy of strategies) {
      if (!force && timedOut()) break
      if (force && (alternatives.length > 0 || forceTimedOut())) break
      const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides, classificationContext)
      const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY)
      if (diagnostics && !diagnostics.strategies[strategy]) {
        diagnostics.strategies[strategy] = {
          candidates: candidates.length,
          evaluated: 0,
          accepted: 0,
          skipped_seen: 0,
          skipped_required: 0,
          partition_iterations: 0,
          relaxed_partitions: 0,
          failed_partitions: 0,
        }
      } else if (diagnostics) {
        diagnostics.strategies[strategy].candidates = Math.max(diagnostics.strategies[strategy].candidates, candidates.length)
      }
      const strategyDiagnostics = diagnostics?.strategies[strategy]
      let acceptedForStrategy = 0

      for (const candidate of candidates) {
        if (!force && timedOut()) break
        if (force && (alternatives.length > 0 || forceTimedOut())) break
        if (acceptedForStrategy >= maxAcceptedPerStrategy) break
        const key = `${combinationKey(candidate.players)}|pvna:${allowRelaxedTolerance ? 'relaxed' : 'strict'}|repeat:${allowRepeatOverflow ? 'overflow' : 'cap'}`
        if (seen.has(key)) {
          if (strategyDiagnostics) strategyDiagnostics.skipped_seen += 1
          continue
        }
        if (
          requiredPlayerIds.size > 0 &&
          ![...requiredPlayerIds].every((playerId) =>
            candidate.players.some((player) => player.player_id === playerId),
          )
        ) {
          if (strategyDiagnostics) strategyDiagnostics.skipped_required += 1
          continue
        }

        if (strategyDiagnostics) strategyDiagnostics.evaluated += 1
        const alternative = makeAlternative(
          candidate.players,
          presentPlayers,
          state,
          warnings,
          (partitionDiagnostic) => {
            if (!strategyDiagnostics) return
            strategyDiagnostics.partition_iterations += partitionDiagnostic.strict_iterations + partitionDiagnostic.relaxed_iterations
            strategyDiagnostics.relaxed_partitions += partitionDiagnostic.relaxed_tolerance ? 1 : 0
            strategyDiagnostics.failed_partitions += partitionDiagnostic.found ? 0 : 1
            diagnostics!.partition_count = partitionDiagnostic.partition_count
            diagnostics!.max_iterations = partitionDiagnostic.max_iterations
            diagnostics!.exhaustive = partitionDiagnostic.exhaustive
          },
          partitioningCache,
          allowRelaxedTolerance,
          allowRepeatOverflow,
          false,
          options.preview_seed,
          thresholds,
          force
            ? subSearchBudget(overallBudget, DEADLINE_RESCUE_CANDIDATE_SEARCH_UNITS)
            : regularBudget,
          force,
        )
        if (!alternative) continue

        alternatives.push(alternative)
        seen.add(key)
        acceptedForStrategy += 1
        if (strategyDiagnostics) strategyDiagnostics.accepted += 1
      }
    }
  }

  let stageDetail: 'strict' | 'relaxed' | 'none' = 'none'
  collectAlternatives(false, false)
  if (alternatives.length > 0) stageDetail = 'strict'
  if (alternatives.length === 0 && !overallTimedOut()) {
    // Try overflow-ok (strict tolerance) before relaxed tolerance (no overflow).
    // In sessions with many repeat pairs, Pass B (relaxed + no overflow) runs all 8 stages
    // and still finds nothing — wasted iterations. Pass C (overflow ok) finds the result in
    // Stage 1. Swapping them avoids the expensive failed Pass B in overflow-heavy rounds.
    collectAlternatives(false, true)
    if (alternatives.length > 0 && stageDetail === 'none') stageDetail = 'strict'
    if (!timedOut()) {
      collectAlternatives(true, false)
      if (alternatives.length > 0 && stageDetail === 'none') stageDetail = 'relaxed'
    }
    if (!timedOut()) {
      collectAlternatives(true, true)
      if (alternatives.length > 0 && stageDetail === 'none') stageDetail = 'relaxed'
    }
  }
  // Forced rescue shares the public deadline, so it cannot extend total wall-clock indefinitely.
  if (alternatives.length === 0 && !overallTimedOut()) {
    try { options.onInstrumentEvent?.({ event: 'forced_pass', detail: 'forced_pass' }) } catch { /* noop */ }
    collectAlternatives(true, true, true)
  }
  try { options.onInstrumentEvent?.({ event: 'stage_resolved', detail: stageDetail }) } catch { /* noop */ }

  const isClosing = phase === 'closing'

  alternatives.sort((a, b) => {
    const tradeoffScoreA = getTradeoffScore(a)
    const tradeoffScoreB = getTradeoffScore(b)
    if (tradeoffScoreA !== tradeoffScoreB) return tradeoffScoreA - tradeoffScoreB
    const tradeoffCountA = getTradeoffCount(a)
    const tradeoffCountB = getTradeoffCount(b)
    if (tradeoffCountA !== tradeoffCountB) return tradeoffCountA - tradeoffCountB

    // Closing: close match-count gap before repeat avoidance (fairness > variety at end)
    if (isClosing) {
      const matchCountA = getProjectedMatchCountExcess(a, state)
      const matchCountB = getProjectedMatchCountExcess(b, state)
      if (matchCountA.excess !== matchCountB.excess) return matchCountA.excess - matchCountB.excess
      if (matchCountA.range !== matchCountB.range) return matchCountA.range - matchCountB.range
    }

    // A floor under match-count balance. `excess` is already zero while the spread stays inside the
    // tolerated ±1 band, so this is a no-op on a level board — but once the spread is genuinely wide,
    // balance stops losing to repeat avoidance. Without it, one repeated partner outranked ANY
    // imbalance, however large: measured on 9 players / 2 courts / 9 rounds, the engine benched the
    // player with the FEWEST matches in round 4 (excess 1.0) to avoid a single partner repeat, and the
    // same player finished the session on 7 matches while two others had 9.
    const balanceFloorA = getProjectedMatchCountExcess(a, state)
    const balanceFloorB = getProjectedMatchCountExcess(b, state)
    if (balanceFloorA.excess !== balanceFloorB.excess) return balanceFloorA.excess - balanceFloorB.excess

    // Recent repeat cost (deprioritized in closing — last-round repeats don't affect future)
    if (!isClosing) {
      const recentRepeatDiff = compareRecentRepeatCost(a, b, state)
      if (recentRepeatDiff !== 0) return recentRepeatDiff
    }

    const burdenA = getProjectedOpponentBurden(a, state)
    const burdenB = getProjectedOpponentBurden(b, state)
    if (burdenA.overThreshold !== burdenB.overThreshold) {
      return burdenA.overThreshold - burdenB.overThreshold
    }
    if (burdenA.max !== burdenB.max) return burdenA.max - burdenB.max

    const partnerBurdenA = getProjectedPartnerBurden(a, state)
    const partnerBurdenB = getProjectedPartnerBurden(b, state)
    if (partnerBurdenA.overThreshold !== partnerBurdenB.overThreshold) {
      return partnerBurdenA.overThreshold - partnerBurdenB.overThreshold
    }
    if (partnerBurdenA.max !== partnerBurdenB.max) return partnerBurdenA.max - partnerBurdenB.max

    if (!isClosing) {
      const matchCountA = getProjectedMatchCountExcess(a, state)
      const matchCountB = getProjectedMatchCountExcess(b, state)
      if (matchCountA.excess !== matchCountB.excess) return matchCountA.excess - matchCountB.excess
      if (matchCountA.range !== matchCountB.range) return matchCountA.range - matchCountB.range
    }

    // Closing: recent repeat moved here — deprioritized but still a tiebreaker
    if (isClosing) {
      const recentRepeatDiff = compareRecentRepeatCost(a, b, state)
      if (recentRepeatDiff !== 0) return recentRepeatDiff
    }

    const groupCoverageA = getProjectedGroupCoverage(a, state)
    const groupCoverageB = getProjectedGroupCoverage(b, state)
    if (groupCoverageA.newPairs !== groupCoverageB.newPairs) {
      return groupCoverageB.newPairs - groupCoverageA.newPairs
    }
    if (groupCoverageA.underTwoPairs !== groupCoverageB.underTwoPairs) {
      return groupCoverageB.underTwoPairs - groupCoverageA.underTwoPairs
    }

    // Closing: bonus for opponent pairs that have never played each other
    if (isClosing) {
      const newOppA = getProjectedNewOpponentPairs(a, state)
      const newOppB = getProjectedNewOpponentPairs(b, state)
      if (newOppA !== newOppB) return newOppB - newOppA
    }

    const scoreDiff = a.score - b.score
    if (Math.abs(scoreDiff) > BURDEN_TIE_BREAK_SCORE_WINDOW) return scoreDiff

    if (burdenA.avg !== burdenB.avg) return burdenA.avg - burdenB.avg
    if (partnerBurdenA.avg !== partnerBurdenB.avg) return partnerBurdenA.avg - partnerBurdenB.avg
    if (a.stats.opponent_repeats !== b.stats.opponent_repeats) {
      return a.stats.opponent_repeats - b.stats.opponent_repeats
    }
    if (a.stats.partner_repeats !== b.stats.partner_repeats) {
      return a.stats.partner_repeats - b.stats.partner_repeats
    }
    if (scoreDiff !== 0) return scoreDiff
    return a.matches[0].team_a.join(':').localeCompare(b.matches[0].team_a.join(':'))
  })

  if (alternatives.length === 0 && !timedOut()) {
    const forceRequiredIds = new Set(
      eligiblePlayers
        .filter((player) => player.consecutive_rest >= 2)
        .map((player) => player.player_id),
    )
    if (forceRequiredIds.size > 0) {
      for (const strategy of strategies) {
        if (alternatives.length > 0) break
        const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides, classificationContext)
        const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY)
        for (const candidate of candidates) {
          if (overallTimedOut()) break
          if (alternatives.length > 0) break
          const key = combinationKey(candidate.players)
          if (seen.has(key)) continue
          if (![...forceRequiredIds].every((id) => candidate.players.some((p) => p.player_id === id))) continue
          const alternative = makeAlternative(
            candidate.players,
            presentPlayers,
            state,
            warnings,
            undefined,
            partitioningCache,
            true,
            true,
            false,
            options.preview_seed,
            thresholds,
            overallBudget,
          )
          if (!alternative) continue
          alternatives.push(alternative)
          seen.add(key)
        }
      }
    }
  }

  if (alternatives.length === 0) {
    finalizeDiagnostics()
    return {
      alternatives: [],
      warnings: [...warnings, 'NO_VALID_MATCH'],
      should_end: false,
    }
  }

  finalizeDiagnostics()
  return {
    alternatives: alternatives.slice(0, maxAlternatives),
    warnings,
    should_end: false,
  }
}

export function suggestNextMatch(
  state: SessionState,
  options: SuggestNextMatchOptions = {},
): SuggestionResult {
  const busyIds = new Set([...(options.busy_player_ids ?? [])].map(String))
  const now = new Date()
  const players = new Map(
    [...state.players.entries()].map(([playerId, player]) => [
      playerId,
      busyIds.has(playerId)
        ? { ...player, checked_out_at: player.checked_out_at ?? now, opted_rest: false }
        : player,
    ]),
  )
  const matchState: SessionState = {
    ...state,
    config: {
      ...state.config,
      courts: 1,
    },
    players,
  }
  const courtIdx = Math.max(0, Math.floor(options.court_idx ?? 0))
  const forcedRequiredIds = new Set((options.forced_required_player_ids ?? []).map(String))
  const hasForcedRequired = forcedRequiredIds.size > 0
  const containsForcedRequired = (alternative: SuggestionAlternative) => (
    !hasForcedRequired ||
    [...forcedRequiredIds].every(playerId =>
      alternative.matches.some(match => [...match.team_a, ...match.team_b].includes(playerId)),
    )
  )
  if (options.allow_recent_group_rematch === true) {
    const fallback = suggestNextMatchExhaustiveFallback(matchState, {
      ...options,
      court_idx: courtIdx,
      max_alternatives: options.max_alternatives ?? 1,
    })
    return {
      ...fallback,
      alternatives: uniqueSingleMatchAlternatives(
        fallback.alternatives.filter(containsForcedRequired),
      ).slice(0, Math.max(1, Math.floor(options.max_alternatives ?? 1))),
    }
  }

  const result = suggestNextRound(matchState, {
    ...options,
    max_alternatives: options.max_alternatives ?? 1,
  })
  const mappedResult: SuggestionResult = {
    ...result,
    alternatives: result.alternatives.map(alternative => ({
      ...alternative,
      matches: alternative.matches.slice(0, 1).map(match => ({
        ...match,
        court_idx: courtIdx,
      })),
    })).filter(alternative => alternative.matches.length > 0 && containsForcedRequired(alternative)),
  }

  const topAlternative = mappedResult.alternatives[0]
  const shouldCheckFallback = !topAlternative || (
    options.exhaustive_fallback !== false && (
      getTradeoffCount(topAlternative) > 0 ||
      topAlternative.warnings.includes('PVNA_TOLERANCE_RELAXED') ||
      topAlternative.warnings.includes('REPEAT_CAP_RELAXED')
    )
  )
  if (!shouldCheckFallback) return mappedResult
  // A single match always runs the fallback (bounded & deterministic for small pools via the
  // findMinCostFoursome fast path below) — the shared budget is passed through only as a safety net
  // for the legacy > 20-player combo loop.
  const diag: ExhaustiveFallbackDiagnostic = {
    ran: false, timedOut: false, eligibleCount: 0,
    combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, spentUnits: 0,
  }
  if (options._exhaustiveDiag) Object.assign(options._exhaustiveDiag, diag)
  const fallback = suggestNextMatchExhaustiveFallback(matchState, {
    ...options,
    _exhaustiveDiag: options._exhaustiveDiag ?? diag,
    court_idx: courtIdx,
    max_alternatives: options.max_alternatives ?? 1,
  })
  if (fallback.alternatives.length === 0) return mappedResult

  const alternatives = [...mappedResult.alternatives, ...fallback.alternatives.filter(containsForcedRequired)]
  alternatives.sort((a, b) => sortSingleMatchAlternatives(a, b, matchState))
  const uniqueAlternatives = uniqueSingleMatchAlternatives(alternatives)

  return {
    ...mappedResult,
    alternatives: uniqueAlternatives.slice(0, Math.max(1, Math.floor(options.max_alternatives ?? 1))),
    warnings: [...new Set([...result.warnings.filter(warning => warning !== 'NO_VALID_MATCH'), ...fallback.warnings])],
  }
}

function sortSingleMatchAlternatives(a: SuggestionAlternative, b: SuggestionAlternative, state: SessionState) {
  const completedRoundsCount = state.rounds.filter((r) => r.status === 'completed').length
  const isClosing = getSessionPhase(state, completedRoundsCount) === 'closing'

  const tradeoffScoreA = getTradeoffScore(a)
  const tradeoffScoreB = getTradeoffScore(b)
  if (tradeoffScoreA !== tradeoffScoreB) return tradeoffScoreA - tradeoffScoreB
  const tradeoffCountA = getTradeoffCount(a)
  const tradeoffCountB = getTradeoffCount(b)
  if (tradeoffCountA !== tradeoffCountB) return tradeoffCountA - tradeoffCountB

  if (!isClosing) {
    const recentRepeatDiff = compareRecentRepeatCost(a, b, state)
    if (recentRepeatDiff !== 0) return recentRepeatDiff
  }

  const burdenA = getProjectedOpponentBurden(a, state)
  const burdenB = getProjectedOpponentBurden(b, state)
  if (burdenA.overThreshold !== burdenB.overThreshold) return burdenA.overThreshold - burdenB.overThreshold
  if (burdenA.max !== burdenB.max) return burdenA.max - burdenB.max

  const partnerBurdenA = getProjectedPartnerBurden(a, state)
  const partnerBurdenB = getProjectedPartnerBurden(b, state)
  if (partnerBurdenA.overThreshold !== partnerBurdenB.overThreshold) return partnerBurdenA.overThreshold - partnerBurdenB.overThreshold
  if (partnerBurdenA.max !== partnerBurdenB.max) return partnerBurdenA.max - partnerBurdenB.max

  if (isClosing) {
    const recentRepeatDiff = compareRecentRepeatCost(a, b, state)
    if (recentRepeatDiff !== 0) return recentRepeatDiff
  }

  const scoreA = a.matches[0]?.score ?? a.score
  const scoreB = b.matches[0]?.score ?? b.score
  if (scoreA !== scoreB) return scoreA - scoreB

  if (burdenA.avg !== burdenB.avg) return burdenA.avg - burdenB.avg
  if (partnerBurdenA.avg !== partnerBurdenB.avg) return partnerBurdenA.avg - partnerBurdenB.avg

  const matchA = a.matches[0]
  const matchB = b.matches[0]
  return (matchA?.team_a.join(':') ?? '').localeCompare(matchB?.team_a.join(':') ?? '')
}

function singleMatchAlternativeKey(alternative: SuggestionAlternative) {
  const match = alternative.matches[0]
  if (!match) return ''
  const teamAKey = [...match.team_a].sort().join(':')
  const teamBKey = [...match.team_b].sort().join(':')
  return [teamAKey, teamBKey].sort().join('|')
}

function uniqueSingleMatchAlternatives(alternatives: SuggestionAlternative[]) {
  const seen = new Set<string>()
  return alternatives.filter((alternative) => {
    const key = singleMatchAlternativeKey(alternative)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function suggestNextMatchExhaustiveFallback(
  state: SessionState,
  options: SuggestNextMatchOptions,
): SuggestionResult {
  const presentPlayers = getPresentPlayers(state)
  const busyIds = new Set(options.busy_player_ids ?? [])
  const eligiblePlayers = presentPlayers.filter(
    (player) => !player.opted_rest && !busyIds.has(player.player_id),
  )
  const tierOverrides = options.tier_overrides ?? {}
  const availabilityMetrics = options.availability_metrics ?? computeAvailabilityMetrics(state)
  const thresholds = computeDynamicThresholds(
    getBenchDepth(state),
    eligiblePlayers.length,
    state.config.court_preset,
  )
  const classificationContext = {
    avgMatches: getAverageMatches(eligiblePlayers),
    matchBalance: getMatchBalanceFromAvailabilityMetrics(availabilityMetrics, eligiblePlayers, 4),
    thresholds,
  }
  const basePick = pickPlayers(state, 4, tierOverrides, classificationContext)
  const warnings = [...basePick.warnings, ...detectGenderConflicts(eligiblePlayers)]
  const mustPlayOverCapacity = warnings.includes('MUST_PLAY_OVER_CAPACITY')
  const hasCompletedRounds = state.rounds.some((r) => r.status === 'completed')
  const requiredPlayerIds = mustPlayOverCapacity
    ? new Set<string>()
    : new Set(
        eligiblePlayers
          .filter((player) => tierOverrides[player.player_id] !== Tier.FLEXIBLE)
          .filter((player) => {
            const isLateArrival = hasCompletedRounds && player.matches_played === 0
            if (isLateArrival) return player.consecutive_rest >= 2
            return player.consecutive_rest >= 1
          })
          .map((player) => player.player_id),
      )

  if (!mustPlayOverCapacity) {
    for (const [playerId, tier] of Object.entries(tierOverrides)) {
      if (tier === Tier.MUST_PLAY && eligiblePlayers.some((player) => player.player_id === playerId)) {
        requiredPlayerIds.add(playerId)
      }
    }
  }
  // Same contract as the main pass: the caller's forced list is enforced on the result, so the
  // fallback has to search under it too.
  for (const playerId of options.forced_required_player_ids ?? []) {
    if (eligiblePlayers.some((player) => player.player_id === playerId)) {
      requiredPlayerIds.add(playerId)
    }
  }
  if (requiredPlayerIds.size > 4) {
    const ranked = eligiblePlayers
      .filter((p) => requiredPlayerIds.has(p.player_id))
      .sort((a, b) => b.consecutive_rest - a.consecutive_rest || a.matches_played - b.matches_played)
      .slice(0, 4)
    requiredPlayerIds.clear()
    for (const p of ranked) requiredPlayerIds.add(p.player_id)
    warnings.push('MUST_PLAY_OVER_CAPACITY')
  }

  const courtIdx = Math.max(0, Math.floor(options.court_idx ?? 0))
  const partitioningCache = options.partition_cache === false
    ? undefined
    : createPartitioningRuntimeCache()

  // Deterministic fast path for realistic single-court pools: pick the best foursome by a
  // cheap exhaustive scan (no wall-clock, no per-combo makeAlternative), then materialize it once. This
  // removes the timing-dependent truncation that let a repeat-3 slip through when a clean lineup exists.
  // Budget-independent by design — runs regardless of options.search_budget, since it's bounded and
  // cheap on its own; do not gate this block on the caller's remaining budget.
  // Skipped when allow_recent_group_rematch is true: that's the rare escape-hatch rescue path (e.g.
  // live-preview.ts's unified social tradeoff), called from suggestNextMatch's early branch that has NO
  // mappedResult safety net — if the fast path's min-cost pick can only materialize as a recent-group
  // rematch, makeAlternative (fixed allowRecentGroupRematch=false here) would return null and the fast
  // path's deterministic bail would surface as an empty result instead of falling through to the legacy
  // loop, whose stages do honor allow_recent_group_rematch and can materialize the rescue.
  if (options.allow_recent_group_rematch !== true && eligiblePlayers.length >= 4 && eligiblePlayers.length <= 20) {
    const tolerance = state.config.pvna_tolerance ?? 0.5
    const eligibleIds = eligiblePlayers.map((p) => p.player_id)
    const best = findMinCostFoursome(eligibleIds, requiredPlayerIds, state, tolerance)
    if (best) {
      const selected = best.ids.map((id) => state.players.get(id)!).filter(Boolean)
      const alternative = makeAlternative(
        selected, presentPlayers, state, warnings, undefined, partitioningCache, true, true, false,
        options.preview_seed, thresholds,
      )
      if (alternative) {
        if (options._exhaustiveDiag) {
          Object.assign(options._exhaustiveDiag, {
            ran: true,
            timedOut: false,
            eligibleCount: eligiblePlayers.length,
            // Not iterated combo-by-combo here (findMinCostFoursome scans internally) — 0 signals
            // "the deterministic path ran", distinguish via deterministicFastPath below.
            combinationsEvaluated: 0,
            bestPvnaDiff: alternative.matches[0]?.stats?.pvna_diff ?? null,
            bestHasTradeoffs: (alternative.tradeoffs?.length ?? 0) > 0,
            spentUnits: 0,
            deterministicFastPath: true,
          })
        }
        return {
          alternatives: [{
            ...alternative,
            matches: alternative.matches.slice(0, 1).map((match) => ({ ...match, court_idx: courtIdx })),
          }],
          warnings,
          should_end: false,
        }
      }
      // best was non-null (a min-cost foursome was found) but makeAlternative couldn't materialize it —
      // e.g. the foursome is a recent-group-rematch (same 4 regrouped within the block window):
      // candidateLineups (forced-tradeoff.ts) never checks recent-group-rematch, but bestPartitioning
      // hard-rejects it for every split, and the block is group-level, so no split can escape it.
      //
      // Seat it anyway with the block relaxed, flagged. A court the host asked us to fill comes back
      // with a lineup or an explicit reason, never silently empty: these four are the only people free,
      // and "you four again" is a worse answer than a clean match but a far better one than an empty
      // court nobody can explain. Relaxing here rather than falling through to the legacy timed loop
      // keeps the determinism this fast path exists for — the loop honours the same relaxation, but on
      // a wall-clock budget.
      const relaxed = makeAlternative(
        selected, presentPlayers, state, warnings, undefined, partitioningCache, true, true, true,
        options.preview_seed, thresholds,
      )
      if (relaxed) {
        if (options._exhaustiveDiag) {
          Object.assign(options._exhaustiveDiag, {
            ran: true,
            timedOut: false,
            eligibleCount: eligiblePlayers.length,
            combinationsEvaluated: 0,
            bestPvnaDiff: relaxed.matches[0]?.stats?.pvna_diff ?? null,
            bestHasTradeoffs: (relaxed.tradeoffs?.length ?? 0) > 0,
            spentUnits: 0,
            deterministicFastPath: true,
          })
        }
        return {
          alternatives: [{
            ...relaxed,
            warnings: [...new Set([...relaxed.warnings, 'RECENT_GROUP_REMATCH_RELAXED'])],
            matches: relaxed.matches.slice(0, 1).map((match) => ({ ...match, court_idx: courtIdx })),
          }],
          warnings,
          should_end: false,
        }
      }
      if (options._exhaustiveDiag) {
        Object.assign(options._exhaustiveDiag, {
          ran: true,
          timedOut: false,
          eligibleCount: eligiblePlayers.length,
          combinationsEvaluated: 0,
          bestPvnaDiff: null,
          bestHasTradeoffs: false,
          spentUnits: 0,
          deterministicFastPath: true,
        })
      }
      return { alternatives: [], warnings, should_end: false }
    }
    // best === null: pool shape genuinely unhandled by findMinCostFoursome (over its internal cap, or no
    // subset contains every required id) — fall through to the legacy timed loop.
  }

  // The deterministic fast path above is budget-independent, but pools > 20 (or a pool shape
  // findMinCostFoursome genuinely can't handle — over its internal cap, or no subset contains every
  // required id) fall through to the combinatorial loop below, which enumerates and sorts every
  // 4-subset before it evaluates one. That is not worth starting on a nearly spent budget.
  if (options.search_budget && searchBudgetRemaining(options.search_budget) <= MIN_EXHAUSTIVE_FALLBACK_SEARCH_UNITS) {
    if (options._exhaustiveDiag) {
      Object.assign(options._exhaustiveDiag, {
        ran: false,
        timedOut: true,
        eligibleCount: eligiblePlayers.length,
        combinationsEvaluated: 0,
        bestPvnaDiff: null,
        bestHasTradeoffs: false,
        spentUnits: 0,
      })
    }
    return { alternatives: [], warnings, should_end: false }
  }

  const maxAlternatives = Math.max(1, Math.floor(options.max_alternatives ?? 1))
  const alternatives: SuggestionAlternative[] = []
  const seen = new Set<string>()
  let combinationsEvaluated = 0

  const fallbackBudget = subSearchBudget(
    options.search_budget ?? createSearchBudget(MAX_EXHAUSTIVE_FALLBACK_SEARCH_UNITS),
    MAX_EXHAUSTIVE_FALLBACK_SEARCH_UNITS,
  )
  const timedOut = () => searchBudgetExhausted(fallbackBudget)
  // Pre-sort once by pvna so each generated combo is already in pvna order —
  // the comparator can then use index 0/3 directly, avoiding O(n log n) inner
  // array allocations that made sorting 35 k+ combos exceed the timeout budget.
  const eligibleByPvna = [...eligiblePlayers].sort((a, b) => getEffectivePvna(a) - getEffectivePvna(b))

  const evaluateStage = (
    allowRelaxedTolerance: boolean,
    allowRepeatOverflow: boolean,
    enforceRequired = true,
    allowRecentGroupRematch = false,
  ) => {
    // Pre-sort combinations by theoretical min pvna_diff so the best candidates
    // are evaluated first — timeout no longer causes quality regression.
    const combinations = getAllCombinations(eligibleByPvna, 4).sort((a, b) => {
      // Combos from a pvna-sorted list are already ordered per element (index 0 = min, 3 = max)
      const diffA = Math.abs(getEffectivePvna(a[0]) + getEffectivePvna(a[3]) - getEffectivePvna(a[1]) - getEffectivePvna(a[2])) / 2
      const diffB = Math.abs(getEffectivePvna(b[0]) + getEffectivePvna(b[3]) - getEffectivePvna(b[1]) - getEffectivePvna(b[2])) / 2
      return diffA - diffB
    })

    for (const selected of combinations) {
      if (timedOut()) break
      // Every combination costs something even when it is skipped: it was generated and sorted with the
      // rest. Charging for the touch is what keeps this loop bounded now that no clock stops it.
      spendSearchBudget(fallbackBudget)
      if (
        enforceRequired &&
        requiredPlayerIds.size > 0 &&
        ![...requiredPlayerIds].every((playerId) =>
          selected.some((player) => player.player_id === playerId),
        )
      ) {
        continue
      }
      const key = `${combinationKey(selected)}|pvna:${allowRelaxedTolerance ? 'relaxed' : 'strict'}|repeat:${allowRepeatOverflow ? 'overflow' : 'cap'}`
        + `|recent:${allowRecentGroupRematch ? 'open' : 'cap'}`
      if (seen.has(key)) continue
      combinationsEvaluated++
      const alternative = makeAlternative(
        selected,
        presentPlayers,
        state,
        warnings,
        undefined,
        partitioningCache,
        allowRelaxedTolerance,
        allowRepeatOverflow,
        allowRecentGroupRematch,
        options.preview_seed,
        thresholds,
        fallbackBudget,
      )
      seen.add(key)
      if (!alternative) continue
      alternatives.push({
        ...alternative,
        warnings: [...new Set([
          ...alternative.warnings,
          ...(getTradeoffCount(alternative) > 0 ? ['EXHAUSTIVE_FALLBACK'] : []),
          ...(!enforceRequired && requiredPlayerIds.size > 0 ? ['REST_REQUIREMENT_RELAXED'] : []),
        ])],
        matches: alternative.matches.slice(0, 1).map(match => ({
          ...match,
          court_idx: courtIdx,
        })),
      })
      if (alternatives.length >= maxAlternatives) break
    }
  }

  const initialRecentGroupRematch = options.allow_recent_group_rematch === true
  evaluateStage(false, false, true, initialRecentGroupRematch)
  if (options._exhaustiveDiag) {
    options._exhaustiveDiag._seenAfterStage1 = seen.size
    options._exhaustiveDiag._altsAfterStage1 = alternatives.length
    options._exhaustiveDiag._combosAfterStage1 = combinationsEvaluated
  }
  if (alternatives.length === 0 && !timedOut()) {
    evaluateStage(false, true)
    if (options._exhaustiveDiag) options._exhaustiveDiag._combosAfterStage2 = combinationsEvaluated
    if (!timedOut()) evaluateStage(true, false)
    if (options._exhaustiveDiag) options._exhaustiveDiag._combosAfterStage3 = combinationsEvaluated
    if (!timedOut()) evaluateStage(true, true)
  }
  // Also try enforceRequired=false when all found alternatives have tradeoffs (required combo is a bad match)
  const allHaveTradeoffs = () => alternatives.every(a => getTradeoffCount(a) > 0)
  if (allHaveTradeoffs() && requiredPlayerIds.size > 0 && !options.forced_required_player_ids?.length && !timedOut()) {
    evaluateStage(false, false, false)
  }
  if (allHaveTradeoffs() && requiredPlayerIds.size > 0 && !options.forced_required_player_ids?.length && !timedOut()) {
    evaluateStage(false, true, false)
    if (!timedOut()) evaluateStage(true, false, false)
    if (allHaveTradeoffs() && !timedOut()) {
      evaluateStage(true, true, false)
    }
  }
  if (!initialRecentGroupRematch && allHaveTradeoffs() && !timedOut()) {
    evaluateStage(false, false, true, true)
  }
  if (!initialRecentGroupRematch && allHaveTradeoffs() && !timedOut()) {
    evaluateStage(false, true, true, true)
    if (!timedOut()) evaluateStage(true, false, true, true)
    if (allHaveTradeoffs() && !timedOut()) {
      evaluateStage(true, true, true, true)
    }
  }

  alternatives.sort((a, b) => sortSingleMatchAlternatives(a, b, state))

  if (options._exhaustiveDiag) {
    const best = alternatives[0]
    options._exhaustiveDiag.ran = true
    options._exhaustiveDiag.timedOut = timedOut()
    options._exhaustiveDiag.eligibleCount = eligiblePlayers.length
    options._exhaustiveDiag.combinationsEvaluated = combinationsEvaluated
    options._exhaustiveDiag.bestPvnaDiff = best?.matches[0]?.stats?.pvna_diff ?? null
    options._exhaustiveDiag.bestHasTradeoffs = (best?.tradeoffs?.length ?? 0) > 0
    options._exhaustiveDiag.spentUnits = searchBudgetSpent(fallbackBudget)
    options._exhaustiveDiag._alternatives = alternatives.map(a => ({
      teamA: a.matches[0]?.team_a,
      teamB: a.matches[0]?.team_b,
      tradeoffs: a.tradeoffs?.map(t => t.type),
      warnings: a.warnings,
    }))
    options._exhaustiveDiag._eligiblePvnas = eligibleByPvna.map(p => `${p.player_id.slice(0,8)}:${getEffectivePvna(p).toFixed(2)}`)
  }

  if (alternatives.length === 0) {
    return {
      alternatives: [],
      warnings: [...warnings, 'NO_VALID_MATCH'],
      should_end: false,
    }
  }

  return {
    alternatives: alternatives.slice(0, maxAlternatives),
    warnings,
    should_end: false,
  }
}

function getProjectedGroupCoverage(
  alternative: SuggestionAlternative,
  state: SessionState,
): { newPairs: number; underTwoPairs: number } {
  let newPairs = 0
  let underTwoPairs = 0

  for (const match of alternative.matches) {
    for (const team of [match.team_a, match.team_b]) {
      const [playerA, playerB] = team
      const stateA = state.players.get(playerA)
      const stateB = state.players.get(playerB)

      if (!stateA?.group_id || stateA.group_id !== stateB?.group_id) continue

      const currentCount = stateA.partner_counts.get(playerB) ?? 0
      if (currentCount === 0) newPairs += 1
      if (currentCount < 2) underTwoPairs += 1
    }
  }

  return { newPairs, underTwoPairs }
}

function getProjectedNewOpponentPairs(
  alternative: SuggestionAlternative,
  state: SessionState,
): number {
  let newPairs = 0
  for (const match of alternative.matches) {
    for (const playerA of match.team_a) {
      const stateA = state.players.get(playerA)
      if (!stateA) continue
      for (const playerB of match.team_b) {
        if ((stateA.opponent_counts.get(playerB) ?? 0) === 0) newPairs++
      }
    }
  }
  return newPairs
}

function getProjectedMatchCountExcess(
  alternative: SuggestionAlternative,
  state: SessionState,
): { range: number; excess: number } {
  const playedIds = new Set(alternative.matches.flatMap((match) => [...match.team_a, ...match.team_b]))
  const presentPlayers = [...state.players.values()].filter((player) => player.checked_out_at === null)
  const availability = computeAvailabilityMetrics(state)
  const currentExpectedShare = presentPlayers.length === 0
    ? 0
    : alternative.matches.length * 4 / presentPlayers.length
  const historicalDeltas = new Map(
    availability.per_player.map((player) => [player.player_id, player.delta_from_expected]),
  )
  const deltas = presentPlayers.map((player) => {
    const historicalDelta = availability.rounds_tracked > 0
      ? historicalDeltas.get(player.player_id) ?? 0
      : player.matches_played - averageMatches(presentPlayers)

    return historicalDelta +
      (playedIds.has(player.player_id) ? 1 : 0) -
      currentExpectedShare
  })

  if (deltas.length === 0) return { range: 0, excess: 0 }

  const min = Math.min(...deltas)
  const max = Math.max(...deltas)
  const range = max - min

  return {
    range,
    excess: Math.max(0, range - 1),
  }
}

function averageMatches(players: PlayerSessionState[]): number {
  if (players.length === 0) return 0
  return players.reduce((sum, player) => sum + player.matches_played, 0) / players.length
}

function getProjectedPartnerBurden(
  alternative: SuggestionAlternative,
  state: SessionState,
): { max: number; avg: number; overThreshold: number } {
  const burden = computeProjectedPartnerRepeatBurden(state, alternative.matches)
  return {
    max: burden.max_repeated_partners,
    avg: burden.avg_repeated_partners,
    overThreshold: burden.per_player.filter(
      (player) => player.repeated_partners >= PROJECTED_REPEAT_BURDEN_THRESHOLD,
    ).length,
  }
}

function getProjectedOpponentBurden(
  alternative: SuggestionAlternative,
  state: SessionState,
): { max: number; avg: number; overThreshold: number } {
  const burden = computeProjectedOpponentRepeatBurden(state, alternative.matches)
  return {
    max: burden.max_repeated_opponents,
    avg: burden.avg_repeated_opponents,
    overThreshold: burden.per_player.filter(
      (player) => player.repeated_opponents >= PROJECTED_REPEAT_BURDEN_THRESHOLD,
    ).length,
  }
}

export function getEmptySuggestion(): SuggestionAlternative {
  return {
    matches: [],
    resting: [],
    score: Infinity,
    warnings: [],
    stats: emptyStats(),
  }
}
