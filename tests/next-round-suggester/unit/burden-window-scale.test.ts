import { bestPartitioning } from '../../../lib/next-round-suggester/pair'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

// A characterization test: it pins the exact partition and score this roster produces, which is how it
// detects the defect at all. Under the shared constant the burden tie-break treated a 0.44 cost
// difference as a tie and returned the worse board (4.4764); with a cost-scale window it returns 4.0324.
// The margin sits well above either window, so the case is not sensitive to the window's exact value —
// but the golden numbers do have to be re-derived if the scoring weights change.
describe('bestPartitioning burden tie-break score windows', () => {
  it('does not let a legacy-scale burden window override a material quality-cost improvement', () => {
    const players = [
      createPlayer('p1', { pvna: 2.64 }),
      createPlayer('p2', { pvna: 4.81 }),
      createPlayer('p3', { pvna: 3.17 }),
      createPlayer('p4', { pvna: 3.33 }),
      createPlayer('p5', { pvna: 3.02 }),
      createPlayer('p6', { pvna: 3.42 }),
      createPlayer('p7', { pvna: 4.06 }),
      createPlayer('p8', { pvna: 2.84 }),
    ]
    const byId = Object.fromEntries(players.map(player => [player.player_id, player]))
    const partner = (a: string, b: string, count: number) => setPartnerRepeats(byId[a], byId[b], count)
    const opponent = (a: string, b: string, count: number) => setOpponentRepeats(byId[a], byId[b], count)

    partner('p1', 'p2', 1)
    opponent('p1', 'p2', 1)
    opponent('p1', 'p5', 1)
    opponent('p1', 'p6', 1)
    opponent('p1', 'p7', 2)
    partner('p1', 'p8', 1)
    partner('p2', 'p3', 1)
    opponent('p2', 'p3', 1)
    opponent('p2', 'p5', 1)
    partner('p2', 'p6', 1)
    opponent('p2', 'p6', 1)
    partner('p2', 'p7', 1)
    opponent('p2', 'p7', 1)
    partner('p3', 'p4', 1)
    opponent('p3', 'p4', 1)
    partner('p3', 'p5', 1)
    opponent('p3', 'p6', 1)
    partner('p4', 'p5', 1)
    opponent('p4', 'p5', 2)
    opponent('p4', 'p8', 1)
    opponent('p5', 'p6', 1)
    partner('p5', 'p7', 1)
    partner('p5', 'p8', 1)

    const state = createState({ players, courts: 2, pvnaTolerance: 0.5, currentRound: 3 })
    state.config.quality_cost_enabled = true

    const result = bestPartitioning(players, state)

    expect(result?.score).toBeCloseTo(4.0324, 4)
    expect(result?.matches.map(match => [match.team_a, match.team_b])).toEqual([
      [['p1', 'p3'], ['p4', 'p8']],
      [['p2', 'p5'], ['p6', 'p7']],
    ])
  })
})
