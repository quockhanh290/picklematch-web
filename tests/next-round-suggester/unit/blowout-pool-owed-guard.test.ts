import { repairPayloadBatchBlowoutFromPool } from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

// P0-4 / BUG #18. repairPayloadBatchSevereRepeatFromPool refuses to bench a player who is owed a turn
// more than the one coming in — rest recovery first, then fewer matches played. Its neighbour, which
// pulls from the same bench to fix a blowout, has no such guard, so it can fix the balance by sitting
// down the person who has been waiting longest. That is the trade nobody asked for: the board looks
// fairer while the queue gets less fair.
//
// This pass never acts on the replay corpus, because it needs degraded_reason === 'blowout' and those
// boards do not carry it, so the case has to be built by hand.
describe('blowout pool repair, fairness guard', () => {
  const build = () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        // Waiting longest of anyone here, and the swap would bench exactly this player.
        createPlayer('owed-strong', { pvna: 4.0, consecutive_rest: 2, matches_played: 0 }),
        createPlayer('strong-2', { pvna: 4.0, consecutive_rest: 0, matches_played: 3 }),
        createPlayer('weak-1', { pvna: 3.0, consecutive_rest: 0, matches_played: 3 }),
        createPlayer('weak-2', { pvna: 3.0, consecutive_rest: 0, matches_played: 3 }),
        // Ratings are chosen so the swap is legal on every other axis: it cuts the 2.0 gap to 0.5,
        // keeps intra-team spread at the 1.0 limit rather than over it, and adds no repeat. The only
        // thing wrong with it is who it sits down.
        createPlayer('fresh-mid', { pvna: 3.5, consecutive_rest: 0, matches_played: 5 }),
        // Also on the bench, and near owed-strong in rating. Without them the near-level peer guard
        // blocks the swap for its own reason — it will not strand an outlier alone on the bench — and
        // the fairness guard never gets a say.
        createPlayer('bench-strong', { pvna: 4.0, consecutive_rest: 0, matches_played: 4 }),
      ],
    })
    const payload = {
      court_idx: 0,
      team_a: ['owed-strong', 'strong-2'],
      team_b: ['weak-1', 'weak-2'],
      resting: ['fresh-mid', 'bench-strong'],
      round_no: 1,
      degraded_reason: 'blowout',
    } as unknown as SuggestedMatchPayload
    return { state, payload }
  }

  it('does not bench the player owed a turn just to even out a blowout', () => {
    const { state, payload } = build()

    const repaired = repairPayloadBatchBlowoutFromPool([payload], state, 0.5, ['fresh-mid', 'bench-strong'])
    const seated = new Set([...repaired[0].team_a, ...repaired[0].team_b])

    expect(seated.has('owed-strong')).toBe(true)
  })

  // Stated as an invariant rather than naming a player, because either bench player can be the one
  // brought in and the unfairness is the same either way: nobody should lose their seat to someone who
  // has been waiting less.
  it('never swaps in someone less owed a turn than the player going out', () => {
    const { state, payload } = build()
    const before = new Set([...payload.team_a, ...payload.team_b])

    const repaired = repairPayloadBatchBlowoutFromPool([payload], state, 0.5, ['fresh-mid', 'bench-strong'])
    const after = new Set([...repaired[0].team_a, ...repaired[0].team_b])

    const owedRank = (id: string) => {
      const p = state.players.get(id)!
      return { rest: p.consecutive_rest, matches: p.matches_played }
    }
    for (const outgoing of [...before].filter(id => !after.has(id))) {
      for (const incoming of [...after].filter(id => !before.has(id))) {
        const out = owedRank(outgoing)
        const inc = owedRank(incoming)
        const atLeastAsOwed = inc.rest > out.rest || (inc.rest === out.rest && inc.matches <= out.matches)
        expect(atLeastAsOwed).toBe(true)
      }
    }
  })
})
