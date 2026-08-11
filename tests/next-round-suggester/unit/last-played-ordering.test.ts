import { comparePlayersByPriority } from '../../../lib/next-round-suggester/select'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer } from '../helpers/factories'
import type { PlayerSessionState } from '../../../lib/next-round-suggester/types'

// BUG #14 observed something true: `last_played_round` counts cycles on ONE court, courts drift apart,
// and ordering by it ascending means a player who walked off a slow court (round 2) is treated as having
// waited longer than someone idle since round 8 on a fast one.
//
// The fix — order by `last_played_seq`, a session-wide position from sequence_no — was built, deployed,
// and then measured against the thing it replaced, on the replay corpus, at two sample sizes:
//
//              court cycles     session position
//   intra>1       19.66%           22.12%          (30-session run: 20.33 vs 22.17)
//   repeat3       11.53%           13.28%          (30-session run: 11.71 vs 13.55)
//   play-spread    1.433            1.433          equal — no fairness bought
//
// Session position costs pairing quality and buys nothing measurable, at both sizes, while the same
// measurement repeated at two sizes moves by at most 0.67pp on its own. So the ordering stays on court
// cycles and these tests pin that, including the inverted-looking case: it is the one the numbers say to
// accept. The column and its bookkeeping remain — nothing reads them for ordering.
//
// What the corpus cannot see: every session in it starts empty, so it observes drift accumulating within
// a replay, not a session resumed from the database with two counters already far apart. If that case
// ever gets measured and disagrees, this is the decision to revisit.
describe('priority ordering by when a player last played', () => {
  // Everyone in these cases is equally flexible and equally rested, so the comparator falls through to
  // the tie-break under test rather than being decided by tier or rest.
  const tiers = new Map<string, Tier>()

  const player = (id: string, over: Partial<PlayerSessionState>) =>
    createPlayer(id, { matches_played: 3, ...over } as never) as PlayerSessionState

  it('orders by court cycles even when a session-wide position disagrees', () => {
    // 'just-finished' played most recently in time but is only 2 cycles into its court; 'waiting' is 8
    // cycles into a faster one. Cycles put 'just-finished' first — fewer games on its court — and that
    // is the behaviour the measurement selected.
    const justFinishedOnSlowCourt = player('just-finished', { last_played_round: 2, last_played_seq: 40 } as never)
    const waitingSinceEarly = player('waiting', { last_played_round: 8, last_played_seq: 5 } as never)

    const order = [waitingSinceEarly, justFinishedOnSlowCourt].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('just-finished')
  })

  it('orders by round when no session-wide value exists at all', () => {
    const earlier = player('earlier', { last_played_round: 2 })
    const later = player('later', { last_played_round: 8 })

    const order = [later, earlier].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('earlier')
  })

  it('still ranks by matches played before anything else', () => {
    const fewerMatches = player('fewer', { matches_played: 1, last_played_round: 90 } as never)
    const moreMatches = player('more', { matches_played: 6, last_played_round: 1 } as never)

    const order = [moreMatches, fewerMatches].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('fewer')
  })
})
