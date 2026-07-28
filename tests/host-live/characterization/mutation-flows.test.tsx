// Characterization tests for NextRoundSuggesterScreenV2 (pre-refactor baseline).
// Pins the CURRENT start / complete / cancel mutation flows -- the exact I/O boundary
// each hits, the request payload shape, and the optimistic UI transition -- so task E2
// (extracting usePreviewOrchestrator, which these three handlers reach into heavily per
// task-D2-report.md) has a safety net proving it didn't change observable behavior.
//
// Real mutation entry points (confirmed against source, not the brief's assumed names --
// see task-A1-report.md #1 and task-D2-report.md):
//   - START: NextRoundSuggesterScreenV2.tsx's `startLiveMatch` (~line 978), wired as
//     `onStartMatch={startLiveMatch}` on CourtLaneLiveMatchBoard (the ACTUALLY-rendered
//     board component -- see task-A2-report.md's dead-code note on the sibling
//     `LiveMatchBoard`). It goes through `useStartMatchMutation` (next-round-v2/mutations.ts),
//     which calls `startPersistedLiveMatch(sessionId, edgePayload)` (next-round-v2/api.ts) when
//     the pressed match's `preview_source` is server-persisted (`edge_committed` / `session_plan`
//     -- see `isServerPersistedPreviewSource`, preview-consistency.ts). A match that came from a
//     committed `full_board` edge response (this file's fixture) is stamped `edge_committed`
//     (NextRoundSuggesterScreenV2.tsx ~line 3182), so `startPersistedLiveMatch` is the path
//     actually exercised here, not the sibling `persistAndStartLiveMatch`.
//   - COMPLETE: `completeLiveMatch` (~line 1433), wired as `onCompleteMatch`. Calls
//     `useCompleteMatchMutation` (mutations.ts), which bypasses api.ts entirely and calls
//     `supabase.rpc('complete_live_session_match_versioned', rpcPayload)` directly (confirmed
//     in task-A1-report.md #2 and task-A2-report.md).
//   - CANCEL: `cancelLiveMatch` (~line 1727), wired as `onCancelMatch`. Also bypasses api.ts:
//     calls `supabase.rpc('cancel_live_session_match_versioned', {...})` directly.
//
// Pinning strategy: same two-tier mock boundary as A1/A2/A3 (mockApi + mockSupabaseRpc via
// renderHostLive.tsx). All three flows are reachable from real, EXISTING testIDs -- no new
// testIDs were added for this task:
//   - start: `nrv2-start-match-court-N` (SuggestedMatchTile, ScreenComponents.tsx ~2531)
//   - complete: `nrv2-complete-match-court-N` (LiveMatchScoreBoard, ~2684)
//   - cancel: `nrv2-cancel-live-court-N` (LiveMatchScoreBoard, ~2661) -- this one is NOT in the
//     brief's testID list, but it exists on the actually-rendered component; found by reading
//     LiveMatchScoreBoard directly rather than assuming a coarser pin was needed.
//
// Optimistic-transition pinning: all three handlers flip a "busy" ref/state SYNCHRONOUSLY
// (before their first `await`), so the pressed button's `disabled` prop already reflects the
// optimistic busy state by the time `fireEvent.press` returns (RTL wraps dispatch in `act`,
// which flushes that synchronous state update). To observe it before the mutation resolves
// (rather than racing straight to the post-resolve render), each test holds the mocked
// RPC/API call open with a manually-resolved deferred promise, asserts the transient busy
// state, then resolves and asserts the settled state.
//
// START test uses fake timers (empirically required, unlike complete/cancel below): under
// real timers, the gap between the mount-time `waitFor` resolving and the `fireEvent.press`
// a few lines later is real wall-clock time, long enough for the screen's own preview-effect
// machinery to run a SECOND cycle in the background (confirmed via the mocked
// `recordClientSessionAuditEvent` trace calls -- `request_serial` had already advanced past
// the mount request's serial by the time of press, and a `client_start_blocked_untrusted_preview`
// / `preview_not_committed` block followed because that second cycle's response -- the shared
// default `fetchLiveMatchesPreview` mock, not this test's `mockResolvedValueOnce` -- nulled
// `suggestedPreviewBatchRef` before the pressed match could be validated as committed). Freezing
// time with `jest.useFakeTimers()` and only advancing the exact hops this test needs (mirroring
// the A3 pattern in preview-retry-defer.test.tsx) prevents that background cycle from ever
// running, which is what actually stabilizes this test -- not a coincidence of timeout tuning.
// complete/cancel don't have this problem: their fixtures start with the board already full
// (no open lane for the preview machinery to chase), so no background cycle competes with the press.

import { act, fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'characterization-mutation-session'
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

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('NextRoundSuggesterScreenV2 characterization: start mutation flow', () => {
  // Mount fixture identical in shape to preview-happy-path.test.tsx test 1 (2 courts, court 0
  // already live, court 1 an open lane the edge fills via a committed full_board response) --
  // this is the simplest real path that produces a match with preview_source: 'edge_committed',
  // which is required for `isCommittedEdgeStart` to pass and the press to not get blocked as
  // "preview_not_committed" (NextRoundSuggesterScreenV2.tsx ~line 1017).
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

  function buildMountPreviewResponse() {
    return {
      ok: true as const,
      live_state_version: 1,
      live_state_version_used: 1,
      payloads: [] as unknown[],
      final_preview_board: [
        {
          id: 'edge-court-1-match',
          session_id: SESSION_ID,
          sequence_no: 1,
          round_no: 1,
          court_idx: 1,
          status: 'suggested' as const,
          team_a: ['p5', 'p6'],
          team_b: ['p7', 'p8'],
          resting: [] as string[],
          score_a: 0,
          score_b: 0,
          suggested_at: CHECKED_IN_AT,
          started_at: null,
          ended_at: null,
          preview_live_state_version: 1,
          preview_countable_match_count: 0,
          warnings: [] as string[],
          tradeoffs: [] as unknown[],
          approval_required: false,
          configured_pvna_tolerance: 0.5,
          effective_pvna_tolerance: 0.5,
        },
      ],
    }
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it('pressing start disables the button immediately, calls startPersistedLiveMatch with the committed preview payload exactly once, and promotes the card to live on success', async () => {
    jest.useFakeTimers()
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildSnapshot(), error: null }
      }
      return { data: null, error: null }
    })
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildMountPreviewResponse())

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 2,
    })

    // Mount -> 80ms request debounce -> committed full-board response (same driver as
    // preview-happy-path.test.tsx's mount test). Kept under fake timers, and the button is
    // pressed with NO further time advance in between, so no background preview cycle
    // (retry/poll) can run and invalidate the just-committed batch before the press lands.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(80)
    })
    expect(queryByTestId('nrv2-start-match-court-1')).toBeTruthy()
    // Sanity: not busy/disabled before anything is pressed.
    expect(getByTestId('nrv2-start-match-court-1').props.accessibilityState.disabled).toBeFalsy()

    const deferredStart = makeDeferred<{ match: SessionLiveMatchRow; live_state_version: number }>()
    mockApi.startPersistedLiveMatch.mockReturnValueOnce(deferredStart.promise)

    fireEvent.press(getByTestId('nrv2-start-match-court-1'))

    // Optimistic: startingPreviewIds gets the match id synchronously (before the mutation's
    // first await), so the button is already disabled by the time fireEvent.press returns --
    // no timer advance needed to observe this part.
    expect(getByTestId('nrv2-start-match-court-1').props.accessibilityState.disabled).toBe(true)

    // The handler's next step (`await waitForUiFrame()`) is a requestAnimationFrame hop, then
    // a promise-queue chain before the mutation actually fires -- flush that before asserting
    // the call landed.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50)
    })

    expect(mockApi.startPersistedLiveMatch).toHaveBeenCalledTimes(1)
    expect(mockApi.startPersistedLiveMatch.mock.calls[0][0]).toBe(SESSION_ID)
    expect(mockApi.startPersistedLiveMatch.mock.calls[0][1]).toMatchObject({
      expected_live_state_version: 1,
      match_id: 'edge-court-1-match',
      audit_payload: expect.objectContaining({
        source: 'client-preview-start-persisted-live-match',
        preview_id: 'edge-court-1-match',
        preview_live_state_version: 1,
        preview_countable_match_count: 0,
        expected_round_matches: 2,
      }),
    })

    deferredStart.resolve({
      match: {
        id: 'live-match-court-1',
        session_id: SESSION_ID,
        sequence_no: 1,
        round_no: 1,
        court_idx: 1,
        status: 'live',
        team_a: ['p5', 'p6'],
        team_b: ['p7', 'p8'],
        resting: [],
        score_a: 0,
        score_b: 0,
        suggested_at: CHECKED_IN_AT,
        started_at: CHECKED_IN_AT,
        ended_at: null,
      },
      live_state_version: 2,
    })

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })

    expect(queryByTestId('nrv2-live-card-court-1')).toBeTruthy()
    expect(queryByTestId('nrv2-suggested-card-court-1')).toBeNull()
    expect(queryByTestId('nrv2-start-match-court-1')).toBeNull()
    // Started exactly once -- no duplicate start on the same press.
    expect(mockApi.startPersistedLiveMatch).toHaveBeenCalledTimes(1)
  }, 25000)
})

describe('NextRoundSuggesterScreenV2 characterization: complete mutation flow', () => {
  // 3-court / 2-live + 1-DB-persisted-suggestion fixture -- deliberately the SAME shape as
  // preview-happy-path.test.tsx test 2 (task A2), which is the proven-stable way to get this
  // screen to settle the completed court's card back down to nothing after completion. A
  // simpler 1-court/no-replacement fixture was tried first and found NOT to settle within 5s:
  // without a real replacement match landing at the vacated court, `completingLiveMatchIds` /
  // `creatingNextMatchIds` (which keep the court's live card counted as "active" per
  // `activeLiveMatches`'s filter, NextRoundSuggesterScreenV2.tsx ~1826) never get cleared --
  // that clearing is driven by the follow-up preview response's `replacementCourts` actually
  // covering the vacated court (~3200-3220). This is the same "hydrate effect only knows about
  // persisted suggestions" quirk task-A2-report.md flagged as pre-existing and out of scope, not
  // something to characterize as new. This test's OWN characterization additions on top of A2 are:
  // (1) the transient optimistic busy/disabled state before the RPC resolves (A2 didn't pin this),
  // and (2) the FULL rpcPayload shape (A2 only pinned `p_match_id`).
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
  const LIVE_MATCH_COURT_1: SessionLiveMatchRow = {
    id: 'live-match-court-1',
    session_id: SESSION_ID,
    sequence_no: 1,
    round_no: 0,
    court_idx: 1,
    status: 'live',
    team_a: ['p5', 'p6'],
    team_b: ['p7', 'p8'],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: CHECKED_IN_AT,
    started_at: CHECKED_IN_AT,
    ended_at: null,
  }
  // DB-persisted suggestion (status already 'suggested' in live_match_rows) -- bypasses
  // isPreviewInvalidatedByCompletedMatch, so it survives completion and the engine takes the
  // mini-recover (replace_courts) path instead of a full-board re-suggest (see A2's header note).
  const PERSISTED_SUGGESTED_COURT_2: SessionLiveMatchRow = {
    id: 'persisted-suggested-court-2',
    session_id: SESSION_ID,
    sequence_no: 2,
    round_no: 1,
    court_idx: 2,
    status: 'suggested',
    team_a: ['p9', 'p10'],
    team_b: ['p11', 'p12'],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: CHECKED_IN_AT,
    started_at: null,
    ended_at: null,
  }

  function buildSnapshot() {
    return {
      live_state_version: 1,
      player_rows: SEEDS.map(buildPlayerStateRow),
      registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
      pair_rows: [],
      round_rows: [],
      live_match_rows: [LIVE_MATCH_COURT_0, LIVE_MATCH_COURT_1, PERSISTED_SUGGESTED_COURT_2],
    }
  }

  function buildCourt0RefillResponse() {
    return {
      ok: true as const,
      live_state_version: 2,
      live_state_version_used: 2,
      payloads: [] as unknown[],
      final_preview_board: [
        {
          id: 'edge-court-0-refill',
          session_id: SESSION_ID,
          sequence_no: 3,
          round_no: 1,
          court_idx: 0,
          status: 'suggested' as const,
          team_a: ['p1', 'p3'],
          team_b: ['p2', 'p4'],
          resting: [] as string[],
          score_a: 0,
          score_b: 0,
          suggested_at: CHECKED_IN_AT,
          started_at: null,
          ended_at: null,
          preview_live_state_version: 2,
          preview_countable_match_count: 1,
          warnings: [] as string[],
          tradeoffs: [] as unknown[],
          approval_required: false,
          configured_pvna_tolerance: 0.5,
          effective_pvna_tolerance: 0.5,
        },
      ],
    }
  }

  it('pressing complete disables the button immediately, sends the full RPC payload shape exactly once, and the card leaves the live lane on success', async () => {
    const deferredComplete = makeDeferred<{ data: unknown; error: null }>()
    mockSupabaseRpc.mockImplementation(async (fn: string, payload: any) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildSnapshot(), error: null }
      }
      if (fn === 'complete_live_session_match_versioned') {
        return deferredComplete.promise
      }
      return { data: null, error: null }
    })

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 3,
    })

    // Court 2's persisted suggestion already fills the one open lane -- no edge call at mount.
    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 10000 })
    expect(getByTestId('nrv2-live-card-court-0')).toBeTruthy()
    expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()
    expect(getByTestId('nrv2-complete-match-court-0').props.accessibilityState.disabled).toBeFalsy()

    // Queue the mini-recover edge response for the follow-up preview call this completion triggers.
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildCourt0RefillResponse())

    fireEvent.press(getByTestId('nrv2-complete-match-court-0'))

    // Optimistic: endingLiveMatchIds gets the match id synchronously (setEndingLiveMatchIds is
    // called before completeLiveMatch's first await), so the button is already disabled -- no
    // need to wait for the (still-pending) RPC to resolve.
    expect(getByTestId('nrv2-complete-match-court-0').props.accessibilityState.disabled).toBe(true)

    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'complete_live_session_match_versioned',
        expect.objectContaining({
          p_session_id: SESSION_ID,
          p_expected_live_state_version: 1,
          p_match_id: 'live-match-court-0',
          p_score_a: 0,
          p_score_b: 0,
          p_score_after: expect.any(Number),
          p_audit_payload: expect.objectContaining({
            sequence_no: 0,
            expected_round_matches: 3,
            source: 'client-direct-complete-live-match',
          }),
        }),
      )
    }, { timeout: 10000 })
    expect(mockSupabaseRpc.mock.calls.filter(call => call[0] === 'complete_live_session_match_versioned')).toHaveLength(1)

    deferredComplete.resolve({
      data: {
        match: { ...LIVE_MATCH_COURT_0, status: 'completed', score_a: 0, score_b: 0, ended_at: new Date().toISOString() },
        changed_player_state: [],
        changed_pair_history: [],
        live_state_version: 2,
      },
      error: null,
    })

    // Same follow-up-request assertion A2 pinned (replace_courts scoped to [0], not full_board),
    // repeated here because it's the mechanism that lets court 0 actually settle in THIS test.
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })
    expect(mockApi.fetchLiveMatchesPreview.mock.calls[0][1]).toMatchObject({
      mode: 'replace_courts',
      court_idxs: [0],
    })

    await waitFor(() => {
      expect(queryByTestId('nrv2-live-card-court-0')).toBeNull()
    }, { timeout: 10000 })
    // Untouched courts survive -- proof this was a scoped completion, not a full reshuffle.
    expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()
    expect(getByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
  }, 25000)
})

describe('NextRoundSuggesterScreenV2 characterization: cancel mutation flow', () => {
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
      player_rows: SEEDS.slice(0, 4).map(buildPlayerStateRow),
      registered_player_rows: SEEDS.slice(0, 4).map(buildRegisteredPlayerRow),
      pair_rows: [],
      round_rows: [],
      live_match_rows: [LIVE_MATCH_COURT_0],
    }
  }

  it('pressing cancel disables the cancel button immediately, calls the cancel RPC exactly once with the expected payload, and clears the live card on success', async () => {
    const deferredCancel = makeDeferred<{ data: unknown; error: null }>()
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildSnapshot(), error: null }
      }
      if (fn === 'cancel_live_session_match_versioned') {
        return deferredCancel.promise
      }
      return { data: null, error: null }
    })
    // Cancelling frees the only court with nothing queued -- harmless non-final-board response
    // for the follow-up re-suggest effect this triggers (setPreviewRefreshNonce in cancelLiveMatch).
    mockApi.fetchLiveMatchesPreview.mockResolvedValue({
      ok: true,
      live_state_version: 2,
      live_state_version_used: 2,
      payloads: [],
    })

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS.slice(0, 4),
      courts: 1,
    })

    await waitFor(() => {
      expect(queryByTestId('nrv2-live-card-court-0')).toBeTruthy()
    }, { timeout: 10000 })
    expect(getByTestId('nrv2-cancel-live-court-0').props.accessibilityState.disabled).toBeFalsy()

    fireEvent.press(getByTestId('nrv2-cancel-live-court-0'))

    // Optimistic: runAction's setBusy(`cancel-match-${id}`) runs synchronously before the RPC
    // await, so cancelBusy flips the button to disabled immediately.
    expect(getByTestId('nrv2-cancel-live-court-0').props.accessibilityState.disabled).toBe(true)

    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'cancel_live_session_match_versioned',
        expect.objectContaining({
          p_session_id: SESSION_ID,
          p_expected_live_state_version: 1,
          p_match_id: 'live-match-court-0',
          p_audit_payload: expect.objectContaining({
            sequence_no: 0,
            source: 'client-direct-cancel-live-match',
          }),
        }),
      )
    }, { timeout: 10000 })
    expect(mockSupabaseRpc.mock.calls.filter(call => call[0] === 'cancel_live_session_match_versioned')).toHaveLength(1)

    deferredCancel.resolve({
      data: {
        match: { ...LIVE_MATCH_COURT_0, status: 'cancelled', ended_at: new Date().toISOString() },
        live_state_version: 2,
      },
      error: null,
    })

    await waitFor(() => {
      expect(queryByTestId('nrv2-live-card-court-0')).toBeNull()
    }, { timeout: 10000 })
  }, 25000)
})
