import * as livePreview from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

describe('blowoutRescue metadata calc fail-soft (W2)', () => {
  it('does not let a genuine throw inside the metadata calc escape buildSuggestedMatchPayloads', () => {
    // Three near-identical low-pvna players + one extreme outlier: every 2v2 partition of 4
    // players forces the outlier onto one team, so the "Trận lệch ... chỉ có 1 người trình cao"
    // explanation branch in explainMatchCompromises ALWAYS fires (unconditional on isBlowout/
    // isRepeat/live-court gating) — this deterministically reaches `nm(highIds[0])`.
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.3,
      players: [
        createPlayer('p1', { pvna: 1.0 }),
        createPlayer('p2', { pvna: 1.0 }),
        createPlayer('p3', { pvna: 1.0 }),
        createPlayer('p4', { pvna: 8.0 }),
      ],
    })

    const playersById = new Map<string, { name?: string | null }>([
      ['p1', { name: 'p1' }],
      ['p2', { name: 'p2' }],
      ['p3', { name: 'p3' }],
      // Real fault injection (no mocking of internal calls, which self-calls bypass anyway):
      // p4's `name` getter throws, so `nm('p4')` genuinely blows up deep inside
      // explainMatchCompromises when it formats the "chỉ có 1 người trình cao" explanation.
      ['p4', {
        get name(): string {
          throw new Error('probe: forced throw reading player name inside rescue metadata calc')
        },
      }],
    ])

    let threw: unknown = null
    let payloads: ReturnType<typeof livePreview.buildSuggestedMatchPayloads> = []
    try {
      payloads = livePreview.buildSuggestedMatchPayloads({
        count: 1,
        sessionId: state.session_id,
        courtCount: 1,
        state,
        rows: { liveMatchRows: [], liveStateVersion: 1 },
        completingLiveMatchIds: new Set(),
        fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
        fairnessWarnings: [],
        playersById,
        pvnaTolerance: 0.3,
        options: { blowoutRescue: true },
      })
    } catch (err) {
      threw = err
    }

    expect(threw).toBeNull()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].team_a.length).toBe(2)
    expect(payloads[0].team_b.length).toBe(2)
    expect(payloads[0].match_explanations).toBeUndefined()
    expect(payloads[0].degraded_reason).toBeUndefined()
    expect(payloads[0].rescue_court_idxs).toBeUndefined()
  })

  it('sanity check: without the throwing name getter, the same imbalance DOES produce an explanation', () => {
    // Proves the previous test's empty match_explanations is caused by the catch, not because
    // this scenario never reaches the explanation branch in the happy path.
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.3,
      players: [
        createPlayer('p1', { pvna: 1.0 }),
        createPlayer('p2', { pvna: 1.0 }),
        createPlayer('p3', { pvna: 1.0 }),
        createPlayer('p4', { pvna: 8.0 }),
      ],
    })

    const payloads = livePreview.buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.3,
      options: { blowoutRescue: true },
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].match_explanations).toBeDefined()
    expect(payloads[0].match_explanations!.length).toBeGreaterThan(0)
  })
})
