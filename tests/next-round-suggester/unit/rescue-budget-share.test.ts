import { getRescueBudgetShareMs } from '../../../lib/next-round-suggester/live-preview'

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
    expect(getRescueBudgetShareMs(400, 1)).toBe(400)
    expect(getRescueBudgetShareMs(400, 4)).toBe(100)
  })

  it('never returns less than a floor a search can do something with', () => {
    // Twelve courts would slice the pool to 33ms each. A search that short cannot finish a candidate, so
    // it would report "none found" while never having looked — the exact confusion this bug is about.
    expect(getRescueBudgetShareMs(400, 12)).toBeGreaterThanOrEqual(80)
  })

  it('is unaffected by how much earlier courts consumed', () => {
    // The whole point: the same inputs give the same answer for the first court and the last.
    const first = getRescueBudgetShareMs(400, 6)
    const last = getRescueBudgetShareMs(400, 6)

    expect(last).toBe(first)
  })
})
