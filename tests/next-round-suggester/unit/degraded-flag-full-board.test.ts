import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

// The degraded flag is computed in two places. computeMatchDegradedRescue is the one the edge
// function's full-board rescue calls, and its own comment records why it sets the flag independently of
// whether any live court exists: tying it to liveCourtIdxs.size > 0 "cleared genuine repeat-3 lanes
// whenever the whole board was suggested (no live courts), so the host lost the repeat warning".
//
// The fill loop never got that fix. It carries its own copy of the detection, still gated on a live
// court existing — so suggesting the whole board at once, which is exactly what happens at the start of
// a round, hands back lineups with no warning on them at all. Only the rescue SEARCH needs a live court;
// the flag is a property of the lineup.
describe('a degraded lineup is flagged even when no court is running', () => {
  const buildState = () => {
    const players = ['p1', 'p2', 'p3', 'p4'].map(id => createPlayer(id, { pvna: 3 }))
    const state = createState({ courts: 1, pvnaTolerance: 0.5, players })
    // createState clones its players, so the history has to be written onto the clones inside the state
    // — mutating the originals after the fact reaches nothing.
    const byId = Object.fromEntries([...state.players.values()].map(p => [p.player_id, p]))

    // Only four players are present, so the engine has exactly one foursome to seat and it is a severe
    // repeat whichever way it splits them.
    setPartnerRepeats(byId.p1, byId.p2, 3)
    setPartnerRepeats(byId.p3, byId.p4, 3)
    setOpponentRepeats(byId.p1, byId.p3, 3)
    setOpponentRepeats(byId.p1, byId.p4, 3)
    setOpponentRepeats(byId.p2, byId.p3, 3)
    setOpponentRepeats(byId.p2, byId.p4, 3)
    return state
  }

  it('flags a repeat-3 lineup suggested onto an empty board', () => {
    const state = buildState()

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: null },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
      pvnaTolerance: 0.5,
      options: { ignoreCapacityLock: true, rollingHorizon: false, rollingPlanTarget: null, blowoutRescue: true },
    } as never)

    expect(payloads).toHaveLength(1)
    expect(payloads[0].degraded_reason).toBe('repeat')
  })
})
