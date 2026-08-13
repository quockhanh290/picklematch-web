// Flicker repro (prod session 260878a4, 2026-08-13 04:18, measured from debug_dumps):
// completing court 0 frees its players, the client refills court 0, and the edge answers with a
// DEGRADED (repeat) lineup. The client then immediately asks for court 0 AGAIN — within ~2s, with
// no new completion in between — because "awaiting rescue" is a single global watermark
// (completedLiveMatchCommitNonce > rescueHandledNonceRef): the completion that emptied the court is
// never consumed by the refill, so the lineup BORN from that completion is treated as waiting for it.
// The engine is non-deterministic, so the re-roll returns a different (still degraded) lineup and the
// host sees the court change for nothing. Prod: seq 58 (04:18:09) -> seq 59 (04:18:11) -> seq 60
// (04:18:15), only the last one — after court 2 actually completed — was clean.
//
// A degraded court must wait for a completion that lands AFTER its lineup was produced.

import { fireEvent, waitFor } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'degraded-reroll-session'
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

const eloFor = (pvna: number) => Math.round(pvna * 400)

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
// Clean persisted suggestion on the only open lane -> board is complete at mount, no edge call.
const CLEAN_SUGGESTED_COURT_2 = {
  id: 'persisted-clean-court-2',
  session_id: SESSION_ID,
  sequence_no: 2,
  round_no: 1,
  court_idx: 2,
  status: 'suggested' as const,
  team_a: ['p9', 'p10'],
  team_b: ['p11', 'p12'],
  resting: [] as string[],
  score_a: 0,
  score_b: 0,
  suggested_at: CHECKED_IN_AT,
  started_at: null,
  ended_at: null,
}

// The server board moves the way prod does: court 0 completes, then the edge persists the refill
// suggestion for court 0 and bumps the version again. A static snapshot would keep court 0 "live"
// and the refill preview would be dropped as an occupied lane — the reason an earlier version of
// this test passed while prod flickered.
type SnapshotPhase = 'initial' | 'court0_completed' | 'court0_refilled'

const COMPLETED_MATCH_COURT_0: SessionLiveMatchRow = {
  ...LIVE_MATCH_COURT_0,
  status: 'completed',
  ended_at: '2026-07-27T00:10:00.000Z',
}
const PERSISTED_DEGRADED_COURT_0 = {
  id: 'edge-court-0-degraded-refill',
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
}

let snapshotPhase: SnapshotPhase = 'initial'

const SNAPSHOT_VERSION: Record<SnapshotPhase, number> = {
  initial: 1,
  court0_completed: 2,
  court0_refilled: 3,
}

function buildSnapshot() {
  const liveMatchRows = snapshotPhase === 'initial'
    ? [LIVE_MATCH_COURT_0, LIVE_MATCH_COURT_1, CLEAN_SUGGESTED_COURT_2]
    : snapshotPhase === 'court0_completed'
      ? [COMPLETED_MATCH_COURT_0, LIVE_MATCH_COURT_1, CLEAN_SUGGESTED_COURT_2]
      : [COMPLETED_MATCH_COURT_0, LIVE_MATCH_COURT_1, CLEAN_SUGGESTED_COURT_2, PERSISTED_DEGRADED_COURT_0]
  return {
    live_state_version: SNAPSHOT_VERSION[snapshotPhase],
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: liveMatchRows,
  }
}

// The refill the completion triggers: court 0 comes back DEGRADED (repeat), balanced on PVNA so the
// only thing that can re-target this court is the degraded/awaiting-rescue path.
function buildDegradedCourt0RefillResponse() {
  return {
    ok: true as const,
    live_state_version: 2,
    live_state_version_used: 2,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-0-degraded-refill',
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
        degraded_reason: 'repeat' as const,
        rescue_court_idxs: [1],
      },
    ],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  snapshotPhase = 'initial'
  // The version poll (the re-render that re-evaluates the board in prod) bails unless the app is
  // foregrounded; the RN test mock does not report 'active' on its own.
  ;(AppState as unknown as { currentState: string }).currentState = 'active'
})

describe('degraded court born from a completion does not re-roll against that same completion', () => {
  it('does not fire a second preview request for the court it just filled', async () => {
    const deferredComplete = makeDeferred<{ data: unknown; error: null }>()
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
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

    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 10000 })

    mockApi.fetchLiveSessionVersion.mockImplementation(async () => SNAPSHOT_VERSION[snapshotPhase])
    mockApi.fetchLiveMatchesPreview.mockImplementation(async () => {
      snapshotPhase = 'court0_refilled'
      return buildDegradedCourt0RefillResponse()
    })

    fireEvent.press(getByTestId('nrv2-complete-match-court-0'))

    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'complete_live_session_match_versioned',
        expect.objectContaining({ p_match_id: 'live-match-court-0' }),
      )
    }, { timeout: 10000 })

    snapshotPhase = 'court0_completed'
    deferredComplete.resolve({
      data: {
        match: { ...LIVE_MATCH_COURT_0, status: 'completed', ended_at: new Date().toISOString() },
        changed_player_state: [],
        changed_pair_history: [],
        live_state_version: 2,
      },
      error: null,
    })

    // The completion fires exactly one request: refill the court it emptied.
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })

    // Guard against a green test that never reached the state under test: the degraded refill must
    // actually be on the board before we can claim it was not re-rolled.
    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-0')).toBeTruthy()
    }, { timeout: 10000 })

    // No completion happens from here on, so nothing can improve court 0's degraded lineup.
    // In prod the re-roll landed 2.1s after the refill; wait past the 4s version poll too.
    await new Promise(resolve => setTimeout(resolve, 9000))

    // The version poll is what re-evaluates the board in prod (and what produced the second request
    // there). If it never ran, this test proves nothing — assert the mechanism was live.
    expect(mockApi.fetchLiveSessionVersion.mock.calls.length).toBeGreaterThan(0)

    const followUpTargets = mockApi.fetchLiveMatchesPreview.mock.calls
      .slice(1)
      .map((call: unknown[]) => call[1] as { mode: string; court_idxs: number[] })
      .filter(body => body.mode === 'full_board' || body.court_idxs.includes(0))
    expect(followUpTargets).toEqual([])
  }, 40000)
})
