import { bestPartitioning } from '@/lib/next-round-suggester/pair'
import {
  bestPartitioningCached,
  createCachedPartitioningRuntimeCache,
  type CachedPartitioningRuntimeCache,
} from './experimental-pair'
import { getPresentPlayers, pickPlayers, sortPlayersForStrategy } from '@/lib/next-round-suggester/select'
import { detectGenderConflicts } from '@/lib/next-round-suggester/suggest'
import { computeAvailabilityMetrics, computeProjectedOpponentRepeatBurden, computeProjectedPartnerRepeatBurden } from '@/lib/next-round-suggester/fairness/metrics'
import type {
  MatchStats,
  PlayerSessionState,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
} from '@/lib/next-round-suggester/types'
import { Tier } from '@/lib/next-round-suggester/classify'

type Strategy = 'fairness' | 'rest' | 'diversity' | 'group'

type Candidate = {
  players: PlayerSessionState[]
  priority: number
  key: string
  source: Strategy
}

export type ExperimentalDiagnostic = {
  generated: Record<Strategy, number>
  duplicateCandidates: number
  evaluatedCandidates: number
  acceptedCandidates: number
  failedCandidates: number
  partitionIterations: number
  expandedTo?: number
  expandedReasons?: string[]
}

export type ExperimentalSuggestionResult = SuggestionResult & {
  diagnostic: ExperimentalDiagnostic
}

export type ExperimentalSuggestOptions = {
  tier_overrides?: Record<string, Tier>
  candidateLimit?: number
  mode?: 'global' | 'cached-global' | 'per-strategy' | 'adaptive' | 'strategy-stop' | 'cached-production'
  perStrategyLimit?: number
}

const MAX_CANDIDATES_PER_STRATEGY = 60
const MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY = 8
const DEFAULT_UNIQUE_CANDIDATE_LIMIT = 18
const DEFAULT_PER_STRATEGY_LIMIT = 6
const ADAPTIVE_INITIAL_PER_STRATEGY_LIMIT = 4
const ADAPTIVE_INITIAL_LIMIT = 16
const ADAPTIVE_MID_LIMIT = 24
const ADAPTIVE_MAX_LIMIT = 28
const CLOSE_SCORE_WINDOW = 3
const STRATEGY_STOP_REQUIRED_STREAK = 12
const BURDEN_TIE_BREAK_SCORE_WINDOW = 3
const PROJECTED_REPEAT_BURDEN_THRESHOLD = 3

function combinationKey(players: PlayerSessionState[]): string {
  return players.map((player) => player.player_id).sort().join(':')
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

function getPriorityCandidates(
  players: PlayerSessionState[],
  size: number,
  limit: number,
  source: Strategy,
): Candidate[] {
  if (size > players.length || size <= 0 || limit <= 0) return []

  const result: Candidate[] = []
  const indexes = Array.from({ length: size }, (_, index) => index)
  const queued = new Set<string>()

  function pushCandidate(nextIndexes: number[]) {
    const indexKey = nextIndexes.join(':')
    if (queued.has(indexKey) || result.length >= limit) return
    queued.add(indexKey)
    const selected = nextIndexes.map((index) => players[index])
    result.push({
      players: selected,
      priority: nextIndexes.reduce((sum, index) => sum + index, 0),
      key: combinationKey(selected),
      source,
    })
  }

  pushCandidate(indexes)

  for (let cursor = 0; cursor < result.length && result.length < limit; cursor += 1) {
    const current = result[cursor]
    const currentIndexes = current.players.map((player) => players.findIndex((item) => item.player_id === player.player_id))

    for (let position = size - 1; position >= 0; position -= 1) {
      const nextIndexes = [...currentIndexes]
      const nextValue = nextIndexes[position] + 1
      const upperBound = position === size - 1 ? players.length : nextIndexes[position + 1]
      if (nextValue >= upperBound) continue
      nextIndexes[position] = nextValue
      pushCandidate(nextIndexes)
    }
  }

  return result.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
}

function makeAlternative(
  selected: PlayerSessionState[],
  allPresent: PlayerSessionState[],
  state: SessionState,
  warnings: string[],
  diagnostic: ExperimentalDiagnostic,
  useCachedPartitioning = false,
  partitioningCache?: CachedPartitioningRuntimeCache,
): SuggestionAlternative | null {
  const partition = useCachedPartitioning
    ? bestPartitioningCached(selected, state, partitioningCache)
    : bestPartitioning(selected, state)
  diagnostic.partitionIterations += partition?.iterations ?? 0
  if (!partition) {
    diagnostic.failedCandidates += 1
    return null
  }

  const selectedIds = new Set(selected.map((player) => player.player_id))
  const resting = allPresent
    .filter((player) => !selectedIds.has(player.player_id) && !player.opted_rest)
    .map((player) => player.player_id)
    .sort()

  return {
    matches: partition.matches,
    resting,
    score: partition.score,
    warnings: partition.relaxed_tolerance ? [...warnings, 'PVNA_TOLERANCE_RELAXED'] : warnings,
    stats: partition.stats,
    iterations: partition.iterations,
  }
}

function sortAlternatives(a: SuggestionAlternative, b: SuggestionAlternative) {
  if (a.score !== b.score) return a.score - b.score
  if (a.stats.opponent_repeats !== b.stats.opponent_repeats) {
    return a.stats.opponent_repeats - b.stats.opponent_repeats
  }
  if (a.stats.partner_repeats !== b.stats.partner_repeats) {
    return a.stats.partner_repeats - b.stats.partner_repeats
  }
  return a.matches[0].team_a.join(':').localeCompare(b.matches[0].team_a.join(':'))
}

function sortAlternativesLikeProduction(state: SessionState) {
  return (a: SuggestionAlternative, b: SuggestionAlternative) => {
    const matchCountA = getProjectedMatchCountExcess(a, state)
    const matchCountB = getProjectedMatchCountExcess(b, state)
    if (matchCountA.excess !== matchCountB.excess) return matchCountA.excess - matchCountB.excess
    if (matchCountA.range !== matchCountB.range) return matchCountA.range - matchCountB.range

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
  return { range, excess: Math.max(0, range - 1) }
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

function shouldExpandAdaptive(
  state: SessionState,
  alternatives: SuggestionAlternative[],
  evaluatedCount: number,
): string[] {
  const reasons: string[] = []
  const top = alternatives[0]

  if (!top) return ['no_alternative']
  if (evaluatedCount < ADAPTIVE_INITIAL_LIMIT) reasons.push('initial_batch_underfilled')
  if (alternatives.length < 3) reasons.push('less_than_3_alternatives')
  if (state.current_round <= 2 && evaluatedCount < ADAPTIVE_MAX_LIMIT) reasons.push('early_round')
  if (top.warnings.includes('PVNA_TOLERANCE_RELAXED')) reasons.push('pvna_relaxed')

  const third = alternatives[2]
  if (third && third.score - top.score <= CLOSE_SCORE_WINDOW && evaluatedCount < ADAPTIVE_MID_LIMIT) {
    reasons.push('close_top_3')
  }

  if (top.stats.opponent_repeats >= 6 && evaluatedCount < ADAPTIVE_MAX_LIMIT) {
    reasons.push('opponent_repeats_high')
  }
  if (top.stats.partner_repeats >= 3 && evaluatedCount < ADAPTIVE_MAX_LIMIT) {
    reasons.push('partner_repeats_high')
  }
  if (top.stats.gender_pref_penalty >= 30 && evaluatedCount < ADAPTIVE_MAX_LIMIT) {
    reasons.push('gender_penalty_high')
  }

  const pvnaBudget = (state.config.pvna_tolerance ?? 0.5) * Math.max(1, top.matches.length) + 1
  if (top.stats.pvna_diff >= pvnaBudget && evaluatedCount < ADAPTIVE_MAX_LIMIT) {
    reasons.push('pvna_diff_high')
  }

  return reasons
}

export function suggestNextRoundExperimental(
  state: SessionState,
  options: ExperimentalSuggestOptions = {},
): ExperimentalSuggestionResult {
  const presentPlayers = getPresentPlayers(state)
  const eligiblePlayers = presentPlayers.filter((player) => !player.opted_rest)
  const courtCapacity = Math.max(1, state.config.courts) * 4
  const slots = Math.min(courtCapacity, Math.floor(eligiblePlayers.length / 4) * 4)
  const tierOverrides = options.tier_overrides ?? {}
  const basePick = pickPlayers(state, Math.max(4, slots), tierOverrides)
  const warnings = [...basePick.warnings, ...detectGenderConflicts(eligiblePlayers)]
  const mustPlayOverCapacity = warnings.includes('MUST_PLAY_OVER_CAPACITY')
  const requiredPlayerIds = mustPlayOverCapacity
    ? new Set<string>()
    : new Set(
        eligiblePlayers
          .filter((player) => player.consecutive_rest >= 1)
          .map((player) => player.player_id),
      )

  if (!mustPlayOverCapacity) {
    for (const [playerId, tier] of Object.entries(tierOverrides)) {
      if (tier === Tier.MUST_PLAY && eligiblePlayers.some((player) => player.player_id === playerId)) {
        requiredPlayerIds.add(playerId)
      }
    }
  }

  const diagnostic: ExperimentalDiagnostic = {
    generated: { fairness: 0, rest: 0, diversity: 0, group: 0 },
    duplicateCandidates: 0,
    evaluatedCandidates: 0,
    acceptedCandidates: 0,
    failedCandidates: 0,
    partitionIterations: 0,
    expandedReasons: [],
  }

  if (slots < 4) {
    return { alternatives: [], warnings, should_end: true, diagnostic }
  }

  const strategies: Strategy[] = ['fairness', 'rest', 'diversity', 'group']
  const unique = new Map<string, Candidate>()
  const seen = new Set<string>()
  const alternatives: SuggestionAlternative[] = []
  const partitioningCache = options.mode === 'cached-production' || options.mode === 'cached-global'
    ? createCachedPartitioningRuntimeCache()
    : undefined

  for (const strategy of strategies) {
    const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides)
    const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY, strategy)
    diagnostic.generated[strategy] = candidates.length
    let acceptedForStrategy = 0
    let skippedRequiredStreak = 0

    for (const candidate of candidates) {
      if (requiredPlayerIds.size > 0 && ![...requiredPlayerIds].every((playerId) =>
        candidate.players.some((player) => player.player_id === playerId)
      )) {
        skippedRequiredStreak += 1
        if (
          options.mode === 'strategy-stop' &&
          acceptedForStrategy === 0 &&
          skippedRequiredStreak >= STRATEGY_STOP_REQUIRED_STREAK
        ) {
          diagnostic.expandedReasons = [
            ...(diagnostic.expandedReasons ?? []),
            `${strategy}_required_streak_${skippedRequiredStreak}`,
          ]
          break
        }
        continue
      }
      skippedRequiredStreak = 0

      if (seen.has(candidate.key) || unique.has(candidate.key)) {
        diagnostic.duplicateCandidates += 1
        continue
      }

      if (
        options.mode === 'per-strategy' ||
        options.mode === 'adaptive' ||
        options.mode === 'strategy-stop' ||
        options.mode === 'cached-production'
      ) {
        const strategyLimit = options.mode === 'adaptive'
          ? ADAPTIVE_INITIAL_PER_STRATEGY_LIMIT
          : options.mode === 'strategy-stop'
          ? MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY
          : options.mode === 'cached-production'
          ? MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY
          : options.perStrategyLimit ?? DEFAULT_PER_STRATEGY_LIMIT
        if (acceptedForStrategy >= strategyLimit) break
        if (options.mode === 'adaptive' && acceptedForStrategy >= strategyLimit) {
          unique.set(candidate.key, candidate)
          continue
        }
        diagnostic.evaluatedCandidates += 1
        const alternative = makeAlternative(
          candidate.players,
          presentPlayers,
          state,
          warnings,
          diagnostic,
          options.mode === 'cached-production',
          partitioningCache,
        )
        if (!alternative) continue
        alternatives.push(alternative)
        seen.add(candidate.key)
        diagnostic.acceptedCandidates += 1
        acceptedForStrategy += 1
        continue
      }

      unique.set(candidate.key, candidate)
    }
  }

  if (options.mode === 'per-strategy' || options.mode === 'cached-production') {
    alternatives.sort(options.mode === 'cached-production' ? sortAlternativesLikeProduction(state) : sortAlternatives)

    if (alternatives.length === 0) {
      return {
        alternatives: [],
        warnings: [...warnings, 'NO_VALID_MATCH'],
        should_end: false,
        diagnostic,
      }
    }

    return {
      alternatives: alternatives.slice(0, 3),
      warnings,
      should_end: false,
      diagnostic,
    }
  }

  if (options.mode === 'strategy-stop') {
    alternatives.sort(sortAlternativesLikeProduction(state))

    if (alternatives.length === 0) {
      return {
        alternatives: [],
        warnings: [...warnings, 'NO_VALID_MATCH'],
        should_end: false,
        diagnostic,
      }
    }

    return {
      alternatives: alternatives.slice(0, 3),
      warnings,
      should_end: false,
      diagnostic,
    }
  }

  const adaptiveInitialReasons = options.mode === 'adaptive'
    ? (() => {
        alternatives.sort(sortAlternatives)
        return shouldExpandAdaptive(state, alternatives, diagnostic.evaluatedCandidates)
      })()
    : []

  if (options.mode === 'adaptive' && adaptiveInitialReasons.length === 0) {
    diagnostic.expandedTo = diagnostic.evaluatedCandidates
    diagnostic.expandedReasons = ['initial_batch_passed']
  } else if (options.mode === 'adaptive') {
    diagnostic.expandedReasons = [...new Set([...(diagnostic.expandedReasons ?? []), ...adaptiveInitialReasons])]
  }

  const candidates = (options.mode === 'adaptive' && adaptiveInitialReasons.length === 0 ? [] : [...unique.values()])
    .sort((a, b) => a.priority - b.priority || strategies.indexOf(a.source) - strategies.indexOf(b.source))
    .slice(0, options.mode === 'adaptive'
      ? ADAPTIVE_MAX_LIMIT
      : options.candidateLimit ?? DEFAULT_UNIQUE_CANDIDATE_LIMIT)

  for (const candidate of candidates) {
    if (seen.has(candidate.key)) continue

    if (options.mode === 'adaptive') {
      alternatives.sort(sortAlternatives)
      const targetLimit = diagnostic.evaluatedCandidates < ADAPTIVE_INITIAL_LIMIT
        ? ADAPTIVE_INITIAL_LIMIT
        : diagnostic.evaluatedCandidates < ADAPTIVE_MID_LIMIT
        ? ADAPTIVE_MID_LIMIT
        : ADAPTIVE_MAX_LIMIT
      if (diagnostic.evaluatedCandidates >= targetLimit) {
        const reasons = shouldExpandAdaptive(state, alternatives, diagnostic.evaluatedCandidates)
        if (reasons.length === 0 || diagnostic.evaluatedCandidates >= ADAPTIVE_MAX_LIMIT) break
        diagnostic.expandedReasons = [...new Set([...(diagnostic.expandedReasons ?? []), ...reasons])]
      }
    }

    diagnostic.evaluatedCandidates += 1
    const alternative = makeAlternative(
      candidate.players,
      presentPlayers,
      state,
      warnings,
      diagnostic,
      options.mode === 'cached-global',
      partitioningCache,
    )
    if (!alternative) continue
    alternatives.push(alternative)
    seen.add(candidate.key)
    diagnostic.acceptedCandidates += 1
  }

  alternatives.sort(sortAlternatives)
  if (options.mode === 'adaptive') {
    diagnostic.expandedTo = diagnostic.evaluatedCandidates
    if ((diagnostic.expandedReasons?.length ?? 0) === 0) {
      diagnostic.expandedReasons = ['initial_batch_passed']
    }
  }

  if (alternatives.length === 0) {
    return {
      alternatives: [],
      warnings: [...warnings, 'NO_VALID_MATCH'],
      should_end: false,
      diagnostic,
    }
  }

  return {
    alternatives: alternatives.slice(0, 3),
    warnings,
    should_end: false,
    diagnostic,
  }
}
