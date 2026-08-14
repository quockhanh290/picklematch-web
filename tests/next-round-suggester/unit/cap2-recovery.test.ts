/**
 * Tests for Session C fixes:
 *   A) Board-cụt pool lớn — engine fills 6 courts with 40 players within budget
 *   B) repairState clone-safety — baseBusyIds path does NOT mutate original state
 *
 * Engine is deterministic; tests are stable and flaky-free.
 */

import { createSearchBudget } from '../../../lib/next-round-suggester/search-budget'
import { commitCompletedRound } from '../../../lib/next-round-suggester/commit'
import {
  buildSuggestedMatchPayloads,
} from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import type { EngineInstrumentEvent, SuggestionDiagnostic } from '../../../lib/next-round-suggester/suggest'
import type {
  PlayerSessionState,
  ScoringWeights,
  SessionLiveMatchRow,
  SessionState,
} from '../../../lib/next-round-suggester/types'

// ── 40-player roster (same as scripts/diagnostics/simulate-cap2-recovery.ts) ──

const ROSTER: [string, number, 'M' | 'F', 'M' | 'F' | 'any', 'M' | 'F' | 'any'][] = [
  ['P12', 3.12, 'F', 'F', 'F'],    ['P8',  2.92, 'F', 'any', 'F'],
  ['P30', 4.06, 'F', 'F', 'any'],  ['P40', 2.58, 'F', 'M', 'F'],
  ['P26', 3.85, 'F', 'any', 'any'], ['P7',  2.86, 'M', 'F', 'any'],
  ['P32', 4.16, 'F', 'any', 'F'],  ['P13', 3.18, 'M', 'F', 'F'],
  ['P3',  2.66, 'M', 'M', 'any'],  ['P31', 4.11, 'M', 'F', 'any'],
  ['P15', 3.28, 'M', 'M', 'any'],  ['P36', 4.37, 'F', 'F', 'F'],
  ['P24', 3.75, 'F', 'F', 'F'],    ['P16', 3.33, 'F', 'M', 'F'],
  ['P34', 4.27, 'F', 'M', 'any'],  ['P2',  2.60, 'F', 'any', 'any'],
  ['P27', 3.90, 'M', 'M', 'any'],  ['P39', 2.53, 'M', 'M', 'any'],
  ['P9',  2.97, 'M', 'M', 'F'],    ['P28', 3.96, 'F', 'M', 'F'],
  ['P14', 3.23, 'F', 'any', 'any'], ['P29', 4.01, 'M', 'any', 'F'],
  ['P19', 3.49, 'M', 'F', 'any'],  ['P22', 3.64, 'F', 'M', 'any'],
  ['P10', 3.02, 'F', 'M', 'any'],  ['P18', 3.44, 'F', 'F', 'any'],
  ['P1',  2.55, 'M', 'F', 'F'],    ['P33', 4.22, 'M', 'M', 'F'],
  ['P11', 3.07, 'M', 'any', 'any'], ['P4',  2.71, 'F', 'M', 'F'],
  ['P37', 4.42, 'M', 'F', 'F'],    ['P35', 4.32, 'M', 'any', 'any'],
  ['P5',  2.76, 'M', 'any', 'F'],  ['P23', 3.70, 'M', 'any', 'any'],
  ['P6',  2.81, 'F', 'F', 'any'],  ['P25', 3.80, 'M', 'F', 'F'],
  ['P38', 4.48, 'F', 'any', 'any'], ['P20', 3.54, 'F', 'any', 'F'],
  ['P21', 3.59, 'M', 'M', 'F'],    ['P17', 3.38, 'M', 'any', 'F'],
]

const WEIGHTS: ScoringWeights = {
  pvna: 100, partner_repeat: 3, opponent_repeat: 1.5,
  group_bonus: 0.5, partner_gender_pref: 4, opponent_gender_pref: 2, consecutive_play: 0,
}

const COURTS = 6
const SESSION_ID = 'test-cap2-recovery'

const PLAYERS_BY_ID = new Map(ROSTER.map(([name]) => [name, { name }]))

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlayer([name, pvna, gender, pp, op]: typeof ROSTER[number]): PlayerSessionState {
  return {
    player_id: name, pvna, gender,
    partner_gender_pref: pp, opponent_gender_pref: op,
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00Z'),
    checked_out_at: null,
    matches_played: 0, last_played_round: -1,
    consecutive_rest: 0, consecutive_play: 0,
    partner_counts: new Map(), opponent_counts: new Map(),
    opted_rest: false, rounds_available: 99,
  }
}

function makeState(
  players: PlayerSessionState[],
  roundNo: number,
  rounds: SessionState['rounds'],
): SessionState {
  return {
    session_id: SESSION_ID,
    current_round: roundNo,
    status: 'active',
    config: { courts: COURTS, pvna_tolerance: 0.5, weights: WEIGHTS },
    players: new Map(players.map(p => [p.player_id, { ...p }])),
    rounds,
  }
}

function payloadToSuggestedRow(
  payload: SuggestedMatchPayload,
  seqNo: number,
  roundNo: number,
): SessionLiveMatchRow {
  return {
    id: `test-court-${payload.court_idx}-seq-${seqNo}`,
    session_id: SESSION_ID,
    sequence_no: seqNo,
    round_no: roundNo,
    court_idx: payload.court_idx,
    status: 'suggested',
    team_a: payload.team_a,
    team_b: payload.team_b,
    resting: payload.resting ?? [],
    score_a: 0, score_b: 0,
    suggested_at: new Date().toISOString(),
    started_at: null, ended_at: null,
  }
}

function verifyNoDoubleBook(rows: SessionLiveMatchRow[]): string[] {
  const seen = new Map<string, number>()
  const errors: string[] = []
  for (const row of rows) {
    for (const id of [...row.team_a, ...row.team_b]) {
      const prev = seen.get(id)
      if (prev !== undefined) errors.push(`double-book: ${id} in court ${prev} and ${row.court_idx}`)
      else seen.set(id, row.court_idx ?? -1)
    }
  }
  return errors
}

// Build state after 3 committed rounds to produce partner/opponent history (stressed).
// This runs once per test file (beforeAll) so suite overhead is <5s.
function buildStressedState(): SessionState {
  let players = ROSTER.map(makePlayer)
  let rounds: SessionState['rounds'] = []

  for (let r = 0; r < 3; r++) {
    const state = makeState(players, r, rounds)
    const result = suggestNextRound(state)
    const suggestion = result.alternatives[0]
    if (!suggestion) break
    const { matches, resting } = suggestion
    const committed = commitCompletedRound(state, { round_no: r, matches, resting })
    players = [...committed.players.values()]
    rounds = [
      ...rounds,
      {
        session_id: SESSION_ID,
        round_no: r,
        status: 'completed',
        matches,
        resting: resting ?? [],
        started_at: new Date('2026-05-14T12:00:00Z'),
        ended_at: new Date('2026-05-14T12:15:00Z'),
      },
    ]
  }

  return makeState(players, rounds.length, rounds)
}

// ── Group A: board fill ───────────────────────────────────────────────────────

describe('A: board fill — 40-player / 6-court pool', () => {
  let stressedState: SessionState

  beforeAll(() => {
    stressedState = buildStressedState()
  }, 30_000)

  it('A1: suggestNextRound fills full 6-court board when given 2000ms budget (no NO_VALID_MATCH)', () => {
    // Lock both board quality and the operational wall-clock gate.
    const diagnostics: SuggestionDiagnostic = {
      strategies: {},
      partition_count: 0,
      max_iterations: 0,
      exhaustive: false,
    }
    const instrumentEvents: EngineInstrumentEvent[] = []
    const startedAt = performance.now()
    const result = suggestNextRound(stressedState, {
      search_budget: createSearchBudget(200_000),
      diagnostics,
      onInstrumentEvent: event => instrumentEvents.push(event),
    })
    const elapsedMs = performance.now() - startedAt

    if (result.alternatives.length === 0) {
      console.info('[cap2-a1-diagnostics]', JSON.stringify({ elapsedMs, diagnostics, instrumentEvents }, null, 2))
    }

    expect(result.alternatives.length).toBeGreaterThan(0)

    const top = result.alternatives[0]
    expect(top.matches.length).toBe(COURTS)
    const selectedIds = top.matches.flatMap(match => [...match.team_a, ...match.team_b])
    expect(new Set(selectedIds).size).toBe(selectedIds.length)
    expect(top.warnings ?? []).not.toContain('NO_VALID_MATCH')
    expect(elapsedMs).toBeLessThan(2000)
  })

  it('A2: cap-2 recovery (count=2 repeated) fills all 6 courts with zero double-booking', () => {
    const state = stressedState
    const roundNo = state.current_round
    const suggestedRows: SessionLiveMatchRow[] = []
    const allPayloads: SuggestedMatchPayload[] = []

    // Production cap-2: repeat until board is full (max 10 iterations safety)
    for (let call = 0; allPayloads.length < COURTS && call < 10; call++) {
      const liveMatchRowsOverride = suggestedRows.map(row => ({
        ...row,
        suggested_at: new Date().toISOString(),
      }))

      for (const row of liveMatchRowsOverride) {
        expect(row.status).toBe('suggested')
      }

      const newPayloads = buildSuggestedMatchPayloads({
        count: 2,
        sessionId: SESSION_ID,
        courtCount: COURTS,
        state,
        rows: { liveMatchRows: liveMatchRowsOverride, liveStateVersion: null },
        completingLiveMatchIds: new Set(),
        fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
        fairnessWarnings: [],
        playersById: PLAYERS_BY_ID,
        pvnaTolerance: 0.5,
        options: { liveMatchRowsOverride },
      })

      expect(newPayloads.length).toBeGreaterThan(0)

      const baseSeq = suggestedRows.length
      for (const [i, payload] of newPayloads.entries()) {
        suggestedRows.push(payloadToSuggestedRow(payload, baseSeq + i, roundNo))
      }
      allPayloads.push(...newPayloads)
    }

    expect(allPayloads.length).toBe(COURTS)
    expect(verifyNoDoubleBook(suggestedRows)).toEqual([])
  })
})

// ── Group B: repairState clone-safety ─────────────────────────────────────────

describe('B: repairState clone-safety — baseBusyIds does not mutate original state', () => {
  it('B1: checked_out_at values of original state.players are unchanged after buildSuggestedMatchPayloads with override rows', () => {
    const state = makeState(ROSTER.map(makePlayer), 0, [])

    // Record the original checked_out_at for all players before the call
    const snapshotBefore = new Map(
      [...state.players.entries()].map(([id, p]) => [id, p.checked_out_at]),
    )

    // Override rows with 2 courts occupied — these become baseBusyIds inside the engine,
    // triggering the repairState player-marking code path we added.
    const suggestedAt = new Date().toISOString()
    const overrideRows: SessionLiveMatchRow[] = [
      {
        id: 'ov-0', session_id: SESSION_ID, sequence_no: 0, round_no: 0,
        court_idx: 0, status: 'suggested',
        team_a: ['P12', 'P8'], team_b: ['P30', 'P40'],
        resting: [], score_a: 0, score_b: 0,
        suggested_at: suggestedAt, started_at: null, ended_at: null,
      },
      {
        id: 'ov-1', session_id: SESSION_ID, sequence_no: 1, round_no: 0,
        court_idx: 1, status: 'suggested',
        team_a: ['P26', 'P7'], team_b: ['P32', 'P13'],
        resting: [], score_a: 0, score_b: 0,
        suggested_at: suggestedAt, started_at: null, ended_at: null,
      },
    ]

    buildSuggestedMatchPayloads({
      count: 2,
      sessionId: SESSION_ID,
      courtCount: COURTS,
      state,
      rows: { liveMatchRows: overrideRows, liveStateVersion: null },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: PLAYERS_BY_ID,
      pvnaTolerance: 0.5,
      options: { liveMatchRowsOverride: overrideRows },
    })

    // The engine must not have modified player objects in the original state
    for (const [id, before] of snapshotBefore) {
      const player = state.players.get(id)
      expect(player?.checked_out_at).toBe(before)
    }
  })

  it('B2: state.players Map reference itself is not replaced by buildSuggestedMatchPayloads', () => {
    const state = makeState(ROSTER.map(makePlayer), 0, [])
    const originalPlayersRef = state.players

    const suggestedAt = new Date().toISOString()
    const overrideRows: SessionLiveMatchRow[] = [
      {
        id: 'ov-0', session_id: SESSION_ID, sequence_no: 0, round_no: 0,
        court_idx: 0, status: 'suggested',
        team_a: ['P12', 'P8'], team_b: ['P30', 'P40'],
        resting: [], score_a: 0, score_b: 0,
        suggested_at: suggestedAt, started_at: null, ended_at: null,
      },
    ]

    buildSuggestedMatchPayloads({
      count: 2,
      sessionId: SESSION_ID,
      courtCount: COURTS,
      state,
      rows: { liveMatchRows: overrideRows, liveStateVersion: null },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: PLAYERS_BY_ID,
      pvnaTolerance: 0.5,
      options: { liveMatchRowsOverride: overrideRows },
    })

    // The Map object identity on the caller's state must not have changed
    expect(state.players).toBe(originalPlayersRef)
  })
})
