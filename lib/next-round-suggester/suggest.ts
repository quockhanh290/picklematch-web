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

function combinationKey(players: PlayerSessionState[]): string {
  return players.map((player) => player.player_id).sort().join(':')
}

function getCombinations(players: PlayerSessionState[], size: number): PlayerSessionState[][] {
  const result: PlayerSessionState[][] = []

  function walk(start: number, selected: PlayerSessionState[]) {
    if (selected.length === size) {
      result.push([...selected])
      return
    }

    for (let i = start; i < players.length; i += 1) {
      selected.push(players[i])
      walk(i + 1, selected)
      selected.pop()
    }
  }

  walk(0, [])
  return result
}

function emptyStats(): MatchStats {
  return {
    elo_diff: 0,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
  }
}

const MAX_CANDIDATES_PER_STRATEGY = 250

function makeAlternative(
  selected: PlayerSessionState[],
  allPresent: PlayerSessionState[],
  state: SessionState,
  warnings: string[],
): SuggestionAlternative | null {
  const startedAt = Date.now()
  const partition = bestPartitioning(selected, state)
  if (!partition) return null

  const selectedIds = new Set(selected.map((player) => player.player_id))
  const resting = allPresent
    .filter((player) => !selectedIds.has(player.player_id))
    .map((player) => player.player_id)
    .sort()

  return {
    matches: partition.matches,
    resting,
    score: partition.score,
    warnings,
    stats: partition.stats,
    runtime_ms: Date.now() - startedAt,
    iterations: partition.iterations,
  }
}

export function suggestNextRound(state: SessionState): SuggestionResult {
  const presentPlayers = getPresentPlayers(state)
  const eligiblePlayers = presentPlayers.filter((player) => !player.opted_rest)
  const courtCapacity = Math.max(1, state.config.courts) * 4
  const slots = Math.min(courtCapacity, Math.floor(eligiblePlayers.length / 4) * 4)
  const basePick = pickPlayers(state, Math.max(4, slots))
  const warnings = [...basePick.warnings]

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
    const sorted = sortPlayersForStrategy(eligiblePlayers, strategy)
    const candidates = getCombinations(sorted, slots)
      .map((players) => {
        const strategyIndexes = new Map(sorted.map((player, index) => [player.player_id, index]))
        const priority = players.reduce(
          (sum, player) => sum + (strategyIndexes.get(player.player_id) ?? 0),
          0,
        )
        return { players, priority }
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return combinationKey(a.players).localeCompare(combinationKey(b.players))
      })
      .slice(0, MAX_CANDIDATES_PER_STRATEGY)

    for (const candidate of candidates) {
      const key = combinationKey(candidate.players)
      if (seen.has(key)) continue

      const alternative = makeAlternative(candidate.players, presentPlayers, state, warnings)
      if (!alternative) continue

      alternatives.push(alternative)
      seen.add(key)
      break
    }
  }

  alternatives.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
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

export function getEmptySuggestion(): SuggestionAlternative {
  return {
    matches: [],
    resting: [],
    score: Infinity,
    warnings: [],
    stats: emptyStats(),
  }
}
