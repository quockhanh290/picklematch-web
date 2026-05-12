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
}

type PairMap = Record<string, number>
type Split = [[number, number], [number, number]]

const pairKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
const getPairValue = (map: PairMap, a: number, b: number) => map[pairKey(a, b)] || 0
const incrementPair = (map: PairMap, a: number, b: number) => {
  const key = pairKey(a, b)
  map[key] = (map[key] || 0) + 1
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

function splitScore(split: Split, partnerMap: PairMap, opponentMap: PairMap) {
  const [[a, b], [c, d]] = split
  const partnerRepeats = getPairValue(partnerMap, a, b) + getPairValue(partnerMap, c, d)
  const opponentRepeats =
    getPairValue(opponentMap, a, c) +
    getPairValue(opponentMap, a, d) +
    getPairValue(opponentMap, b, c) +
    getPairValue(opponentMap, b, d)

  return partnerRepeats * 100 + opponentRepeats
}

function splitOptions([a, b, c, d]: number[]): Split[] {
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ]
}

function bestSplitOf(court: number[], partnerMap: PairMap, opponentMap: PairMap): Split {
  return splitOptions(court).reduce((best, current) => {
    return splitScore(current, partnerMap, opponentMap) < splitScore(best, partnerMap, opponentMap)
      ? current
      : best
  })
}

function courtScore(court: number[], partnerMap: PairMap, opponentMap: PairMap) {
  return splitScore(bestSplitOf(court, partnerMap, opponentMap), partnerMap, opponentMap)
}

function chooseBestPartition(
  active: number[],
  courtCount: number,
  partnerMap: PairMap,
  opponentMap: PairMap
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
      .sort((left, right) => courtScore(left, partnerMap, opponentMap) - courtScore(right, partnerMap, opponentMap))
      .slice(0, candidateLimit)

    for (const court of candidates) {
      const nextScore = score + courtScore(court, partnerMap, opponentMap)
      const nextRemaining = remaining.filter(player => !court.includes(player))
      if (search(nextRemaining, [...partition, court], nextScore)) return true
    }

    return false
  }

  search(active, [], 0)
  return bestPartition
}

export function buildRoundRobinDoublesSchedule(
  playerIds: string[],
  courtCount: number,
  rounds?: number
): RoundRobinSchedule {
  const normalizedCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const players = playerIds.map(String)
  const courtsPerRound = Math.min(normalizedCourtCount, Math.floor(players.length / 4))
  const requiredMatchesForPartnerCoverage = Math.ceil((players.length * (players.length - 1)) / 4)
  const targetRounds = rounds ?? Math.ceil(requiredMatchesForPartnerCoverage / Math.max(1, courtsPerRound))

  if (players.length < 4 || courtsPerRound < 1) {
    return {
      matches: [],
      rounds: 0,
      courtsPerRound: 0,
      sittersPerRound: players.length,
      gamesCount: Object.fromEntries(players.map(player => [player, 0])),
      sitCount: Object.fromEntries(players.map(player => [player, 0])),
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

  for (let round = 0; round < Math.max(1, Math.floor(targetRounds)); round += 1) {
    const sitters = [...playerIndexes]
      .sort((a, b) => {
        if (sitCountByIndex[a] !== sitCountByIndex[b]) return sitCountByIndex[a] - sitCountByIndex[b]
        if (gamesCountByIndex[a] !== gamesCountByIndex[b]) return gamesCountByIndex[b] - gamesCountByIndex[a]
        return a - b
      })
      .slice(0, sittersPerRound)

    sitters.forEach(player => { sitCountByIndex[player] += 1 })

    const active = playerIndexes
      .filter(player => !sitters.includes(player))
      .sort((a, b) => {
        if (gamesCountByIndex[a] !== gamesCountByIndex[b]) return gamesCountByIndex[a] - gamesCountByIndex[b]
        return a - b
      })

    const partition = chooseBestPartition(active, courtsPerRound, partnerMap, opponentMap)
    const courts = partition.map(court => bestSplitOf(court, partnerMap, opponentMap))

    courts.forEach(([teamA, teamB], courtIndex) => {
      incrementPair(partnerMap, teamA[0], teamA[1])
      incrementPair(partnerMap, teamB[0], teamB[1])
      teamA.forEach(a => teamB.forEach(b => incrementPair(opponentMap, a, b)))
      ;[...teamA, ...teamB].forEach(player => { gamesCountByIndex[player] += 1 })

      matches.push({
        teamA: teamA.map(player => players[player]),
        teamB: teamB.map(player => players[player]),
        rotation: round + 1,
        court: courtIndex + 1,
        sitterIds: sitters.map(player => players[player]),
      })
    })
  }

  return {
    matches,
    rounds: Math.max(1, Math.floor(targetRounds)),
    courtsPerRound,
    sittersPerRound,
    gamesCount: Object.fromEntries(players.map((player, index) => [player, gamesCountByIndex[index]])),
    sitCount: Object.fromEntries(players.map((player, index) => [player, sitCountByIndex[index]])),
  }
}
