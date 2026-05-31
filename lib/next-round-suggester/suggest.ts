// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import {
  bestPartitioning,
  createPartitioningRuntimeCache,
  type PartitioningDiagnostic,
  type PartitioningRuntimeCache,
} from './pair.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getPresentPlayers, pickPlayers, sortPlayersForStrategy } from './select.ts'
import type {
  Match,
  MatchStats,
  PlayerSessionState,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
  SuggestionTradeoff,
} from './types'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeAvailabilityMetrics, computeProjectedOpponentRepeatBurden, computeProjectedPartnerRepeatBurden } from './fairness/metrics.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import {
  MAX_PROJECTED_OPPONENT_PAIR_COUNT,
  MAX_PROJECTED_PARTNER_PAIR_COUNT,
  MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER,
  MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER,
  getProjectedRepeatSummary,
} from './score.ts'

export type SuggestNextRoundOptions = {
  tier_overrides?: Record<string, Tier>
  diagnostics?: SuggestionDiagnostic
  partition_cache?: boolean
  max_alternatives?: number
}

export type SuggestNextMatchOptions = SuggestNextRoundOptions & {
  busy_player_ids?: Iterable<string>
  court_idx?: number
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
  }
}

const MAX_CANDIDATES_PER_STRATEGY = 60
const MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY = 8
const BURDEN_TIE_BREAK_SCORE_WINDOW = 3
const PROJECTED_REPEAT_BURDEN_THRESHOLD = 3
const PVNA_TRADEOFF_WEIGHT = 10
const REPEAT_TRADEOFF_WEIGHT = 1

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

function getPvnaTradeoff(matches: Match[], state: SessionState): SuggestionTradeoff | null {
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
  }
}

function buildTradeoffs(partition: { matches: Match[] }, state: SessionState): SuggestionTradeoff[] {
  return [
    getPvnaTradeoff(partition.matches, state),
    getRepeatCapTradeoff(partition.matches, state),
  ].filter((tradeoff): tradeoff is SuggestionTradeoff => Boolean(tradeoff))
}

function getTradeoffScore(alternative: SuggestionAlternative) {
  return alternative.tradeoffs?.reduce((sum, tradeoff) => sum + tradeoff.severity, 0) ?? 0
}

function getTradeoffCount(alternative: SuggestionAlternative) {
  return alternative.tradeoffs?.length ?? 0
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
): SuggestionAlternative | null {
  const partition = bestPartitioning(selected, state, {
    diagnostics,
    cache: partitioningCache,
    allowRelaxedTolerance,
    allowRepeatOverflow,
  })
  if (!partition) return null
  const tradeoffs = buildTradeoffs(partition, state)
  const repeatCapReached = hasRepeatCapReached(partition.matches, state)
  const alternativeWarnings = [...new Set([
    ...warnings,
    ...(partition.relaxed_tolerance ? ['PVNA_TOLERANCE_RELAXED'] : []),
    ...(partition.repeat_overflow ? ['REPEAT_CAP_RELAXED'] : []),
    ...(partition.intra_team_gap_overflow ? ['INTRA_TEAM_GAP_RELAXED'] : []),
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
  const eligiblePlayers = presentPlayers.filter((player) => !player.opted_rest)
  const courtCapacity = Math.max(1, state.config.courts) * 4
  const slots = Math.min(courtCapacity, Math.floor(eligiblePlayers.length / 4) * 4)
  const tierOverrides = options.tier_overrides ?? {}
  const basePick = pickPlayers(state, Math.max(4, slots), tierOverrides)
  const warnings = [...basePick.warnings, ...detectGenderConflicts(eligiblePlayers)]
  const mustPlayOverCapacity = warnings.includes('MUST_PLAY_OVER_CAPACITY')
  const hasCompletedRounds = state.rounds.some((r) => r.status === 'completed')
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
  const partitioningCache = options.partition_cache === false
    ? undefined
    : createPartitioningRuntimeCache()
  const strategies: Array<'fairness' | 'rest' | 'diversity' | 'group'> = [
    'fairness',
    'rest',
    'diversity',
    'group',
  ]

  const collectAlternatives = (allowRelaxedTolerance: boolean, allowRepeatOverflow: boolean) => {
    for (const strategy of strategies) {
      const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides)
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
        )
        if (!alternative) continue

        alternatives.push(alternative)
        seen.add(key)
        acceptedForStrategy += 1
        if (strategyDiagnostics) strategyDiagnostics.accepted += 1
      }
    }
  }

  collectAlternatives(false, false)
  if (alternatives.length === 0) {
    collectAlternatives(false, true)
    collectAlternatives(true, false)
    collectAlternatives(true, true)
  }

  alternatives.sort((a, b) => {
    const tradeoffScoreA = getTradeoffScore(a)
    const tradeoffScoreB = getTradeoffScore(b)
    if (tradeoffScoreA !== tradeoffScoreB) return tradeoffScoreA - tradeoffScoreB
    const tradeoffCountA = getTradeoffCount(a)
    const tradeoffCountB = getTradeoffCount(b)
    if (tradeoffCountA !== tradeoffCountB) return tradeoffCountA - tradeoffCountB

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

    const matchCountA = getProjectedMatchCountExcess(a, state)
    const matchCountB = getProjectedMatchCountExcess(b, state)
    if (matchCountA.excess !== matchCountB.excess) return matchCountA.excess - matchCountB.excess
    if (matchCountA.range !== matchCountB.range) return matchCountA.range - matchCountB.range

    const groupCoverageA = getProjectedGroupCoverage(a, state)
    const groupCoverageB = getProjectedGroupCoverage(b, state)
    if (groupCoverageA.newPairs !== groupCoverageB.newPairs) {
      return groupCoverageB.newPairs - groupCoverageA.newPairs
    }
    if (groupCoverageA.underTwoPairs !== groupCoverageB.underTwoPairs) {
      return groupCoverageB.underTwoPairs - groupCoverageA.underTwoPairs
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

  if (alternatives.length === 0) {
    const forceRequiredIds = new Set(
      eligiblePlayers
        .filter((player) => player.consecutive_rest >= 2)
        .map((player) => player.player_id),
    )
    if (forceRequiredIds.size > 0) {
      for (const strategy of strategies) {
        if (alternatives.length > 0) break
        const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides)
        const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY)
        for (const candidate of candidates) {
          if (alternatives.length > 0) break
          const key = combinationKey(candidate.players)
          if (seen.has(key)) continue
          if (![...forceRequiredIds].every((id) => candidate.players.some((p) => p.player_id === id))) continue
          const alternative = makeAlternative(candidate.players, presentPlayers, state, warnings, undefined, partitioningCache)
          if (!alternative) continue
          alternatives.push(alternative)
          seen.add(key)
        }
      }
    }
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
  const result = suggestNextRound(matchState, {
    ...options,
    max_alternatives: options.max_alternatives ?? 1,
  })
  const courtIdx = Math.max(0, Math.floor(options.court_idx ?? 0))
  const mappedResult: SuggestionResult = {
    ...result,
    alternatives: result.alternatives.map(alternative => ({
      ...alternative,
      matches: alternative.matches.slice(0, 1).map(match => ({
        ...match,
        court_idx: courtIdx,
      })),
    })).filter(alternative => alternative.matches.length > 0),
  }

  const topAlternative = mappedResult.alternatives[0]
  const shouldCheckFallback = !topAlternative ||
    getTradeoffCount(topAlternative) > 0 ||
    topAlternative.warnings.includes('PVNA_TOLERANCE_RELAXED') ||
    topAlternative.warnings.includes('REPEAT_CAP_RELAXED')
  if (!shouldCheckFallback) return mappedResult

  const fallback = suggestNextMatchExhaustiveFallback(matchState, {
    ...options,
    court_idx: courtIdx,
    max_alternatives: options.max_alternatives ?? 1,
  })
  if (fallback.alternatives.length === 0) return mappedResult

  const alternatives = [...mappedResult.alternatives, ...fallback.alternatives]
  alternatives.sort(sortSingleMatchAlternatives)

  return {
    ...mappedResult,
    alternatives: alternatives.slice(0, Math.max(1, Math.floor(options.max_alternatives ?? 1))),
    warnings: [...new Set([...result.warnings.filter(warning => warning !== 'NO_VALID_MATCH'), ...fallback.warnings])],
  }
}

function sortSingleMatchAlternatives(a: SuggestionAlternative, b: SuggestionAlternative) {
  const tradeoffScoreA = getTradeoffScore(a)
  const tradeoffScoreB = getTradeoffScore(b)
  if (tradeoffScoreA !== tradeoffScoreB) return tradeoffScoreA - tradeoffScoreB
  const tradeoffCountA = getTradeoffCount(a)
  const tradeoffCountB = getTradeoffCount(b)
  if (tradeoffCountA !== tradeoffCountB) return tradeoffCountA - tradeoffCountB

  const scoreA = a.matches[0]?.score ?? a.score
  const scoreB = b.matches[0]?.score ?? b.score
  if (scoreA !== scoreB) return scoreA - scoreB

  const matchA = a.matches[0]
  const matchB = b.matches[0]
  return (matchA?.team_a.join(':') ?? '').localeCompare(matchB?.team_a.join(':') ?? '')
}

function suggestNextMatchExhaustiveFallback(
  state: SessionState,
  options: SuggestNextMatchOptions,
): SuggestionResult {
  const presentPlayers = getPresentPlayers(state)
  const eligiblePlayers = presentPlayers.filter((player) => !player.opted_rest)
  const tierOverrides = options.tier_overrides ?? {}
  const basePick = pickPlayers(state, 4, tierOverrides)
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
  if (requiredPlayerIds.size > 4) {
    requiredPlayerIds.clear()
    warnings.push('MUST_PLAY_OVER_CAPACITY')
  }

  const maxAlternatives = Math.max(1, Math.floor(options.max_alternatives ?? 1))
  const courtIdx = Math.max(0, Math.floor(options.court_idx ?? 0))
  const partitioningCache = options.partition_cache === false
    ? undefined
    : createPartitioningRuntimeCache()
  const alternatives: SuggestionAlternative[] = []
  const seen = new Set<string>()

  const startMs = Date.now()
  const evaluateStage = (allowRelaxedTolerance: boolean, allowRepeatOverflow: boolean, enforceRequired = true) => {
    let fallbackEligiblePlayers = eligiblePlayers
    if (eligiblePlayers.length > 20) {
      const required = eligiblePlayers.filter(p => requiredPlayerIds.has(p.player_id))
      const others = eligiblePlayers.filter(p => !requiredPlayerIds.has(p.player_id))
      const medianPvna = others.reduce((s, p) => s + p.pvna, 0) / (others.length || 1)
      const sortedByExtreme = [...others].sort((a, b) =>
        Math.abs(b.pvna - medianPvna) - Math.abs(a.pvna - medianPvna),
      )
      fallbackEligiblePlayers = [...required, ...sortedByExtreme].slice(0, 20)
    }

    for (const selected of getAllCombinations(fallbackEligiblePlayers, 4)) {
      if (Date.now() - startMs > 2500) break
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
      if (seen.has(key)) continue
      const alternative = makeAlternative(
        selected,
        presentPlayers,
        state,
        warnings,
        undefined,
        partitioningCache,
        allowRelaxedTolerance,
        allowRepeatOverflow,
      )
      seen.add(key)
      if (!alternative) continue
      alternatives.push({
        ...alternative,
        warnings: [...new Set([
          ...alternative.warnings,
          'EXHAUSTIVE_FALLBACK',
          ...(!enforceRequired && requiredPlayerIds.size > 0 ? ['REST_REQUIREMENT_RELAXED'] : []),
        ])],
        matches: alternative.matches.slice(0, 1).map(match => ({
          ...match,
          court_idx: courtIdx,
        })),
      })
    }
  }

  evaluateStage(false, false)
  if (alternatives.length === 0) {
    evaluateStage(false, true)
    evaluateStage(true, false)
    evaluateStage(true, true)
  }
  if (alternatives.length === 0 && requiredPlayerIds.size > 0) {
    evaluateStage(false, false, false)
  }
  if (alternatives.length === 0 && requiredPlayerIds.size > 0) {
    evaluateStage(false, true, false)
    evaluateStage(true, false, false)
    if (alternatives.length === 0) {
      evaluateStage(true, true, false)
    }
  }

  alternatives.sort(sortSingleMatchAlternatives)

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
