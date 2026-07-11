import { classifyPersistAssignmentConflict } from '../../features/host/session-detail/next-round-v2/preview-conflict-recovery'

const rows = [
  { id: 'live-1', status: 'live', court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
  { id: 'suggested-2', status: 'suggested', court_idx: 1, team_a: ['p4', 'p5'], team_b: ['p6', 'p7'] },
  { id: 'completed-3', status: 'completed', court_idx: 2, team_a: ['p8', 'p9'], team_b: ['p10', 'p11'] },
]

describe('persist assignment conflict recovery', () => {
  it('regenerates when the authoritative snapshot advanced', () => {
    expect(classifyPersistAssignmentConflict({
      requestVersion: 7,
      snapshotVersion: 8,
      liveMatchRows: rows,
    })).toMatchObject({ stateAdvanced: true, authoritativeVersion: 8 })
  })

  it('reports authoritative blocker identities when the version is unchanged', () => {
    expect(classifyPersistAssignmentConflict({
      requestVersion: 7,
      snapshotVersion: 7,
      liveMatchRows: rows,
    })).toEqual({
      stateAdvanced: false,
      authoritativeVersion: 7,
      conflictingMatchIds: ['live-1', 'suggested-2'],
      conflictingPlayerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
      conflictingCourtIdxs: [0, 1],
    })
  })

  it('keeps a missing authoritative version unknown', () => {
    expect(classifyPersistAssignmentConflict({
      requestVersion: 7,
      snapshotVersion: null,
      liveMatchRows: [],
    })).toMatchObject({ stateAdvanced: false, authoritativeVersion: null })
  })
})
