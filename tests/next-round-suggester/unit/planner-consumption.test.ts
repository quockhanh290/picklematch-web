import { selectConsumablePlannedCourts } from '@/lib/next-round-suggester/planner/consumption'
import { buildSuggestedMatchPayloads } from '@/lib/next-round-suggester/live-preview'
import type { SessionLiveMatchRow } from '@/lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

describe('Phase 5B per-court consumption', () => {
  const state = createState({
    players: Array.from({ length: 12 }, (_, index) => createPlayer(`p${index + 1}`)),
    courts: 3,
  })
  const candidate = (courtIdx: number, ids: [string, string, string, string]) => ({
    court_idx: courtIdx,
    live_round_no: 0,
    planned_round_no: 1,
    match: { team_a: [ids[0], ids[1]] as [string, string], team_b: [ids[2], ids[3]] as [string, string] },
  })

  it('accepts independent usable courts and reserves their players', () => {
    const result = selectConsumablePlannedCourts({
      state,
      identityMatches: true,
      candidates: [
        candidate(0, ['p1', 'p2', 'p3', 'p4']),
        candidate(1, ['p5', 'p6', 'p7', 'p8']),
      ],
    })
    expect(result.accepted.map(item => item.court_idx)).toEqual([0, 1])
    expect(result.reserved_player_ids).toEqual(new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']))
  })

  it('keeps a good court while routing a conflicting court to repair', () => {
    const result = selectConsumablePlannedCourts({
      state,
      identityMatches: true,
      candidates: [
        candidate(0, ['p1', 'p2', 'p3', 'p4']),
        candidate(1, ['p4', 'p5', 'p6', 'p7']),
      ],
    })
    expect(result.accepted.map(item => item.court_idx)).toEqual([0])
    expect(result.decisions.map(item => item.status)).toEqual(['usable', 'repair_required'])
    expect(result.decisions[1].reasons).toContain('reserved')
  })

  it('routes busy planned players to repair without rejecting other courts', () => {
    const result = selectConsumablePlannedCourts({
      state,
      identityMatches: true,
      busyIds: new Set(['p2']),
      candidates: [
        candidate(0, ['p1', 'p2', 'p3', 'p4']),
        candidate(1, ['p5', 'p6', 'p7', 'p8']),
      ],
    })
    expect(result.accepted.map(item => item.court_idx)).toEqual([1])
    expect(result.decisions[0]).toMatchObject({ status: 'repair_required', reasons: ['busy'] })
  })

  it('falls back every court when planner identity is stale', () => {
    const result = selectConsumablePlannedCourts({
      state,
      identityMatches: false,
      candidates: [candidate(0, ['p1', 'p2', 'p3', 'p4'])],
    })
    expect(result.accepted).toEqual([])
    expect(result.decisions[0].status).toBe('fallback')
  })

  it('keeps planned players reserved while the live engine fills unresolved courts', () => {
    const plannedLock: SessionLiveMatchRow = {
      id: 'planned-lock',
      session_id: state.session_id,
      sequence_no: 0,
      round_no: 0,
      cycle_no: 0,
      court_idx: 0,
      status: 'suggested',
      team_a: ['p1', 'p2'],
      team_b: ['p3', 'p4'],
      resting: [],
      score_a: 0,
      score_b: 0,
      suggested_at: new Date(0).toISOString(),
      started_at: null,
      ended_at: null,
    }
    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 3,
      state,
      rows: { liveMatchRows: [plannedLock], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: {
        config_changes: {},
        tier_overrides: {},
        applied_for_warnings: [],
      },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [1] },
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(1)
    expect([...payloads[0].team_a, ...payloads[0].team_b]
      .some(id => ['p1', 'p2', 'p3', 'p4'].includes(id))).toBe(false)
  })
})
