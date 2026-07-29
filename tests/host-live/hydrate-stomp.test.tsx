// Regression reproduction for the "hydrate-stomp" bug (task FU3 investigation).
//
// BUG: after a live match completes, the preview effect runs a mini-recover
// (`replace_courts` scoped to the vacated court) and commits an EPHEMERAL
// (`edge_committed`, client-only) replacement suggestion for that court into
// `suggestedLiveMatches`. But the separate DB-suggested HYDRATE effect
// (useLiveBoard.ts ~line 1448) rebuilds `suggestedLiveMatches` SOLELY from
// `rows.liveMatchRows` where status==='suggested' (DB-persisted rows only). That
// effect re-fires right after the mini-recover commit because its dep
// `activeLiveMatches` changes reference when the completing court's
// `completingLiveMatchIds` / `creatingNextMatchIds` / `completingLiveMatchPlaceholders`
// get cleared. Since the ephemeral court-0 refill is NOT a DB-persisted row, the
// rebuild (useLiveBoard.ts ~line 1501-1510, which also overwrites
// suggestedLaneCacheRef) drops it -> the just-vacated court shows NO replacement
// suggestion even though the edge returned one.
//
// This mirrors preview-happy-path.test.tsx test 2's fixture EXACTLY (3 courts:
// two live + one DB-persisted suggestion on court 2), but where that
// characterization test deliberately did NOT assert court 0's refill content
// (see its lines 444-454 "pre-existing quirk" note), this test DOES. It therefore
// FAILS on current code, pinning the correct behavior: the mini-recovered court's
// ephemeral suggestion must remain visible.
//
// Constraint (task FU3): this is a TEST-ONLY reproduction. No product code is
// changed. When the hydrate effect is fixed to preserve fresh ephemeral lanes,
// this test should pass.

import { fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from './helpers/renderHostLive'

const SESSION_ID = 'hydrate-stomp-session'
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

// DB-persisted suggestion on court 2 -- survives completion (bypasses
// isPreviewInvalidatedByCompletedMatch) and keeps the engine on the mini-recover
// path. Crucially, its mere presence means the hydrate effect's `hydrated` array
// is non-empty, so the effect does NOT early-return -- it proceeds to overwrite
// `suggestedLiveMatches` with DB rows only, stomping court 0's ephemeral refill.
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

// The mini-recover (replace_courts [0]) edge response: an ephemeral replacement
// suggestion for the just-vacated court 0.
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

describe('hydrate-stomp regression (task FU3)', () => {
  it('keeps the mini-recovered ephemeral suggestion for the just-vacated court visible (not stomped by the DB-suggested hydrate effect)', async () => {
    mockSupabaseRpc.mockImplementation(async (fn: string, payload: any) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildSnapshot(), error: null }
      }
      if (fn === 'complete_live_session_match_versioned') {
        return {
          data: {
            match: {
              ...LIVE_MATCH_COURT_0,
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

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 3,
    })

    // Mount: court 2's persisted suggestion fills the one open lane; no edge call.
    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 5000 })
    expect(getByTestId('nrv2-live-card-court-0')).toBeTruthy()
    expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()

    // Queue the mini-recover replacement for the follow-up preview call.
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildCourt0RefillResponse())

    fireEvent.press(getByTestId('nrv2-complete-match-court-0'))

    // The completion fires a scoped mini-recover for the vacated court only.
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 5000 })
    expect(mockApi.fetchLiveMatchesPreview.mock.calls[0][1]).toMatchObject({
      mode: 'replace_courts',
      court_idxs: [0],
    })

    // Court 0's live card is gone; court 1 live + court 2 suggested survive.
    await waitFor(() => {
      expect(queryByTestId('nrv2-live-card-court-0')).toBeNull()
      expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()
      expect(getByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 5000 })

    // THE POINT: the edge returned a replacement for court 0. It must be shown.
    // On current code this FAILS: the DB-suggested hydrate effect re-fires after
    // the mini-recover commit and overwrites suggestedLiveMatches with DB rows
    // only, stomping the ephemeral court-0 refill.
    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-0')).toBeTruthy()
    }, { timeout: 5000 })
  }, 25000)
})
