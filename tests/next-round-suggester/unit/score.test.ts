import { genderPenalty, getRecentRepeatCost, hasRecentGroupRematch, scoreMatch } from '../../../lib/next-round-suggester/score'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import type { Match } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('scoreMatch', () => {
  afterEach(() => {
    __setQualityCostModelOverrideForTests(null)
  })

  it('scores empty history as total-team PVNA diff', () => {
    const state = createState({
      players: [
        createPlayer('p1', { pvna: 3.75 }),
        createPlayer('p2', { pvna: 3.25 }),
        createPlayer('p3', { pvna: 3.5 }),
        createPlayer('p4', { pvna: 3.0 }),
      ],
    })

    // pvnaDiff=0.5, intraGapSoftPenalty=(0.5+0.5)*0.15=0.15
    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBeCloseTo(0.65, 5)
  })

  it('adds partner repeat penalty', () => {
    const p1 = createPlayer('p1')
    const p2 = createPlayer('p2')
    const p3 = createPlayer('p3')
    const p4 = createPlayer('p4')
    setPartnerRepeats(p1, p2, 2) // projected 3rd meeting -> severe repeat (+50 surcharge)
    setPartnerRepeats(p3, p4, 1) // projected 2nd meeting -> not severe

    const result = scoreMatch(['p1', 'p2'], ['p3', 'p4'], createState({ players: [p1, p2, p3, p4] }), {
      allowRepeatOverflow: true,
    })

    expect(result.stats.partner_repeats).toBe(3)
    // 3 * partner_repeat(3) = 9, plus the +50 severe-repeat surcharge for the p1-p2 pair reaching its 3rd meeting
    expect(result.score).toBe(59)
  })

  it('makes a repeat-3 lineup score worse than a gender-pref-violating alternative', () => {
    // p1-p2 have partnered twice; pairing them again is a 3rd meeting (severe repeat). The alternative
    // pairs them with fresh partners but violates a gender preference. The severe-repeat lineup must
    // score HIGHER (worse) so the engine prefers breaking the repeat over honouring the preference.
    const p1 = createPlayer('p1', { gender: 'F', partner_gender_pref: 'F' })
    const p2 = createPlayer('p2', { gender: 'F', partner_gender_pref: 'F' })
    const p3 = createPlayer('p3', { gender: 'M', partner_gender_pref: 'M' })
    const p4 = createPlayer('p4', { gender: 'M', partner_gender_pref: 'M' })
    setPartnerRepeats(p1, p2, 2)
    const state = createState({ players: [p1, p2, p3, p4] })
    const repeatLineup = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state, { allowRepeatOverflow: true }) // p1-p2 3rd meeting, gender ok
    const freshButGenderViolating = scoreMatch(['p1', 'p3'], ['p2', 'p4'], state, { allowRepeatOverflow: true }) // no repeat, F-M partners violate prefs
    expect(freshButGenderViolating.score).toBeLessThan(repeatLineup.score)
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

  it('preserves repeat stats when a diagnostic caller allows PVNA tolerance overflow', () => {
    const p1 = createPlayer('p1', { pvna: 4.5 })
    const p2 = createPlayer('p2', { pvna: 4.0 })
    const p3 = createPlayer('p3', { pvna: 3.8 })
    const p4 = createPlayer('p4', { pvna: 3.7 })
    setPartnerRepeats(p1, p2, 1)
    setOpponentRepeats(p1, p3, 2)
    const state = createState({ pvnaTolerance: 0.5, players: [p1, p2, p3, p4] })

    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state, {
      allowRepeatOverflow: true,
    }).score).toBe(Infinity)

    const diagnostic = scoreMatch(['p1', 'p2'], ['p3', 'p4'], state, {
      allowPvnaToleranceOverflow: true,
      allowRepeatOverflow: true,
    })
    expect(Number.isFinite(diagnostic.score)).toBe(true)
    expect(diagnostic.stats.pvna_diff).toBe(1)
    expect(diagnostic.stats.partner_repeats).toBe(1)
    expect(diagnostic.stats.opponent_repeats).toBe(2)
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

    // pvnaDiff=0.5, partnerRepeat=3, opponentRepeat=1.5, genderPenalty=4, intraGapSoftPenalty=(0.5+0.5)*0.15=0.15
    expect(result.score).toBeCloseTo(0.5 + 3 + 1.5 + 4 + 0.15, 5)
  })

  it('adds decayed recent-repeat soft cost for the last three rounds', () => {
    const state = {
      ...createState({
        currentRound: 3,
        players: [
          createPlayer('p1'),
          createPlayer('p2'),
          createPlayer('p3'),
          createPlayer('p4'),
          createPlayer('p5'),
          createPlayer('p6'),
        ],
      }),
      rounds: [
        {
          session_id: 'session-test',
          round_no: 2,
          status: 'completed' as const,
          matches: [{ court_idx: 0, team_a: ['p1', 'p2'] as [string, string], team_b: ['p3', 'p4'] as [string, string] }],
          resting: ['p5', 'p6'],
          started_at: null,
          ended_at: null,
        },
        {
          session_id: 'session-test',
          round_no: 1,
          status: 'completed' as const,
          matches: [{ court_idx: 0, team_a: ['p1', 'p5'] as [string, string], team_b: ['p2', 'p6'] as [string, string] }],
          resting: ['p3', 'p4'],
          started_at: null,
          ended_at: null,
        },
      ],
    }

    const cost = getRecentRepeatCost(['p1', 'p2'], ['p5', 'p6'], state)
    const score = scoreMatch(['p1', 'p2'], ['p5', 'p6'], state, {
      allowRecentGroupRematch: true,
      tolerance: 10,
    })

    expect(cost.partner).toBe(1)
    expect(cost.opponent).toBeCloseTo(1.3)
    expect(cost.overlap2).toBeCloseTo(1)
    // Flag OFF (default): exact4 is the generic same-four-player signal, not partnership-aware.
    // Round 1 (p1-p5/p2-p6) shares all 4 players with the new lineup (p1-p2/p5-p6) -> exact4 hit.
    expect(cost.exact4).toBeCloseTo(0.65)
    expect(score.score).toBeCloseTo(score.stats.pvna_diff + cost.total)
  })

  it('team-aware exact4 (flag ON): a re-split of the same four players is not an exact rematch', () => {
    __setQualityCostModelOverrideForTests(true)
    const state = {
      ...createState({
        currentRound: 3,
        players: [
          createPlayer('p1'),
          createPlayer('p2'),
          createPlayer('p3'),
          createPlayer('p4'),
          createPlayer('p5'),
          createPlayer('p6'),
        ],
      }),
      rounds: [
        {
          session_id: 'session-test',
          round_no: 2,
          status: 'completed' as const,
          matches: [{ court_idx: 0, team_a: ['p1', 'p2'] as [string, string], team_b: ['p3', 'p4'] as [string, string] }],
          resting: ['p5', 'p6'],
          started_at: null,
          ended_at: null,
        },
        {
          session_id: 'session-test',
          round_no: 1,
          status: 'completed' as const,
          matches: [{ court_idx: 0, team_a: ['p1', 'p5'] as [string, string], team_b: ['p2', 'p6'] as [string, string] }],
          resting: ['p3', 'p4'],
          started_at: null,
          ended_at: null,
        },
      ],
    }

    const cost = getRecentRepeatCost(['p1', 'p2'], ['p5', 'p6'], state)

    // Round 1 re-partitions the same four players (p1-p5/p2-p6 -> p1-p2/p5-p6): a re-split, not an
    // exact rematch, since neither partnership repeats. Round 2 only overlaps on 1 of 2 partnerships.
    expect(cost.exact4).toBe(0)
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

    // teamA gap = |4.42 - 2.66| = 1.76, soft=1.76*0.15=0.264, overflow=(1.76-1.0)*1=0.76
    // teamB gap = |3.02 - 3.59| = 0.57, soft=0.57*0.15=0.0855, no overflow
    // score = pvna_diff(0.47) + intra_soft((1.76+0.57)*0.15=0.3495) + intra_overflow(0.76) ≈ 1.58
    expect(strict.score).toBe(Infinity)
    expect(Math.abs(relaxedIntra.stats.pvna_diff - 0.47)).toBeLessThan(0.001)
    expect(Math.abs(relaxedIntra.score - 1.58)).toBeLessThan(0.01)
  })

  it('blocks same four-player rematches for the next two rounds even when partners change', () => {
    // Use N=11 players so getRematchBlockRounds(11) = 2 (N > 10)
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
      createPlayer('p7', { pvna: 3.0 }),
      createPlayer('p8', { pvna: 3.1 }),
      createPlayer('p9', { pvna: 3.2 }),
      createPlayer('p10', { pvna: 3.3 }),
      createPlayer('p11', { pvna: 3.4 }),
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

  it('team-aware (flag ON): blocks a true rematch (same partnerships) for the next two rounds, but allows a re-split of the same four', () => {
    __setQualityCostModelOverrideForTests(true)
    // Use N=11 players so getRematchBlockRounds(11) = 2 (N > 10)
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
      createPlayer('p7', { pvna: 3.0 }),
      createPlayer('p8', { pvna: 3.1 }),
      createPlayer('p9', { pvna: 3.2 }),
      createPlayer('p10', { pvna: 3.3 }),
      createPlayer('p11', { pvna: 3.4 }),
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

    // scoreMatch's flag-ON path delegates to computeQualityCost before reaching hasRecentGroupRematch
    // (that early return is out of scope here — see quality-cost.ts for the flag-ON cost model), so
    // exercise the gated function directly.
    // Same partnerships (exact rematch, team sides may swap) -> still blocked.
    expect(hasRecentGroupRematch(['p1', 'p2'], ['p3', 'p4'], state)).toBe(true)
    expect(hasRecentGroupRematch(['p3', 'p4'], ['p1', 'p2'], state)).toBe(true)
    // Same four players, fresh partnerships (re-split) -> a fresh lineup, not blocked.
    expect(hasRecentGroupRematch(['p1', 'p3'], ['p2', 'p4'], state)).toBe(false)
    // Unrelated players -> not blocked.
    expect(hasRecentGroupRematch(['p1', 'p5'], ['p2', 'p6'], state)).toBe(false)
  })

  it('flag OFF (default): getRecentRepeatCost and scoreMatch treat a re-split of the same four as an exact rematch', () => {
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.0 }),
      createPlayer('p3', { pvna: 3.0 }),
      createPlayer('p4', { pvna: 3.0 }),
      createPlayer('p5', { pvna: 3.0 }),
      createPlayer('p6', { pvna: 3.0 }),
    ]
    const previousMatch: Match = {
      court_idx: 0,
      team_a: ['p1', 'p2'],
      team_b: ['p3', 'p4'],
    }
    const state = {
      ...createState({ players, currentRound: 1, pvnaTolerance: 10 }),
      rounds: [{
        session_id: 'session-test',
        round_no: 0,
        status: 'completed' as const,
        matches: [previousMatch],
        resting: ['p5', 'p6'],
        started_at: null,
        ended_at: null,
      }],
    }

    const resplit = getRecentRepeatCost(['p1', 'p3'], ['p2', 'p4'], state)
    expect(resplit.exact4).toBeGreaterThan(0)
    expect(scoreMatch(['p1', 'p3'], ['p2', 'p4'], state, { allowRepeatOverflow: true }).score).toBe(Infinity)

    const sameLineup = getRecentRepeatCost(['p1', 'p2'], ['p3', 'p4'], state)
    expect(sameLineup.exact4).toBeGreaterThan(0)
    expect(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score).toBe(Infinity)

    const swappedSides = getRecentRepeatCost(['p3', 'p4'], ['p1', 'p2'], state)
    expect(swappedSides.exact4).toBeGreaterThan(0)
    expect(scoreMatch(['p3', 'p4'], ['p1', 'p2'], state).score).toBe(Infinity)
  })

  it('team-aware (flag ON): does not count a re-split of the same four players as an exact rematch in getRecentRepeatCost', () => {
    __setQualityCostModelOverrideForTests(true)
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.0 }),
      createPlayer('p3', { pvna: 3.0 }),
      createPlayer('p4', { pvna: 3.0 }),
      createPlayer('p5', { pvna: 3.0 }),
      createPlayer('p6', { pvna: 3.0 }),
    ]
    const previousMatch: Match = {
      court_idx: 0,
      team_a: ['p1', 'p2'],
      team_b: ['p3', 'p4'],
    }
    const state = {
      ...createState({ players, currentRound: 1, pvnaTolerance: 10 }),
      rounds: [{
        session_id: 'session-test',
        round_no: 0,
        status: 'completed' as const,
        matches: [previousMatch],
        resting: ['p5', 'p6'],
        started_at: null,
        ended_at: null,
      }],
    }

    // scoreMatch's flag-ON path delegates to computeQualityCost before reaching these gated
    // functions, so verify getRecentRepeatCost and hasRecentGroupRematch directly.
    const resplit = getRecentRepeatCost(['p1', 'p3'], ['p2', 'p4'], state)
    expect(resplit.exact4).toBe(0)
    expect(hasRecentGroupRematch(['p1', 'p3'], ['p2', 'p4'], state)).toBe(false)

    const sameLineup = getRecentRepeatCost(['p1', 'p2'], ['p3', 'p4'], state)
    expect(sameLineup.exact4).toBeGreaterThan(0)
    expect(hasRecentGroupRematch(['p1', 'p2'], ['p3', 'p4'], state)).toBe(true)

    const swappedSides = getRecentRepeatCost(['p3', 'p4'], ['p1', 'p2'], state)
    expect(swappedSides.exact4).toBeGreaterThan(0)
    expect(hasRecentGroupRematch(['p3', 'p4'], ['p1', 'p2'], state)).toBe(true)
  })

  it('blocks near-rematches with three of the same four players in the recent window', () => {
    // Use N=9 players so getNearRematchMinOverlap(9) = 3 (N > 8)
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
      createPlayer('p7', { pvna: 3.0 }),
      createPlayer('p8', { pvna: 3.1 }),
      createPlayer('p9', { pvna: 3.2 }),
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
