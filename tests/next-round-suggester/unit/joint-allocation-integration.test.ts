import {
  applyJointRepartition,
  buildSuggestedMatchPayloads,
} from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import type {
  PlayerSessionState,
  ScoringWeights,
  SessionState,
  Team,
} from '../../../lib/next-round-suggester/types'

// ── shared fixture helpers ──────────────────────────────────────────────────

const WEIGHTS: ScoringWeights = {
  pvna: 100, partner_repeat: 3, opponent_repeat: 1.5,
  group_bonus: 0.5, partner_gender_pref: 4, opponent_gender_pref: 2, consecutive_play: 0,
}

function makePlayer(id: string, pvna: number): PlayerSessionState {
  return {
    player_id: id, pvna, gender: null,
    partner_gender_pref: 'any', opponent_gender_pref: 'any',
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00Z'),
    checked_out_at: null,
    matches_played: 0, last_played_round: -1,
    consecutive_rest: 0, consecutive_play: 0,
    partner_counts: new Map(), opponent_counts: new Map(),
    opted_rest: false, rounds_available: 99,
  }
}

function makeState(players: PlayerSessionState[], courts: number): SessionState {
  return {
    session_id: 'joint-alloc-test',
    current_round: 0,
    status: 'active',
    config: { courts, pvna_tolerance: 0.5, weights: WEIGHTS },
    players: new Map(players.map(p => [p.player_id, { ...p }])),
    rounds: [],
  }
}

const payloadGap = (p: SuggestedMatchPayload, state: SessionState) => {
  const sum = (t: Team) => t.reduce((s, id) => s + (state.players.get(id)?.pvna ?? 0), 0)
  return Math.abs(sum(p.team_a) - sum(p.team_b))
}

const seated = (ps: SuggestedMatchPayload[]) => ps.flatMap(p => [...p.team_a, ...p.team_b]).sort()

afterEach(() => __setQualityCostModelOverrideForTests(null))

// ── direct-level tests (fallback per task-3-brief: prove the adapter itself repartitions) ─────────
//
// End-to-end divergence through the full suggestNextMatch pipeline proved intractable to engineer:
// the engine already assigns courts per-court via its own pvna-dominated scoring (weight 100), so a
// purely skill-bimodal fixture (see the buildSuggestedMatchPayloads-level tests below) is *already*
// grouped optimally by the plain greedy fill before the joint pass ever runs, and a repeat-history-
// driven fixture diverges via the pre-existing (Task 1/2) isQualityCostModelEnabled branch inside
// score.ts's greedy scorer rather than via this task's jointRepartition call (confirmed by instrumenting
// onInstrumentEvent and observing 'early', not 'joint', fire). These tests instead call the exported
// applyJointRepartition adapter directly with a hand-built cross-court blowout it can provably fix.

describe('applyJointRepartition (direct)', () => {
  // Bimodal swap fixture: court 0 = 3 low + 1 high outlier, court 1 = 3 high + 1 low outlier.
  // Swapping the two outliers across courts balances both foursomes perfectly.
  const players = [
    makePlayer('p1', 2.0), makePlayer('p2', 2.0), makePlayer('p3', 2.0), makePlayer('p4', 6.0),
    makePlayer('q1', 6.0), makePlayer('q2', 6.0), makePlayer('q3', 6.0), makePlayer('q4', 2.0),
  ]
  const state = makeState(players, 2)

  const payloads: SuggestedMatchPayload[] = [
    { court_idx: 0, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'], status: 'suggested', round_no: 1 } as SuggestedMatchPayload,
    { court_idx: 1, team_a: ['q1', 'q2'], team_b: ['q3', 'q4'], status: 'suggested', round_no: 1 } as SuggestedMatchPayload,
  ]

  it('flag OFF: identity (kill-switch clean)', () => {
    __setQualityCostModelOverrideForTests(false)
    const out = applyJointRepartition(payloads, state, 0.5)
    expect(out).toBe(payloads)
  })

  it('single court (count<2): identity even with the flag on', () => {
    __setQualityCostModelOverrideForTests(true)
    const singleCourtInput = [payloads[0]]
    const out = applyJointRepartition(singleCourtInput, state, 0.5)
    expect(out).toBe(singleCourtInput)
  })

  it('flag ON, divergent cross-court blowout: re-partitions, holds the seated set fixed, preserves court_idx, emits the joint instrument', () => {
    __setQualityCostModelOverrideForTests(true)
    const events: string[] = []
    const out = applyJointRepartition(payloads, state, 0.5, tag => events.push(tag))

    expect(events).toEqual(['joint'])
    expect(out).not.toBe(payloads)
    expect(out.map(p => p.court_idx)).toEqual(payloads.map(p => p.court_idx))
    expect(seated(out)).toEqual(seated(payloads))

    // both courts must now be perfectly balanced (each has 2 low + 2 high, sum 8 vs 8)
    for (const payload of out) {
      expect(payloadGap(payload, state)).toBeLessThanOrEqual(1e-9)
    }
    // and strictly better than the pre-repartition blowout
    const totalGapBefore = payloads.reduce((s, p) => s + payloadGap(p, state), 0)
    const totalGapAfter = out.reduce((s, p) => s + payloadGap(p, state), 0)
    expect(totalGapAfter).toBeLessThan(totalGapBefore)
  })
})

// ── integration-level tests: buildSuggestedMatchPayloads properties (1)-(3) from the task brief ───

describe('buildSuggestedMatchPayloads — joint pass properties', () => {
  const COURTS = 2
  // Clean bimodal fixture with no repeat/participation history, so none of the other flag-off repair
  // passes (early/swap/repeat/participation) fire and the only variable between flag off/on is whether
  // applyJointRepartition runs. The greedy per-court fill already finds the pvna-optimal grouping for
  // this fixture (verified empirically), so flag ON is expected to be a safe, provably-inert no-op here
  // — exactly the "never worse" guarantee this suite locks in at the integration boundary. Real
  // divergence is proven directly against the adapter above.
  const players = [
    makePlayer('p1', 2.0), makePlayer('p2', 2.0), makePlayer('p3', 2.0), makePlayer('p4', 6.0),
    makePlayer('q1', 6.0), makePlayer('q2', 6.0), makePlayer('q3', 6.0), makePlayer('q4', 2.0),
  ]
  const playersById = new Map(players.map(p => [p.player_id, { name: p.player_id }]))

  function build(buildOptions: Parameters<typeof buildSuggestedMatchPayloads>[0]['options'] = {}) {
    const state = makeState(players, COURTS)
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
      options: buildOptions,
    })
  }

  const gapState = makeState(players, COURTS)

  it('flag OFF: deterministic baseline lineup', () => {
    __setQualityCostModelOverrideForTests(false)
    const off = build()
    expect(off.map(p => [p.court_idx, [...p.team_a].sort(), [...p.team_b].sort()])).toMatchSnapshot()
  })

  it('flag ON, >=2 courts: seated set unchanged and total gap not worse than flag OFF', () => {
    __setQualityCostModelOverrideForTests(false)
    const off = build()
    __setQualityCostModelOverrideForTests(true)
    const on = build()

    expect(seated(on)).toEqual(seated(off))
    const gap = (ps: SuggestedMatchPayload[]) => ps.reduce((s, p) => s + payloadGap(p, gapState), 0)
    expect(gap(on)).toBeLessThanOrEqual(gap(off) + 1e-9)
  })

  it('flag ON with an active rollingPlanTarget: seated set still unchanged (#70 preserved)', () => {
    const rollingPlanTarget = {
      target_matches_by_player: Object.fromEntries(players.map(p => [p.player_id, 1])),
    }

    __setQualityCostModelOverrideForTests(true)
    const on = build({ rollingPlanTarget })
    __setQualityCostModelOverrideForTests(false)
    const off = build({ rollingPlanTarget })

    expect(seated(on)).toEqual(seated(off))
  })
})
