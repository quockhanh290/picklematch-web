// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { bestPartitioning } from './pair.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getPresentPlayers, pickPlayers, sortPlayersForStrategy } from './select.ts'
import type {
  MatchStats,
  PlayerSessionState,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
} from './types'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { Tier } from './classify.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { computeProjectedOpponentRepeatBurden } from './fairness/metrics.ts'

export type SuggestNextRoundOptions = {
  tier_overrides?: Record<string, Tier>
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

function makeAlternative(
  selected: PlayerSessionState[],
  allPresent: PlayerSessionState[],
  state: SessionState,
  warnings: string[],
): SuggestionAlternative | null {
  const partition = bestPartitioning(selected, state)
  if (!partition) return null
  const alternativeWarnings = partition.relaxed_tolerance
    ? [...warnings, 'PVNA_TOLERANCE_RELAXED']
    : warnings

  const selectedIds = new Set(selected.map((player) => player.player_id))
  const resting = allPresent
    .filter((player) => !selectedIds.has(player.player_id))
    .map((player) => player.player_id)
    .sort()

  return {
    matches: partition.matches,
    resting,
    score: partition.score,
    warnings: alternativeWarnings,
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
  const requiredPlayerIds = warnings.includes('MUST_PLAY_OVER_CAPACITY')
    ? new Set<string>()
    : new Set(
        eligiblePlayers
          .filter((player) => player.consecutive_rest >= 1)
          .map((player) => player.player_id),
      )

  for (const [playerId, tier] of Object.entries(tierOverrides)) {
    if (tier === Tier.MUST_PLAY && eligiblePlayers.some((player) => player.player_id === playerId)) {
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
  const seen = new Set<string>()
  const strategies: Array<'fairness' | 'rest' | 'diversity'> = ['fairness', 'rest', 'diversity']

  for (const strategy of strategies) {
    const sorted = sortPlayersForStrategy(eligiblePlayers, strategy, tierOverrides)
    const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY)
    let acceptedForStrategy = 0

    for (const candidate of candidates) {
      if (acceptedForStrategy >= MAX_ACCEPTED_ALTERNATIVES_PER_STRATEGY) break
      const key = combinationKey(candidate.players)
      if (seen.has(key)) continue
      if (
        requiredPlayerIds.size > 0 &&
        ![...requiredPlayerIds].every((playerId) =>
          candidate.players.some((player) => player.player_id === playerId),
        )
      ) {
        continue
      }

      const alternative = makeAlternative(candidate.players, presentPlayers, state, warnings)
      if (!alternative) continue

      alternatives.push(alternative)
      seen.add(key)
      acceptedForStrategy += 1
    }
  }

  alternatives.sort((a, b) => {
    const scoreDiff = a.score - b.score
    if (Math.abs(scoreDiff) > BURDEN_TIE_BREAK_SCORE_WINDOW) return scoreDiff

    const burdenA = getProjectedOpponentBurden(a, state)
    const burdenB = getProjectedOpponentBurden(b, state)
    if (burdenA.max !== burdenB.max) return burdenA.max - burdenB.max
    if (burdenA.avg !== burdenB.avg) return burdenA.avg - burdenB.avg
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
    return {
      alternatives: [],
      warnings: [...warnings, 'NO_VALID_MATCH'],
      should_end: false,
    }
  }

  return {
    alternatives: alternatives.slice(0, 3),
    warnings,
    should_end: false,
  }
}

function getProjectedOpponentBurden(
  alternative: SuggestionAlternative,
  state: SessionState,
): { max: number; avg: number } {
  const burden = computeProjectedOpponentRepeatBurden(state, alternative.matches)
  return {
    max: burden.max_repeated_opponents,
    avg: burden.avg_repeated_opponents,
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
