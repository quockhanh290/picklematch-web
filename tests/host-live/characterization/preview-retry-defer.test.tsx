// Characterization test for NextRoundSuggesterScreenV2 (pre-refactor baseline).
// Pins the CURRENT incomplete-preview retry + block-cooldown behavior so later
// logic/UI-separation tasks can prove they didn't change it:
//   - an edge preview response that never fills the open lane (empty `payloads`,
//     `mode: 'full_board'`) is retried once (~900ms later, `LIVE_PREVIEW_INCOMPLETE_RETRY_MS`)
//   - after the SECOND incomplete result with the same retry key, the client stops
//     spinning and enters a block cooldown -- no further edge calls happen for the
//     rest of that cooldown window
//   - the cooldown eventually lifts (`LIVE_PREVIEW_BLOCKED_RETRY_MS` = 6000ms) and a
//     further call fires, proving the block is a cooldown, not a permanent lockout
//
// Field/behavior confirmed by reading NextRoundSuggesterScreenV2.tsx directly (not
// assumed from the brief):
//   - "incomplete" is NOT a single boolean flag on the response. The client derives
//     `previewBatchComplete` from the edge's *reported* completeness fields when
//     present (`missing_target_courts` / `target_count_shortfall`), falling back to
//     locally recomputing completeness from the returned board otherwise (see
//     ~line 3075-3096, and the mirrored non-final-board branch ~3380-3392). Simplest
//     stable way to force "incomplete" every single retry without touching product
//     code: have the mock resolve to `{ ok: true, payloads: [] }` (no
//     `final_preview_board`) -- the edge genuinely couldn't fill the lane, so
//     `fetchedMatches`/`matches` stay empty and `previewBatchComplete` is false via
//     the local-recompute path every time, with no edge-reported fields to fake.
//   - retry counter state: `previewIncompleteRetryRef.current = { key: retryKey, count }`
//     (~3179-3182 / ~3478-3481). `retryKey` folds in `incompleteRequestKey` (which
//     itself folds in board/version/mode state) plus the *returned* board's court
//     layout. With an always-empty response and an unchanging board (nothing ever
//     gets committed because it's always incomplete), `retryKey` is IDENTICAL across
//     retries, so the counter increments (1, then 2) instead of resetting -- this is
//     the "stable board" precondition flagged by the task brief.
//   - count 1 (first incomplete result) -> `currentRetry < 2` -> schedules a retry via
//     `schedulePreviewRetry('incomplete:...', LIVE_PREVIEW_INCOMPLETE_RETRY_MS, ...)`
//     (900ms), which bumps `previewRefreshNonce` -> re-runs the effect -> after the
//     80ms request debounce, a second edge call fires.
//   - count 2 (second incomplete result, same key) -> `currentRetry < 2` is now false ->
//     `previewBlockedIncompleteKeysRef` gets the key added AND a cooldown retry is
//     scheduled via `LIVE_PREVIEW_BLOCKED_RETRY_MS` (6000ms). While the key is in
//     `previewBlockedIncompleteKeysRef`, the effect's early guard
//     (~line 2566: `if (previewBlockedIncompleteKeysRef.current.has(incompleteRequestKey))`)
//     skips the edge call entirely -- no request happens, not even a debounced one --
//     until the cooldown timer fires, clears the key, bumps a nonce, and lets the
//     cycle repeat.
//
// Pinning strategy: same testID / two-tier mock boundary as A1/A2
// (`renderHostLiveScreen`, `mockApi.fetchLiveMatchesPreview`, `mockSupabaseRpc`).
// Fixture is a self-contained local 2-court / 8-player board (court 0 already live,
// court 1 the one open lane) mirroring A2 test 1's mount scenario, but the edge
// mock always resolves to an empty/incomplete board instead of a real match, so the
// lane can never be filled and the retry/block machinery runs to its cap.
//
// Timers: fake timers (`jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync`),
// not real timers + `waitFor` as in A2. This test counts exact call-count deltas
// across specific millisecond windows ("no call in this 900ms window" is the
// assertion that matters for "block cooldown"), which real timers + polling
// `waitFor` cannot express -- `waitFor` can prove "eventually true" but not "stays
// false for at least N ms". `advanceTimersByTimeAsync` (rather than the sync
// `advanceTimersByTime`) is required because each retry cycle also awaits a real
// Promise chain (`fetchLiveMatchesPreview(...).then(...)`) between timer firings;
// the async variant interleaves timer advancement with microtask flushing so that
// chain actually resolves before the next assertion. No `waitFor` is used anywhere
// in this file specifically to avoid the fake-timers/polling deadlock A1 flagged
// (RTL's `waitFor` schedules its own polling interval, which fake timers would
// otherwise need a competing manual advance to unstick).
//
// Numbers pinned exactly (verified empirically against the running code, not
// guessed from the brief's sketch): mount -> call 1 (after 80ms debounce); +900ms
// (retry delay) +80ms (next debounce) -> call 2; +900ms more -> STILL call 2 (no
// call 3 -- this is the "stops spinning, enters cooldown" assertion); then
// +(6000-900)ms +80ms (rest of the cooldown + next debounce) -> call 3, proving the
// cooldown lifts rather than locking out the lane forever. This is exactly 2 calls
// before the cooldown, not 3 -- the brief's own draft comment ("advance 900ms x2 ->
// 3 calls") was a guess; tracing `previewIncompleteRetryRef`'s count (1 on the
// first incomplete result, 2 on the second) shows the block triggers on the second
// retry's result, i.e. the second edge call already lands inside the cap.

import { act } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'characterization-retry-session'
const CHECKED_IN_AT = '2026-07-27T00:00:00.000Z'

type Seed = { id: string; name: string; pvna: number; gender: 'male' | 'female' }

const SEEDS: Seed[] = [
  { id: 'p1', name: 'P1', pvna: 3.2, gender: 'male' },
  { id: 'p2', name: 'P2', pvna: 3.3, gender: 'male' },
  { id: 'p3', name: 'P3', pvna: 3.1, gender: 'female' },
  { id: 'p4', name: 'P4', pvna: 3.0, gender: 'female' },
  { id: 'p5', name: 'P5', pvna: 3.4, gender: 'male' },
  { id: 'p6', name: 'P6', pvna: 3.5, gender: 'male' },
  { id: 'p7', name: 'P7', pvna: 2.9, gender: 'female' },
  { id: 'p8', name: 'P8', pvna: 2.8, gender: 'female' },
]

function eloFor(pvna: number) {
  return Math.round(pvna * 400)
}

function buildArrangementPlayer(seed: Seed): ArrangementPlayer {
  const elo = eloFor(seed.pvna)
  return {
    id: seed.id,
    name: seed.name,
    elo,
    team: 0,
    reliability: 90,
    levelId: getLevelIdForElo(elo),
    skillTag: 'PVNA',
    gender: seed.gender,
    pvna: seed.pvna,
    status: 'confirmed',
    checkInStatus: 'present',
    metadata: null,
  }
}

function buildPlayerStateRow(seed: Seed): SessionPlayerStateRow {
  const elo = eloFor(seed.pvna)
  return {
    session_id: SESSION_ID,
    player_id: seed.id,
    group_id: null,
    checked_in_at: CHECKED_IN_AT,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: 0,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    players: {
      name: seed.name,
      pvna: seed.pvna,
      current_elo: elo,
      elo,
      gender: seed.gender,
      partner_gender_pref: null,
      opponent_gender_pref: null,
    },
    session_players: { metadata: null },
  }
}

function buildRegisteredPlayerRow(seed: Seed): RegisteredSessionPlayerRow {
  const elo = eloFor(seed.pvna)
  return {
    player_id: seed.id,
    team_no: 0,
    status: 'confirmed',
    check_in_status: 'present',
    metadata: null,
    players: {
      name: seed.name,
      pvna: seed.pvna,
      current_elo: elo,
      elo,
      gender: seed.gender,
      reliability_score: 90,
      sessions_joined: 5,
      no_show_count: 0,
      self_assessed_level: null,
      skill_label: null,
      partner_gender_pref: null,
      opponent_gender_pref: null,
    },
  }
}

const PLAYERS = SEEDS.map(buildArrangementPlayer)

const LIVE_MATCH_COURT_0: SessionLiveMatchRow = {
  id: 'live-match-court-0',
  session_id: SESSION_ID,
  sequence_no: 0,
  round_no: 0,
  court_idx: 0,
  status: 'live',
  team_a: ['p1', 'p2'],
  team_b: ['p3', 'p4'],
  resting: [],
  score_a: 0,
  score_b: 0,
  suggested_at: CHECKED_IN_AT,
  started_at: CHECKED_IN_AT,
  ended_at: null,
}

function buildSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: [LIVE_MATCH_COURT_0],
  }
}

function mockSnapshotOnlyRpc() {
  mockSupabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_live_session_snapshot_versioned') {
      return { data: buildSnapshot(), error: null }
    }
    return { data: null, error: null }
  })
}

// The edge genuinely fails to fill the one open lane (court 1) every single call --
// `live_state_version_used` must match the snapshot's version (1) or the response
// gets discarded as stale (`isPreviewResponseCurrent`) before the incomplete/retry
// logic is ever reached. No `final_preview_board` field -> `edgeReturnedFinalBoard`
// is false -> the client parses `payloads` (empty) -> `matches` stays empty ->
// `previewBatchComplete` is false via the local recompute, every time, with a
// stable retry key (see header comment).
function buildIncompletePreviewResponse() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('NextRoundSuggesterScreenV2 characterization: incomplete preview retry + block cooldown', () => {
  it('retries an unfillable open lane once, then stops spinning and enters a block cooldown, which later lifts', async () => {
    jest.useFakeTimers()
    mockSnapshotOnlyRpc()
    mockApi.fetchLiveMatchesPreview.mockResolvedValue(buildIncompletePreviewResponse())

    const { queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 2,
    })

    // Let the initial snapshot-load microtasks (supabase.rpc mock, settings load,
    // etc.) settle before the preview effect's own 80ms request debounce starts.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })

    // Debounce -> first edge call.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(80)
    })
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    expect(mockApi.fetchLiveMatchesPreview.mock.calls[0][1]).toMatchObject({ mode: 'full_board' })
    // The unfillable lane never renders a suggested card -- it stays open the whole time.
    expect(queryByTestId('nrv2-suggested-card-court-1')).toBeNull()

    // First incomplete result schedules a retry after LIVE_PREVIEW_INCOMPLETE_RETRY_MS
    // (900ms); the retry itself goes through the same 80ms request debounce. These
    // must be two SEPARATE advanceTimersByTimeAsync calls, not one combined
    // advance(980): the fake-timer engine here advances its clock to the full
    // requested target before draining due callbacks, so a timer newly scheduled
    // *during* that drain (the 80ms debounce, scheduled from inside the 900ms
    // retry's callback) is relative to the already-advanced clock, not to "900ms
    // into the original window" -- it needs its own subsequent advance to fire.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(900)
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(80)
    })
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(2)
    expect(mockApi.fetchLiveMatchesPreview.mock.calls[1][1]).toMatchObject({ mode: 'full_board' })

    // Second incomplete result with the same retry key trips the cap: the client
    // enters a block cooldown instead of scheduling another 900ms retry. Advancing
    // another 900ms (the same window that produced call #2 last time) must NOT
    // produce a call #3 -- this is the "stops spinning" characterization.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(900)
    })
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(2)
    expect(queryByTestId('nrv2-suggested-card-court-1')).toBeNull()

    // The cooldown is LIVE_PREVIEW_BLOCKED_RETRY_MS (6000ms) after the block started
    // (i.e. after call #2's response), not a permanent lockout. Advance through the
    // rest of it (900ms of which is already elapsed above), then the next debounce
    // as a SEPARATE advance (same chained-timer reason as above) -- a 3rd call must fire.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000 - 900)
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(80)
    })
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(3)
  })
})
