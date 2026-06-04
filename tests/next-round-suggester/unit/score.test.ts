import { genderPenalty, scoreMatch } from '../../../lib/next-round-suggester/score'
import type { Match } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('scoreMatch', () => {
  it('scores empty history as total-team PVNA diff', () => {
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

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }), {
      allowRepeatOverflow: true,
    })

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

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }), {
      allowRepeatOverflow: true,
    })

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

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBe(-6)
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

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }), {
      allowRepeatOverflow: true,
    })

    expect(result.score).toBe(0.5 + 3 + 1.5 + 4)
  })

  it('allows a second partner meeting by default', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    setPartnerRepeats(p1, p2, 1)

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] })).score).toBe(3)
  })

  it('rejects a third partner meeting by default', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    setPartnerRepeats(p1, p2, 2)

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] })).score).toBe(Infinity)
  })

  it('rejects a third opponent meeting by default', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    setOpponentRepeats(p1, p3, 2)

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] })).score).toBe(Infinity)
  })

  it('rejects opponent repeat overflow per player even when each pair stays under cap', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    const p5 = createPlayer('p5')
    const p6 = createPlayer('p6')
    setOpponentRepeats(p1, p5, 2)
    setOpponentRepeats(p1, p6, 2)
    setOpponentRepeats(p1, p3, 1)

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4, p5, p6] })).score).toBe(Infinity)
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
    expect(result.score).toBe(-4)
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

  it('uses total team PVNA and enforces tolerance directly', () => {
    const withinTolerance = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 3.5 }),
        createPlayer('p2', { pvna: 3.5 }),
        createPlayer('p3', { pvna: 3.25 }),
        createPlayer('p4', { pvna: 3.25 }),
      ],
    })
    const overTolerance = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 3.5 }),
        createPlayer('p2', { pvna: 3.5 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.2 }),
      ],
    })

    const accepted = scoreMatch(['p1', 'p2'], ['p3', 'p4'], withinTolerance)
    const rejected = scoreMatch(['p1', 'p2'], ['p3', 'p4'], overTolerance)

    expect(accepted.stats.pvna_diff).toBe(0.5)
    expect(accepted.score).toBe(0.5)
    expect(rejected.score).toBe(Infinity)
  })

  it('returns Infinity when intra-team PVNA gap is over 1.0', () => {
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

  it('adds no consecutive_play penalty for consecutive_play = 0 or 1', () => {
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_play: 0 }),
        createPlayer('p2', { consecutive_play: 1 }),
        createPlayer('p3', { consecutive_play: 0 }),
        createPlayer('p4', { consecutive_play: 1 }),
      ],
    })

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state)
    expect(result.stats.consecutive_play_penalty).toBe(0)
    expect(result.score).toBe(0)
  })

  it('adds quadratic penalty for consecutive_play = 2 (trận thứ 3 liên tiếp): (2-1)² × 4 = 4', () => {
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_play: 2 }),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state)
    expect(result.stats.consecutive_play_penalty).toBe(4)
    expect(result.score).toBe(4)
  })

  it('adds quadratic penalty for consecutive_play = 3 (trận thứ 4 liên tiếp): (3-1)² × 4 = 16', () => {
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_play: 3 }),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state)
    expect(result.stats.consecutive_play_penalty).toBe(16)
    expect(result.score).toBe(16)
  })

  it('accumulates consecutive_play penalty across multiple players in the match', () => {
    // p1: consecutive=3 → (3-1)²×4=16, p2: consecutive=2 → (2-1)²×4=4, total=20
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_play: 3 }),
        createPlayer('p2', { consecutive_play: 2 }),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state)
    expect(result.stats.consecutive_play_penalty).toBe(20)
    expect(result.score).toBe(20)
  })

  it('consecutive_play penalty is much larger than a typical partner_repeat penalty', () => {
    const withConsecutive3 = createState({
      players: [
        createPlayer('p1', { consecutive_play: 3 }),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })
    const withPartnerRepeat = createState({
      players: [
        createPlayer('p1'),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })
    setPartnerRepeats(withPartnerRepeat.players.get('p1')!, withPartnerRepeat.players.get('p2')!, 1)

    const consecutivePenaltyScore = scoreMatch(['p1', 'p2'], ['p3', 'p4'], withConsecutive3).score
    const partnerRepeatScore = scoreMatch(['p1', 'p2'], ['p3', 'p4'], withPartnerRepeat, { allowRepeatOverflow: true }).score

    // consecutive=3 penalty (16) >> partner_repeat penalty (3)
    expect(consecutivePenaltyScore).toBeGreaterThan(partnerRepeatScore)
    expect(consecutivePenaltyScore - partnerRepeatScore).toBe(13)
  })

  it('can relax intra-team PVNA gap without relaxing match PVNA tolerance', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 4.42 }),
        createPlayer('p2', { pvna: 3.02 }),
        createPlayer('p3', { pvna: 2.66 }),
        createPlayer('p4', { pvna: 3.59 }),
      ],
    })

    const strict = scoreMatch(['p1', 'p3'], ['p2', 'p4'], state)
    const relaxedIntra = scoreMatch(['p1', 'p3'], ['p2', 'p4'], state, {
      allowIntraTeamGapOverflow: true,
    })

    expect(strict.score).toBe(Infinity)
    expect(Math.abs(relaxedIntra.stats.pvna_diff - 0.47)).toBeLessThan(0.001)
    expect(Math.abs(relaxedIntra.score - 0.47)).toBeLessThan(0.001)
  })

  it('blocks same four-player rematches for the next two rounds even when partners change', () => {
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
    ]
    const previousMatch: Match = {
      court_idx: 0,
      team_a: ['p1', 'p2'],
      team_b: ['p3', 'p4'],
    }
    const state = {
      ...createState({ players, currentRound: 2, pvnaTolerance: 10 }),
      rounds: [{
        session_id: 'session-test',
        round_no: 0,
        status: 'completed' as const,
        matches: [previousMatch],
        resting: [],
        started_at: null,
        ended_at: null,
      }],
    }

    expect(scoreMatch(['p1', 'p3'], ['p2', 'p4'], state).score).toBe(Infinity)
    expect(scoreMatch(['p1', 'p5'], ['p2', 'p6'], state).score).not.toBe(Infinity)
  })

  it('blocks near-rematches with three of the same four players in the recent window', () => {
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
    ]
    const state = {
      ...createState({ players, currentRound: 1, pvnaTolerance: 10 }),
      rounds: [{
        session_id: 'session-test',
        round_no: 0,
        status: 'completed' as const,
        matches: [{
          court_idx: 0,
          team_a: ['p1', 'p2'] as [string, string],
          team_b: ['p3', 'p4'] as [string, string],
        }],
        resting: [],
        started_at: null,
        ended_at: null,
      }],
    }

    expect(scoreMatch(['p1', 'p3'], ['p2', 'p5'], state).score).toBe(Infinity)
    expect(scoreMatch(['p1', 'p5'], ['p2', 'p6'], state).score).not.toBe(Infinity)
  })

  it('allows same four-player groups after the two-round block window', () => {
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
    ]
    const state = {
      ...createState({ players, currentRound: 3, pvnaTolerance: 10 }),
      rounds: [{
        session_id: 'session-test',
        round_no: 0,
        status: 'completed' as const,
        matches: [{
          court_idx: 0,
          team_a: ['p1', 'p2'] as [string, string],
          team_b: ['p3', 'p4'] as [string, string],
        }],
        resting: [],
        started_at: null,
        ended_at: null,
      }],
    }

    expect(scoreMatch(['p1', 'p3'], ['p2', 'p4'], state).score).not.toBe(Infinity)
  })
})
