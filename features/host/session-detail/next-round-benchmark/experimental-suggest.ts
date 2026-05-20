import { bestPartitioning } from '@/lib/next-round-suggester/pair'
import { getPresentPlayers, pickPlayers, sortPlayersForStrategy } from '@/lib/next-round-suggester/select'
import { detectGenderConflicts } from '@/lib/next-round-suggester/suggest'
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
}

export type ExperimentalSuggestionResult = SuggestionResult & {
  diagnostic: ExperimentalDiagnostic
}

export type ExperimentalSuggestOptions = {
  tier_overrides?: Record<string, Tier>
  candidateLimit?: number
  mode?: 'global' | 'per-strategy'
  perStrategyLimit?: number
}

const MAX_CANDIDATES_PER_STRATEGY = 60
const DEFAULT_UNIQUE_CANDIDATE_LIMIT = 18
const DEFAULT_PER_STRATEGY_LIMIT = 6

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
): SuggestionAlternative | null {
  const partition = bestPartitioning(selected, state)
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
  }

  if (slots < 4) {
    return { alternatives: [], warnings, should_end: true, diagnostic }
  }

  const strategies: Strategy[] = ['fairness', 'rest', 'diversity', 'group']
  const unique = new Map<string, Candidate>()
  const seen = new Set<string>()
  const alternatives: SuggestionAlternative[] = []

  for (const strategy of strategies) {
    const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides)
    const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY, strategy)
    diagnostic.generated[strategy] = candidates.length
    let acceptedForStrategy = 0

    for (const candidate of candidates) {
      if (requiredPlayerIds.size > 0 && ![...requiredPlayerIds].every((playerId) =>
        candidate.players.some((player) => player.player_id === playerId)
      )) {
        continue
      }

      if (seen.has(candidate.key) || unique.has(candidate.key)) {
        diagnostic.duplicateCandidates += 1
        continue
      }

      if (options.mode === 'per-strategy') {
        if (acceptedForStrategy >= (options.perStrategyLimit ?? DEFAULT_PER_STRATEGY_LIMIT)) break
        diagnostic.evaluatedCandidates += 1
        const alternative = makeAlternative(candidate.players, presentPlayers, state, warnings, diagnostic)
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

  if (options.mode === 'per-strategy') {
    alternatives.sort(sortAlternatives)

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

  const candidates = [...unique.values()]
    .sort((a, b) => a.priority - b.priority || strategies.indexOf(a.source) - strategies.indexOf(b.source))
    .slice(0, options.candidateLimit ?? DEFAULT_UNIQUE_CANDIDATE_LIMIT)

  for (const candidate of candidates) {
    diagnostic.evaluatedCandidates += 1
    const alternative = makeAlternative(candidate.players, presentPlayers, state, warnings, diagnostic)
    if (!alternative) continue
    alternatives.push(alternative)
    diagnostic.acceptedCandidates += 1
  }

  alternatives.sort(sortAlternatives)

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
