import { computeQualityCost } from '../../../lib/next-round-suggester/quality-cost'
import { createMatch, createPlayer, createState, setOpponentRepeats } from '../helpers/factories'
import type { RoundRecord, SessionState, Team } from '../../../lib/next-round-suggester/types'

// Remainder of BUG #7. score.ts stopped treating a completed round from a faster court as the future
// (commit baa5c70); quality-cost's recency window still does, at recentMeetings, so the cost model keeps
// pricing a pairing as fresh when it finished minutes ago on a court further ahead in its own count.
//
// The two models disagreeing about what counts as recent is worse than either rule on its own: which
// answer a host gets depends on a rollout flag.
describe('quality-cost recency counts completed rounds from faster courts', () => {
  const teamA: Team = ['p1', 'p2']
  const teamB: Team = ['p3', 'p4']

  const stateAt = (currentRound: number, priorRoundNo: number): SessionState => {
    const s = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: ['p1', 'p2', 'p3', 'p4'].map((id, i) => createPlayer(id, { pvna: 3 + i * 0.05 })),
    })
    // recentMeetings is a multiplier on meetings that already exist, floored at 0.4 for old ones, so
    // the pair needs history before the recency window can be observed at all.
    setOpponentRepeats(s.players.get('p1')!, s.players.get('p3')!, 1)
    s.current_round = currentRound
    s.rounds = [{
      session_id: 's', round_no: priorRoundNo, status: 'completed',
      matches: [createMatch(teamA, teamB)], resting: [], started_at: null, ended_at: null,
    } as RoundRecord]
    return s
  }

  it('treats a meeting finished on a court further ahead as recent, not stale', () => {
    // Court 1 reached round 8 while this board is judged at round 2. That meeting just happened, so it
    // should be priced like the one from round 1, not discounted to the stale floor.
    const ahead = computeQualityCost(teamA, teamB, stateAt(2, 8), { tolerance: 0.5 })
    const behind = computeQualityCost(teamA, teamB, stateAt(2, 1), { tolerance: 0.5 })

    expect(ahead.cost).toBeCloseTo(behind.cost, 6)
  })

  it('still discounts a meeting that really is old', () => {
    const old = computeQualityCost(teamA, teamB, stateAt(40, 1), { tolerance: 0.5 })
    const recent = computeQualityCost(teamA, teamB, stateAt(2, 1), { tolerance: 0.5 })

    expect(old.cost).toBeLessThan(recent.cost)
  })
})
