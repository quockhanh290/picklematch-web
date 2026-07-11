import { shouldRefetchForExternalVersion } from '../../features/host/session-detail/next-round-v2/version-poll'

describe('external live version poll', () => {
  it('refetches only when the server version advances', () => {
    expect(shouldRefetchForExternalVersion(7, 8)).toBe(true)
    expect(shouldRefetchForExternalVersion(7, 7)).toBe(false)
    expect(shouldRefetchForExternalVersion(7, 6)).toBe(false)
  })

  it('treats a missing local version as stale but ignores a missing server version', () => {
    expect(shouldRefetchForExternalVersion(null, 1)).toBe(true)
    expect(shouldRefetchForExternalVersion(1, null)).toBe(false)
  })
})
