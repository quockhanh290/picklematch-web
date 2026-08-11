import { hasHardPreviewQualityViolation } from '../../features/host/session-detail/next-round-v2/preview-consistency'
import { createPlayer, createState } from '../next-round-suggester/helpers/factories'

// BUG #32. The client's quality gate picks its threshold from `match.round_no < 5`, and round_no counts
// cycles on ONE court. Courts drift, so two lanes of the SAME board arrive carrying different numbers —
// a court on its 6th cycle and a court on its 3rd — and the same lineup quality is accepted on one lane
// and rejected on the other.
//
// Whether the gate should loosen later in a session is a separate question. What it may not do is answer
// it differently for two lanes the host is looking at side by side.
describe('one board, one quality threshold', () => {
  // Gap of 0.9 over a tolerance of 0.5: 0.4 over, which lands between the two thresholds — under the
  // late-session bar of 1.0 and over the early-session bar of 0.25. Exactly the band where the two
  // answers disagree.
  const state = createState({
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a1', { pvna: 3.5 }),
      createPlayer('a2', { pvna: 3.4 }),
      createPlayer('b1', { pvna: 3.0 }),
      createPlayer('b2', { pvna: 3.0 }),
    ],
  })

  const judge = (roundNo: number) => hasHardPreviewQualityViolation(
    { round_no: roundNo, team_a: ['a1', 'a2'], team_b: ['b1', 'b2'] } as never,
    state,
    0.5,
  )

  it('judges a lane on its 3rd cycle the same as a lane on its 6th', () => {
    expect(judge(3)).toBe(judge(6))
  })

  it('still rejects a real blowout on any lane', () => {
    const lopsided = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a1', { pvna: 5 }),
        createPlayer('a2', { pvna: 5 }),
        createPlayer('b1', { pvna: 2 }),
        createPlayer('b2', { pvna: 2 }),
      ],
    })

    for (const roundNo of [1, 3, 6, 9]) {
      expect(hasHardPreviewQualityViolation(
        { round_no: roundNo, team_a: ['a1', 'a2'], team_b: ['b1', 'b2'] } as never,
        lopsided,
        0.5,
      )).toBe(true)
    }
  })
})
