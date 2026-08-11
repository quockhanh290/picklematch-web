import { buildProjectedStateAfterLiveMatch } from '../../../lib/next-round-suggester/live-preview'
import { comparePlayersByPriority } from '../../../lib/next-round-suggester/select'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types'

// Filling several courts in one request projects each completion forward before choosing the next
// lineup, so whatever the comparator orders by has to advance in that projection too. Ordering reads
// `last_played_round`, and a projection that failed to bump it would leave a player who just played
// tied with everyone waiting — decided by player id, which is no ordering at all.
//
// This was found the other way round: the projection did NOT maintain `last_played_seq` while the
// comparator briefly preferred it, so a player projected as just having played kept an older sequence
// than someone waiting and outranked them. The ordering has since moved back to court cycles
// (last-played-ordering.test.ts records why), and this pins the invariant that outlived it.
describe('projected state advances what the comparator orders by', () => {
  const tiers = new Map([
    ['a-just-played', Tier.FLEXIBLE],
    ['b-waiting', Tier.FLEXIBLE],
  ])

  it('does not let a player projected as just having played outrank someone still waiting', () => {
    const justPlayed = createPlayer('a-just-played', {
      pvna: 3, matches_played: 1, last_played_round: 0, last_played_seq: 5,
    } as never)
    const waiting = createPlayer('b-waiting', {
      pvna: 3, matches_played: 2, last_played_round: 0, last_played_seq: 5,
    } as never)
    const filler = ['f1', 'f2', 'f3'].map(id => createPlayer(id, { pvna: 3 }))
    const state = createState({ players: [justPlayed, waiting, ...filler] })

    const completed = {
      id: 'm1', session_id: state.session_id, sequence_no: 100, round_no: 1, court_idx: 0,
      status: 'completed', team_a: ['a-just-played', 'f1'], team_b: ['f2', 'f3'],
      resting: [], started_at: null, ended_at: null,
    } as unknown as SessionLiveMatchRow

    const projected = buildProjectedStateAfterLiveMatch(state, completed, 1)
    const a = projected.players.get('a-just-played')!
    const b = projected.players.get('b-waiting')!

    // Both have now played twice, so the comparison lands on who played more recently.
    expect(a.matches_played).toBe(b.matches_played)

    const order = [a, b].sort((x, y) => comparePlayersByPriority(x, y, tiers))
    expect(order[0].player_id).toBe('b-waiting')
  })
})
