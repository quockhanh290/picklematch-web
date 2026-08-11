import { buildProjectedStateAfterCompletedLiveRound } from '../../../lib/next-round-suggester/live-preview'
import { comparePlayersByPriority } from '../../../lib/next-round-suggester/select'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer, createState } from '../helpers/factories'

// state.ts stamps last_rest_started_round when it reads a resting player out of the database, and the
// comparator uses it to separate two players on the same rest run. Projecting a round forward increments
// consecutive_rest, so it has to stamp the same field — otherwise a rest run that BEGAN in the
// projection has no start at all, reads as Infinity, and loses to every player whose run came from the
// database, no matter how long ago either of them actually sat down.
//
// This changes nothing measurable on the replay corpus (identical board hash across 60 sessions). It is
// here because the two sources of the same state must agree, not because a number moved.
describe('projecting a round forward stamps where a rest run began', () => {
  const tiers = new Map([['from-db', Tier.FLEXIBLE], ['from-projection', Tier.FLEXIBLE]])

  it('separates a run that began in the projection from one that came out of the database', () => {
    // Both sit out the round being projected and end on the same rest run. from-projection sat down
    // FIRST (last match in round 1, against round 4), so the rest-start tie-break picks it.
    //
    // Match counts are set to DISAGREE — from-projection has played more — because the rest-start
    // comparison sits above match balance in this comparator. Without the stamp both starts read
    // Infinity, the comparison ties, and the decision falls through to match balance, which answers the
    // other way. That disagreement is the whole point of the case: with equal match counts the later
    // tie-breaks reach the same answer on their own and the test proves nothing.
    const fromProjection = createPlayer('from-projection', {
      pvna: 3, matches_played: 5, last_played_round: 1, consecutive_rest: 0,
    } as never)
    const fromDb = createPlayer('from-db', {
      pvna: 3, matches_played: 2, last_played_round: 4, consecutive_rest: 0,
    } as never)
    const state = createState({ players: [fromProjection, fromDb] })

    const projected = buildProjectedStateAfterCompletedLiveRound(state, new Set<string>())
    const a = projected.players.get('from-projection')!
    const b = projected.players.get('from-db')!

    expect(a.consecutive_rest).toBe(b.consecutive_rest)

    const order = [b, a].sort((x, y) => comparePlayersByPriority(x, y, tiers))
    expect(order[0].player_id).toBe('from-projection')
  })
})
