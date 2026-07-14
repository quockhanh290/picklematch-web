function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

export function minimumPossibleMaxRestStreak(playerCount: number, playingPerRound: number) {
  const restPerRound = playerCount - playingPerRound
  if (restPerRound <= 0) return 0
  return Math.ceil(restPerRound / playingPerRound)
}

export function buildBalancedRestSchedule(
  playerIds: string[],
  roundCount: number,
  restPerRound: number,
) {
  if (restPerRound < 0 || restPerRound >= playerIds.length) {
    throw new Error(`Invalid rest capacity: players=${playerIds.length} rest_per_round=${restPerRound}`)
  }
  if (restPerRound === 0) return Array.from({ length: roundCount }, () => [] as string[])

  const playerCount = playerIds.length
  let stride = Math.max(1, Math.floor(playerCount * 0.618))
  while (greatestCommonDivisor(stride, playerCount) !== 1) stride += 1
  const restCounts = new Map(playerIds.map(id => [id, 0]))
  const restStreaks = new Map(playerIds.map(id => [id, 0]))

  return Array.from({ length: roundCount }, (_, roundNo) => {
    const tieOrder = new Map<string, number>()
    const offset = (roundNo * restPerRound) % playerCount
    for (let index = 0; index < playerCount; index += 1) {
      tieOrder.set(playerIds[(offset + index * stride) % playerCount], index)
    }
    const resting = [...playerIds]
      .sort((left, right) => {
        const streakDelta = (restStreaks.get(left) ?? 0) - (restStreaks.get(right) ?? 0)
        if (streakDelta !== 0) return streakDelta
        const countDelta = (restCounts.get(left) ?? 0) - (restCounts.get(right) ?? 0)
        return countDelta || (tieOrder.get(left) ?? 0) - (tieOrder.get(right) ?? 0)
      })
      .slice(0, restPerRound)
    const restingSet = new Set(resting)
    playerIds.forEach(id => {
      restStreaks.set(id, restingSet.has(id) ? (restStreaks.get(id) ?? 0) + 1 : 0)
    })
    resting.forEach(id => restCounts.set(id, (restCounts.get(id) ?? 0) + 1))
    return resting
  })
}
