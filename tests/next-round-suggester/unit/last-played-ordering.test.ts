import { comparePlayersByPriority } from '../../../lib/next-round-suggester/select'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer } from '../helpers/factories'
import type { PlayerSessionState } from '../../../lib/next-round-suggester/types'

// BUG #14. complete_live_session_match_versioned stores `last_played_round = v_match.round_no`, which is
// the round number of one court, and select.ts orders by it ascending — lower means waited longer.
//
// Courts drift apart constantly: court 3 can be on round 2 while court 1 is on round 8. A player who
// walked off court 3 seconds ago carries last_played_round 2; someone who finished on court 1 long ago
// carries 8. Ordered ascending, the player who just finished is treated as the one who has waited
// longest and gets picked first. The priority is inverted exactly when the courts are most out of step.
//
// The fix mirrors the rest-bookkeeping one: a session-wide column with an honest name
// (`last_played_seq`, from sequence_no, which is unique per session and 0.886 correlated with wall
// time), and the comparator prefers it when present. The old column stays readable so the engine keeps
// working against a database the migration has not reached.
describe('priority ordering by when a player last played', () => {
  // Everyone in these cases is equally flexible and equally rested, so the comparator falls through to
  // the tie-break under test rather than being decided by tier or rest.
  const tiers = new Map<string, Tier>()

  const player = (id: string, over: Partial<PlayerSessionState>) =>
    createPlayer(id, { matches_played: 3, ...over } as never) as PlayerSessionState

  it('puts the player who last played earlier in the session first', () => {
    // Same number of matches, so the tie-break is which of them played longer ago. Court numbering is
    // deliberately misleading: the recent player sits on a court that is far behind in its own count.
    const justFinishedOnSlowCourt = player('just-finished', { last_played_round: 2, last_played_seq: 40 } as never)
    const waitingSinceEarly = player('waiting', { last_played_round: 8, last_played_seq: 5 } as never)

    const order = [justFinishedOnSlowCourt, waitingSinceEarly].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('waiting')
  })

  it('falls back to the per-court round when the session-wide value is absent', () => {
    const earlier = player('earlier', { last_played_round: 2 })
    const later = player('later', { last_played_round: 8 })

    const order = [later, earlier].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('earlier')
  })

  it('still ranks by matches played before anything else', () => {
    const fewerMatches = player('fewer', { matches_played: 1, last_played_seq: 90 } as never)
    const moreMatches = player('more', { matches_played: 6, last_played_seq: 1 } as never)

    const order = [moreMatches, fewerMatches].sort((x, y) => comparePlayersByPriority(x, y, tiers))

    expect(order[0].player_id).toBe('fewer')
  })
})
