import {
  getPayloadIntraTeamGap,
  getPayloadMaxHistoricalPairCount,
  getPayloadPairKey,
  getPayloadProjectedMaxMeeting,
  hasAvoidedPartnerPair,
} from '@/lib/next-round-suggester/board-metrics'
import type { SuggestedMatchPayload } from '@/lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

function makeStateWithPlayers(players: Array<[string, number]>) {
  return createState({
    players: players.map(([id, pvna]) => createPlayer(id, { pvna })),
  })
}

function makePayload(teamA: [string, string], teamB: [string, string], courtIdx = 0) {
  return { court_idx: courtIdx, team_a: teamA, team_b: teamB } as SuggestedMatchPayload
}

describe('getPayloadIntraTeamGap', () => {
  test('is the larger of the two in-team gaps', () => {
    const state = makeStateWithPlayers([['a', 4.0], ['b', 2.0], ['c', 3.0], ['d', 3.1]])
    const payload = makePayload(['a', 'b'], ['c', 'd'])
    expect(getPayloadIntraTeamGap(payload, state)).toBeCloseTo(2.0, 5)
  })

  test('treats an unknown player as pvna 0', () => {
    const state = makeStateWithPlayers([['a', 4.0], ['c', 3.0], ['d', 3.0]])
    const payload = makePayload(['a', 'ghost'], ['c', 'd'])
    expect(getPayloadIntraTeamGap(payload, state)).toBeCloseTo(4.0, 5)
  })
})

describe('getPayloadProjectedMaxMeeting', () => {
  test('is the highest historical meeting count plus one', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    state.players.get('a')!.partner_counts.set('b', 2)
    const payload = makePayload(['a', 'b'], ['c', 'd'])
    expect(getPayloadProjectedMaxMeeting(payload, state)).toBe(3)
  })

  test('counts opponent history too', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    state.players.get('a')!.opponent_counts.set('d', 3)
    const payload = makePayload(['a', 'b'], ['c', 'd'])
    expect(getPayloadProjectedMaxMeeting(payload, state)).toBe(4)
  })

  test('is 1 for a foursome with no history', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    expect(getPayloadProjectedMaxMeeting(makePayload(['a', 'b'], ['c', 'd']), state)).toBe(1)
  })
})

describe('getPayloadMaxHistoricalPairCount', () => {
  test('reports partner and opponent maxima separately', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    state.players.get('a')!.partner_counts.set('b', 2)
    state.players.get('b')!.opponent_counts.set('c', 5)
    const payload = makePayload(['a', 'b'], ['c', 'd'])
    expect(getPayloadMaxHistoricalPairCount(payload, state)).toEqual({ partner: 2, opponent: 5 })
  })
})

describe('getPayloadPairKey', () => {
  test('is order independent', () => {
    expect(getPayloadPairKey('b', 'a')).toBe(getPayloadPairKey('a', 'b'))
    expect(getPayloadPairKey('a', 'b')).toBe('a:b')
  })
})

describe('hasAvoidedPartnerPair', () => {
  test('is false when the session has no avoid pairs', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    expect(hasAvoidedPartnerPair([makePayload(['a', 'b'], ['c', 'd'])], state)).toBe(false)
  })

  test('detects an avoided pair seated as partners in either direction', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    state.config.avoid_pairs = [{ player_a: 'b', player_b: 'a' }]
    expect(hasAvoidedPartnerPair([makePayload(['a', 'b'], ['c', 'd'])], state)).toBe(true)
  })

  test('ignores an avoided pair split across opposing teams', () => {
    const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
    state.config.avoid_pairs = [{ player_a: 'a', player_b: 'c' }]
    expect(hasAvoidedPartnerPair([makePayload(['a', 'b'], ['c', 'd'])], state)).toBe(false)
  })
})
