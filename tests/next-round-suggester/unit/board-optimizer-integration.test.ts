import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { __setBoardOptimizerOverrideForTests } from '../../../lib/next-round-suggester/board-optimizer-flag'
import { hasAvoidedPartnerPair } from '../../../lib/next-round-suggester/board-metrics'
import type {
  PlayerSessionState,
  ScoringWeights,
  SessionState,
} from '../../../lib/next-round-suggester/types'

const WEIGHTS: ScoringWeights = {
  pvna: 100, partner_repeat: 3, opponent_repeat: 1.5,
  group_bonus: 0.5, partner_gender_pref: 4, opponent_gender_pref: 2, consecutive_play: 0,
}

function makePlayer(id: string, pvna: number): PlayerSessionState {
  return {
    player_id: id, pvna, gender: null,
    partner_gender_pref: 'any', opponent_gender_pref: 'any',
    group_id: null,
    checked_in_at: new Date('2026-08-13T12:00:00Z'),
    checked_out_at: null,
    matches_played: 0, last_played_round: -1,
    consecutive_rest: 0, consecutive_play: 0,
    partner_counts: new Map(), opponent_counts: new Map(),
    opted_rest: false, rounds_available: 99,
  }
}

const COURTS = 2
// Two courts seated plus four on the bench, so W3 (bench swap) has something to consider and the
// board is not trivially frozen.
const PLAYERS = [
  makePlayer('p1', 2.0), makePlayer('p2', 2.2), makePlayer('p3', 3.0), makePlayer('p4', 3.2),
  makePlayer('q1', 4.0), makePlayer('q2', 4.2), makePlayer('q3', 5.0), makePlayer('q4', 5.2),
  makePlayer('r1', 2.5), makePlayer('r2', 3.5), makePlayer('r3', 4.5), makePlayer('r4', 5.5),
]
const playersById = new Map(PLAYERS.map(p => [p.player_id, { name: p.player_id }]))

function makeState(): SessionState {
  return {
    session_id: 'board-optimizer-integration',
    current_round: 0,
    status: 'active',
    config: { courts: COURTS, pvna_tolerance: 0.5, weights: WEIGHTS },
    players: new Map(PLAYERS.map(p => [p.player_id, { ...p }])),
    rounds: [],
  }
}

function build(onInstrumentEvent?: (event: { event: string; detail: string }) => void) {
  const state = makeState()
  return buildSuggestedMatchPayloads({
    count: COURTS,
    sessionId: state.session_id,
    courtCount: COURTS,
    state,
    rows: { liveMatchRows: [], liveStateVersion: null },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
    fairnessWarnings: [],
    playersById,
    pvnaTolerance: 0.5,
    options: onInstrumentEvent ? { onInstrumentEvent } : {},
  })
}

const shape = (payloads: SuggestedMatchPayload[]) =>
  payloads.map(p => [p.court_idx, [...p.team_a], [...p.team_b]])

const seated = (payloads: SuggestedMatchPayload[]) =>
  payloads.flatMap(p => [...p.team_a, ...p.team_b])

afterEach(() => __setBoardOptimizerOverrideForTests(null))

describe('board optimizer integration', () => {
  it('flag OFF: the board is exactly what the six-pass chain produced before the optimizer existed', () => {
    __setBoardOptimizerOverrideForTests(null)
    const baseline = build()
    __setBoardOptimizerOverrideForTests(false)
    const off = build()
    expect(shape(off)).toEqual(shape(baseline))
    expect(shape(off)).toMatchSnapshot()
  })

  it('flag ON: the optimizer actually runs and the board it returns is still valid', () => {
    __setBoardOptimizerOverrideForTests(false)
    const baseline = build()

    __setBoardOptimizerOverrideForTests(true)
    const details: string[] = []
    const on = build(event => { if (event.event === 'repair') details.push(event.detail) })

    // The measurement itself must be proven live before any number derived from it is trusted.
    expect(details).toContain('optimizer:entered')
    // and none of the six passes may have run on this path
    expect(details.some(d => d.startsWith('participation:') || d.startsWith('repeatPool:')
      || d.startsWith('blowoutPool:') || d.startsWith('invariantGuardRevert:'))).toBe(false)

    expect(on).toHaveLength(baseline.length)
    expect(on.map(p => p.court_idx).sort()).toEqual(baseline.map(p => p.court_idx).sort())
    for (const payload of on) {
      expect(payload.team_a).toHaveLength(2)
      expect(payload.team_b).toHaveLength(2)
    }
    const ids = seated(on)
    expect(new Set(ids).size).toBe(ids.length)
    expect(hasAvoidedPartnerPair(on, makeState())).toBe(false)
  })
})
