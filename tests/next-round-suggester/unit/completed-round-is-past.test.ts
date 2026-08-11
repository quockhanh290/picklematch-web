import { getRecentRepeatCost, hasRecentGroupRematch } from '../../../lib/next-round-suggester/score'
import { createMatch, createPlayer, createState } from '../helpers/factories'
import type { RoundRecord, SessionState, Team } from '../../../lib/next-round-suggester/types'

// Part of BUG #4/#5/#6/#7, the round_no cluster. Both repeat guards compute
// `distance = roundNo - round.round_no` and skip when it is <= 0, treating a higher round number as the
// future. In the live lane round_no counts cycles on ONE court, and courts drift: court 1 can be on
// round 8 while court 3 is on round 2. Judging a lineup for court 3, every completed match carrying
// round 8 looks like it has not happened yet and is skipped, so the engine is free to rebuild a pairing
// that finished minutes ago on another court.
//
// A completed round is history no matter whose counter it carries. round-no-characterization.test.ts
// pins the current behaviour and its eighth case names this contradiction directly; that test is
// expected to change with this fix, deliberately, rather than being edited to stay green.
describe('a completed round counts as past whichever court numbered it', () => {
  const round = (roundNo: number, teamA: Team, teamB: Team): RoundRecord => ({
    session_id: 's', round_no: roundNo, status: 'completed',
    matches: [createMatch(teamA, teamB)], resting: [], started_at: null, ended_at: null,
  })

  const state = (rounds: RoundRecord[]): SessionState => {
    const s = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: ['p1', 'p2', 'p3', 'p4'].map((id, i) => createPlayer(id, { pvna: 3 + i * 0.05 })),
    })
    s.rounds = rounds
    return s
  }

  const teamA: Team = ['p1', 'p2']
  const teamB: Team = ['p3', 'p4']

  it('charges a repeat for a match finished on a court that is further ahead', () => {
    // The pairing finished in round 8 on a fast court. Court 3 is being filled at round 2.
    const cost = getRecentRepeatCost(teamA, teamB, state([round(8, teamA, teamB)]), 2)

    expect(cost.total).toBeGreaterThan(0)
  })

  it('blocks a group rematch that finished on a court further ahead', () => {
    const blocked = hasRecentGroupRematch(teamA, teamB, state([round(8, teamA, teamB)]), 2, 3)

    expect(blocked).toBe(true)
  })

  it('still charges repeats from courts that are behind', () => {
    const cost = getRecentRepeatCost(teamA, teamB, state([round(1, teamA, teamB)]), 2)

    expect(cost.total).toBeGreaterThan(0)
  })

  it('ignores rounds that are not completed', () => {
    const pending: RoundRecord = { ...round(8, teamA, teamB), status: 'active' }

    expect(getRecentRepeatCost(teamA, teamB, state([pending]), 2).total).toBe(0)
  })
})
