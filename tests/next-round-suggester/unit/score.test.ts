import { genderPenalty, scoreMatch } from '../../../lib/next-round-suggester/score'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('scoreMatch', () => {
  it('scores empty history as PVNA diff / 0.5', () => {
    const state = createState({
      players: [
        createPlayer('p1', { pvna: 3.75 }),
        createPlayer('p2', { pvna: 3.25 }),
        createPlayer('p3', { pvna: 3.5 }),
        createPlayer('p4', { pvna: 3.0 }),
      ],
    })

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBe(0.5)
  })

  it('adds partner repeat penalty', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    setPartnerRepeats(p1, p2, 2)
    setPartnerRepeats(p3, p4, 1)

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }))

    expect(result.stats.partner_repeats).toBe(3)
    expect(result.score).toBe(9)
  })

  it('adds opponent repeat penalty across all four opponent pairs', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    setOpponentRepeats(p1, p3, 1)
    setOpponentRepeats(p1, p4, 1)
    setOpponentRepeats(p2, p3, 1)
    setOpponentRepeats(p2, p4, 1)

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }))

    expect(result.stats.opponent_repeats).toBe(4)
    expect(result.score).toBe(6)
  })

  it('subtracts group bonus for grouped players', () => {
    const state = createState({
      players: [
        createPlayer('p1', { group_id: 'g1' }),
        createPlayer('p2', { group_id: 'g1' }),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBe(-5)
  })

  it('does not subtract group bonus when grouped players are opponents', () => {
    const state = createState({
      players: [
        createPlayer('p1', { group_id: 'g1' }),
        createPlayer('p2'),
        createPlayer('p3', { group_id: 'g1' }),
        createPlayer('p4'),
      ],
    })

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).stats.group_bonus).toBe(0)
  })

  it('adds gender preference penalties with override weights 2 and 1', () => {
    const state = createState({
      weights: { partner_gender_pref: 2, opponent_gender_pref: 1 },
      players: [
        createPlayer('p1', { gender: 'M', partner_gender_pref: 'F', opponent_gender_pref: 'F' }),
        createPlayer('p2', { gender: 'M' }),
        createPlayer('p3', { gender: 'M' }),
        createPlayer('p4', { gender: 'M' }),
      ],
    })

    expect(genderPenalty(['p1', 'p2'], ['p3', 'p4'], state)).toBe(4)
  })

  it('keeps all penalties additive', () => {
    const p1 = createPlayer('p1', { pvna: 3.75, gender: 'M', partner_gender_pref: 'F' })
    const p2 = createPlayer('p2', { pvna: 3.25, gender: 'M', group_id: 'g1' })
    const p3 = createPlayer('p3', { pvna: 3.5, gender: 'F', group_id: 'g1' })
    const p4 = createPlayer('p4', { pvna: 3.0, gender: 'F' })
    setPartnerRepeats(p1, p2, 1)
    setOpponentRepeats(p1, p3, 1)

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }))

    expect(result.score).toBe(0.5 + 3 + 1.5 + 4)
  })

  it('discounts partner gender preference mismatch by 50% for same-group partners', () => {
    const state = createState({
      players: [
        createPlayer('p1', { group_id: 'g1', gender: 'F', partner_gender_pref: 'M' }),
        createPlayer('p2', { group_id: 'g1', gender: 'F' }),
        createPlayer('p3', { gender: 'M' }),
        createPlayer('p4', { gender: 'M' }),
      ],
    })

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state)

    expect(result.stats.group_bonus).toBe(1)
    expect(result.stats.gender_pref_penalty).toBe(2)
    expect(result.score).toBe(-3)
  })

  it('returns Infinity when inter-team PVNA diff violates hard guard', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 4.6 }),
        createPlayer('p2', { pvna: 4.4 }),
        createPlayer('p3', { pvna: 2.7 }),
        createPlayer('p4', { pvna: 2.5 }),
      ],
    })

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBe(Infinity)
  })

  it('returns Infinity when intra-team PVNA gap is over 300', () => {
    const state = createState({
      pvnaTolerance: 10,
      players: [
        createPlayer('p1', { pvna: 4.8 }),
        createPlayer('p2', { pvna: 3.0 }),
        createPlayer('p3', { pvna: 3.6 }),
        createPlayer('p4', { pvna: 3.6 }),
      ],
    })

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBe(Infinity)
  })
})
