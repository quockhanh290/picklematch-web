import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types'

// Production requests 2ce7a8de and dd89d049 came back with an empty court. Neither was a fault: the
// anti-fatigue guard held back everyone at four consecutive matches, and what remained was three
// players — enough to fail "is anybody left", never enough to seat a court. The engine chose to wait.
//
// Waiting is a defensible answer. Choosing it silently is not: the host sees an empty lane and cannot
// tell a deliberate wait from a broken engine. Per the host's decision this becomes a panel — the same
// shape already used for repeat and blowout — so the choice between resting the tired player and
// playing them a fifth time in a row belongs to the person watching the court.
describe('fatigue forced tradeoff', () => {
  const liveRow = (id: string, courtIdx: number, a: [string, string], b: [string, string]) => ({
    id, session_id: 'r', sequence_no: courtIdx, round_no: 0, cycle_no: null, court_idx: courtIdx,
    status: 'live', team_a: a, team_b: b, resting: [], score_a: 0, score_b: 0,
    suggested_at: null, started_at: new Date('2026-05-14T12:00:00.000Z'), ended_at: null,
    created_at: null, updated_at: null, suggestion_metadata: null,
  } as unknown as SessionLiveMatchRow)

  const build = () => {
    const state = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('tired', { pvna: 3.0, matches_played: 4, consecutive_play: 4 }),
        createPlayer('fresh-1', { pvna: 3.1 }),
        createPlayer('fresh-2', { pvna: 3.2 }),
        createPlayer('fresh-3', { pvna: 3.3 }),
        createPlayer('busy-1', { pvna: 3.4 }),
        createPlayer('busy-2', { pvna: 3.5 }),
        createPlayer('busy-3', { pvna: 3.6 }),
        createPlayer('busy-4', { pvna: 3.7 }),
      ],
    })
    return buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 2,
      state,
      rows: {
        liveMatchRows: [liveRow('live-1', 1, ['busy-1', 'busy-2'], ['busy-3', 'busy-4'])],
        liveStateVersion: 1,
      },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [0] },
    })
  }

  it('offers the court as a choice instead of leaving it silently empty', () => {
    const payloads = build()

    expect(payloads).toHaveLength(1)
    expect(payloads[0].forced_tradeoff?.kind).toBe('fatigue')
  })

  it('puts the tired player in the lineup the host would be accepting', () => {
    const seated = build()[0]?.forced_tradeoff?.acceptRepeat

    expect(seated).toBeDefined()
    expect([...seated!.team_a, ...seated!.team_b]).toContain('tired')
  })

  it('explains which player the wait is protecting', () => {
    expect(build()[0]?.forced_tradeoff?.explanation ?? '').toMatch(/tired|liên tiếp/i)
  })
})
