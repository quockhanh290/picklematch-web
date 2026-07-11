import { buildPreviewPolicyFingerprint } from '../../features/host/session-detail/next-round-v2/preview-policy'

const base = {
  courtCount: 2,
  pvnaTolerance: 0.5,
  plannedTotalRounds: 8,
  courtPreset: 'balanced',
  avoidPairs: [{ player_a: 'p2', player_b: 'p1', reason: 'conflict' }],
}

describe('preview policy fingerprint', () => {
  it.each([
    ['court count', { courtCount: 3 }],
    ['PVNA tolerance', { pvnaTolerance: 0.75 }],
    ['target rounds', { plannedTotalRounds: 6 }],
    ['court preset', { courtPreset: 'play_more' }],
    ['avoid pairs', { avoidPairs: [] }],
  ])('changes when %s changes', (_label, patch) => {
    expect(buildPreviewPolicyFingerprint({ ...base, ...patch })).not.toBe(buildPreviewPolicyFingerprint(base))
  })

  it('is stable across avoid-pair direction and ordering', () => {
    const first = buildPreviewPolicyFingerprint({
      ...base,
      avoidPairs: [
        { player_a: 'p2', player_b: 'p1', reason: 'conflict' },
        { player_a: 'p4', player_b: 'p3', reason: 'preference' },
      ],
    })
    const second = buildPreviewPolicyFingerprint({
      ...base,
      avoidPairs: [
        { player_a: 'p3', player_b: 'p4', reason: 'preference' },
        { player_a: 'p1', player_b: 'p2', reason: 'conflict' },
      ],
    })
    expect(second).toBe(first)
  })
})
