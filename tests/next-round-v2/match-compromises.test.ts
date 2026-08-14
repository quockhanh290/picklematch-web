import {
  getCompromiseInfoLines,
  getMatchCompromises,
  getPlayCostText,
  type MatchCompromiseFacts,
} from '@/features/host/session-detail/next-round-v2/match-compromises'

const facts = (overrides: Partial<MatchCompromiseFacts> = {}): MatchCompromiseFacts => ({
  degradedReason: null,
  maxOpponentPair: 1,
  pvnaOverBy: 0,
  pvnaCapExceeded: false,
  intraTeamRelaxed: false,
  repeatOverBy: 0,
  ...overrides,
})

describe('match compromises', () => {
  it('says nothing is given up when nothing is', () => {
    const compromises = getMatchCompromises(facts())
    expect(compromises).toEqual([])
    expect(getPlayCostText(compromises)).toBe('không đánh đổi gì')
    expect(getCompromiseInfoLines(compromises)).toEqual([])
  })

  // The contradiction the host reported: the card said "không đánh đổi gì" while the line right under it
  // said the teams were further apart than usual.
  it('never claims a free lineup while also reporting a compromise', () => {
    const cases: MatchCompromiseFacts[] = [
      facts({ pvnaOverBy: 0.85, pvnaCapExceeded: true }),
      facts({ intraTeamRelaxed: true }),
      facts({ repeatOverBy: 1 }),
      facts({ degradedReason: 'blowout' }),
      facts({ degradedReason: 'repeat' }),
      facts({ maxOpponentPair: 3 }),
    ]
    for (const input of cases) {
      const compromises = getMatchCompromises(input)
      const cost = getPlayCostText(compromises)
      const lines = getCompromiseInfoLines(compromises)
      expect(lines.length).toBeGreaterThan(0)
      expect(cost).not.toBe('không đánh đổi gì')
      expect(compromises).toHaveLength(lines.length)
    }
  })

  it('names an intra-team gap, which the cost line used to have no term for', () => {
    const compromises = getMatchCompromises(facts({ intraTeamRelaxed: true }))
    expect(getPlayCostText(compromises)).toBe('giữ một đôi lệch trình')
    expect(getCompromiseInfoLines(compromises)).toEqual(['Hai người cùng đội chênh trình độ'])
  })

  it('names an over-tolerance gap that never earned the blowout flag', () => {
    const compromises = getMatchCompromises(facts({ pvnaOverBy: 0.85, pvnaCapExceeded: true }))
    expect(getPlayCostText(compromises)).toBe('giữ trận chênh 0,85 quá mức cân')
  })

  it('does not report the gap twice when the lineup is already flagged as a blowout', () => {
    const compromises = getMatchCompromises(facts({ degradedReason: 'blowout', pvnaOverBy: 1.6, pvnaCapExceeded: true }))
    expect(compromises).toEqual([{ kind: 'blowout' }])
    expect(getPlayCostText(compromises)).toBe('giữ trận hơi lệch trình')
  })

  it('counts a third meeting rather than calling it a plain repeat', () => {
    const compromises = getMatchCompromises(facts({ degradedReason: 'repeat', maxOpponentPair: 3 }))
    expect(getPlayCostText(compromises)).toBe('giữ lặp đối thủ 3 lần')
  })

  it('joins several compromises instead of reporting only the first', () => {
    const compromises = getMatchCompromises(facts({
      degradedReason: 'both',
      maxOpponentPair: 3,
      intraTeamRelaxed: true,
    }))
    expect(getPlayCostText(compromises)).toBe('giữ trận hơi lệch trình & một đôi lệch trình & lặp đối thủ 3 lần')
    expect(getCompromiseInfoLines(compromises)).toHaveLength(3)
  })
})
