import { scoreMatch } from '../../../lib/next-round-suggester/score'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState } from '../helpers/factories'
import type { Team } from '../../../lib/next-round-suggester/types'

const scoreOf = (r: ReturnType<typeof scoreMatch>) => (typeof r === 'number' ? r : r.score)

// Under the cost model, scoreMatch returned the raw cost and ignored the tolerance entirely, so a soft
// preference could buy a lineup past the balance tolerance: with p1 preferring an F partner, the split
// that is 0.8 apart scored 0.3440 and beat the split that is 0.2 apart at 0.5400. ALGO 55 established
// that tolerance is a real threshold and gender is only a tie-break, but it only fixed
// bestSplitForFoursome, which the joint pass alone calls — the single-court path never saw the rule.
describe('scoreMatch tolerance under the cost model', () => {
  const withinTol: [Team, Team] = [['p1', 'p2'], ['p3', 'p4']]  // gap 0.2
  const overTol: [Team, Team] = [['p1', 'p4'], ['p2', 'p3']]    // gap 0.8

  const genderPrefState = () => {
    const s = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 4.0, gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { pvna: 3.0, gender: 'M' }),
        createPlayer('p3', { pvna: 3.5, gender: 'F' }),
        createPlayer('p4', { pvna: 3.3, gender: 'F' }),
      ],
    })
    s.config.quality_cost_enabled = true
    return s
  }

  beforeEach(() => { __setQualityCostModelOverrideForTests(true) })
  afterEach(() => { __setQualityCostModelOverrideForTests(null) })

  it('ranks a within-tolerance split above a cheaper split that breaks tolerance', () => {
    const s = genderPrefState()

    expect(scoreOf(scoreMatch(withinTol[0], withinTol[1], s, { tolerance: 0.5 })))
      .toBeLessThan(scoreOf(scoreMatch(overTol[0], overTol[1], s, { tolerance: 0.5 })))
  })

  // The cost model must not consult the legacy relaxation ladder's escape hatches. Honouring them here
  // would re-couple it to the 8-stage ladder it exists to replace, and it is not needed: the barrier
  // relaxes itself when nothing fits (see below).
  it('ignores the legacy allow-overflow option', () => {
    const s = genderPrefState()
    const plain = scoreOf(scoreMatch(overTol[0], overTol[1], s, { tolerance: 0.5 }))
    const relaxed = scoreOf(scoreMatch(overTol[0], overTol[1], s, { tolerance: 0.5, allowPvnaToleranceOverflow: true }))

    expect(relaxed).toBe(plain)
  })

  it('still ranks normally when every split breaks tolerance', () => {
    const s = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('q1', { pvna: 1.0 }),
        createPlayer('q2', { pvna: 2.0 }),
        createPlayer('q3', { pvna: 3.0 }),
        createPlayer('q4', { pvna: 9.0 }),
      ],
    })
    s.config.quality_cost_enabled = true
    const splits: [Team, Team][] = [
      [['q1', 'q2'], ['q3', 'q4']],
      [['q1', 'q3'], ['q2', 'q4']],
      [['q1', 'q4'], ['q2', 'q3']],
    ]

    const scores = splits.map(([a, b]) => scoreOf(scoreMatch(a, b, s, { tolerance: 0.5 })))

    expect(scores.every(Number.isFinite)).toBe(true)
    expect(new Set(scores).size).toBeGreaterThan(1)
  })
})
