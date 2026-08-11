import { simulateWaitWouldClean } from '../../../lib/next-round-suggester/forced-tradeoff'
import { createPlayer, createState } from '../helpers/factories'

// "Chờ Sân X" tells the host that waiting for a particular court to finish will produce a clean board.
// The simulation behind it asks only whether SOME clean foursome exists once that court's players join
// the pool. The engine does not get that freedom: it has to seat the players it owes a game to. When the
// only clean foursome excludes one of them, the promise cannot be kept and the host waits for nothing.
//
// The wait option has to be judged against the same constraint the refill will be built under.
describe('a wait option must be clean WITH the players who are owed a game', () => {
  const tolerance = 0.5

  // Seven players level at 3.0 and one far outlier. A clean foursome exists among the level players; no
  // clean foursome exists that contains the outlier, whose gap to anyone is 3.0.
  const build = () => {
    const owedOutlier = createPlayer('owed-outlier', { pvna: 6 })
    const level = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => createPlayer(id, { pvna: 3 }))
    const state = createState({ courts: 2, pvnaTolerance: tolerance, players: [owedOutlier, ...level] })

    return {
      state,
      poolIds: ['owed-outlier', 'A', 'B', 'C'],
      liveCourts: [{ court_idx: 1, player_ids: ['D', 'E', 'F', 'G'], started_at: null }],
    }
  }

  it('offers the wait when nobody is owed a game', () => {
    const { state, poolIds, liveCourts } = build()

    const options = simulateWaitWouldClean(poolIds, liveCourts, state, tolerance)

    expect(options.map(o => o.court_idx)).toEqual([1])
  })

  it('does not offer a wait whose only clean lineup leaves out a player who is owed a game', () => {
    const { state, poolIds, liveCourts } = build()

    const options = simulateWaitWouldClean(poolIds, liveCourts, state, tolerance, ['owed-outlier'])

    expect(options).toEqual([])
  })
})
