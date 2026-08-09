import { findMinCostFoursome } from '../../../lib/next-round-suggester/forced-tradeoff'
import { createPlayer, createState } from '../helpers/factories'

// findMinCostFoursome picks who plays on the deterministic single-court fast path, ordering candidates
// by raw quality cost. Raw cost lets a soft gender preference outrank the balance tolerance, so the
// fast path could choose a split 0.8 apart over one 0.2 apart. Tolerance has to mean the same thing
// here as it does in bestSplitForFoursome and scoreMatch.
describe('findMinCostFoursome tolerance', () => {
  it('prefers a within-tolerance split over a cheaper one that breaks tolerance', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 4.0, gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { pvna: 3.0, gender: 'M' }),
        createPlayer('p3', { pvna: 3.5, gender: 'F' }),
        createPlayer('p4', { pvna: 3.3, gender: 'F' }),
      ],
    })

    const best = findMinCostFoursome(['p1', 'p2', 'p3', 'p4'], new Set(), state, 0.5)

    expect(best).not.toBeNull()
    expect(best!.gap).toBeLessThanOrEqual(0.5)
  })
})
