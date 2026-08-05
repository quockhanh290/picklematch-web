import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'
import type { SessionLiveMatchRow, SessionState } from '../../../lib/next-round-suggester/types'

// Forced-pool fixture (mirrors forced-tradeoff.test.ts): lo1/lo2 vs hi1/hi2 is a gap-~1.6 blowout,
// while every lo×hi cross-pair is partner-saturated (2 prior meetings) so a balanced split forces a
// 3rd meeting. With only these 4 players eligible and a single court, buildSuggestedMatchPayloads must
// seat *some* lineup (fail-soft: it doesn't bail on a bad court) — and, flag ON, must attach the two
// Pareto tradeoff endpoints as advisory metadata alongside the seated lineup.
function buildForcedState(): SessionState {
  const players = [
    createPlayer('lo1', { pvna: 2.0 }),
    createPlayer('lo2', { pvna: 2.1 }),
    createPlayer('hi1', { pvna: 3.6 }),
    createPlayer('hi2', { pvna: 3.7 }),
  ]
  const state = createState({ players, courts: 1, pvnaTolerance: 0.5, currentRound: 3 })
  const lo1 = state.players.get('lo1')!
  const lo2 = state.players.get('lo2')!
  const hi1 = state.players.get('hi1')!
  const hi2 = state.players.get('hi2')!
  setPartnerRepeats(lo1, hi1, 2)
  setPartnerRepeats(lo1, hi2, 2)
  setPartnerRepeats(lo2, hi1, 2)
  setPartnerRepeats(lo2, hi2, 2)
  return state
}

// Balanced, history-free pool — a clean split always exists, so the court should never be forced.
function buildCleanState(): SessionState {
  const players = [
    createPlayer('a', { pvna: 3.0 }),
    createPlayer('b', { pvna: 3.0 }),
    createPlayer('c', { pvna: 3.1 }),
    createPlayer('d', { pvna: 3.1 }),
  ]
  return createState({ players, courts: 1, pvnaTolerance: 0.5 })
}

// Same forced lo/hi fixture as buildForcedState, plus a fresh balanced foursome (m1-m4) already
// playing live on court_idx 1 — courts:2 so the forced court (idx 0) gets suggested while court 1
// stays occupied. Exercises the liveMatchRows → liveCourtsForSim mapping in live-preview.ts, which
// the other tests here never touch (they all pass liveMatchRows: []).
function buildForcedStateWithLiveCourt(): { state: SessionState; liveMatchRows: SessionLiveMatchRow[] } {
  const players = [
    createPlayer('lo1', { pvna: 2.0 }),
    createPlayer('lo2', { pvna: 2.1 }),
    createPlayer('hi1', { pvna: 3.6 }),
    createPlayer('hi2', { pvna: 3.7 }),
    createPlayer('m1', { pvna: 3.0 }),
    createPlayer('m2', { pvna: 3.0 }),
    createPlayer('m3', { pvna: 3.0 }),
    createPlayer('m4', { pvna: 3.0 }),
  ]
  const state = createState({ players, courts: 2, pvnaTolerance: 0.5, currentRound: 3 })
  const lo1 = state.players.get('lo1')!
  const lo2 = state.players.get('lo2')!
  const hi1 = state.players.get('hi1')!
  const hi2 = state.players.get('hi2')!
  setPartnerRepeats(lo1, hi1, 2)
  setPartnerRepeats(lo1, hi2, 2)
  setPartnerRepeats(lo2, hi1, 2)
  setPartnerRepeats(lo2, hi2, 2)
  const liveMatchRows: SessionLiveMatchRow[] = [
    {
      id: 'live-court-1',
      session_id: state.session_id,
      sequence_no: 1,
      round_no: 3,
      court_idx: 1,
      status: 'live',
      team_a: ['m1', 'm2'],
      team_b: ['m3', 'm4'],
      resting: [],
      score_a: 0,
      score_b: 0,
      suggested_at: '2026-08-05T06:55:00Z',
      started_at: '2026-08-05T07:00:00Z',
      ended_at: null,
    },
  ]
  return { state, liveMatchRows }
}

const PLAYERS_BY_ID = new Map(
  ['lo1', 'lo2', 'hi1', 'hi2', 'a', 'b', 'c', 'd', 'm1', 'm2', 'm3', 'm4'].map(id => [id, { name: id }]),
)

function callHarness(state: SessionState, liveMatchRows: SessionLiveMatchRow[] = [], courtCount = 1) {
  return buildSuggestedMatchPayloads({
    count: 1,
    sessionId: 'forced-tradeoff-integration',
    courtCount,
    state,
    rows: { liveMatchRows, liveStateVersion: null },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
    fairnessWarnings: [],
    playersById: PLAYERS_BY_ID as any,
    pvnaTolerance: 0.5,
    options: {},
  })
}

describe('buildSuggestedMatchPayloads — forced_tradeoff / wait_rescue_options integration', () => {
  afterEach(() => __setQualityCostModelOverrideForTests(null))

  it('flag ON: a forced bad court emits forced_tradeoff with distinct accept-repeat + accept-imbalance endpoints', () => {
    __setQualityCostModelOverrideForTests(true)
    const payloads = callHarness(buildForcedState())
    expect(payloads.length).toBeGreaterThan(0)
    const p = payloads[0]
    expect(p.forced_tradeoff).toBeDefined()
    expect(p.forced_tradeoff!.acceptRepeat).not.toEqual(p.forced_tradeoff!.acceptImbalance)
    expect(p.forced_tradeoff!.acceptRepeat.team_a.length).toBe(2)
    expect(p.forced_tradeoff!.acceptImbalance.team_a.length).toBe(2)
  })

  it('flag OFF: no forced_tradeoff / wait_rescue_options attached', () => {
    // The whole forced-tradeoff block is gated behind isQualityCostModelEnabled(state); with the flag
    // off it never runs, so the pushed payload carries only `forced_tradeoff: undefined,
    // wait_rescue_options: undefined` — additive keys that are indistinguishable from absent fields.
    // (We don't compare this to a flag-ON run here: the quality-cost model also changes scoring
    // elsewhere in the pipeline, so ON vs OFF payloads can legitimately differ beyond these two fields.)
    __setQualityCostModelOverrideForTests(false)
    const payloads = callHarness(buildForcedState())
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads[0].forced_tradeoff).toBeUndefined()
    expect(payloads[0].wait_rescue_options).toBeUndefined()
  })

  it('a clean court emits no forced_tradeoff even with the flag ON', () => {
    __setQualityCostModelOverrideForTests(true)
    const payloads = callHarness(buildCleanState())
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads[0].forced_tradeoff).toBeUndefined()
    expect(payloads[0].wait_rescue_options).toBeUndefined()
  })

  it('flag ON + a live court present: a forced court populates wait_rescue_options via the liveMatchRows mapping', () => {
    __setQualityCostModelOverrideForTests(true)
    const { state, liveMatchRows } = buildForcedStateWithLiveCourt()
    const payloads = callHarness(state, liveMatchRows, 2)
    const forcedPayload = payloads.find(p => p.forced_tradeoff !== undefined)
    expect(forcedPayload).toBeDefined()
    // m1-m4 are a fresh, balanced foursome live on court 1 — returning them yields a clean split,
    // so this exercises the verified-clean path (not just "array is defined").
    expect(Array.isArray(forcedPayload!.wait_rescue_options)).toBe(true)
    expect(forcedPayload!.wait_rescue_options!.map(o => o.court_idx)).toContain(1)
  })
})
