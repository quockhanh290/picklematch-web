import {
  canRecoverMissingPreviewCourts,
  computeHasGenuinePreviewQualityViolation,
  computeShouldRequestFullBoardPreview,
  hasHardPreviewQualityViolation,
  shouldRestMissForceFullBoard,
} from '@/features/host/session-detail/next-round-v2/preview-consistency'

function stateWithPvna(pvnaById: Record<string, number>) {
  return {
    players: new Map(Object.entries(pvnaById).map(([id, pvna]) => [id, { pvna }])),
  } as any
}

describe('hasHardPreviewQualityViolation', () => {
  it('flags an early-round match whose team-total pvna gap exceeds tolerance by more than 0.25', () => {
    const match = { round_no: 1, team_a: ['1', '2'], team_b: ['3', '4'] }
    // team_a = 5+3=8, team_b = 4+1=5, gap=3, tolerance=0.5 -> overBy=2.5
    const state = stateWithPvna({ '1': 5, '2': 3, '3': 4, '4': 1 })
    expect(hasHardPreviewQualityViolation(match, state, 0.5)).toBe(true)
  })

  it('does not flag an early-round match within the 0.25-over-tolerance band', () => {
    const match = { round_no: 1, team_a: ['1', '2'], team_b: ['3', '4'] }
    // gap = |8-7.6| = 0.4, tolerance=0.5 -> overBy=-0.1 (under tolerance)
    const state = stateWithPvna({ '1': 5, '2': 3, '3': 4, '4': 3.6 })
    expect(hasHardPreviewQualityViolation(match, state, 0.5)).toBe(false)
  })

  it('late-round matches only reject when overBy exceeds 1 (looser than early/mid rounds)', () => {
    const match = { round_no: 5, team_a: ['1', '2'], team_b: ['3', '4'] }
    // gap = |8-7.4| = 0.6, tolerance=0.5 -> overBy=0.1 -- would fail early-round (>0.25 band) but
    // round 5 is NOT early/mid (roundNo < 5 is false), so it's allowed.
    const state = stateWithPvna({ '1': 5, '2': 3, '3': 4, '4': 3.4 })
    expect(hasHardPreviewQualityViolation(match, state, 0.5)).toBe(false)
  })

  it('late-round matches still reject when overBy exceeds 1', () => {
    const match = { round_no: 5, team_a: ['1', '2'], team_b: ['3', '4'] }
    const state = stateWithPvna({ '1': 5, '2': 3, '3': 4, '4': 1 })
    expect(hasHardPreviewQualityViolation(match, state, 0.5)).toBe(true)
  })
})

describe('computeHasGenuinePreviewQualityViolation', () => {
  const badMatch = { id: 'm1', round_no: 1, team_a: ['1', '2'], team_b: ['3', '4'] }
  const state = stateWithPvna({ '1': 5, '2': 3, '3': 4, '4': 1 })

  it('flags a fresh (non-persisted) match with a hard quality violation', () => {
    expect(computeHasGenuinePreviewQualityViolation({
      previewBoard: [badMatch],
      persistedSuggestedMatchIds: new Set(),
      state,
      pvnaTolerance: 0.5,
    })).toBe(true)
  })

  it('does not flag a persisted (already-committed) match even with a hard quality violation', () => {
    expect(computeHasGenuinePreviewQualityViolation({
      previewBoard: [badMatch],
      persistedSuggestedMatchIds: new Set(['m1']),
      state,
      pvnaTolerance: 0.5,
    })).toBe(false)
  })

  it('does not flag an available-pool-only match', () => {
    expect(computeHasGenuinePreviewQualityViolation({
      previewBoard: [{ ...badMatch, available_pool_only: true }],
      persistedSuggestedMatchIds: new Set(),
      state,
      pvnaTolerance: 0.5,
    })).toBe(false)
  })

  it('returns false for an empty board', () => {
    expect(computeHasGenuinePreviewQualityViolation({
      previewBoard: [],
      persistedSuggestedMatchIds: new Set(),
      state,
      pvnaTolerance: 0.5,
    })).toBe(false)
  })
})

describe('shouldRestMissForceFullBoard', () => {
  it('forces full board when a rest-priority miss exists and no lanes are missing to recover into', () => {
    expect(shouldRestMissForceFullBoard({
      hasRestPriorityMiss: true,
      missingPreviewCourtIdxsForRecoveryCount: 0,
    })).toBe(true)
  })

  it('does not force full board when there is a lane mini-recover could fill instead', () => {
    expect(shouldRestMissForceFullBoard({
      hasRestPriorityMiss: true,
      missingPreviewCourtIdxsForRecoveryCount: 1,
    })).toBe(false)
  })

  it('does not force full board when there is no rest-priority miss', () => {
    expect(shouldRestMissForceFullBoard({
      hasRestPriorityMiss: false,
      missingPreviewCourtIdxsForRecoveryCount: 0,
    })).toBe(false)
  })
})

describe('canRecoverMissingPreviewCourts', () => {
  it('recovers when there is no genuine violation, missing courts exist, and reusable count is short', () => {
    expect(canRecoverMissingPreviewCourts({
      hasGenuinePreviewQualityViolation: false,
      missingPreviewCourtIdxsForRecoveryCount: 1,
      reusableMatchCount: 1,
      suggestedQueueCount: 2,
    })).toBe(true)
  })

  it('does not recover when a genuine violation exists', () => {
    expect(canRecoverMissingPreviewCourts({
      hasGenuinePreviewQualityViolation: true,
      missingPreviewCourtIdxsForRecoveryCount: 1,
      reusableMatchCount: 1,
      suggestedQueueCount: 2,
    })).toBe(false)
  })

  it('does not recover when there is nothing missing', () => {
    expect(canRecoverMissingPreviewCourts({
      hasGenuinePreviewQualityViolation: false,
      missingPreviewCourtIdxsForRecoveryCount: 0,
      reusableMatchCount: 1,
      suggestedQueueCount: 2,
    })).toBe(false)
  })

  it('does not recover when reusable matches already meet the queue count', () => {
    expect(canRecoverMissingPreviewCourts({
      hasGenuinePreviewQualityViolation: false,
      missingPreviewCourtIdxsForRecoveryCount: 1,
      reusableMatchCount: 2,
      suggestedQueueCount: 2,
    })).toBe(false)
  })
})

describe('computeShouldRequestFullBoardPreview', () => {
  const base = {
    pendingPlanAdoption: false,
    hasGenuinePreviewQualityViolation: false,
    restMissForcesFullBoard: false,
    reusableMatchCount: 2,
    shouldRecoverMissingPreviewCourts: false,
    missingPreviewCourtIdxsForRecoveryCount: 0,
    replacementMaxCount: 2,
  }

  it('requests full board on pending plan adoption', () => {
    expect(computeShouldRequestFullBoardPreview({ ...base, pendingPlanAdoption: true })).toBe(true)
  })

  it('requests full board on a genuine quality violation', () => {
    expect(computeShouldRequestFullBoardPreview({ ...base, hasGenuinePreviewQualityViolation: true })).toBe(true)
  })

  it('requests full board when a rest miss forces it', () => {
    expect(computeShouldRequestFullBoardPreview({ ...base, restMissForcesFullBoard: true })).toBe(true)
  })

  it('requests full board when there are no reusable matches at all', () => {
    expect(computeShouldRequestFullBoardPreview({ ...base, reusableMatchCount: 0 })).toBe(true)
  })

  it('stays scoped to replace_courts when 0 reusable but the open courts fit mini-recover (live board, one empty lane)', () => {
    // 5 courts live + 1 empty lane, no pending suggestions -> reusableMatchCount is 0, but the single
    // open court is recoverable via replace_courts. Forcing full_board here makes the edge re-persist
    // the live courts' players too -> "already assigned" conflict -> the empty lane stays stuck.
    expect(computeShouldRequestFullBoardPreview({
      ...base,
      reusableMatchCount: 0,
      shouldRecoverMissingPreviewCourts: true,
      missingPreviewCourtIdxsForRecoveryCount: 1,
      replacementMaxCount: 2,
    })).toBe(false)
  })

  it('requests full board when recovery would exceed the replacement max count', () => {
    expect(computeShouldRequestFullBoardPreview({
      ...base,
      shouldRecoverMissingPreviewCourts: true,
      missingPreviewCourtIdxsForRecoveryCount: 3,
      replacementMaxCount: 2,
    })).toBe(true)
  })

  it('does not request full board when recovery is within the replacement max count', () => {
    expect(computeShouldRequestFullBoardPreview({
      ...base,
      shouldRecoverMissingPreviewCourts: true,
      missingPreviewCourtIdxsForRecoveryCount: 2,
      replacementMaxCount: 2,
    })).toBe(false)
  })

  it('stays scoped to replace_courts when nothing forces a full board', () => {
    expect(computeShouldRequestFullBoardPreview(base)).toBe(false)
  })
})
