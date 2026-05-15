import { Tier } from '../../../lib/next-round-suggester/classify'
import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('Corrector (naive)', () => {
  it('returns empty adjustments when no warnings exist', () => {
    const adjustment = correctForFairness(createState({ currentRound: 3 }))

    expect(adjustment.type).toBe('none')
    expect(adjustment.config_changes).toEqual({})
    expect(adjustment.tier_overrides).toEqual({})
    expect(adjustment.applied_for_warnings).toEqual([])
  })

  it('applies tier overrides for underplayed players', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 5 }),
        createPlayer('p2', { matches_played: 1 }),
        createPlayer('p3', { matches_played: 5 }),
        createPlayer('p4', { matches_played: 5 }),
      ],
    })

    expect(correctForFairness(state).tier_overrides.p2).toBe(Tier.MUST_PLAY)
  })

  it('boosts weights for repeats', () => {
    const p1 = createPlayer('p1', { matches_played: 4 })
    const p2 = createPlayer('p2', { matches_played: 4 })
    setPartnerRepeats(p1, p2, 3)
    setOpponentRepeats(p1, p2, 3)

    const state = createState({ currentRound: 4, players: [p1, p2] })
    const adjustment = correctForFairness(state)

    expect(adjustment.config_changes.weights?.partner_repeat).toBe(
      state.config.weights.partner_repeat * 1.5,
    )
    expect(adjustment.config_changes.weights?.opponent_repeat).toBe(
      state.config.weights.opponent_repeat * 1.5,
    )
  })

  it('applies multiple adjustments simultaneously', () => {
    const p1 = createPlayer('p1', { matches_played: 5 })
    const p2 = createPlayer('p2', { matches_played: 1, consecutive_rest: 2 })
    const p3 = createPlayer('p3', { matches_played: 5 })
    const p4 = createPlayer('p4', { matches_played: 5 })
    setPartnerRepeats(p1, p3, 3)

    const state = createState({ currentRound: 4, players: [p1, p2, p3, p4] })
    const adjustment = correctForFairness(state)

    expect(adjustment.tier_overrides.p2).toBe(Tier.MUST_PLAY)
    expect(adjustment.config_changes.pvna_tolerance).toBe(Number((state.config.pvna_tolerance + 0.15).toFixed(2)))
    expect(adjustment.config_changes.weights?.partner_repeat).toBe(
      state.config.weights.partner_repeat * 1.5,
    )
    expect(adjustment.applied_for_warnings).toEqual(
      expect.arrayContaining(['underplayed', 'rest_violation', 'partner_repeat']),
    )
  })

  it('ignores checked-out players when correcting', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 5 }),
        createPlayer('p2', {
          matches_played: 0,
          checked_out_at: new Date('2026-05-14T13:00:00.000Z'),
        }),
        createPlayer('p3', { matches_played: 5 }),
        createPlayer('p4', { matches_played: 5 }),
      ],
    })

    expect(correctForFairness(state).type).toBe('none')
  })
})
