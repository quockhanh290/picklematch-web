import {
  buildBalancedRestSchedule,
  minimumPossibleMaxRestStreak,
} from '@/lib/next-round-suggester/planner/rest-schedule'
import {
  runPairSwapSearch,
  type PairSwapCheckpoint,
  type PlannedBoardMatch,
} from '@/lib/next-round-suggester/planner/pair-swap-search'

function restMetrics(playerIds: string[], schedule: string[][]) {
  const counts = new Map(playerIds.map(id => [id, 0]))
  const streaks = new Map(playerIds.map(id => [id, 0]))
  let maxStreak = 0
  schedule.forEach(resting => {
    const restingSet = new Set(resting)
    playerIds.forEach(id => {
      const streak = restingSet.has(id) ? (streaks.get(id) ?? 0) + 1 : 0
      streaks.set(id, streak)
      maxStreak = Math.max(maxStreak, streak)
      if (restingSet.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
    })
  })
  return { counts: [...counts.values()], maxStreak }
}

describe('precomputed planner primitives', () => {
  it('balances six-court rest counts without consecutive rests', () => {
    const players = Array.from({ length: 32 }, (_, index) => `p${index + 1}`)
    const schedule = buildBalancedRestSchedule(players, 8, 8)
    const metrics = restMetrics(players, schedule)

    expect(schedule).toHaveLength(8)
    expect(schedule.every(resting => resting.length === 8 && new Set(resting).size === 8)).toBe(true)
    expect(Math.max(...metrics.counts) - Math.min(...metrics.counts)).toBeLessThanOrEqual(1)
    expect(metrics.maxStreak).toBe(1)
  })

  it('meets the mathematical rest-streak bound when resting players are the majority', () => {
    const players = Array.from({ length: 36 }, (_, index) => `p${index + 1}`)
    const schedule = buildBalancedRestSchedule(players, 10, 20)
    const metrics = restMetrics(players, schedule)

    expect(minimumPossibleMaxRestStreak(36, 16)).toBe(2)
    expect(metrics.maxStreak).toBe(2)
    expect(Math.max(...metrics.counts) - Math.min(...metrics.counts)).toBeLessThanOrEqual(1)
  })

  it('resumes deterministic pair-swap checkpoints to the same final board', () => {
    const initialBoard: PlannedBoardMatch[] = [
      { team_a: ['p1', 'p12'], team_b: ['p2', 'p11'] },
      { team_a: ['p3', 'p10'], team_b: ['p4', 'p9'] },
      { team_a: ['p5', 'p8'], team_b: ['p6', 'p7'] },
    ]
    const rating = (id: string) => Number(id.slice(1))
    const evaluate = (board: PlannedBoardMatch[]) => board.reduce((sum, match) => {
      const teamA = rating(match.team_a[0]) + rating(match.team_a[1])
      const teamB = rating(match.team_b[0]) + rating(match.team_b[1])
      return sum + Math.abs(teamA - teamB)
    }, 0)
    const full = runPairSwapSearch({
      initialBoard,
      passes: 2,
      evaluate,
      isBetter: (candidate, current) => candidate < current,
    })

    let checkpoint: PairSwapCheckpoint | undefined
    let chunked = runPairSwapSearch({
      initialBoard,
      passes: 2,
      evaluate,
      isBetter: (candidate, current) => candidate < current,
      maxCourtPairs: 1,
    })
    let chunks = 1
    while (!chunked.completed) {
      checkpoint = chunked.checkpoint ?? undefined
      chunked = runPairSwapSearch({
        initialBoard,
        passes: 2,
        evaluate,
        isBetter: (candidate, current) => candidate < current,
        checkpoint,
        maxCourtPairs: 1,
      })
      chunks += 1
      if (chunks > 20) throw new Error('Checkpoint search did not converge')
    }

    expect(chunks).toBeGreaterThan(1)
    expect(chunked.board).toEqual(full.board)
    expect(evaluate(chunked.board)).toBe(evaluate(full.board))
  })
})
