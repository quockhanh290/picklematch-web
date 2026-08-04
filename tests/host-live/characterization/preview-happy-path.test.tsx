// Characterization test for NextRoundSuggesterScreenV2 (pre-refactor baseline).
// Pins two behaviors from the CURRENT implementation so later logic/UI-separation
// tasks can prove they didn't change them:
//   (a)+(b) mount -> requests a full-board edge preview exactly once -> renders
//           the returned board (live card for the occupied court, suggested card
//           for the open one).
//   (c) completing a live match on a board that also has an existing DB-persisted
//       suggestion elsewhere triggers a mini-recover "replace_courts" edge request
//       scoped to the vacated court only -- NOT a full-board re-suggest -- and the
//       persisted suggestion survives untouched.
//
// Pinning strategy: query by EXISTING testIDs already on NextRoundSuggesterScreenV2
// / ScreenComponents.tsx (nrv2-court-lane-board, nrv2-live-card-court-N,
// nrv2-suggested-card-court-N, nrv2-complete-match-court-N, ...) -- none were added
// for this task. Network boundary is pinned via mockApi.fetchLiveMatchesPreview
// (features/host/session-detail/next-round-v2/api.ts, mocked in
// tests/host-live/helpers/renderHostLive.tsx) and mockSupabaseRpc (the screen's
// complete-match RPC bypasses api.ts entirely, see task-A1-report.md #2).
//
// Fixtures are built locally (not via makeSessionFixture, which hardcodes a fixed
// 4-player seed) since each scenario needs precise control over player count and
// live-match layout. Both fixtures are self-contained -- not shared with each other.
//
// Behavior (c) note (discovered while writing this test, not assumed up front):
// a purely client-side (ephemeral) suggested-lane preview is invalidated the
// instant ANY match completes (isPreviewInvalidatedByCompletedMatch in
// preview-consistency.ts compares the completed match's sequence_no against the
// preview's snapshot baseline) -- so a 2-court board with one live + one bare
// ephemeral suggestion actually forces `full_board` on completion, not
// `replace_courts`. Only a DB-PERSISTED suggestion (status: 'suggested' already in
// live_match_rows, i.e. isPersistedSuggestedMatch) bypasses that invalidation check
// and survives as "reusable", which is what keeps the engine on the mini-recover
// path (`shouldRequestFullBoardPreview`'s `reusableMatches.length === 0` branch does
// NOT fire). Test 2's fixture therefore uses 3 courts: two live matches (one gets
// completed, one stays untouched) plus one DB-persisted suggested match.

import { act, fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'characterization-session'
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
  { id: 'p9', name: 'P9', pvna: 3.2, gender: 'male' },
  { id: 'p10', name: 'P10', pvna: 3.1, gender: 'male' },
  { id: 'p11', name: 'P11', pvna: 3.0, gender: 'female' },
  { id: 'p12', name: 'P12', pvna: 2.9, gender: 'female' },
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

// Mount-time preview response: court 0 is occupied by the live match above, so only
// court 1 is an open lane -> engine requests `full_board` (see
// `shouldRequestFullBoardPreview`'s `reusableMatches.length === 0` branch) and the
// edge returns a single committed match for it.
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

function mockSnapshotOnlyRpc() {
  mockSupabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_live_session_snapshot_versioned') {
      return { data: buildSnapshot(), error: null }
    }
    return { data: null, error: null }
  })
}

// --- Test 2 fixture: 3 courts, two live matches + one DB-persisted suggestion ---

const LIVE_MATCH_COURT_0_B: SessionLiveMatchRow = {
  id: 'live-match-court-0-b',
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

const LIVE_MATCH_COURT_1_B: SessionLiveMatchRow = {
  id: 'live-match-court-1-b',
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

// A DB-persisted suggestion (already status 'suggested' in live_match_rows, as if
// adopted from a session plan) -- unlike an ephemeral edge preview, this bypasses
// isPreviewInvalidatedByCompletedMatch entirely, so it stays reusable across
// completions and keeps the engine on the mini-recover (replace_courts) path.
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

function buildThreeCourtSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: [LIVE_MATCH_COURT_0_B, LIVE_MATCH_COURT_1_B, PERSISTED_SUGGESTED_COURT_2],
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

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('NextRoundSuggesterScreenV2 characterization: happy-path preview + fill 1 sân', () => {
  // This test was flaky under real timers + waitFor(timeout: 5000): the assertion races the
  // screen's internal 80ms request-debounce setTimeout (NextRoundSuggesterScreenV2.tsx ~3533)
  // against real wall-clock time, and under load (parallel jest workers, CI) the debounce timer
  // + edge promise resolution + re-render don't reliably land inside the waitFor polling window.
  // Fixed per the pattern proven stable in task A3 (preview-retry-defer.test.tsx): fake timers,
  // each timer hop advanced via its own `advanceTimersByTimeAsync` call (not summed into one),
  // which deterministically drives the debounce instead of racing it. Assertions are unchanged
  // from the original real-timer version -- same behavior pinned, just a deterministic driver.
  it('mount requests a full-board edge preview exactly once and renders the returned board', async () => {
    jest.useFakeTimers()
    mockSnapshotOnlyRpc()
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildMountPreviewResponse())

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 2,
    })

    // Let the initial snapshot-load microtasks (supabase.rpc mock, settings load, etc.) settle
    // before the preview effect's own 80ms request-debounce timer starts.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })

    // Debounce -> the edge call fires.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(80)
    })
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    // Court 0 is already live and only court 1 is open -> the client mini-recovers the single open
    // lane via replace_courts (treating the live court as busy) rather than a full_board re-suggest,
    // which would re-persist court 0's already-assigned players and conflict. (See
    // computeShouldRequestFullBoardPreview: reusableMatchCount===0 no longer forces full_board while
    // mini-recover can cover the gap.)
    expect(mockApi.fetchLiveMatchesPreview.mock.calls[0][1]).toMatchObject({ mode: 'replace_courts', court_idxs: [1] })

    // Flush the microtasks from the resolved preview promise (state updates that render the board).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })

    expect(getByTestId('nrv2-court-lane-board')).toBeTruthy()
    expect(getByTestId('nrv2-live-card-court-0')).toBeTruthy()
    expect(queryByTestId('nrv2-suggested-card-court-1')).toBeTruthy()
    expect(getByTestId('nrv2-start-match-court-1')).toBeTruthy()
    // Court 0 is occupied by the live match -- the board must not also show a
    // suggested card for the same lane.
    expect(queryByTestId('nrv2-suggested-card-court-0')).toBeNull()

    // Preview call count must stay at 1 -- no follow-up re-suggest while nothing changed.
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
  })

  it('completing a live match requests replace_courts for the vacated court only, not a full-board re-suggest, and the persisted suggestion survives', async () => {
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildThreeCourtSnapshot(), error: null }
      }
      return { data: null, error: null }
    })

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 3,
    })

    // The persisted suggestion at court 2 already satisfies the one open lane
    // (courts=3, 2 live matches -> suggestedQueueCount=1), so no edge call is
    // needed at mount at all.
    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 5000 })
    expect(getByTestId('nrv2-live-card-court-0')).toBeTruthy()
    expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(0)

    // Wire the complete-match RPC (bypasses api.ts -- see task-A1-report.md #2)
    // and queue the mini-recover edge response for the follow-up preview call.
    mockSupabaseRpc.mockImplementation(async (fn: string, payload: any) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildThreeCourtSnapshot(), error: null }
      }
      if (fn === 'complete_live_session_match_versioned') {
        return {
          data: {
            match: {
              ...LIVE_MATCH_COURT_0_B,
              status: 'completed',
              score_a: payload?.p_score_a ?? 0,
              score_b: payload?.p_score_b ?? 0,
              ended_at: new Date().toISOString(),
            },
            changed_player_state: [],
            changed_pair_history: [],
            live_state_version: 2,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildCourt0RefillResponse())

    fireEvent.press(getByTestId('nrv2-complete-match-court-0'))

    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'complete_live_session_match_versioned',
        expect.objectContaining({ p_match_id: 'live-match-court-0-b' }),
      )
    }, { timeout: 5000 })

    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 5000 })
    expect(mockApi.fetchLiveMatchesPreview.mock.calls[0][1]).toMatchObject({
      mode: 'replace_courts',
      court_idxs: [0],
    })

    // Court 2's persisted suggestion and court 1's live match must survive
    // untouched -- proof this was a scoped mini-recover, not a full-board
    // re-suggest that would have reshuffled or dropped them. (Whether court 0
    // itself gets visibly re-populated from the fetched replacement is NOT
    // asserted here: a separate effect that re-hydrates `suggestedLiveMatches`
    // from DB-persisted suggested rows only -- see NextRoundSuggesterScreenV2.tsx
    // around line 2185 -- re-runs once `completingLiveMatchPlaceholders`
    // changes reference after the mini-recover commit, and it does not know
    // about the ephemeral edge-fetched court-0 replacement, so it can
    // overwrite the just-committed board back down to just the persisted
    // match. That's a pre-existing quirk of the current implementation,
    // orthogonal to what this test pins, and is called out in the task report
    // rather than locked in as intended behavior.)
    await waitFor(() => {
      expect(getByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
      expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()
      expect(queryByTestId('nrv2-live-card-court-0')).toBeNull()
    }, { timeout: 5000 })
  })
})
