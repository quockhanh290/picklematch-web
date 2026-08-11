import { commitCompletedRound } from '../../../lib/next-round-suggester/commit'
import { computeRestFairness } from '../../../lib/next-round-suggester/fairness/metrics'
import { buildRecentGroupRematchKeys } from '../../../lib/next-round-suggester/pair'
import { computeQualityCost } from '../../../lib/next-round-suggester/quality-cost'
import { getRecentRepeatCost, hasRecentGroupRematch } from '../../../lib/next-round-suggester/score'
import { pickPlayers } from '../../../lib/next-round-suggester/select'
import type { RoundRecord, SessionState, Team } from '../../../lib/next-round-suggester/types'
import { createMatch, createPlayer, createState, setOpponentRepeats } from '../helpers/factories'

function completedRound(roundNo: number, teamA: Team, teamB: Team, resting: string[] = []): RoundRecord {
  return {
    session_id: 'session-test',
    round_no: roundNo,
    status: 'completed',
    matches: [createMatch(teamA, teamB)],
    resting,
    started_at: null,
    ended_at: null,
  }
}

function fourPlayerState(currentRound: number, priorRoundNo: number): SessionState {
  const state = createState({
    currentRound,
    players: ['a', 'b', 'c', 'd'].map(id => createPlayer(id)),
  })
  state.rounds.push(completedRound(priorRoundNo, ['a', 'b'], ['c', 'd']))
  return state
}

describe('round_no characterization across next-round-suggester', () => {
  it('score.getRecentRepeatCost uses round_no as the session timeline for recency decay', () => {
    const recent = fourPlayerState(4, 3)
    const sameCourtAheadCycle = fourPlayerState(4, 5)

    // Meaning: session time/recency axis. A per-court cycle number ahead of current_round is treated
    // as future and contributes no recent-repeat cost.
    expect(getRecentRepeatCost(['a', 'b'], ['c', 'd'], recent).exact4).toBe(1)
    // APPROVED BEHAVIOUR CHANGE (BUG #4-#7): a completed round on a court further ahead used to be
    // read as the future and skipped. It is history, so it is now charged.
    expect(getRecentRepeatCost(['a', 'b'], ['c', 'd'], sameCourtAheadCycle).total).toBeGreaterThan(0)
  })

  it('score.hasRecentGroupRematch uses round_no as the session timeline window', () => {
    const recent = fourPlayerState(4, 3)
    const sameCourtAheadCycle = fourPlayerState(4, 5)

    // Meaning: session time/recency axis. The same foursome is blocked only when round_no falls inside
    // the current_round-based lookback window.
    expect(hasRecentGroupRematch(['a', 'b'], ['c', 'd'], recent)).toBe(true)
    // APPROVED BEHAVIOUR CHANGE: the block window now sees rounds finished on faster courts.
    expect(hasRecentGroupRematch(['a', 'b'], ['c', 'd'], sameCourtAheadCycle)).toBe(true)
  })

  it('pair.buildRecentGroupRematchKeys uses round_no as the session timeline window', () => {
    const recent = fourPlayerState(4, 3)
    const sameCourtAheadCycle = fourPlayerState(4, 5)

    // Meaning: session time/recency axis. The guard-key set ignores completed rows whose per-court
    // round_no is ahead of state.current_round.
    expect(buildRecentGroupRematchKeys(recent, 3).size).toBeGreaterThan(0)
    expect(buildRecentGroupRematchKeys(sameCourtAheadCycle, 3).size).toBe(0)
  })

  it('quality-cost recent meeting weight uses round_no as the session timeline for recency', () => {
    const recent = fourPlayerState(4, 3)
    const sameCourtAheadCycle = fourPlayerState(4, 5)
    setOpponentRepeats(recent.players.get('a')!, recent.players.get('c')!, 1)
    setOpponentRepeats(sameCourtAheadCycle.players.get('a')!, sameCourtAheadCycle.players.get('c')!, 1)

    // Meaning: session time/recency axis. The all-time repeat count is present in both states, but a
    // per-court cycle number ahead of current_round falls out of the recency numerator and decays to
    // the minimum repeat weight.
    const recentCost = computeQualityCost(['a', 'b'], ['c', 'd'], recent, { tolerance: 0.5 }).cost
    const aheadCycleCost = computeQualityCost(['a', 'b'], ['c', 'd'], sameCourtAheadCycle, { tolerance: 0.5 }).cost
    // APPROVED BEHAVIOUR CHANGE (BUG #7): the cost model used to discount a meeting from a court further
    // ahead to the stale floor — 0.31 against 0.73 for the identical pairing from a slower court. Both
    // are recent, so they now price the same, and score.ts already made this change in baa5c70.
    expect(recentCost).toBeCloseTo(aheadCycleCost, 6)
  })

  it('select.pickPlayers uses last_played_round as a session recency priority tie-breaker', () => {
    const players = [
      createPlayer('p1', { matches_played: 1, last_played_round: 3 }),
      createPlayer('p2', { matches_played: 1, last_played_round: 0 }),
      createPlayer('p3', { matches_played: 1, last_played_round: 0 }),
      createPlayer('p4', { matches_played: 1, last_played_round: 0 }),
      createPlayer('p5', { matches_played: 1, last_played_round: 0 }),
    ]
    const state = createState({ players, currentRound: 1 })

    // Meaning: session time/recency axis. A larger last_played_round is less urgent even if that value
    // came from a faster court's per-court cycle and is greater than current_round.
    expect(pickPlayers(state, 4).selected.map(p => p.player_id)).toEqual(['p2', 'p3', 'p4', 'p5'])
  })

  it('fairness.computeRestFairness extends a rest run when last_played_round marks the current round active', () => {
    const players = [
      createPlayer('active-ahead', { last_played_round: 3 }),
      createPlayer('r', { last_played_round: 0 }),
      createPlayer('p2'),
      createPlayer('p3'),
      createPlayer('p4'),
    ]
    const state = createState({ players, currentRound: 2 })
    state.rounds.push(completedRound(1, ['active-ahead', 'p2'], ['p3', 'p4'], ['r']))

    // Meaning: session time/recency axis. Because one player has last_played_round >= current_round,
    // the current round is considered active and the resting player's run is projected by one.
    const r = computeRestFairness(state).per_player.find(player => player.player_id === 'r')
    expect(r?.total_rests).toBe(1)
    expect(r?.max_consecutive_rest).toBe(2)
  })

  it('commitCompletedRound persists completed round_no into last_played_round for players', () => {
    const state = createState({
      players: ['a', 'b', 'c', 'd', 'r'].map(id => createPlayer(id)),
      currentRound: 2,
    })

    // Meaning: per-court display cycle at write time. The completed round_no is copied directly into
    // last_played_round, which other code later reads as session recency.
    const committed = commitCompletedRound(state, completedRound(7, ['a', 'b'], ['c', 'd'], ['r']))
    expect(committed.players.get('a')?.last_played_round).toBe(7)
    expect(committed.players.get('r')?.last_played_round).toBe(-1)
  })

  it('exposes the current contradiction: future per-court round_no is ignored by repeat guards but still lowers player priority', () => {
    const state = fourPlayerState(4, 5)
    const players = [
      createPlayer('a', { matches_played: 1, last_played_round: 5 }),
      createPlayer('b', { matches_played: 1, last_played_round: 0 }),
      createPlayer('c', { matches_played: 1, last_played_round: 0 }),
      createPlayer('d', { matches_played: 1, last_played_round: 0 }),
      createPlayer('e', { matches_played: 1, last_played_round: 0 }),
    ]
    const priorityState = createState({ players, currentRound: 4 })

    // Meaning conflict: the same value, 5, is a per-court cycle that score/pair treat as future, while
    // select treats last_played_round 5 as more recent than the session current_round.
    // The contradiction this case was written to expose is resolved: the guards and the priority
    // ordering now read the same completed round the same way, instead of one ignoring it while the
    // other penalised for it.
    expect(getRecentRepeatCost(['a', 'b'], ['c', 'd'], state).total).toBeGreaterThan(0)
    expect(hasRecentGroupRematch(['a', 'b'], ['c', 'd'], state)).toBe(true)
    expect(pickPlayers(priorityState, 4).selected.map(p => p.player_id)).not.toContain('a')
  })
})
