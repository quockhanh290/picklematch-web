import { computeQualityCost, DEFAULT_QUALITY_COST_WEIGHTS } from '../../../lib/next-round-suggester/quality-cost'
import type { RoundRecord, SessionState, Team } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setOpponentRepeats } from '../helpers/factories'

const cost = (s: SessionState, a: Team, b: Team) => computeQualityCost(a, b, s, { tolerance: 0.5 }).cost

// Records `teamA` vs `teamB` as a completed match in round `roundNo`, so recentMeetings() picks it up
// with the right recency decay (distance = state.current_round - roundNo).
function recordPriorMatch(state: SessionState, teamA: Team, teamB: Team, roundNo: number) {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: roundNo,
    status: 'completed',
    matches: [{ court_idx: 0, team_a: teamA, team_b: teamB }],
    resting: [],
    started_at: null,
    ended_at: null,
  }
  state.rounds.push(round)
}

// Builds a fresh 4-player state for one side of a comparison. Every scenario below evaluates the two
// candidates (X, Y) against fully independent player pools so one side's history can never leak into
// the other's cost.
function fourPlayerState(pvna: [number, number, number, number], currentRound = 0): { state: SessionState; teamA: Team; teamB: Team } {
  const ids = ['a0', 'a1', 'b0', 'b1']
  const players = ids.map((id, i) => createPlayer(id, { pvna: pvna[i] }))
  const state = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound })
  return { state, teamA: ['a0', 'a1'], teamB: ['b0', 'b1'] }
}

describe('computeQualityCost — intent scenarios (spec §8)', () => {
  it('1) prefers a fresh gap-0.4 match over a balanced 2nd-opponent-repeat', () => {
    // X: fresh, gap 0.4. Y: balanced (gap 0), but a0/b0 already met once as opponents last round —
    // recorded as a completed round so the repeat is fully "recent" (recency multiplier = 1).
    const X = fourPlayerState([3.0, 3.0, 3.2, 3.2])
    const Y = fourPlayerState([3.0, 3.4, 3.2, 3.2], 1)
    setOpponentRepeats(Y.state.players.get('a0')!, Y.state.players.get('b0')!, 1)
    recordPriorMatch(Y.state, Y.teamA, Y.teamB, 0)

    const costX = cost(X.state, X.teamA, X.teamB)
    const costY = cost(Y.state, Y.teamA, Y.teamB)
    expect(costX).toBeLessThan(costY)
  })

  it('2) does not repeat just to shave 0.1 off the gap', () => {
    // X: fresh, gap 0.5 (right at the tolerance edge, so no over-tolerance penalty).
    // Y: gap 0.4 (0.1 tighter), but a0/b0 already met once as opponents, recorded last round.
    const X = fourPlayerState([3.0, 3.0, 3.25, 3.25])
    const Y = fourPlayerState([3.0, 3.05, 3.2, 3.25], 1)
    setOpponentRepeats(Y.state.players.get('a0')!, Y.state.players.get('b0')!, 1)
    recordPriorMatch(Y.state, Y.teamA, Y.teamB, 0)

    const costX = cost(X.state, X.teamA, X.teamB)
    const costY = cost(Y.state, Y.teamA, Y.teamB)
    expect(costX).toBeLessThan(costY)
  })

  it('3) prefers a 2nd-opponent-repeat over a fresh BLOWOUT (gap 2.0)', () => {
    // X: fresh, but a real blowout (gap 2.0, well over the 0.5 tolerance -> quadratic penalty).
    // Y: near-balanced (gap 0.1), a0/b0 already met once as opponents, recorded last round.
    const X = fourPlayerState([2.5, 2.5, 3.5, 3.5])
    const Y = fourPlayerState([3.0, 3.0, 2.9, 3.2], 1)
    setOpponentRepeats(Y.state.players.get('a0')!, Y.state.players.get('b0')!, 1)
    recordPriorMatch(Y.state, Y.teamA, Y.teamB, 0)

    const costX = cost(X.state, X.teamA, X.teamB)
    const costY = cost(Y.state, Y.teamA, Y.teamB)
    expect(costY).toBeLessThan(costX)
  })

  it('4) prefers a fresh gap-1.0 match over a balanced 2nd-opponent-repeat (crossover point)', () => {
    // X: fresh, gap 1.0 (0.5 over tolerance -> quadratic balance cost, but still no repeat).
    // Y: perfectly balanced (gap 0), but a0/b0 already met once as opponents, recorded last round.
    const X = fourPlayerState([2.75, 2.75, 3.25, 3.25])
    const Y = fourPlayerState([3.0, 3.0, 3.0, 3.0], 1)
    setOpponentRepeats(Y.state.players.get('a0')!, Y.state.players.get('b0')!, 1)
    recordPriorMatch(Y.state, Y.teamA, Y.teamB, 0)

    const costX = cost(X.state, X.teamA, X.teamB)
    const costY = cost(Y.state, Y.teamA, Y.teamB)
    expect(costX).toBeLessThan(costY)
  })

  it('5) prefers the literal spec fresh gap-1.5 over an unavoidable severe 3rd-meeting repeat', () => {
    // X: fresh, gap 1.5 (1.0 over tolerance -> a real blowout; the literal spec §8 scenario-5 gap).
    // Y: perfectly balanced (gap 0), but a0/b0 have already met twice as opponents (projected 3rd
    // meeting = severe). Both prior meetings are recorded as completed rounds (last round + the one
    // before) so the repeat gets close to full recency weight -- two meetings can never both land at
    // distance 1 (rounds are sequential), so 0.825 is the maximum achievable recency here. Task 1's
    // illustrative weights only cleared this at gap 1.3 (a ~0.006 margin at the literal 1.5, i.e. not
    // reliably on the right side of the inequality); Task 6's calibration raised repeat3 (2.5 -> 3.6)
    // enough that literal gap 1.5 now holds with a comfortable margin (fresh 1.75 vs repeat ~2.08)
    // without needing to touch the cost shapes.
    const X = fourPlayerState([3.0, 3.0, 3.75, 3.75])
    const Y = fourPlayerState([3.0, 3.0, 3.0, 3.0], 2)
    setOpponentRepeats(Y.state.players.get('a0')!, Y.state.players.get('b0')!, 2)
    recordPriorMatch(Y.state, Y.teamA, Y.teamB, 1)
    recordPriorMatch(Y.state, Y.teamA, Y.teamB, 0)

    const costX = cost(X.state, X.teamA, X.teamB)
    const costY = cost(Y.state, Y.teamA, Y.teamB)
    expect(costX).toBeLessThan(costY)
  })
})

describe('computeQualityCost — gender preference (ported from score.ts genderPenalty)', () => {
  it('charges genderPartner weight when a player is paired against their partner-gender preference', () => {
    const players = [
      createPlayer('a0', { pvna: 3.0, gender: 'M', partner_gender_pref: 'F' }),
      createPlayer('a1', { pvna: 3.0, gender: 'M' }),
      createPlayer('b0', { pvna: 3.0, gender: 'M' }),
      createPlayer('b1', { pvna: 3.0, gender: 'M' }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    const baseline = createState({
      players: [
        createPlayer('a0', { pvna: 3.0, gender: 'M' }),
        createPlayer('a1', { pvna: 3.0, gender: 'M' }),
        createPlayer('b0', { pvna: 3.0, gender: 'M' }),
        createPlayer('b1', { pvna: 3.0, gender: 'M' }),
      ],
      courts: 6,
      pvnaTolerance: 0.5,
    })

    const violation = cost(state, ['a0', 'a1'], ['b0', 'b1'])
    const noPref = cost(baseline, ['a0', 'a1'], ['b0', 'b1'])
    expect(violation - noPref).toBeCloseTo(DEFAULT_QUALITY_COST_WEIGHTS.genderPartner, 5)
  })

  it('charges genderOpponent weight per opposing player who violates an opponent-gender preference', () => {
    const players = [
      createPlayer('a0', { pvna: 3.0, gender: 'M', opponent_gender_pref: 'F' }),
      createPlayer('a1', { pvna: 3.0, gender: 'M' }),
      createPlayer('b0', { pvna: 3.0, gender: 'M' }),
      createPlayer('b1', { pvna: 3.0, gender: 'F' }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    const baseline = createState({
      players: [
        createPlayer('a0', { pvna: 3.0, gender: 'M' }),
        createPlayer('a1', { pvna: 3.0, gender: 'M' }),
        createPlayer('b0', { pvna: 3.0, gender: 'M' }),
        createPlayer('b1', { pvna: 3.0, gender: 'F' }),
      ],
      courts: 6,
      pvnaTolerance: 0.5,
    })

    // a0's opponent_gender_pref='F' is violated by b0 (M) but satisfied by b1 (F) -> 1 violation.
    const violation = cost(state, ['a0', 'a1'], ['b0', 'b1'])
    const noPref = cost(baseline, ['a0', 'a1'], ['b0', 'b1'])
    expect(violation - noPref).toBeCloseTo(DEFAULT_QUALITY_COST_WEIGHTS.genderOpponent, 5)
  })

  it('halves the partner-gender penalty for a same-group pair', () => {
    const players = [
      createPlayer('a0', { pvna: 3.0, gender: 'M', partner_gender_pref: 'F', group_id: 'g1' }),
      createPlayer('a1', { pvna: 3.0, gender: 'M', group_id: 'g1' }),
      createPlayer('b0', { pvna: 3.0, gender: 'M' }),
      createPlayer('b1', { pvna: 3.0, gender: 'M' }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    const ungrouped = createState({
      players: [
        createPlayer('a0', { pvna: 3.0, gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('a1', { pvna: 3.0, gender: 'M' }),
        createPlayer('b0', { pvna: 3.0, gender: 'M' }),
        createPlayer('b1', { pvna: 3.0, gender: 'M' }),
      ],
      courts: 6,
      pvnaTolerance: 0.5,
    })

    const grouped = cost(state, ['a0', 'a1'], ['b0', 'b1'])
    const notGrouped = cost(ungrouped, ['a0', 'a1'], ['b0', 'b1'])
    // Grouped pair still pays a partner group *reward* (-groupReward), on top of the halved gender
    // penalty, so compare against the ungrouped violation directly for the halving ratio.
    const groupedGenderOnly = grouped + Math.min(DEFAULT_QUALITY_COST_WEIGHTS.groupCap, DEFAULT_QUALITY_COST_WEIGHTS.groupReward)
    expect(groupedGenderOnly - notGrouped).toBeCloseTo(-DEFAULT_QUALITY_COST_WEIGHTS.genderPartner * 0.5, 5)
  })
})
