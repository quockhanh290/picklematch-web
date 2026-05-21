// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { scoreMatch } from './score.ts'
import type { Match, MatchScore, PlayerSessionState, SessionState, Team } from './types'

export type TeamSplitResult = {
  match: Match
  score: number
  stats: MatchScore['stats']
}

export type PartitioningResult = {
  matches: Match[]
  score: number
  stats: MatchScore['stats']
  iterations: number
  relaxed_tolerance?: boolean
}

export type PartitioningDiagnostic = {
  player_count: number
  max_iterations: number
  partition_count: number
  exhaustive: boolean
  strict_iterations: number
  relaxed_iterations: number
  found: boolean
  relaxed_tolerance: boolean
}

type SplitCacheEntry = TeamSplitResult | null
type Burden = { max: number; avg: number; overThreshold: number }

export type PartitioningRuntimeCache = {
  split: Map<string, SplitCacheEntry>
  burden: Map<string, Burden>
}

export function createPartitioningRuntimeCache(): PartitioningRuntimeCache {
  return {
    split: new Map(),
    burden: new Map(),
  }
}

const SPLIT_INDEXES: Array<[number, number, number, number]> = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
]

export function bestTeamSplit(players: PlayerSessionState[], state: SessionState): TeamSplitResult | null {
  if (players.length !== 4) return null

  let best: TeamSplitResult | null = null

  for (const [a1, a2, b1, b2] of SPLIT_INDEXES) {
    const teamA: Team = [players[a1].player_id, players[a2].player_id]
    const teamB: Team = [players[b1].player_id, players[b2].player_id]
    const scored = scoreMatch(teamA, teamB, state)

    if (!Number.isFinite(scored.score)) continue

    const result: TeamSplitResult = {
      match: {
        court_idx: 0,
        team_a: teamA,
        team_b: teamB,
      },
      score: scored.score,
      stats: scored.stats,
    }

    if (!best || result.score < best.score) {
      best = result
    }
  }

  return best
}

const EXHAUSTIVE_MAX_ITER = 20000
const SAMPLED_MAX_ITER = 600
const SAMPLED_MAX_ITER_3_COURTS = 2000
const SAMPLED_MAX_ITER_4_PLUS_COURTS = 3000
const BURDEN_TIE_BREAK_SCORE_WINDOW = 3
const PROJECTED_REPEAT_BURDEN_THRESHOLD = 3
const PARTITION_COUNT_CAP = 1_000_000_000

function teamKey(team: Team) {
  return [...team].sort().join(':')
}

function splitCacheKey(players: PlayerSessionState[], tolerance?: number) {
  return `${players.map((player) => player.player_id).sort().join(':')}|${tolerance ?? 'strict'}`
}

function matchesKey(matches: Match[]) {
  return matches
    .map((match) => `${teamKey(match.team_a)}>${teamKey(match.team_b)}`)
    .sort()
    .join('|')
}

function addStats(a: MatchScore['stats'], b: MatchScore['stats']): MatchScore['stats'] {
  return {
    pvna_diff: a.pvna_diff + b.pvna_diff,
    partner_repeats: a.partner_repeats + b.partner_repeats,
    opponent_repeats: a.opponent_repeats + b.opponent_repeats,
    group_bonus: a.group_bonus + b.group_bonus,
    gender_pref_penalty: a.gender_pref_penalty + b.gender_pref_penalty,
  }
}

function zeroStats(): MatchScore['stats'] {
  return {
    pvna_diff: 0,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
  }
}

function evaluatePartition(
  groups: PlayerSessionState[][],
  state: SessionState,
  iteration: number,
  cache?: PartitioningRuntimeCache,
  options: { tolerance?: number; relaxedTolerance?: boolean } = {},
): PartitioningResult | null {
  let score = 0
  let stats = zeroStats()
  const matches: Match[] = []

  for (let courtIdx = 0; courtIdx < groups.length; courtIdx += 1) {
    const split = bestTeamSplitWithTolerance(groups[courtIdx], state, options.tolerance, cache)
    if (!split) return null

    matches.push({
      ...split.match,
      court_idx: courtIdx,
      score: split.score,
      stats: split.stats,
    })
    score += split.score
    stats = addStats(stats, split.stats)
  }

  return {
    matches,
    score,
    stats,
    iterations: iteration,
    relaxed_tolerance: options.relaxedTolerance,
  }
}

function shouldReplaceBestPartition(
  candidate: PartitioningResult,
  best: PartitioningResult | null,
  state: SessionState,
  cache?: PartitioningRuntimeCache,
): boolean {
  if (!best) return true

  const scoreDiff = candidate.score - best.score
  if (scoreDiff < -BURDEN_TIE_BREAK_SCORE_WINDOW) return true
  if (scoreDiff > BURDEN_TIE_BREAK_SCORE_WINDOW) return false

  const candidateOpponentBurden = getProjectedBurden(candidate.matches, state, 'opponent', cache)
  const bestOpponentBurden = getProjectedBurden(best.matches, state, 'opponent', cache)
  if (candidateOpponentBurden.overThreshold !== bestOpponentBurden.overThreshold) {
    return candidateOpponentBurden.overThreshold < bestOpponentBurden.overThreshold
  }
  if (candidateOpponentBurden.max !== bestOpponentBurden.max) {
    return candidateOpponentBurden.max < bestOpponentBurden.max
  }
  if (candidateOpponentBurden.avg !== bestOpponentBurden.avg) {
    return candidateOpponentBurden.avg < bestOpponentBurden.avg
  }

  const candidatePartnerBurden = getProjectedBurden(candidate.matches, state, 'partner', cache)
  const bestPartnerBurden = getProjectedBurden(best.matches, state, 'partner', cache)
  if (candidatePartnerBurden.overThreshold !== bestPartnerBurden.overThreshold) {
    return candidatePartnerBurden.overThreshold < bestPartnerBurden.overThreshold
  }
  if (candidatePartnerBurden.max !== bestPartnerBurden.max) {
    return candidatePartnerBurden.max < bestPartnerBurden.max
  }
  if (candidatePartnerBurden.avg !== bestPartnerBurden.avg) {
    return candidatePartnerBurden.avg < bestPartnerBurden.avg
  }

  return scoreDiff < 0
}

function getProjectedBurden(
  matches: Match[],
  state: SessionState,
  kind: 'partner' | 'opponent',
  cache?: PartitioningRuntimeCache,
): Burden {
  const key = `${kind}|${matchesKey(matches)}`
  const cached = cache?.burden.get(key)
  if (cached) return cached

  const repeatedCounts = new Map<string, Set<string>>(
    [...state.players.keys()].map((playerId) => [playerId, new Set<string>()]),
  )

  for (const match of matches) {
    const pairs =
      kind === 'partner'
        ? [
            [match.team_a[0], match.team_a[1]],
            [match.team_b[0], match.team_b[1]],
          ]
        : [
            [match.team_a[0], match.team_b[0]],
            [match.team_a[0], match.team_b[1]],
            [match.team_a[1], match.team_b[0]],
            [match.team_a[1], match.team_b[1]],
          ]

    for (const [playerA, playerB] of pairs) {
      if (isProjectedBurdenRepeat(playerA, playerB, state, kind)) {
        repeatedCounts.get(playerA)?.add(playerB)
        repeatedCounts.get(playerB)?.add(playerA)
      }
    }
  }

  const counts = [...repeatedCounts.values()].map((players) => players.size)
  const result = counts.length === 0
    ? { max: 0, avg: 0, overThreshold: 0 }
    : {
        max: Math.max(...counts),
        avg: counts.reduce((sum, count) => sum + count, 0) / counts.length,
        overThreshold: counts.filter((count) => count >= PROJECTED_REPEAT_BURDEN_THRESHOLD).length,
      }

  cache?.burden.set(key, result)
  return result
}

function isProjectedBurdenRepeat(
  playerA: string,
  playerB: string,
  state: SessionState,
  kind: 'partner' | 'opponent',
): boolean {
  const stateA = state.players.get(playerA)
  const stateB = state.players.get(playerB)
  if (!stateA || !stateB) return false

  const currentCount =
    kind === 'partner'
      ? stateA.partner_counts.get(playerB) ?? 0
      : stateA.opponent_counts.get(playerB) ?? 0
  const projectedCount = currentCount + 1
  const sameGroup = Boolean(stateA.group_id && stateA.group_id === stateB.group_id)

  return sameGroup ? projectedCount > 2 : projectedCount > 1
}

function bestTeamSplitWithTolerance(
  players: PlayerSessionState[],
  state: SessionState,
  tolerance?: number,
  cache?: PartitioningRuntimeCache,
): TeamSplitResult | null {
  if (players.length !== 4) return null

  const key = splitCacheKey(players, tolerance)
  if (cache?.split.has(key)) return cache.split.get(key) ?? null

  let best: TeamSplitResult | null = null

  for (const [a1, a2, b1, b2] of SPLIT_INDEXES) {
    const teamA: Team = [players[a1].player_id, players[a2].player_id]
    const teamB: Team = [players[b1].player_id, players[b2].player_id]
    const scored = scoreMatch(teamA, teamB, state, tolerance === undefined ? {} : { tolerance })

    if (!Number.isFinite(scored.score)) continue

    const result: TeamSplitResult = {
      match: {
        court_idx: 0,
        team_a: teamA,
        team_b: teamB,
      },
      score: scored.score,
      stats: scored.stats,
    }

    if (!best || result.score < best.score) {
      best = result
    }
  }

  cache?.split.set(key, best)
  return best
}

function getCombinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []

  function walk(start: number, selected: T[]) {
    if (selected.length === size) {
      result.push([...selected])
      return
    }

    for (let i = start; i < items.length; i += 1) {
      selected.push(items[i])
      walk(i + 1, selected)
      selected.pop()
    }
  }

  walk(0, [])
  return result
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(players: PlayerSessionState[], seed: number): PlayerSessionState[] {
  const random = seededRandom(seed)
  const copy = [...players]

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = copy[i]
    copy[i] = copy[j]
    copy[j] = temp
  }

  return copy
}

function chunkIntoCourts(players: PlayerSessionState[]): PlayerSessionState[][] {
  const groups: PlayerSessionState[][] = []
  for (let i = 0; i < players.length; i += 4) {
    groups.push(players.slice(i, i + 4))
  }
  return groups
}

function historySignature(players: PlayerSessionState[]): string {
  return players
    .map((player) => {
      const partnerTotal = [...player.partner_counts.values()].reduce((sum, count) => sum + count, 0)
      const opponentTotal = [...player.opponent_counts.values()].reduce((sum, count) => sum + count, 0)
      return `${player.player_id}:${player.matches_played}:${partnerTotal}:${opponentTotal}`
    })
    .join('|')
}

function combinationCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  const effectiveK = Math.min(k, n - k)
  let result = 1
  for (let i = 1; i <= effectiveK; i += 1) {
    result = (result * (n - effectiveK + i)) / i
    if (result > PARTITION_COUNT_CAP) return PARTITION_COUNT_CAP
  }
  return Math.round(result)
}

function estimateUniqueCourtPartitions(playerCount: number): number {
  if (playerCount < 4 || playerCount % 4 !== 0) return 0
  let remaining = playerCount
  let total = 1

  while (remaining > 0) {
    total *= combinationCount(remaining - 1, 3)
    if (total > PARTITION_COUNT_CAP) return PARTITION_COUNT_CAP
    remaining -= 4
  }

  return Math.round(total)
}

function defaultMaxIterations(playerCount: number): number {
  const partitionCount = estimateUniqueCourtPartitions(playerCount)
  if (partitionCount <= EXHAUSTIVE_MAX_ITER) return EXHAUSTIVE_MAX_ITER

  const courts = playerCount / 4
  if (courts <= 2) return SAMPLED_MAX_ITER
  if (courts === 3) return SAMPLED_MAX_ITER_3_COURTS
  return SAMPLED_MAX_ITER_4_PLUS_COURTS
}

export function bestPartitioning(
  players: PlayerSessionState[],
  state: SessionState,
  options: {
    maxIterations?: number
    diagnostics?: (diagnostic: PartitioningDiagnostic) => void
    cache?: PartitioningRuntimeCache
  } = {},
): PartitioningResult | null {
  if (players.length < 4 || players.length % 4 !== 0) return null

  const normalizedPlayers = [...players].sort((a, b) => a.player_id.localeCompare(b.player_id))
  const maxIterations = options.maxIterations ?? defaultMaxIterations(normalizedPlayers.length)
  const partitionCount = estimateUniqueCourtPartitions(normalizedPlayers.length)
  const canSearchExhaustively = partitionCount > 0 && partitionCount <= maxIterations

  function runSearch(
    searchOptions: { tolerance?: number; relaxedTolerance?: boolean } = {},
  ): { result: PartitioningResult | null; iterations: number } {
    let best: PartitioningResult | null = null
    let iterations = 0

    function consider(groups: PlayerSessionState[][]) {
      if (iterations >= maxIterations) return
      iterations += 1
      const result = evaluatePartition(groups, state, iterations, options.cache, searchOptions)
      if (!result) return
      if (shouldReplaceBestPartition(result, best, state, options.cache)) {
        best = result
      }
    }

    if (canSearchExhaustively) {
      function walk(remaining: PlayerSessionState[], groups: PlayerSessionState[][]) {
        if (iterations >= maxIterations) return
        if (remaining.length === 0) {
          consider(groups)
          return
        }

        const [anchor, ...rest] = remaining
        for (const combo of getCombinations(rest, 3)) {
          const comboIds = new Set(combo.map((player) => player.player_id))
          const nextRemaining = rest.filter((player) => !comboIds.has(player.player_id))
          walk(nextRemaining, [...groups, [anchor, ...combo]])
        }
      }

      walk(normalizedPlayers, [])
      const finalBest = best as PartitioningResult | null
      return {
        result: finalBest
          ? {
              matches: finalBest.matches,
              score: finalBest.score,
              stats: finalBest.stats,
              iterations,
              relaxed_tolerance: finalBest.relaxed_tolerance,
            }
          : null,
        iterations,
      }
    }

    consider(chunkIntoCourts(normalizedPlayers))

    const seedBase = hashString(
      `${state.current_round}|${normalizedPlayers.map((player) => player.player_id).join(':')}|${historySignature(normalizedPlayers)}`,
    )
    while (iterations < maxIterations) {
      consider(chunkIntoCourts(shuffled(normalizedPlayers, seedBase + iterations)))
    }

    const finalBest = best as PartitioningResult | null
    return {
      result: finalBest
      ? {
          matches: finalBest.matches,
          score: finalBest.score,
          stats: finalBest.stats,
          iterations,
          relaxed_tolerance: finalBest.relaxed_tolerance,
        }
      : null,
      iterations,
    }
  }

  const strict = runSearch()
  if (strict.result) {
    options.diagnostics?.({
      player_count: normalizedPlayers.length,
      max_iterations: maxIterations,
      partition_count: partitionCount,
      exhaustive: canSearchExhaustively,
      strict_iterations: strict.iterations,
      relaxed_iterations: 0,
      found: true,
      relaxed_tolerance: false,
    })
    return strict.result
  }

  const relaxed = runSearch({
    tolerance: Number.POSITIVE_INFINITY,
    relaxedTolerance: true,
  })
  options.diagnostics?.({
    player_count: normalizedPlayers.length,
    max_iterations: maxIterations,
    partition_count: partitionCount,
    exhaustive: canSearchExhaustively,
    strict_iterations: strict.iterations,
    relaxed_iterations: relaxed.iterations,
    found: Boolean(relaxed.result),
    relaxed_tolerance: Boolean(relaxed.result),
  })
  return relaxed.result
}
