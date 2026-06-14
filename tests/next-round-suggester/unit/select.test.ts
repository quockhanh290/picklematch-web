import { getAverageMatches, Tier } from '../../../lib/next-round-suggester/classify'
import { getMatchBalanceMap, pickPlayers, sortPlayersForStrategy } from '../../../lib/next-round-suggester/select'
import { createMatch, createPlayer, createState } from '../helpers/factories'

describe('pickPlayers', () => {
  it('picks top slots by tier, low matches, and stable id ordering', () => {
    const state = createState({
      players: [
        createPlayer('p5', { matches_played: 5 }),
        createPlayer('p1', { consecutive_rest: 1, matches_played: 9 }),
        createPlayer('p2', { matches_played: 0 }),
        createPlayer('p3', { matches_played: 1 }),
        createPlayer('p4', { matches_played: 2 }),
      ],
    })

    expect(pickPlayers(state, 4).selected.map((player) => player.player_id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ])
  })

  it('returns NOT_ENOUGH_PRESENT when target slots exceed eligible present players', () => {
    const state = createState({
      players: [
        createPlayer('p1'),
        createPlayer('p2'),
        createPlayer('p3', { opted_rest: true }),
        createPlayer('p4', { checked_out_at: new Date('2026-05-14T12:10:00.000Z') }),
      ],
    })

    const result = pickPlayers(state, 4)

    expect(result.selected).toEqual([])
    expect(result.warnings).toContain('NOT_ENOUGH_PRESENT')
  })

  it('cuts non-multiple-of-four present pool through the caller-provided slot count', () => {
    const state = createState({
      players: Array.from({ length: 6 }, (_, index) =>
        createPlayer(`p${index + 1}`, { matches_played: index }),
      ),
    })

    expect(pickPlayers(state, 4).selected).toHaveLength(4)
    expect(pickPlayers(state, 4).resting).toHaveLength(2)
  })

  it('includes MUST_PLAY players when there is enough capacity', () => {
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_rest: 1 }),
        createPlayer('p2', { consecutive_rest: 1 }),
        createPlayer('p3'),
        createPlayer('p4'),
        createPlayer('p5', { matches_played: 10 }),
      ],
    })

    expect(pickPlayers(state, 4).selected.map((player) => player.player_id)).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    )
  })

  it('warns when MUST_PLAY count exceeds target slots', () => {
    const state = createState({
      players: Array.from({ length: 5 }, (_, index) =>
        createPlayer(`p${index + 1}`, { consecutive_rest: 1 }),
      ),
    })

    expect(pickPlayers(state, 4).warnings).toContain('MUST_PLAY_OVER_CAPACITY')
  })

  it('warns when MUST_REST players are forced to play', () => {
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_play: 2 }),
        createPlayer('p2', { consecutive_play: 2 }),
        createPlayer('p3', { consecutive_play: 2 }),
        createPlayer('p4', { consecutive_play: 2 }),
      ],
    })

    expect(pickPlayers(state, 4).warnings).toContain('MUST_REST_FORCED_PLAY')
  })

  it('applies optional tier overrides without changing existing callers', () => {
    const state = createState({
      players: [
        createPlayer('p1', { matches_played: 9 }),
        createPlayer('p2', { matches_played: 0 }),
        createPlayer('p3', { matches_played: 0 }),
        createPlayer('p4', { matches_played: 0 }),
        createPlayer('p5', { matches_played: 0 }),
      ],
    })

    expect(pickPlayers(state, 4, { p1: Tier.MUST_PLAY }).selected.map((p) => p.player_id)).toContain(
      'p1',
    )
  })

  it('uses availability-aware balance so truly underplayed players outrank late check-ins', () => {
    const state = createState({
      currentRound: 5,
      players: [
        createPlayer('p1', { matches_played: 5, last_played_round: 4 }),
        createPlayer('p2', { matches_played: 5, last_played_round: 4 }),
        createPlayer('p3', { matches_played: 5, last_played_round: 4 }),
        createPlayer('p4', { matches_played: 4, last_played_round: 3 }),
        createPlayer('p5', { matches_played: 1, last_played_round: 4 }),
        createPlayer('p6', { matches_played: 1, last_played_round: 5 }),
      ],
    })
    state.rounds = [
      {
        session_id: state.session_id,
        round_no: 0,
        status: 'completed',
        matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
        resting: ['p6'],
        started_at: null,
        ended_at: null,
      },
      {
        session_id: state.session_id,
        round_no: 1,
        status: 'completed',
        matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
        resting: ['p6'],
        started_at: null,
        ended_at: null,
      },
      {
        session_id: state.session_id,
        round_no: 2,
        status: 'completed',
        matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
        resting: ['p6'],
        started_at: null,
        ended_at: null,
      },
      {
        session_id: state.session_id,
        round_no: 3,
        status: 'completed',
        matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
        resting: ['p6'],
        started_at: null,
        ended_at: null,
      },
      {
        session_id: state.session_id,
        round_no: 4,
        status: 'completed',
        matches: [createMatch(['p1', 'p2'], ['p3', 'p5'])],
        resting: ['p4', 'p6'],
        started_at: null,
        ended_at: null,
      },
    ]

    const players = [...state.players.values()]
    const matchBalance = getMatchBalanceMap(state, players, 4)
    const sorted = sortPlayersForStrategy(players, 'fairness', {}, {
      avgMatches: getAverageMatches(players),
      matchBalance,
    })

    expect(matchBalance.get('p5')).toBeGreaterThan(-1.5)
    expect(matchBalance.get('p6')).toBeLessThan(-1.5)
    expect(sorted.map(player => player.player_id).indexOf('p6')).toBeLessThan(
      sorted.map(player => player.player_id).indexOf('p5'),
    )
  })
})
