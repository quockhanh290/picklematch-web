import { classifyPlayer, Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer } from '../helpers/factories'

describe('classifyPlayer', () => {
  it('returns MUST_PLAY when consecutive_rest >= 1', () => {
    expect(classifyPlayer(createPlayer('p1', { consecutive_rest: 1 }), { avgMatches: 2 })).toBe(Tier.MUST_PLAY)
  })

  it('returns MUST_REST when consecutive_play >= 2', () => {
    expect(classifyPlayer(createPlayer('p1', { consecutive_play: 2, matches_played: 2 }), { avgMatches: 2 })).toBe(
      Tier.MUST_REST,
    )
  })

  it('lets MUST_PLAY win over MUST_REST when both apply', () => {
    expect(
      classifyPlayer(createPlayer('p1', { consecutive_rest: 1, consecutive_play: 2 }), { avgMatches: 2 }),
    ).toBe(Tier.MUST_PLAY)
  })

  it('returns SHOULD_PLAY when matches_played < avg - 1.5', () => {
    expect(classifyPlayer(createPlayer('p1', { matches_played: 0 }), { avgMatches: 2 })).toBe(Tier.SHOULD_PLAY)
  })

  it('returns SHOULD_REST when matches_played > avg + 1.5', () => {
    expect(classifyPlayer(createPlayer('p1', { matches_played: 4 }), { avgMatches: 2 })).toBe(Tier.SHOULD_REST)
  })

  it('returns FLEXIBLE inside the boundary window', () => {
    expect(classifyPlayer(createPlayer('p1', { matches_played: 2 }), { avgMatches: 2 })).toBe(Tier.FLEXIBLE)
  })

  it('treats exact avg +/- 1.5 as FLEXIBLE boundary', () => {
    expect(classifyPlayer(createPlayer('p1', { matches_played: 0.5 }), { avgMatches: 2 })).toBe(Tier.FLEXIBLE)
    expect(classifyPlayer(createPlayer('p2', { matches_played: 3.5 }), { avgMatches: 2 })).toBe(Tier.FLEXIBLE)
  })

  it('returns OPTED_REST before all play tiers', () => {
    expect(classifyPlayer(createPlayer('p1', { opted_rest: true, consecutive_rest: 2 }), { avgMatches: 2 })).toBe(
      Tier.OPTED_REST,
    )
  })

  it('uses availability balance when provided instead of raw match average', () => {
    expect(
      classifyPlayer(createPlayer('late', { matches_played: 0 }), {
        avgMatches: 4,
        matchBalance: new Map([['late', 0]]),
      }),
    ).toBe(Tier.FLEXIBLE)
  })

  it('returns SHOULD_PLAY for severely underplayed player even with high consecutive_play', () => {
    expect(
      classifyPlayer(createPlayer('p1', { matches_played: 4, consecutive_play: 2 }), {
        avgMatches: 4,
        matchBalance: new Map([['p1', -2]]),
      }),
    ).toBe(Tier.SHOULD_PLAY)
  })

  it('uses tier override before computed classification', () => {
    expect(
      classifyPlayer(
        createPlayer('p1', { matches_played: 0, consecutive_rest: 2 }),
        { avgMatches: 4 },
        Tier.FLEXIBLE,
      ),
    ).toBe(Tier.FLEXIBLE)
  })
})
