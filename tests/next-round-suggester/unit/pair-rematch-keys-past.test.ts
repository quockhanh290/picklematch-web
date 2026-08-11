import { buildRecentGroupRematchKeys } from '../../../lib/next-round-suggester/pair'
import { createMatch, createPlayer, createState } from '../helpers/factories'
import type { RoundRecord, SessionState, Team } from '../../../lib/next-round-suggester/types'

// Third of the four BUG #7 sites. score.ts (baa5c70) and quality-cost.ts (088ff67) stopped reading a
// completed round from a faster court as the future; pair.ts still does, so the rematch-key set it
// builds omits exactly the groups that just finished elsewhere on the board.
//
// The keys are what stops the pairing stage rebuilding a group, so an omission here is not a pricing
// nudge — it is the guard not firing at all.
describe('recent group rematch keys include rounds finished on faster courts', () => {
  const teamA: Team = ['p1', 'p2']
  const teamB: Team = ['p3', 'p4']

  const stateAt = (currentRound: number, priorRoundNo: number): SessionState => {
    const s = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      // Eight players so addNearKeys is satisfied and the set is built at all.
      players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id, i) =>
        createPlayer(id, { pvna: 3 + i * 0.05 })),
    })
    s.current_round = currentRound
    s.rounds = [{
      session_id: 's', round_no: priorRoundNo, status: 'completed',
      matches: [createMatch(teamA, teamB)], resting: [], started_at: null, ended_at: null,
    } as RoundRecord]
    return s
  }

  it('keys a group that finished on a court further ahead', () => {
    expect(buildRecentGroupRematchKeys(stateAt(2, 8), 3).size).toBeGreaterThan(0)
  })

  it('still keys a group that finished on a court behind', () => {
    expect(buildRecentGroupRematchKeys(stateAt(2, 1), 3).size).toBeGreaterThan(0)
  })

  it('does not key a group from outside the block window', () => {
    expect(buildRecentGroupRematchKeys(stateAt(40, 1), 3).size).toBe(0)
  })
})
