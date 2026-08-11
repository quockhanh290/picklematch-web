import { scoreMatch, withRecentGroupRematchKeys } from '../../../lib/next-round-suggester/score'
import { buildRecentGroupRematchKeys } from '../../../lib/next-round-suggester/pair'
import { OVER_TOLERANCE_BARRIER } from '../../../lib/next-round-suggester/quality-cost'
import { createMatch, createPlayer, createState } from '../helpers/factories'
import type { RoundRecord, SessionState, Team } from '../../../lib/next-round-suggester/types'

// scoreMatch holds two scoring models behind one `if`. Under the cost model it returns at score.ts:631,
// which is BEFORE the gate at :657 that blocks replaying the same four players against each other. The
// cost model has no term standing in for it — its repeat curve prices PAIR meetings, and four people
// meeting again as the same two-versus-two costs no more than any other repeat.
//
// So the rule disappears exactly for the sessions on the cost model, silently. It is not a weight the
// model can be tuned into honouring: the two models simply disagree about whether a rule exists.
//
// Restored the way the tolerance rule already is — as a barrier that dominates cost rather than an
// INFINITY that would put a hard gate back inside a soft model. A rematch stays orderable against other
// rematches, and always loses to any lineup that is not one.
describe('the cost model keeps the whole-four rematch rule', () => {
  const teamA: Team = ['p1', 'p2']
  const teamB: Team = ['p3', 'p4']

  const buildState = (): SessionState => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(id => createPlayer(id, { pvna: 3 })),
    })
    state.config.quality_cost_enabled = true as never

    const round: RoundRecord = {
      session_id: state.session_id,
      round_no: 1,
      status: 'completed',
      matches: [createMatch(teamA, teamB)],
      resting: [],
      started_at: null,
      ended_at: null,
    }
    state.rounds = [round]
    return withRecentGroupRematchKeys(state, buildRecentGroupRematchKeys(state, 2))
  }

  const scoreOf = (a: Team, b: Team, state: SessionState) => {
    const scored = scoreMatch(a, b, state, { tolerance: 0.5 })
    return typeof scored === 'number' ? scored : scored.score
  }

  it('ranks a replay of the same four below a lineup that is not a replay', () => {
    const state = buildState()

    const replay = scoreOf(teamA, teamB, state)
    const fresh = scoreOf(['p5', 'p6'], ['p7', 'p8'], state)

    expect(replay).toBeGreaterThan(fresh)
  })

  it('charges nothing to a lineup that is not the same four', () => {
    const state = buildState()

    // One of them plus three new. The rule is wider than an exact replay: it keys on the group of four,
    // so re-splitting those four is still a rematch, and it also catches a three-of-four overlap as a
    // near-rematch. Breaking the group down to a single carried-over player is what clears it.
    const differentFour = scoreOf(['p1', 'p5'], ['p6', 'p7'], state)

    expect(differentFour).toBeLessThan(OVER_TOLERANCE_BARRIER)
  })
})
