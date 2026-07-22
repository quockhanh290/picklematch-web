/**
 * Contract tests for the "start suggested live match" server gate.
 *
 * Root cause under test: the RPC rejects a start with 'Session changed' whenever
 * live_state_version advanced — even when the advance came from an unrelated
 * preview re-persist and the specific match/court/players are still perfectly
 * valid. In a rolling multi-court session that version churns constantly, so
 * legitimate starts get bounced and the host is forced to refresh.
 *
 * The gate's SPECIFIC checks (status='suggested', players available, no player in
 * another live match / already played this round, court free) — run under a
 * `for update` row lock — already guarantee correctness. The coarse version CAS
 * adds no safety, only false positives.
 *
 * These tests assert the intended contract. Mirrors the SQL RPC via startGateModel.
 */
import {
  evaluateStartGate,
  evaluateCompleteGate,
  evaluateCancelGate,
  evaluateStartFromPayloadGate,
  type StartGateInput,
  type StartGatePlayerState,
  type MatchActionGateInput,
  type StartPayloadGateInput,
} from './startGateModel'

const HOST = 'host-1'
const AVAILABLE: StartGatePlayerState = { present: true, checkedOut: false, optedRest: false }

function baseInput(overrides: Partial<StartGateInput> = {}): StartGateInput {
  const players = ['p1', 'p2', 'p3', 'p4']
  return {
    callerId: HOST,
    hostId: HOST,
    expectedVersion: 10,
    currentVersion: 10,
    match: { id: 'm1', status: 'suggested', court_idx: 2, round_no: 3, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
    playerStates: Object.fromEntries(players.map((id) => [id, AVAILABLE])),
    liveMatches: [],
    ...overrides,
  }
}

describe('start gate — happy path', () => {
  it('allows a valid start when versions match', () => {
    expect(evaluateStartGate(baseInput())).toEqual({ ok: true })
  })

  // THE BUG-FIX ASSERTION: a preview re-persist on another court bumped the
  // session version from 10 → 13, but this suggested match, its court, and its
  // players are all still free. The start MUST succeed, not report 'Session changed'.
  it('allows a start when live_state_version advanced but match/court/players are still valid', () => {
    const input = baseInput({ expectedVersion: 10, currentVersion: 13 })
    expect(evaluateStartGate(input)).toEqual({ ok: true })
  })
})

describe('start gate — real conflicts still rejected (safety preserved without the CAS)', () => {
  it('rejects when the caller is not the host', () => {
    expect(evaluateStartGate(baseInput({ callerId: 'someone-else' }))).toEqual({
      ok: false, error: 'Only the host can start live match',
    })
  })

  it('rejects when the target match no longer exists', () => {
    expect(evaluateStartGate(baseInput({ match: null }))).toEqual({ ok: false, error: 'Live match not found' })
  })

  it('rejects when the match was already started or cancelled (not suggested)', () => {
    const input = baseInput()
    input.match!.status = 'live'
    expect(evaluateStartGate(input)).toEqual({ ok: false, error: 'Only suggested matches can be started' })
  })

  it('rejects when a player checked out', () => {
    const input = baseInput()
    input.playerStates.p3 = { present: true, checkedOut: true, optedRest: false }
    expect(evaluateStartGate(input)).toEqual({ ok: false, error: 'Live match must use available checked-in players' })
  })

  // Critical: even when the version ALSO advanced, a genuine double-book (a player
  // now in a live match on another court) is still caught by the specific check —
  // proving the coarse CAS is redundant for safety.
  it('rejects a player already in another live match, even when version advanced', () => {
    const input = baseInput({
      expectedVersion: 10,
      currentVersion: 12,
      liveMatches: [
        { id: 'm2', status: 'live', court_idx: 0, round_no: 3, team_a: ['p1', 'px'], team_b: ['py', 'pz'] },
      ],
    })
    expect(evaluateStartGate(input)).toEqual({
      ok: false, error: 'A player is already in a live match or already played in this round',
    })
  })

  it('rejects when the court already has a live match', () => {
    const input = baseInput({
      liveMatches: [
        { id: 'm3', status: 'live', court_idx: 2, round_no: 3, team_a: ['pa', 'pb'], team_b: ['pc', 'pd'] },
      ],
    })
    expect(evaluateStartGate(input)).toEqual({ ok: false, error: 'Court already has a live match' })
  })
})

function actionInput(overrides: Partial<MatchActionGateInput> = {}): MatchActionGateInput {
  return {
    callerId: HOST,
    hostId: HOST,
    expectedVersion: 10,
    currentVersion: 10,
    match: { id: 'm1', status: 'live' },
    ...overrides,
  }
}

describe('complete gate', () => {
  it('allows completing a live match when versions match', () => {
    expect(evaluateCompleteGate(actionInput())).toEqual({ ok: true })
  })

  // BUG-FIX: version churned from an unrelated court; completing this live match must still work.
  it('allows completing when live_state_version advanced (unrelated churn)', () => {
    expect(evaluateCompleteGate(actionInput({ expectedVersion: 10, currentVersion: 17 }))).toEqual({ ok: true })
  })

  it('rejects a non-host', () => {
    expect(evaluateCompleteGate(actionInput({ callerId: 'x' }))).toEqual({
      ok: false, error: 'Only the host can complete live match',
    })
  })

  it('rejects completing a match that is not live (idempotent double-submit), even when version advanced', () => {
    expect(evaluateCompleteGate(actionInput({ currentVersion: 17, match: { id: 'm1', status: 'completed' } }))).toEqual({
      ok: false, error: 'Only live matches can be completed',
    })
  })

  it('rejects when the match is missing', () => {
    expect(evaluateCompleteGate(actionInput({ match: null }))).toEqual({ ok: false, error: 'Live match not found' })
  })
})

describe('cancel gate', () => {
  it('allows cancelling a suggested match when versions match', () => {
    expect(evaluateCancelGate(actionInput({ match: { id: 'm1', status: 'suggested' } }))).toEqual({ ok: true })
  })

  // BUG-FIX: version churned; cancelling this suggested/live match must still work.
  it('allows cancelling when live_state_version advanced (unrelated churn)', () => {
    expect(evaluateCancelGate(actionInput({ expectedVersion: 10, currentVersion: 21, match: { id: 'm1', status: 'live' } }))).toEqual({ ok: true })
  })

  it('rejects cancelling an already-completed match, even when version advanced', () => {
    expect(evaluateCancelGate(actionInput({ currentVersion: 21, match: { id: 'm1', status: 'completed' } }))).toEqual({
      ok: false, error: 'Only suggested/live matches can be cancelled',
    })
  })

  it('rejects a non-host', () => {
    expect(evaluateCancelGate(actionInput({ callerId: 'x' }))).toEqual({
      ok: false, error: 'Only the host can cancel live match',
    })
  })
})

function payloadInput(overrides: Partial<StartPayloadGateInput> = {}): StartPayloadGateInput {
  const players = ['p1', 'p2', 'p3', 'p4']
  return {
    callerId: HOST,
    hostId: HOST,
    expectedVersion: 10,
    currentVersion: 10,
    isClientPreviewStart: true,
    previewVersion: 10,
    previewCountableCount: 5,
    currentCountableCount: 5,
    matchPlayers: players,
    playerStates: Object.fromEntries(players.map((id) => [id, AVAILABLE])),
    liveMatches: [],
    courtIdx: 2,
    ...overrides,
  }
}

describe('start-from-payload gate', () => {
  it('allows a valid start when versions match', () => {
    expect(evaluateStartFromPayloadGate(payloadInput())).toEqual({ ok: true })
  })

  // BUG-FIX: version advanced (completion / new preview elsewhere) but no players were freed
  // by a cancellation — the countable count is unchanged, so the start must succeed.
  it('allows a start when version advanced but countable match count is unchanged', () => {
    expect(evaluateStartFromPayloadGate(payloadInput({
      previewVersion: 10, currentVersion: 14, previewCountableCount: 5, currentCountableCount: 5,
    }))).toEqual({ ok: true })
  })

  // Legit stale: a match was cancelled after the preview (countable dropped 5 -> 4), which
  // freed players the preview didn't account for. This SHOULD still be rejected.
  it('rejects as stale when the countable match count decreased (a cancellation freed players)', () => {
    expect(evaluateStartFromPayloadGate(payloadInput({
      previewVersion: 10, currentVersion: 14, previewCountableCount: 5, currentCountableCount: 4,
    }))).toEqual({ ok: false, error: 'Preview is stale' })
  })

  it('rejects a player already in a live match, even when version advanced', () => {
    expect(evaluateStartFromPayloadGate(payloadInput({
      currentVersion: 14,
      liveMatches: [{ id: 'm2', status: 'live', court_idx: 0, round_no: 3, team_a: ['p1', 'px'], team_b: ['py', 'pz'] }],
    }))).toEqual({ ok: false, error: 'A player is already in a live match' })
  })

  it('rejects when the court already has a live match', () => {
    expect(evaluateStartFromPayloadGate(payloadInput({
      liveMatches: [{ id: 'm3', status: 'live', court_idx: 2, round_no: 3, team_a: ['pa', 'pb'], team_b: ['pc', 'pd'] }],
    }))).toEqual({ ok: false, error: 'Court already has a live match' })
  })

  it('rejects a non-host', () => {
    expect(evaluateStartFromPayloadGate(payloadInput({ callerId: 'x' }))).toEqual({
      ok: false, error: 'Only the host can start live match',
    })
  })
})
