import * as livePreview from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

// explainMatchOptimality reads player NAMES only on its counterfactual branches — i.e. when a
// seated opponent pair is a 3rd+ meeting (`worst` non-null). A purely lopsided-but-fresh match
// takes the numbers-only "Lệch X điểm" branch and never touches a name. So to exercise the
// fail-soft catch we need a REPEAT scenario: every pairwise opponent_count starts at 2, so any
// 2v2 the engine seats has a cross-team pair on its 3rd meeting → the explanation formats a
// name → the throwing getter fires deep inside explainMatchOptimality.
const REPEAT_HISTORY = (self: string) =>
  new Map(['p1', 'p2', 'p3', 'p4'].filter(id => id !== self).map(id => [id, 2] as const))

describe('blowoutRescue metadata calc fail-soft (W2)', () => {
  it('does not let a genuine throw inside the metadata calc escape buildSuggestedMatchPayloads', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.3,
      players: [
        createPlayer('p1', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p1') }),
        createPlayer('p2', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p2') }),
        createPlayer('p3', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p3') }),
        createPlayer('p4', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p4') }),
      ],
    })

    // Every player's `name` getter throws, so whichever cross-team pair the engine seats,
    // formatting the counterfactual explanation genuinely blows up inside explainMatchOptimality.
    const throwingName = (): { get name(): string } => ({
      get name(): string {
        throw new Error('probe: forced throw reading player name inside rescue metadata calc')
      },
    })
    const playersById = new Map<string, { name?: string | null }>([
      ['p1', throwingName()],
      ['p2', throwingName()],
      ['p3', throwingName()],
      ['p4', throwingName()],
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
  })

  it('sanity check: without the throwing name getter, the same repeat DOES produce an explanation', () => {
    // Proves the previous test's empty match_explanations is caused by the catch, not because
    // this scenario never reaches a name-reading branch in the happy path.
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.3,
      players: [
        createPlayer('p1', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p1') }),
        createPlayer('p2', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p2') }),
        createPlayer('p3', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p3') }),
        createPlayer('p4', { pvna: 3.0, opponent_counts: REPEAT_HISTORY('p4') }),
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
