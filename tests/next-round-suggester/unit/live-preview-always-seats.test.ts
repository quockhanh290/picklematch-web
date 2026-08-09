import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState } from '../helpers/factories'

// Production (debug_dumps 828b7010, ALGO 55): a 6-court board where courts 0-2 seated fine, then court 3
// reported busy_count 31 / eligible 4 / selected 0 and was dropped — three retries, all empty. With
// exactly four eligible players there are only three possible splits, so returning nothing means every
// split was rejected outright rather than seated as the least-bad option. Across 60 days, 1080 of 4035
// requests came back short and 93% of those had enough free players to fill what they dropped.
describe('always seats an open court when four players are free', () => {
  afterEach(() => {
    __setQualityCostModelOverrideForTests(null)
  })

  const build = (players: ReturnType<typeof createPlayer>[], qualityCostEnabled = false) => {
    const state = createState({ courts: 1, pvnaTolerance: 0.5, players })
    state.config.quality_cost_enabled = qualityCostEnabled
    return buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [0] },
    })
  }

  it('seats a foursome whose every split breaks a quality limit', () => {
    // Any pairing of these four is bad: the level split is a 8.0 blowout, and both mixed splits stack a
    // 1.0 with a 5.0. There is no clean answer — but four people are standing on the court.
    const payloads = build([
      createPlayer('a', { pvna: 1.0 }),
      createPlayer('b', { pvna: 1.1 }),
      createPlayer('c', { pvna: 5.0 }),
      createPlayer('d', { pvna: 5.1 }),
    ], true)

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('still seats the degraded lineup with the quality-cost model enabled', () => {
    __setQualityCostModelOverrideForTests(true)
    const payloads = build([
      createPlayer('a', { pvna: 1.0 }),
      createPlayer('b', { pvna: 1.1 }),
      createPlayer('c', { pvna: 5.0 }),
      createPlayer('d', { pvna: 5.1 }),
    ], true)

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('still returns nothing when the pool is genuinely too small', () => {
    const payloads = build([
      createPlayer('a', { pvna: 3.0 }),
      createPlayer('b', { pvna: 3.1 }),
      createPlayer('c', { pvna: 3.2 }),
    ])

    expect(payloads).toHaveLength(0)
  })
})
