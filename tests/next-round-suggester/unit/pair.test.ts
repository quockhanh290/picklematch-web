import {
  bestPartitioning,
  bestTeamSplit,
  createPartitioningRuntimeCache,
} from '../../../lib/next-round-suggester/pair'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'

describe('bestTeamSplit', () => {
  it('finds the most balanced PVNA split', () => {
    const players = [
      createPlayer('p1', { pvna: 4.0 }),
      createPlayer('p2', { pvna: 3.8 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.0 }),
    ]

    const split = bestTeamSplit(players, createState({ players }))

    expect(split?.match.team_a).toEqual(['p1', 'p4'])
    expect(split?.match.team_b).toEqual(['p2', 'p3'])
    expect(split?.stats.pvna_diff).toBe(0)
  })

  it('hard rejects when every valid-looking split has intra-team PVNA gap > 1.5', () => {
    const players = [
      createPlayer('p1', { pvna: 2.0 }),
      createPlayer('p2', { pvna: 3.6 }),
      createPlayer('p3', { pvna: 5.2 }),
      createPlayer('p4', { pvna: 6.8 }),
    ]

    expect(bestTeamSplit(players, createState({ players, pvnaTolerance: 10 }))).toBeNull()
  })

  it('hard rejects inter-team PVNA diff beyond tolerance', () => {
    const players = [
      createPlayer('p1', { pvna: 4.0 }),
      createPlayer('p2', { pvna: 3.8 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.1 }),
    ]

    expect(bestTeamSplit(players, createState({ players, pvnaTolerance: 0.01 }))).toBeNull()
  })

  it('prefers new partners over slight PVNA imbalance', () => {
    const p1 = createPlayer('p1', { pvna: 3.6 })
    const p2 = createPlayer('p2', { pvna: 3.1 })
    const p3 = createPlayer('p3', { pvna: 3.1 })
    const p4 = createPlayer('p4', { pvna: 3.6 })
    setPartnerRepeats(p1, p2, 2)
    setPartnerRepeats(p3, p4, 2)

    const split = bestTeamSplit([p1, p2, p3, p4], createState({ players: [p1, p2, p3, p4] }))

    expect(split?.match.team_a).toEqual(['p1', 'p3'])
    expect(split?.match.team_b).toEqual(['p2', 'p4'])
  })

  it('returns null when no split passes guards', () => {
    const players = [
      createPlayer('p1', { pvna: 2.0 }),
      createPlayer('p2', { pvna: 3.6 }),
      createPlayer('p3', { pvna: 5.2 }),
      createPlayer('p4', { pvna: 6.8 }),
    ]

    expect(bestTeamSplit(players, createState({ players, pvnaTolerance: 1 }))).toBeNull()
  })
})

describe('bestPartitioning', () => {
  it('exhaustively evaluates 35 partitions for 8 players and 2 courts', () => {
    const players = Array.from({ length: 8 }, (_, index) => createPlayer(`p${index + 1}`))
    const result = bestPartitioning(players, createState({ players, courts: 2 }))

    expect(result?.matches).toHaveLength(2)
    expect(result?.iterations).toBe(35)
  })

  it('handles one court with four players', () => {
    const players = Array.from({ length: 4 }, (_, index) => createPlayer(`p${index + 1}`))
    const result = bestPartitioning(players, createState({ players }))

    expect(result?.matches).toHaveLength(1)
    expect(result?.iterations).toBe(1)
  })

  it('uses sampling for n >= 16', () => {
    const players = Array.from({ length: 16 }, (_, index) =>
      createPlayer(`p${String(index + 1).padStart(2, '0')}`, { pvna: 3.0 + index * 0.01 }),
    )
    const result = bestPartitioning(players, createState({ players, courts: 4 }), { maxIterations: 12 })

    expect(result?.matches).toHaveLength(4)
    expect(result?.iterations).toBeLessThanOrEqual(12)
  })

  it('falls back to relaxed PVNA tolerance when strict tolerance has no partition', () => {
    const players = [
      createPlayer('p1', { pvna: 4.0 }),
      createPlayer('p2', { pvna: 3.8 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.1 }),
    ]

    const result = bestPartitioning(players, createState({ players, pvnaTolerance: 0.01 }))

    expect(result?.matches).toHaveLength(1)
    expect(result?.relaxed_tolerance).toBe(true)
  })

  it('skips court creation when fewer than four players are present', () => {
    const players = [createPlayer('p1'), createPlayer('p2'), createPlayer('p3')]

    expect(bestPartitioning(players, createState({ players }))).toBeNull()
  })

  it('returns the same partition with and without runtime cache', () => {
    const players = Array.from({ length: 16 }, (_, index) =>
      createPlayer(`p${String(index + 1).padStart(2, '0')}`, { pvna: 3.0 + index * 0.03 }),
    )
    const state = createState({ players, courts: 4 })

    const uncached = bestPartitioning(players, state)
    const cached = bestPartitioning(players, state, { cache: createPartitioningRuntimeCache() })

    expect(cached).toEqual(uncached)
  })

})
