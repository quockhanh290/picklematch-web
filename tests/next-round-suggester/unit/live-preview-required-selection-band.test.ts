import { selectRequiredIdsForCourt } from '../../../lib/next-round-suggester/live-preview'
import type { SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

// availableRequiredIds is fairness-ordered; the first id is the anchor. The band cap forces only owed
// players within INTRA_TEAM_PVNA_GAP_LIMIT (1.0) of the anchor, deferring skill-outliers so pairing can
// fill the seat from a near-level pool player instead of being handed a strong+weak blowout foursome.
function stateOf(pvnas: Record<string, number>): SessionState {
  return createState({
    players: Object.entries(pvnas).map(([id, p]) => createPlayer(id, { pvna: p, matches_played: 1, consecutive_rest: 1 })),
    courts: 6,
    pvnaTolerance: 0.5,
  })
}

describe('selectRequiredIdsForCourt — skill band cap', () => {
  it('defers the skill-outlier of a bimodal owed set (anchor = low)', () => {
    // owed: 3 low + 3 high, all MUST_PLAY. Anchor Uyen(2.31). Band -> Tung(2.42), Huong(3.23) in; highs out.
    const state = stateOf({ Uyen: 2.31, Tung: 2.42, Huong: 3.23, Bao: 4.50, Thao: 4.57, HoVy: 4.92 })
    const owed = ['Uyen', 'Tung', 'Huong', 'Bao', 'Thao', 'HoVy']
    const picked = selectRequiredIdsForCourt(owed, 4, 5, state)
    expect(picked).toContain('Uyen')
    expect(picked).not.toContain('Bao')   // 4.50 is > 1.0 from anchor 2.31 -> deferred
    expect(picked).not.toContain('Thao')
    expect(picked).not.toContain('HoVy')
    picked.forEach(id => expect(Math.abs(state.players.get(id)!.pvna - 2.31)).toBeLessThanOrEqual(1.0))
  })

  it('groups a cohesive cluster when the anchor is high', () => {
    const state = stateOf({ HoVy: 4.92, Bao: 4.50, Thao: 4.57, Uyen: 2.31, Tung: 2.42, Huong: 3.23 })
    const owed = ['HoVy', 'Bao', 'Thao', 'Uyen', 'Tung', 'Huong'] // anchor HoVy
    const picked = selectRequiredIdsForCourt(owed, 4, 5, state)
    expect(picked).toContain('HoVy')
    expect(picked).toContain('Bao')
    expect(picked).toContain('Thao')
    expect(picked).not.toContain('Uyen') // lows are > 1.0 from 4.92 -> deferred
  })

  it('no-ops for an already-cohesive owed set (forces the full count as before)', () => {
    const state = stateOf({ A: 3.0, B: 3.1, C: 3.2, D: 3.3, E: 3.4, F: 3.5 })
    const picked = selectRequiredIdsForCourt(['A', 'B', 'C', 'D', 'E', 'F'], 4, 5, state)
    expect(picked.length).toBe(4)
    expect(picked[0]).toBe('A')
  })

  it('seats all owed unchanged when there is no surplus (length <= count)', () => {
    const state = stateOf({ A: 2.0, B: 5.0, C: 3.0 })
    const picked = selectRequiredIdsForCourt(['A', 'B', 'C'], 4, 5, state)
    expect(picked).toEqual(['A', 'B', 'C'])
  })
})
