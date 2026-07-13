import {
  getLiveRowsForPreviewMode,
  getSuggestedPreviewQueueCount,
  hasMissingRestPriorityPlayer,
  isPreviewBatchCacheCurrent,
  isCommittedPreviewMatch,
  isPreviewResponseCurrent,
  isStartablePreviewRow,
  mergePreviewLaneCandidates,
  mergePersistedSuggestionMetadata,
} from '../../features/host/session-detail/next-round-v2/preview-consistency'

describe('preview consistency', () => {
  it('fills every open court during the initial bootstrap', () => {
    expect(getSuggestedPreviewQueueCount({
      courtCount: 6,
      capacityOccupyingMatchCount: 1,
      completedMatchCount: 0,
      persistedSuggestedMatchCount: 5,
      previewAheadLimit: 2,
    })).toBe(5)
  })

  it('limits preview-ahead to two after play has completed', () => {
    expect(getSuggestedPreviewQueueCount({
      courtCount: 6,
      capacityOccupyingMatchCount: 2,
      completedMatchCount: 1,
      persistedSuggestedMatchCount: 1,
      previewAheadLimit: 2,
    })).toBe(2)
  })

  it('lets a larger persisted bootstrap batch drain without cancelling it', () => {
    expect(getSuggestedPreviewQueueCount({
      courtCount: 6,
      capacityOccupyingMatchCount: 1,
      completedMatchCount: 1,
      persistedSuggestedMatchCount: 4,
      previewAheadLimit: 2,
    })).toBe(4)
  })

  it('never requests more suggestions than open courts', () => {
    expect(getSuggestedPreviewQueueCount({
      courtCount: 6,
      capacityOccupyingMatchCount: 5,
      completedMatchCount: 3,
      persistedSuggestedMatchCount: 4,
      previewAheadLimit: 2,
    })).toBe(1)
  })

  it('invalidates a persisted board that omits an available player who already rested once', () => {
    expect(hasMissingRestPriorityPlayer({
      players: [
        { player_id: 'rested', consecutive_rest: 1, opted_rest: false, checked_out_at: null },
        { player_id: 'fresh', consecutive_rest: 0, opted_rest: false, checked_out_at: null },
      ],
      assignedPlayerIds: new Set(['fresh']),
    })).toBe(true)
  })

  it('does not invalidate for opted-rest, checked-out, or already-assigned players', () => {
    expect(hasMissingRestPriorityPlayer({
      players: [
        { player_id: 'assigned', consecutive_rest: 2, opted_rest: false, checked_out_at: null },
        { player_id: 'opted', consecutive_rest: 2, opted_rest: true, checked_out_at: null },
        { player_id: 'left', consecutive_rest: 2, opted_rest: false, checked_out_at: '2026-07-13' },
      ],
      assignedPlayerIds: new Set(['assigned']),
    })).toBe(false)
  })

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

  it('treats a just-persisted DB suggestion as reusable before local hydration runs', () => {
    const persisted = { id: 'persisted-2', status: 'suggested', court_idx: 2, sequence_no: 8 }
    const candidates = mergePreviewLaneCandidates({
      cachedMatches: [],
      visibleMatches: [],
      persistedMatches: [persisted],
    })

    expect(candidates.get(2)).toBe(persisted)
  })

  it('keeps cache and visible matches ahead of a delayed persisted copy', () => {
    const cached = { id: 'cached-1', status: 'suggested', court_idx: 1, sequence_no: 7 }
    const visible = { id: 'visible-2', status: 'suggested', court_idx: 2, sequence_no: 8 }
    const candidates = mergePreviewLaneCandidates({
      cachedMatches: [[1, cached] as [number, typeof cached]],
      visibleMatches: [visible],
      persistedMatches: [
        { ...cached, id: 'db-1' },
        { ...visible, id: 'db-2' },
      ],
    })

    expect(candidates.get(1)?.id).toBe('cached-1')
    expect(candidates.get(2)?.id).toBe('visible-2')
  })

  it('restores quality metadata without letting it override the persisted row identity', () => {
    expect(mergePersistedSuggestionMetadata({
      id: 'server-row',
      status: 'suggested',
      suggestion_metadata: {
        id: 'metadata-row',
        warnings: ['PVNA_TOLERANCE_RELAXED'],
        approval_required: true,
      },
    })).toMatchObject({
      id: 'server-row',
      status: 'suggested',
      warnings: ['PVNA_TOLERANCE_RELAXED'],
      approval_required: true,
    })
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
