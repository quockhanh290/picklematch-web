import { buildTradeoffEndpoints, simulateWaitWouldClean } from '../../../lib/next-round-suggester/forced-tradeoff'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'

function stateWith(pvnaById: Record<string, number>, currentRound = 0): SessionState {
  const players = Object.entries(pvnaById).map(([id, pvna]) => createPlayer(id, { pvna }))
  return createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound })
}

describe('simulateWaitWouldClean started_at ordering', () => {
  it('does not rank wait-rescue courts by started_at when that timestamp is only row creation time', () => {
    const state = stateWith({
      lo1: 2.0, lo2: 2.1, hi1: 3.7, hi2: 3.8,
      m1: 3.0, m2: 3.0, m3: 3.0, m4: 3.0,
      n1: 3.0, n2: 3.0, n3: 3.0, n4: 3.0,
    }, 3)
    setPartnerRepeats(state.players.get('lo1')!, state.players.get('hi1')!, 2)
    setPartnerRepeats(state.players.get('lo1')!, state.players.get('hi2')!, 2)
    setPartnerRepeats(state.players.get('lo2')!, state.players.get('hi1')!, 2)
    setPartnerRepeats(state.players.get('lo2')!, state.players.get('hi2')!, 2)

    const pool = ['lo1', 'lo2', 'hi1', 'hi2']
    expect(buildTradeoffEndpoints(pool, state, 0.5).isForced).toBe(true)

    const live = [
      { court_idx: 1, player_ids: ['m1', 'm2', 'm3', 'm4'], started_at: '2026-08-05T07:10:00Z' },
      { court_idx: 2, player_ids: ['n1', 'n2', 'n3', 'n4'], started_at: '2026-08-05T07:00:00Z' },
    ]

    expect(simulateWaitWouldClean(pool, live, state, 0.5).map(r => r.court_idx)).toEqual([1, 2])
  })
})
