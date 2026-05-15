import { Tier } from '../../../lib/next-round-suggester/classify'
import { pickPlayers } from '../../../lib/next-round-suggester/select'
import { createPlayer, createState } from '../helpers/factories'

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
})
