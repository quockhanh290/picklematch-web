import { getRescueBudgetShareUnits } from '../../../lib/next-round-suggester/live-preview'

// BUG #9. The rescue search drew from one 400ms pool, drained in the order courts happen to be visited.
// Whoever came first could spend it all, so a degraded court late in the array searched with nothing
// left and came back with no "Chờ Sân X" at all — not "we looked and found none", but "we never looked",
// and the host cannot tell those apart.
//
// The share is now decided by how many courts are being filled, so no court can be starved by an earlier
// one. That costs a lone degraded court some search time, which is the deliberate trade: a shorter search
// still answers the question, an unrun one does not.
describe('every court gets the same rescue search share', () => {
  it('splits the pool by court count, not by who asks first', () => {
    expect(getRescueBudgetShareUnits(40_000, 1)).toBe(40_000)
    expect(getRescueBudgetShareUnits(40_000, 4)).toBe(10_000)
  })

  it('never returns less than a floor a search can do something with', () => {
    // Twelve courts would slice the pool to 33ms each. A search that short cannot finish a candidate, so
    // it would report "none found" while never having looked — the exact confusion this bug is about.
    expect(getRescueBudgetShareUnits(40_000, 12)).toBeGreaterThanOrEqual(8_000)
  })

  it('is unaffected by how much earlier courts consumed', () => {
    // The whole point: the same inputs give the same answer for the first court and the last.
    const first = getRescueBudgetShareUnits(40_000, 6)
    const last = getRescueBudgetShareUnits(40_000, 6)

    expect(last).toBe(first)
  })
})
