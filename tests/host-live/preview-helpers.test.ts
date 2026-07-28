import {
  getSuggestedMatchPvnaGap,
  getSuggestedMatchSignature,
  swapPlayersInSuggestedMatch,
} from '@/features/host/session-detail/next-round-v2/preview-helpers'

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

describe('getSuggestedMatchPvnaGap', () => {
  it('computes the absolute pvna gap between team totals', () => {
    const match = { team_a: ['1', '2'], team_b: ['3', '4'] }
    const state = {
      players: new Map([
        ['1', { pvna: 5 }],
        ['2', { pvna: 3 }],
        ['3', { pvna: 4 }],
        ['4', { pvna: 1 }],
      ]),
    } as any
    // team_a = 5 + 3 = 8, team_b = 4 + 1 = 5, gap = 3
    expect(getSuggestedMatchPvnaGap(match, state)).toBe(3)
  })

  it('treats missing pvna as 0', () => {
    const match = { team_a: ['1'], team_b: ['2'] }
    const state = { players: new Map() } as any
    expect(getSuggestedMatchPvnaGap(match, state)).toBe(0)
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
