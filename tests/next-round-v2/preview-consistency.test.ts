import {
  getLiveRowsForPreviewMode,
  isPreviewBatchCacheCurrent,
  isCommittedPreviewMatch,
  isPreviewResponseCurrent,
  isStartablePreviewRow,
} from '../../features/host/session-detail/next-round-v2/preview-consistency'

describe('preview consistency', () => {
  it('does not reserve retained suggestions during a full-board rebuild', () => {
    const liveRows = [
      { id: 'live', status: 'live' },
      { id: 'old-suggestion', status: 'suggested' },
      { id: 'completed', status: 'completed' },
    ]
    const retained = [{ id: 'retained', status: 'suggested' }]

    expect(getLiveRowsForPreviewMode('full_board', liveRows, retained)).toEqual([
      liveRows[0],
      liveRows[2],
    ])
  })

  it('reserves retained suggestions when replacing selected courts', () => {
    const liveRows = [{ id: 'live', status: 'live' }]
    const retained = [{ id: 'retained', status: 'suggested' }]

    expect(getLiveRowsForPreviewMode('replace_courts', liveRows, retained)).toEqual([
      liveRows[0],
      retained[0],
    ])
  })

  it('rejects a response computed from an older state even if the client advanced', () => {
    expect(isPreviewResponseCurrent({
      requestVersion: 41,
      responseVersion: 41,
      currentVersion: 42,
    })).toBe(false)
  })

  it('accepts only the exact request, response, and current state version', () => {
    expect(isPreviewResponseCurrent({
      requestVersion: 42,
      responseVersion: 42,
      currentVersion: 42,
    })).toBe(true)
  })

  it('accepts a server-persisted preview version advance when requested', () => {
    expect(isPreviewResponseCurrent({
      requestVersion: 42,
      responseVersion: 43,
      currentVersion: 42,
      allowResponseAdvance: true,
    })).toBe(true)

    expect(isPreviewResponseCurrent({
      requestVersion: 42,
      responseVersion: 43,
      currentVersion: 42,
    })).toBe(false)
  })

  it('keeps a committed batch across request-version churn while its lane policy is unchanged', () => {
    expect(isPreviewBatchCacheCurrent('stable-lane-policy', 'stable-lane-policy')).toBe(true)
    expect(isPreviewBatchCacheCurrent('old-lane-policy', 'new-lane-policy')).toBe(false)
  })

  it('allows an edge-committed partial lane to start without a complete batch', () => {
    expect(isCommittedPreviewMatch({
      previewSource: 'edge_committed',
      matchId: 'partial-court-2',
      committedBatchMatchIds: [],
      committedLaneMatchId: 'partial-court-2',
    })).toBe(true)
  })

  it('allows an edge-committed DB suggestion to start after the client cache resets', () => {
    expect(isCommittedPreviewMatch({
      previewSource: 'edge_committed',
      matchId: 'persisted-court-2',
      committedBatchMatchIds: [],
      committedLaneMatchId: null,
      persistedSuggestedMatchId: 'persisted-court-2',
    })).toBe(true)
  })

  it('does not trust a persisted id when the preview source is local', () => {
    expect(isCommittedPreviewMatch({
      previewSource: 'local_fallback',
      matchId: 'persisted-court-2',
      committedBatchMatchIds: [],
      committedLaneMatchId: null,
      persistedSuggestedMatchId: 'persisted-court-2',
    })).toBe(false)
  })

  it('does not trust a partial lane from a non-edge source', () => {
    expect(isCommittedPreviewMatch({
      previewSource: 'local_fallback',
      matchId: 'partial-court-2',
      committedBatchMatchIds: [],
      committedLaneMatchId: 'partial-court-2',
    })).toBe(false)
  })

  it('rejects preview rows that have teams but no startable identity', () => {
    expect(isStartablePreviewRow({
      id: null,
      status: null,
      court_idx: 2,
      team_a: ['p1', 'p2'],
      team_b: ['p3', 'p4'],
    })).toBe(false)

    expect(isStartablePreviewRow({
      id: 'preview-2-p1-p2-p3-p4',
      status: 'suggested',
      court_idx: 2,
      team_a: ['p1', 'p2'],
      team_b: ['p3', 'p4'],
    })).toBe(true)
  })
})
