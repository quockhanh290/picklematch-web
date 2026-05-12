export type RoundRobinMatch = {
  teamA: string[]
  teamB: string[]
  rotation: number
  court: number
  sitterIds: string[]
}

export type RoundRobinSchedule = {
  matches: RoundRobinMatch[]
  rounds: number
  courtsPerRound: number
  sittersPerRound: number
  gamesCount: Record<string, number>
  sitCount: Record<string, number>
  quality?: {
    runtimeMs: number
    timedOut: boolean
    fallbackUsed: boolean
  }
}

export type SchedulePriority = 'balanced' | 'partner' | 'opponent'

export type RoundRobinScheduleOptions = {
  minGamesPerPlayer?: number
  priority?: SchedulePriority
  maxRuntimeMs?: number
}

type PairMap = Record<string, number>
type Split = [[number, number], [number, number]]
type PartnerPair = [number, number]

const pairKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
const getPairValue = (map: PairMap, a: number, b: number) => map[pairKey(a, b)] || 0
const incrementPair = (map: PairMap, a: number, b: number) => {
  const key = pairKey(a, b)
  map[key] = (map[key] || 0) + 1
}

const nowMs = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

type RuntimeGuard = {
  startedAt: number
  maxRuntimeMs?: number | null
  timedOut: boolean
}

const createRuntimeGuard = (maxRuntimeMs?: number | null): RuntimeGuard => ({
  startedAt: nowMs(),
  maxRuntimeMs: maxRuntimeMs && maxRuntimeMs > 0 ? maxRuntimeMs : null,
  timedOut: false,
})

function hasTimedOut(guard?: RuntimeGuard | null) {
  if (!guard?.maxRuntimeMs) return false
  if (guard.timedOut) return true
  guard.timedOut = nowMs() - guard.startedAt >= guard.maxRuntimeMs
  return guard.timedOut
}

function getCombos(arr: number[], k: number): number[][] {
  const result: number[][] = []
  const current: number[] = []

  function walk(start: number) {
    if (current.length === k) {
      result.push([...current])
      return
    }

    for (let i = start; i <= arr.length - (k - current.length); i += 1) {
      current.push(arr[i])
      walk(i + 1)
      current.pop()
    }
  }

  walk(0)
  return result
}

function getLocalSplitWeights(priority: SchedulePriority = 'balanced') {
  if (priority === 'partner') return { partner: 160, opponent: 8 }
  if (priority === 'opponent') return { partner: 25, opponent: 90 }
  return { partner: 90, opponent: 12 }
}

function splitScore(split: Split, partnerMap: PairMap, opponentMap: PairMap, priority: SchedulePriority = 'balanced') {
  const weights = getLocalSplitWeights(priority)
  const [[a, b], [c, d]] = split
  const partnerRepeats = getPairValue(partnerMap, a, b) + getPairValue(partnerMap, c, d)
  const opponentRepeats =
    getPairValue(opponentMap, a, c) +
    getPairValue(opponentMap, a, d) +
    getPairValue(opponentMap, b, c) +
    getPairValue(opponentMap, b, d)

  return partnerRepeats * weights.partner + opponentRepeats * weights.opponent
}

function splitOptions([a, b, c, d]: number[]): Split[] {
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ]
}

function bestSplitOf(court: number[], partnerMap: PairMap, opponentMap: PairMap, priority: SchedulePriority = 'balanced'): Split {
  return splitOptions(court).reduce((best, current) => {
    return splitScore(current, partnerMap, opponentMap, priority) < splitScore(best, partnerMap, opponentMap, priority)
      ? current
      : best
  })
}

function courtScore(court: number[], partnerMap: PairMap, opponentMap: PairMap, priority: SchedulePriority = 'balanced') {
  return splitScore(bestSplitOf(court, partnerMap, opponentMap, priority), partnerMap, opponentMap, priority)
}

function chooseBestPartition(
  active: number[],
  courtCount: number,
  partnerMap: PairMap,
  opponentMap: PairMap,
  priority: SchedulePriority = 'balanced'
) {
  let bestPartition: number[][] = []
  let bestScore = Number.POSITIVE_INFINITY
  const candidateLimit = courtCount <= 3 ? Number.POSITIVE_INFINITY : 80

  function search(remaining: number[], partition: number[][], score: number): boolean {
    if (partition.length === courtCount) {
      if (score < bestScore) {
        bestScore = score
        bestPartition = partition.map(court => [...court])
      }
      return score === 0
    }

    if (score >= bestScore) return false

    // Anchor on the first remaining player to avoid evaluating duplicate court partitions.
    const anchor = remaining[0]
    const candidates = getCombos(remaining.slice(1), 3)
      .map(rest => [anchor, ...rest])
      .sort((left, right) => courtScore(left, partnerMap, opponentMap, priority) - courtScore(right, partnerMap, opponentMap, priority))
      .slice(0, candidateLimit)

    for (const court of candidates) {
      const nextScore = score + courtScore(court, partnerMap, opponentMap, priority)
      const nextRemaining = remaining.filter(player => !court.includes(player))
      if (search(nextRemaining, [...partition, court], nextScore)) return true
    }

    return false
  }

  search(active, [], 0)
  return bestPartition
}

function buildExhaustiveSingleCourtSchedule(playerIndexes: number[]): Split[] | null {
  if (playerIndexes.length !== 9) return null

  // Precomputed exact Kirkman-style schedule for 9 players on 1 court.
  // It avoids runtime backtracking on the UI thread while preserving:
  // partner pair = exactly 1, opponent pair = exactly 2.
  const template: Split[] = [
    [[0, 1], [2, 3]],
    [[4, 7], [6, 8]],
    [[0, 2], [4, 5]],
    [[1, 6], [5, 7]],
    [[0, 3], [6, 7]],
    [[2, 8], [3, 7]],
    [[0, 4], [1, 8]],
    [[2, 5], [3, 8]],
    [[0, 5], [1, 3]],
    [[1, 4], [5, 6]],
    [[0, 6], [7, 8]],
    [[2, 7], [3, 4]],
    [[0, 7], [2, 4]],
    [[1, 2], [3, 6]],
    [[0, 8], [1, 5]],
    [[1, 7], [5, 8]],
    [[2, 6], [4, 8]],
    [[3, 5], [4, 6]],
  ]

  return template.map(([[a, b], [c, d]]) => [[playerIndexes[a], playerIndexes[b]], [playerIndexes[c], playerIndexes[d]]] as Split)
}

function reorderSingleCourtMatchesForPace(matches: Split[], playerIndexes: number[]) {
  const remaining = [...matches]
  const ordered: Split[] = []
  const gamesCount = Object.fromEntries(playerIndexes.map(player => [player, 0])) as Record<number, number>
  let previousPlayers = new Set<number>()

  while (remaining.length > 0) {
    let bestIndex = 0
    let bestScore = Number.POSITIVE_INFINITY

    remaining.forEach((match, index) => {
      const playersInMatch = [...match[0], ...match[1]]
      const projectedCounts = { ...gamesCount }
      playersInMatch.forEach(player => { projectedCounts[player] += 1 })
      const counts = playerIndexes.map(player => projectedCounts[player])
      const range = Math.max(...counts) - Math.min(...counts)
      const alreadyBusyPenalty = playersInMatch.filter(player => previousPlayers.has(player)).length
      const currentGameSum = playersInMatch.reduce((sum, player) => sum + gamesCount[player], 0)
      const maxCurrentGames = Math.max(...playersInMatch.map(player => gamesCount[player]))

      const score =
        range * 1000 +
        alreadyBusyPenalty * 100 +
        maxCurrentGames * 10 +
        currentGameSum

      if (score < bestScore) {
        bestScore = score
        bestIndex = index
      }
    })

    const [picked] = remaining.splice(bestIndex, 1)
    ordered.push(picked)
    const pickedPlayers = [...picked[0], ...picked[1]]
    pickedPlayers.forEach(player => { gamesCount[player] += 1 })
    previousPlayers = new Set(pickedPlayers)
  }

  return ordered
}

type RoundCandidate = {
  courts: Split[]
  sitters: number[]
}

type SearchState = {
  rounds: RoundCandidate[]
  partnerMap: PairMap
  opponentMap: PairMap
  gamesCount: Record<number, number>
  sitCount: Record<number, number>
}

const fullRotationTemplateCache = new Map<string, RoundCandidate[]>()
const exactPartnerTemplatePlayerCounts = new Set([4, 5, 8, 9, 12, 13, 16, 17, 20])
const nearExactPartnerTemplatePlayerCounts = new Set([6, 7, 10, 11, 14, 15, 18, 19])

const SCORE_WEIGHTS: Record<SchedulePriority, {
  partnerRepeat: number
  partnerMissing: number
  opponentOverTarget: number
  opponentMissing: number
  opponentDistance: number
  gamesRange: number
  sitRange: number
  uniquePartnerReward: number
  uniqueOpponentReward: number
}> = {
  balanced: {
    partnerRepeat: 1_000_000,
    partnerMissing: 500_000,
    opponentOverTarget: 100_000,
    opponentMissing: 25_000,
    opponentDistance: 1_000,
    gamesRange: 500,
    sitRange: 250,
    uniquePartnerReward: 1_000,
    uniqueOpponentReward: 100,
  },
  partner: {
    partnerRepeat: 1_500_000,
    partnerMissing: 800_000,
    opponentOverTarget: 80_000,
    opponentMissing: 20_000,
    opponentDistance: 800,
    gamesRange: 500,
    sitRange: 250,
    uniquePartnerReward: 1_500,
    uniqueOpponentReward: 250,
  },
  opponent: {
    partnerRepeat: 400_000,
    partnerMissing: 150_000,
    opponentOverTarget: 500_000,
    opponentMissing: 250_000,
    opponentDistance: 4_000,
    gamesRange: 500,
    sitRange: 250,
    uniquePartnerReward: 400,
    uniqueOpponentReward: 1_200,
  },
}

const clonePairMap = (map: PairMap): PairMap => ({ ...map })
const cloneCountMap = (map: Record<number, number>) => ({ ...map })

function buildCirclePartnerRounds(playerIndexes: number[]) {
  const dummy = -1
  const circle = playerIndexes.length % 2 === 0
    ? [...playerIndexes]
    : [...playerIndexes, dummy]
  const rounds: Array<Array<[number, number]>> = []

  for (let round = 0; round < circle.length - 1; round += 1) {
    const pairs: Array<[number, number]> = []
    for (let index = 0; index < circle.length / 2; index += 1) {
      const left = circle[index]
      const right = circle[circle.length - 1 - index]
      if (left !== dummy && right !== dummy) pairs.push([left, right])
    }
    rounds.push(pairs)

    const fixed = circle[0]
    const rotated = [fixed, circle[circle.length - 1], ...circle.slice(1, circle.length - 1)]
    circle.splice(0, circle.length, ...rotated)
  }

  return rounds
}

function opponentRepeatScore(split: Split, opponentMap: PairMap, priority: SchedulePriority) {
  const [[a, b], [c, d]] = split
  const opponentRepeats =
    getPairValue(opponentMap, a, c) +
    getPairValue(opponentMap, a, d) +
    getPairValue(opponentMap, b, c) +
    getPairValue(opponentMap, b, d)
  const weights = getLocalSplitWeights(priority)
  return opponentRepeats * weights.opponent
}

function pairPartnerPairsForTemplate(
  partnerPairs: PartnerPair[],
  opponentMap: PairMap,
  priority: SchedulePriority
): Split[] {
  let bestMatches: Split[] = []
  let bestScore = Number.POSITIVE_INFINITY

  function search(remaining: Array<[number, number]>, matches: Split[], score: number) {
    if (score > bestScore) return
    if (remaining.length === 0) {
      if (score < bestScore) {
        bestScore = score
        bestMatches = matches.map(match => [[...match[0]], [...match[1]]] as Split)
      }
      return
    }

    const first = remaining[0]
    for (let index = 1; index < remaining.length; index += 1) {
      const second = remaining[index]
      const split: Split = [[first[0], first[1]], [second[0], second[1]]]
      const nextRemaining = remaining.filter((_, itemIndex) => itemIndex !== 0 && itemIndex !== index)
      search(nextRemaining, [...matches, split], score + opponentRepeatScore(split, opponentMap, priority))
    }
  }

  search(partnerPairs, [], 0)
  return bestMatches
}

function buildAllPartnerPairs(playerIndexes: number[]): PartnerPair[] {
  return getCombos(playerIndexes, 2).map(([a, b]) => [a, b])
}

function findMostConstrainedPartnerPairIndex(remaining: PartnerPair[]) {
  let bestIndex = 0
  let bestCandidateCount = Number.POSITIVE_INFINITY

  remaining.forEach(([a, b], index) => {
    const candidateCount = remaining.filter(([c, d], candidateIndex) => {
      return candidateIndex !== index && a !== c && a !== d && b !== c && b !== d
    }).length

    if (candidateCount < bestCandidateCount) {
      bestCandidateCount = candidateCount
      bestIndex = index
    }
  })

  return bestIndex
}

function buildGreedyPartnerPairMatches(
  playerIndexes: number[],
  priority: SchedulePriority
): Split[] | null {
  const remaining = buildAllPartnerPairs(playerIndexes)
  const opponentMap: PairMap = {}

  if (remaining.length % 2 === 1) {
    // A full doubles match consumes 2 partner pairs, so odd pair counts need
    // exactly one repeated partner pair to still cover every unique partner.
    remaining.push([playerIndexes[0], playerIndexes[1]])
  }

  const matches: Split[] = []

  while (remaining.length > 0) {
    const firstIndex = findMostConstrainedPartnerPairIndex(remaining)
    const [first] = remaining.splice(firstIndex, 1)
    const candidateIndexes = remaining
      .map((pair, index) => ({ pair, index }))
      .filter(({ pair: [c, d] }) => first[0] !== c && first[0] !== d && first[1] !== c && first[1] !== d)
      .sort((left, right) => {
        if (priority === 'partner') return left.index - right.index
        const leftSplit: Split = [[first[0], first[1]], [left.pair[0], left.pair[1]]]
        const rightSplit: Split = [[first[0], first[1]], [right.pair[0], right.pair[1]]]
        return opponentRepeatScore(leftSplit, opponentMap, priority) - opponentRepeatScore(rightSplit, opponentMap, priority)
      })

    const selected = candidateIndexes[0]
    if (!selected) return null

    const [second] = remaining.splice(selected.index, 1)
    const split: Split = [[first[0], first[1]], [second[0], second[1]]]
    matches.push(split)
    split[0].forEach(a => split[1].forEach(b => incrementPair(opponentMap, a, b)))
  }

  return matches
}

function packTemplateMatchesIntoRounds(matches: Split[], playerIndexes: number[], courtsPerRound: number): RoundCandidate[] {
  const remaining = [...matches]
  const rounds: RoundCandidate[] = []
  const gamesCount = Object.fromEntries(playerIndexes.map(player => [player, 0])) as Record<number, number>

  while (remaining.length > 0) {
    const courts: Split[] = []
    const playingThisRound = new Set<number>()

    while (courts.length < courtsPerRound) {
      let bestIndex = -1
      let bestScore = Number.POSITIVE_INFINITY

      remaining.forEach((match, index) => {
        const matchPlayers = [...match[0], ...match[1]]
        if (matchPlayers.some(player => playingThisRound.has(player))) return

        const projectedCounts = { ...gamesCount }
        matchPlayers.forEach(player => { projectedCounts[player] += 1 })
        const counts = playerIndexes.map(player => projectedCounts[player])
        const range = Math.max(...counts) - Math.min(...counts)
        const currentGameSum = matchPlayers.reduce((sum, player) => sum + gamesCount[player], 0)
        const score = range * 1_000 + currentGameSum

        if (score < bestScore) {
          bestScore = score
          bestIndex = index
        }
      })

      if (bestIndex < 0) break

      const [picked] = remaining.splice(bestIndex, 1)
      courts.push(picked)
      ;[...picked[0], ...picked[1]].forEach(player => {
        playingThisRound.add(player)
        gamesCount[player] += 1
      })
    }

    rounds.push({
      courts,
      sitters: playerIndexes.filter(player => !playingThisRound.has(player)),
    })
  }

  return rounds
}

function buildFastFullRotationTemplateRounds(
  playerIndexes: number[],
  courtsPerRound: number,
  priority: SchedulePriority,
  guard?: RuntimeGuard | null
): RoundCandidate[] | null {
  if (playerIndexes.length > 20) return null
  if (playerIndexes.length < 4) return null
  if (!exactPartnerTemplatePlayerCounts.has(playerIndexes.length) && !nearExactPartnerTemplatePlayerCounts.has(playerIndexes.length)) return null
  const cacheKey = `${playerIndexes.length}:${courtsPerRound}:${priority}`
  const cached = fullRotationTemplateCache.get(cacheKey)
  if (cached) return cached.map(round => ({
    courts: round.courts.map(([teamA, teamB]) => [[...teamA], [...teamB]] as Split),
    sitters: [...round.sitters],
  }))

  const partnerRounds = buildCirclePartnerRounds(playerIndexes)
  const canUseExactPartnerRounds = partnerRounds.every(round => round.length % 2 === 0)

  const opponentMap: PairMap = {}
  const matches: Split[] = []

  if (canUseExactPartnerRounds) {
    for (const partnerPairs of partnerRounds) {
      if (hasTimedOut(guard)) return null
      const roundMatches = pairPartnerPairsForTemplate(partnerPairs, opponentMap, priority)
      matches.push(...roundMatches)

      roundMatches.forEach(([teamA, teamB]) => {
        teamA.forEach(a => teamB.forEach(b => incrementPair(opponentMap, a, b)))
      })
    }
  } else {
    const greedyMatches = buildGreedyPartnerPairMatches(playerIndexes, priority)
    if (!greedyMatches) return null
    matches.push(...greedyMatches)
  }

  const packedRounds = packTemplateMatchesIntoRounds(matches, playerIndexes, courtsPerRound)
  fullRotationTemplateCache.set(cacheKey, packedRounds)
  return packedRounds.map(round => ({
    courts: round.courts.map(([teamA, teamB]) => [[...teamA], [...teamB]] as Split),
    sitters: [...round.sitters],
  }))
}

function applyRoundCandidate(state: SearchState, candidate: RoundCandidate): SearchState {
  const next: SearchState = {
    rounds: [...state.rounds, candidate],
    partnerMap: clonePairMap(state.partnerMap),
    opponentMap: clonePairMap(state.opponentMap),
    gamesCount: cloneCountMap(state.gamesCount),
    sitCount: cloneCountMap(state.sitCount),
  }

  candidate.sitters.forEach(player => { next.sitCount[player] += 1 })
  candidate.courts.forEach(([teamA, teamB]) => {
    incrementPair(next.partnerMap, teamA[0], teamA[1])
    incrementPair(next.partnerMap, teamB[0], teamB[1])
    teamA.forEach(a => teamB.forEach(b => incrementPair(next.opponentMap, a, b)))
    ;[...teamA, ...teamB].forEach(player => { next.gamesCount[player] += 1 })
  })

  return next
}

function countUniquePairs(map: PairMap) {
  return Object.keys(map).filter(key => map[key] > 0).length
}

function scoreSearchState(
  state: SearchState,
  playerIndexes: number[],
  finalScore = false,
  priority: SchedulePriority = 'balanced'
) {
  const weights = SCORE_WEIGHTS[priority]
  const allPairs = getCombos(playerIndexes, 2)
  let partnerMissing = 0
  let partnerRepeat = 0
  let opponentMissing = 0
  let opponentOverTarget = 0
  let opponentDistance = 0

  allPairs.forEach(([a, b]) => {
    const partnerCount = getPairValue(state.partnerMap, a, b)
    const opponentCount = getPairValue(state.opponentMap, a, b)
    if (partnerCount === 0) partnerMissing += 1
    if (partnerCount > 1) partnerRepeat += partnerCount - 1
    if (opponentCount === 0) opponentMissing += 1
    if (opponentCount > 2) opponentOverTarget += opponentCount - 2
    opponentDistance += Math.abs(opponentCount - 2)
  })

  const games = playerIndexes.map(player => state.gamesCount[player])
  const sits = playerIndexes.map(player => state.sitCount[player])
  const gamesRange = Math.max(...games) - Math.min(...games)
  const sitRange = Math.max(...sits) - Math.min(...sits)

  if (finalScore) {
    return (
      partnerRepeat * weights.partnerRepeat +
      partnerMissing * weights.partnerMissing +
      opponentOverTarget * weights.opponentOverTarget +
      opponentMissing * weights.opponentMissing +
      opponentDistance * weights.opponentDistance +
      gamesRange * weights.gamesRange +
      sitRange * weights.sitRange
    )
  }

  return (
    partnerRepeat * weights.partnerRepeat +
    opponentOverTarget * Math.round(weights.opponentOverTarget * 0.75) +
    gamesRange * Math.round(weights.gamesRange * 1.5) +
    sitRange * Math.round(weights.sitRange * 1.2) -
    countUniquePairs(state.partnerMap) * weights.uniquePartnerReward -
    countUniquePairs(state.opponentMap) * weights.uniqueOpponentReward
  )
}

function splitOptionsForCourt(court: number[], state: SearchState, priority: SchedulePriority) {
  return splitOptions(court)
    .sort((left, right) => splitScore(left, state.partnerMap, state.opponentMap, priority) - splitScore(right, state.partnerMap, state.opponentMap, priority))
}

function generateCourtCombinations(active: number[], courtCount: number, state: SearchState, limit: number, priority: SchedulePriority) {
  const results: Split[][] = []

  function search(remaining: number[], courts: Split[]) {
    if (results.length >= limit) return
    if (courts.length === courtCount) {
      results.push(courts)
      return
    }

    const anchor = remaining[0]
    const courtCandidates = getCombos(remaining.slice(1), 3)
      .map(rest => [anchor, ...rest])
      .sort((left, right) => courtScore(left, state.partnerMap, state.opponentMap, priority) - courtScore(right, state.partnerMap, state.opponentMap, priority))
      .slice(0, courtCount <= 2 ? 16 : 10)

    for (const court of courtCandidates) {
      const nextRemaining = remaining.filter(player => !court.includes(player))
      const splitCandidates = splitOptionsForCourt(court, state, priority).slice(0, 2)
      for (const split of splitCandidates) {
        search(nextRemaining, [...courts, split])
        if (results.length >= limit) return
      }
    }
  }

  search(active, [])
  return results
}

function generateRoundCandidates(
  state: SearchState,
  playerIndexes: number[],
  courtsPerRound: number,
  sittersPerRound: number,
  targetGamesPerPlayer?: number | null,
  priority: SchedulePriority = 'balanced',
  guard?: RuntimeGuard | null
) {
  const activeSlots = courtsPerRound * 4
  const candidates: RoundCandidate[] = []
  const orderedForSitting = [...playerIndexes].sort((a, b) => {
    if (state.sitCount[a] !== state.sitCount[b]) return state.sitCount[a] - state.sitCount[b]
    if (state.gamesCount[a] !== state.gamesCount[b]) return state.gamesCount[b] - state.gamesCount[a]
    return a - b
  })

  const sitterSets = sittersPerRound === 0
    ? [[]]
    : getCombos(orderedForSitting.slice(0, Math.min(playerIndexes.length, sittersPerRound + 6)), sittersPerRound)
      .slice(0, 28)

  sitterSets.forEach(sitters => {
    if (hasTimedOut(guard)) return
    const sitterSet = new Set(sitters)
    const active = playerIndexes
      .filter(player => !sitterSet.has(player))
      .sort((a, b) => {
        if (state.gamesCount[a] !== state.gamesCount[b]) return state.gamesCount[a] - state.gamesCount[b]
        return a - b
      })
      .slice(0, activeSlots)

    if (active.length !== activeSlots) return
    generateCourtCombinations(active, courtsPerRound, state, 32, priority).forEach(courts => {
      if (hasTimedOut(guard)) return
      candidates.push({ courts, sitters })
    })
  })

  return candidates
    .map(candidate => ({ candidate, score: scoreSearchState(applyRoundCandidate(state, candidate), playerIndexes, false, priority) }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 80)
    .map(item => item.candidate)
}

function buildBeamSearchSchedule(
  playerIndexes: number[],
  courtsPerRound: number,
  sittersPerRound: number,
  targetRounds: number,
  targetGamesPerPlayer?: number | null,
  totalMatchesTarget?: number | null,
  priority: SchedulePriority = 'balanced',
  guard?: RuntimeGuard | null
) {
  const emptyCounts = Object.fromEntries(playerIndexes.map(player => [player, 0])) as Record<number, number>
  const initialState: SearchState = {
    rounds: [],
    partnerMap: {},
    opponentMap: {},
    gamesCount: { ...emptyCounts },
    sitCount: { ...emptyCounts },
  }
  const beamWidth = playerIndexes.length <= 13 ? 36 : 18
  let beam: SearchState[] = [initialState]

  for (let round = 0; round < targetRounds; round += 1) {
    if (hasTimedOut(guard)) break
    const matchesRemaining = totalMatchesTarget
      ? totalMatchesTarget - (beam[0]?.rounds.reduce((sum, item) => sum + item.courts.length, 0) ?? 0)
      : null
    const courtsThisRound = matchesRemaining
      ? Math.min(courtsPerRound, matchesRemaining)
      : courtsPerRound
    const sittersThisRound = playerIndexes.length - courtsThisRound * 4
    const nextBeam: SearchState[] = []
    beam.forEach(state => {
      if (hasTimedOut(guard)) return
      generateRoundCandidates(state, playerIndexes, courtsThisRound, sittersThisRound, targetGamesPerPlayer, priority, guard)
        .forEach(candidate => nextBeam.push(applyRoundCandidate(state, candidate)))
    })

    if (nextBeam.length === 0) break
    beam = nextBeam
      .sort((left, right) => scoreSearchState(left, playerIndexes, false, priority) - scoreSearchState(right, playerIndexes, false, priority))
      .slice(0, beamWidth)

    if (beam.length === 0) break
  }

  return beam
    .sort((left, right) => scoreSearchState(left, playerIndexes, true, priority) - scoreSearchState(right, playerIndexes, true, priority))[0] || initialState
}

function extendStateToMinimumGames(
  state: SearchState,
  playerIndexes: number[],
  courtsPerRound: number,
  targetGamesPerPlayer: number,
  priority: SchedulePriority,
  guard?: RuntimeGuard | null
) {
  let current = state
  const maxExtraRounds = playerIndexes.length * 2

  for (let extraRound = 0; extraRound < maxExtraRounds; extraRound += 1) {
    if (hasTimedOut(guard)) break
    const games = playerIndexes.map(player => current.gamesCount[player])
    if (Math.min(...games) >= targetGamesPerPlayer) break

    const sittersThisRound = playerIndexes.length - courtsPerRound * 4
    const candidates = generateRoundCandidates(current, playerIndexes, courtsPerRound, sittersThisRound, targetGamesPerPlayer, priority, guard)
    if (candidates.length === 0) break

    const bestCandidate = candidates
      .map(candidate => {
        const next = applyRoundCandidate(current, candidate)
        const nextGames = playerIndexes.map(player => next.gamesCount[player])
        const underTarget = nextGames.filter(count => count < targetGamesPerPlayer).length
        const minGames = Math.min(...nextGames)
        const range = Math.max(...nextGames) - minGames
        const score =
          underTarget * 1_000_000 -
          minGames * 100_000 +
          range * 10_000 +
          scoreSearchState(next, playerIndexes, false, priority)
        return { candidate, score }
      })
      .sort((left, right) => left.score - right.score)[0]?.candidate

    if (!bestCandidate) break
    current = applyRoundCandidate(current, bestCandidate)
  }

  return current
}

export function buildRoundRobinDoublesSchedule(
  playerIds: string[],
  courtCount: number,
  rounds?: number,
  options: RoundRobinScheduleOptions = {}
): RoundRobinSchedule {
  const guard = createRuntimeGuard(options.maxRuntimeMs)
  const normalizedCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const players = playerIds.map(String)
  const courtsPerRound = Math.min(normalizedCourtCount, Math.floor(players.length / 4))
  const priority = options.priority || 'balanced'
  const minGamesPerPlayer = options.minGamesPerPlayer
  const targetGamesPerPlayer = minGamesPerPlayer && minGamesPerPlayer > 0
    ? Math.min(Math.floor(minGamesPerPlayer), Math.max(1, players.length - 1))
    : null
  const requiredMatchesForPartnerCoverage = targetGamesPerPlayer
    ? Math.ceil((players.length * targetGamesPerPlayer) / 4)
    : Math.ceil((players.length * (players.length - 1)) / 4)
  const targetRounds = rounds ?? (
    targetGamesPerPlayer
      ? Math.max(1, Math.ceil(requiredMatchesForPartnerCoverage / Math.max(1, courtsPerRound)))
      : Math.ceil(requiredMatchesForPartnerCoverage / Math.max(1, courtsPerRound))
  )

  if (players.length < 4 || courtsPerRound < 1) {
    return {
      matches: [],
      rounds: 0,
      courtsPerRound: 0,
      sittersPerRound: players.length,
      gamesCount: Object.fromEntries(players.map(player => [player, 0])),
      sitCount: Object.fromEntries(players.map(player => [player, 0])),
      quality: {
        runtimeMs: nowMs() - guard.startedAt,
        timedOut: guard.timedOut,
        fallbackUsed: false,
      },
    }
  }

  const playerIndexes = players.map((_, index) => index)
  const activeSlots = courtsPerRound * 4
  const sittersPerRound = players.length - activeSlots
  const partnerMap: PairMap = {}
  const opponentMap: PairMap = {}
  const sitCountByIndex = Object.fromEntries(playerIndexes.map(player => [player, 0])) as Record<number, number>
  const gamesCountByIndex = Object.fromEntries(playerIndexes.map(player => [player, 0])) as Record<number, number>
  const matches: RoundRobinMatch[] = []
  const exactSingleCourtMatches = !rounds && !targetGamesPerPlayer && courtsPerRound === 1
    ? buildExhaustiveSingleCourtSchedule(playerIndexes)
    : null
  const fastTemplateRounds = !exactSingleCourtMatches && !rounds && !targetGamesPerPlayer
    ? buildFastFullRotationTemplateRounds(playerIndexes, courtsPerRound, priority, guard)
    : null

  if (exactSingleCourtMatches) {
    const pacedMatches = reorderSingleCourtMatchesForPace(exactSingleCourtMatches, playerIndexes)

    pacedMatches.forEach(([teamA, teamB], index) => {
      incrementPair(partnerMap, teamA[0], teamA[1])
      incrementPair(partnerMap, teamB[0], teamB[1])
      teamA.forEach(a => teamB.forEach(b => incrementPair(opponentMap, a, b)))
      ;[...teamA, ...teamB].forEach(player => { gamesCountByIndex[player] += 1 })

      const playing = new Set([...teamA, ...teamB])
      playerIndexes
        .filter(player => !playing.has(player))
        .forEach(player => { sitCountByIndex[player] += 1 })

      matches.push({
        teamA: teamA.map(player => players[player]),
        teamB: teamB.map(player => players[player]),
        rotation: index + 1,
        court: 1,
        sitterIds: playerIndexes.filter(player => !playing.has(player)).map(player => players[player]),
      })
    })

    return {
      matches,
      rounds: exactSingleCourtMatches.length,
      courtsPerRound,
      sittersPerRound,
      gamesCount: Object.fromEntries(players.map((player, index) => [player, gamesCountByIndex[index]])),
      sitCount: Object.fromEntries(players.map((player, index) => [player, sitCountByIndex[index]])),
      quality: {
        runtimeMs: nowMs() - guard.startedAt,
        timedOut: guard.timedOut,
        fallbackUsed: false,
      },
    }
  }

  let beamState: SearchState | null = null
  let fallbackUsed = false
  if (!fastTemplateRounds) {
    beamState = buildBeamSearchSchedule(
      playerIndexes,
      courtsPerRound,
      sittersPerRound,
      Math.max(1, Math.floor(targetRounds)),
      targetGamesPerPlayer,
      targetGamesPerPlayer ? requiredMatchesForPartnerCoverage : null,
      priority,
      guard
    )

    if (targetGamesPerPlayer) {
      const beforeRounds = beamState.rounds.length
      beamState = extendStateToMinimumGames(beamState, playerIndexes, courtsPerRound, targetGamesPerPlayer, priority, guard)
      fallbackUsed = beamState.rounds.length > beforeRounds
    }
  }

  const scheduledRounds = fastTemplateRounds || beamState?.rounds || []

  scheduledRounds.forEach((round, roundIndex) => {
    round.sitters.forEach(player => { sitCountByIndex[player] += 1 })
    round.courts.forEach(([teamA, teamB], courtIndex) => {
      incrementPair(partnerMap, teamA[0], teamA[1])
      incrementPair(partnerMap, teamB[0], teamB[1])
      teamA.forEach(a => teamB.forEach(b => incrementPair(opponentMap, a, b)))
      ;[...teamA, ...teamB].forEach(player => { gamesCountByIndex[player] += 1 })

      matches.push({
        teamA: teamA.map(player => players[player]),
        teamB: teamB.map(player => players[player]),
        rotation: roundIndex + 1,
        court: courtIndex + 1,
        sitterIds: round.sitters.map(player => players[player]),
      })
    })
  })

  return {
    matches,
    rounds: scheduledRounds.length,
    courtsPerRound,
    sittersPerRound,
    gamesCount: Object.fromEntries(players.map((player, index) => [player, gamesCountByIndex[index]])),
    sitCount: Object.fromEntries(players.map((player, index) => [player, sitCountByIndex[index]])),
    quality: {
      runtimeMs: nowMs() - guard.startedAt,
      timedOut: guard.timedOut,
      fallbackUsed,
    },
  }
}
