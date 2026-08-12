import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

// P2-5. The engine iterates players, courts and bench in whatever order its inputs arrive in, and
// several tie-breaks stop at the first candidate that is no worse. Where those tie-breaks are not total,
// the board depends on the order the caller happened to build its Map — which nothing guarantees: it
// comes from a database row order, a snapshot merge, a client cache.
//
// Two hosts looking at the same session, or the same host after a reload, can then see different boards
// from identical state. That is not a quality problem, it is a "the engine is not a function of its
// input" problem, and it makes every other measurement here shakier than it looks.
//
// Shuffling the input is the honest test: the roster is the same set either way.
describe('the board is a function of the state, not of the order it was built in', () => {
  const ROSTER = Array.from({ length: 24 }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`,
    // A spread wide enough that pairing choices actually differ, and deliberately not sorted.
    pvna: 2.4 + ((i * 7) % 13) * 0.15,
  }))

  const boardFor = (order: typeof ROSTER) => {
    const players = order.map(({ id, pvna }) => createPlayer(id, { pvna }))
    const state = createState({ courts: 5, pvnaTolerance: 0.5, players })

    return buildSuggestedMatchPayloads({
      count: 5,
      sessionId: state.session_id,
      courtCount: 5,
      state,
      rows: { liveMatchRows: [], liveStateVersion: null },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
      pvnaTolerance: 0.5,
      options: { ignoreCapacityLock: true, rollingHorizon: false, rollingPlanTarget: null },
    } as never)
      .map((payload: { court_idx: number; team_a: string[]; team_b: string[] }) =>
        `${payload.court_idx}:${[...payload.team_a].sort().join('+')}|${[...payload.team_b].sort().join('+')}`)
      .sort()
      .join(' / ')
  }

  it('gives the same board whichever order the roster arrives in', () => {
    const asListed = boardFor(ROSTER)
    const reversed = boardFor([...ROSTER].reverse())
    const rotated = boardFor([...ROSTER.slice(9), ...ROSTER.slice(0, 9)])

    expect(asListed).not.toBe('')
    expect(reversed).toBe(asListed)
    expect(rotated).toBe(asListed)
  })
})
