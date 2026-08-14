import { createSearchBudget } from '../../../lib/next-round-suggester/search-budget'
import { bestPartitioning } from '../../../lib/next-round-suggester/pair'
import { createPlayer, createState } from '../helpers/factories'

function boardKey(result: ReturnType<typeof bestPartitioning>): string {
  return result?.matches
    .map((match) => [
      [...match.team_a].sort().join(':'),
      [...match.team_b].sort().join(':'),
    ].sort().join('>'))
    .sort()
    .join('|') ?? ''
}

function withMockedDateNow<T>(stepMs: number, run: () => T): T {
  const originalNow = Date.now
  let now = 1_000
  Date.now = () => {
    now += stepMs
    return now
  }
  try {
    return run()
  } finally {
    Date.now = originalNow
  }
}

describe('bestPartitioning determinism', () => {
  it('uses a total board-order tie-break when the wall clock changes', () => {
    const players = Array.from({ length: 20 }, (_, index) =>
      createPlayer(`p${index + 1}`, { pvna: 3 }),
    )
    const state = createState({ players, courts: 5, pvnaTolerance: 0.5 })
    const expectedBoard =
      'p10:p15>p1:p11|p12:p19>p14:p9|p13:p7>p16:p3|p17:p2>p18:p4|p20:p8>p5:p6'

    const oneMsClock = withMockedDateNow(1, () =>
      bestPartitioning(players, state, { maxIterations: 12, budget: createSearchBudget(100_000) }),
    )
    const twoMsClock = withMockedDateNow(2, () =>
      bestPartitioning(players, state, { maxIterations: 12, budget: createSearchBudget(100_000) }),
    )

    expect(boardKey(oneMsClock)).toBe(expectedBoard)
    expect(boardKey(twoMsClock)).toBe(expectedBoard)
  })
})
