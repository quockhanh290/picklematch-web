import { comparePlayersByPriority } from '../../../lib/next-round-suggester/select'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer } from '../helpers/factories'
import type { PlayerSessionState } from '../../../lib/next-round-suggester/types'

// Last engine site of BUG #7. When two players have rested equally long, select.ts breaks the tie on
// who started resting earlier. That value was derived from last_played_round + 1 — a per-court cycle —
// and the two sides of the comparison can come from different courts, so it compared numbers from
// different scales. The player idle since the start of a slow court could lose to someone who sat down
// moments ago on a fast one.
//
// The value is only ever compared between players, never against a round number, so a session-wide
// position is the right basis. It is named for what it now is rather than reusing a round-shaped name
// for something that is not a round.
describe('rest-start tie-break compares positions on one scale', () => {
  const tiers = new Map<string, Tier>()
  const player = (id: string, over: Partial<PlayerSessionState>) =>
    createPlayer(id, { consecutive_rest: 2, matches_played: 3, ...over } as never) as PlayerSessionState

  it('prefers the player who started resting earlier in the session', () => {
    // Court numbering is misleading on purpose: the player who sat down long ago is on a court whose
    // own counter is low, and the recent one is on a court far ahead.
    const restingSinceEarly = player('early', { last_rest_started_seq: 5, last_rest_started_round: 40 } as never)
    const justSatDown = player('recent', { last_rest_started_seq: 60, last_rest_started_round: 3 } as never)

    const order = [justSatDown, restingSinceEarly].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('early')
  })

  it('falls back to the round-derived value when no session position is present', () => {
    const earlier = player('earlier', { last_rest_started_round: 2 })
    const later = player('later', { last_rest_started_round: 8 })

    const order = [later, earlier].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('earlier')
  })
})
