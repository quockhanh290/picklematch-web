/**
 * Tests for Group C: idempotency + retry logic (#1).
 *
 * The retry orchestration (executeStart / executeComplete closures) is embedded in
 * component state handlers and cannot be exercised here without React Testing Library.
 * Those integration tests are deferred; this file covers the pure decision functions
 * that govern WHEN to retry and WHEN to treat a call as idempotent.
 */

import { isSameCourtAndPlayers, shouldInvalidatePreviewAfterStartError } from '@/features/host/session-detail/liveMatchGuards'

/**
 * Pure retry harness that replicates the two-attempt pattern used by
 * executeStart and executeComplete (without React state / component wiring).
 *
 * Matches the logic:
 *   for (attempt 0..1) {
 *     if (attempt > 0) { refetch; if alreadyDone → idempotency return }
 *     try { rpc(); return } catch { if 'Session changed' && attempt===0 → continue; throw }
 *   }
 *   throw 'Session changed'
 */
async function retryOnSessionChanged<T>(
  rpc: (attempt: number) => Promise<T>,
  isAlreadyDone: (attempt: number) => Promise<boolean>,
  onRefetch: () => Promise<void>,
): Promise<T | 'idempotent'> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      await onRefetch()
      if (await isAlreadyDone(attempt)) return 'idempotent'
    }
    try {
      return await rpc(attempt)
    } catch (err: unknown) {
      if (attempt === 0 && String((err as Error)?.message ?? '').includes('Session changed')) {
        continue
      }
      throw err
    }
  }
  throw new Error('Session changed')
}

// ── Group C tests ─────────────────────────────────────────────────────────────

describe('C: isSameCourtAndPlayers', () => {
  it('returns true for identical court and player set', () => {
    expect(isSameCourtAndPlayers(
      { court_idx: 2, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 2, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
    )).toBe(true)
  })

  it('returns true even when team_a / team_b order differs between sides', () => {
    expect(isSameCourtAndPlayers(
      { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 0, team_a: ['p3', 'p4'], team_b: ['p1', 'p2'] },
    )).toBe(true)
  })

  it('returns false when court_idx differs', () => {
    expect(isSameCourtAndPlayers(
      { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 1, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
    )).toBe(false)
  })

  it('returns false when one player differs', () => {
    expect(isSameCourtAndPlayers(
      { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p5'] },
    )).toBe(false)
  })

  it('treats null and 0 court_idx as different', () => {
    // null → -1, 0 → 0
    expect(isSameCourtAndPlayers(
      { court_idx: null, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
      { court_idx: 0,    team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
    )).toBe(false)
  })
})

describe('C: shouldInvalidatePreviewAfterStartError', () => {
  it('returns true for "Session changed"', () => {
    expect(shouldInvalidatePreviewAfterStartError(new Error('Session changed'))).toBe(true)
  })

  it('returns true for "Preview is stale"', () => {
    expect(shouldInvalidatePreviewAfterStartError(new Error('Preview is stale — refetch'))).toBe(true)
  })

  it('returns true for "A player is already in a live match"', () => {
    expect(shouldInvalidatePreviewAfterStartError(new Error('A player is already in a live match'))).toBe(true)
  })

  it('returns true for "Court already has a live match"', () => {
    expect(shouldInvalidatePreviewAfterStartError(new Error('Court already has a live match'))).toBe(true)
  })

  it('returns false for generic network error', () => {
    expect(shouldInvalidatePreviewAfterStartError(new Error('Network request failed'))).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(shouldInvalidatePreviewAfterStartError(undefined)).toBe(false)
  })

  it('handles plain object with message property', () => {
    expect(shouldInvalidatePreviewAfterStartError({ message: 'Session changed' })).toBe(true)
  })
})

describe('C: retry-on-session-changed harness', () => {
  it('succeeds on first attempt without calling refetch', async () => {
    const rpc = jest.fn().mockResolvedValueOnce('ok')
    const isAlreadyDone = jest.fn()
    const onRefetch = jest.fn()

    const result = await retryOnSessionChanged(rpc, isAlreadyDone, onRefetch)

    expect(result).toBe('ok')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(onRefetch).not.toHaveBeenCalled()
    expect(isAlreadyDone).not.toHaveBeenCalled()
  })

  it('retries exactly once on "Session changed" error, then succeeds', async () => {
    const rpc = jest.fn()
      .mockRejectedValueOnce(new Error('Session changed: version mismatch'))
      .mockResolvedValueOnce('ok-retry')
    const isAlreadyDone = jest.fn().mockResolvedValue(false)
    const onRefetch = jest.fn().mockResolvedValue(undefined)

    const result = await retryOnSessionChanged(rpc, isAlreadyDone, onRefetch)

    expect(result).toBe('ok-retry')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(onRefetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on non-session-changed errors — throws immediately', async () => {
    const rpc = jest.fn().mockRejectedValueOnce(new Error('Network timeout'))
    const isAlreadyDone = jest.fn()
    const onRefetch = jest.fn()

    await expect(retryOnSessionChanged(rpc, isAlreadyDone, onRefetch)).rejects.toThrow('Network timeout')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(onRefetch).not.toHaveBeenCalled()
  })

  it('returns "idempotent" on second attempt when already done (executeComplete idempotency)', async () => {
    const rpc = jest.fn()
      .mockRejectedValueOnce(new Error('Session changed'))
    const isAlreadyDone = jest.fn().mockResolvedValue(true)
    const onRefetch = jest.fn().mockResolvedValue(undefined)

    const result = await retryOnSessionChanged(rpc, isAlreadyDone, onRefetch)

    expect(result).toBe('idempotent')
    // RPC was called once (failed), then on retry isAlreadyDone returned true → no second RPC
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('throws "Session changed" when retry also fails with the same error', async () => {
    const rpc = jest.fn().mockRejectedValue(new Error('Session changed'))
    const isAlreadyDone = jest.fn().mockResolvedValue(false)
    const onRefetch = jest.fn().mockResolvedValue(undefined)

    await expect(retryOnSessionChanged(rpc, isAlreadyDone, onRefetch)).rejects.toThrow('Session changed')
    // Attempt 0: 'Session changed' → continue; attempt 1: 'Session changed' → throw (no more retries)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
