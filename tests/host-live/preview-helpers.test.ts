import {
  applyPairIncrement,
  getSuggestedMatchSignature,
  swapPlayersInSuggestedMatch,
} from '@/features/host/session-detail/next-round-v2/preview-helpers'
import { getMatchPvnaGap } from '@/lib/next-round-suggester/state'

describe('getSuggestedMatchSignature', () => {
  it('signature is order-independent within a team', () => {
    const a = { team_a: ['1', '2'], team_b: ['3', '4'] }
    const b = { team_a: ['2', '1'], team_b: ['4', '3'] }
    expect(getSuggestedMatchSignature(a)).toBe(getSuggestedMatchSignature(b))
  })

  it('signature differs when teams differ', () => {
    const a = { team_a: ['1', '2'], team_b: ['3', '4'] }
    const b = { team_a: ['1', '3'], team_b: ['2', '4'] }
    expect(getSuggestedMatchSignature(a)).not.toBe(getSuggestedMatchSignature(b))
  })
})

// Was getSuggestedMatchPvnaGap, a client-local copy that read raw pvna. Deleted in favour of the
// function the engine itself gates on (P1-9). The arithmetic below is unchanged; what changed is that a
// session carrying effective_pvna now yields the engine's number instead of a second opinion, which is a
// deliberate behaviour change, not a test being made to fit.
describe('getMatchPvnaGap', () => {
  it('computes the absolute pvna gap between team totals', () => {
    const state = {
      players: new Map([
        ['1', { pvna: 5 }],
        ['2', { pvna: 3 }],
        ['3', { pvna: 4 }],
        ['4', { pvna: 1 }],
      ]),
    } as any
    // team_a = 5 + 3 = 8, team_b = 4 + 1 = 5, gap = 3
    expect(getMatchPvnaGap(['1', '2'], ['3', '4'], state)).toBe(3)
  })

  it('prefers effective_pvna, which is what the engine ranked on', () => {
    const state = {
      players: new Map([
        ['1', { pvna: 5, effective_pvna: 2 }],
        ['2', { pvna: 3, effective_pvna: 2 }],
        ['3', { pvna: 4 }],
        ['4', { pvna: 1 }],
      ]),
    } as any
    // team_a = 2 + 2 = 4 (not 8), team_b = 4 + 1 = 5, gap = 1
    expect(getMatchPvnaGap(['1', '2'], ['3', '4'], state)).toBe(1)
  })

  it('treats a player the state has not caught up to as 0', () => {
    const state = { players: new Map() } as any
    expect(getMatchPvnaGap(['1'], ['2'], state)).toBe(0)
  })
})

describe('applyPairIncrement', () => {
  it('bumps partner counts both directions', () => {
    const players = new Map<string, any>([
      ['A', { partner_counts: new Map(), opponent_counts: new Map() }],
      ['B', { partner_counts: new Map(), opponent_counts: new Map() }],
    ])
    applyPairIncrement(players, 'A', 'B', 'partner')
    expect(players.get('A').partner_counts.get('B')).toBe(1)
    expect(players.get('B').partner_counts.get('A')).toBe(1)
  })

  it('type=opponent bumps opponent_counts', () => {
    const players = new Map<string, any>([
      ['A', { partner_counts: new Map(), opponent_counts: new Map() }],
      ['B', { partner_counts: new Map(), opponent_counts: new Map() }],
    ])
    applyPairIncrement(players, 'A', 'B', 'opponent')
    expect(players.get('A').opponent_counts.get('B')).toBe(1)
    expect(players.get('B').opponent_counts.get('A')).toBe(1)
    expect(players.get('A').partner_counts.get('B') ?? 0).toBe(0)
  })
})

describe('swapPlayersInSuggestedMatch', () => {
  it('swap exchanges two players across teams and fixes resting', () => {
    const match = { team_a: ['1', '2'], team_b: ['3', '4'], resting: ['5'] } as any
    const out = swapPlayersInSuggestedMatch(match, '2', '5')
    expect(out.team_a).toContain('5')
    expect(out.team_a).not.toContain('2')
    expect(out.resting).toContain('2')
  })

  it('swaps two currently-playing players without touching resting', () => {
    const match = { team_a: ['1', '2'], team_b: ['3', '4'], resting: ['5'] } as any
    const out = swapPlayersInSuggestedMatch(match, '2', '3')
    expect(out.team_a).toEqual(['1', '3'])
    expect(out.team_b).toEqual(['2', '4'])
    expect(out.resting).toEqual(['5'])
  })
})
