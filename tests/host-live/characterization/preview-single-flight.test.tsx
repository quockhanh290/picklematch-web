// Measured on prod session ff0ea657 (session_audit_events): 180 preview requests scheduled, 75 sent
// to the edge, and 32 of those 75 answers DISCARDED as stale. Discarded is not free — the edge had
// already computed AND persisted that board, so the host saw the lineup change.
//
// The loop is self-feeding: the edge persist bumps live_state_version -> the 4s version poll reloads
// -> rows change -> previewRequestKey changes -> the effect cleanup calls abortPreviewRequest(),
// which bumps the serial (the answer in flight becomes stale) and reruns -> a second edge call
// persists a different lineup for the same court. Engine calls took 2.8-5.4s, longer than the poll
// interval, so the loop closed almost every time.
//
// Two properties this pins, in one scenario:
//   1. a board change while a request is in flight must NOT start a second request
//   2. when that request lands, the client must still re-evaluate (no stuck board) — here by
//      requesting the court that was freed while the first request was in flight

import { fireEvent, waitFor } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'preview-single-flight-session'
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

// The board the poll sees. Mirrors prod: the edge persist bumps the version WHILE the client is still
// waiting for that same request's answer, and the poll reloads on the bump.
type SnapshotPhase = 'initial' | 'court0_completed' | 'court0_persisted' | 'court1_completed'

let snapshotPhase: SnapshotPhase = 'initial'

const SNAPSHOT_VERSION: Record<SnapshotPhase, number> = {
  initial: 1,
  court0_completed: 2,
  court0_persisted: 3,
  court1_completed: 4,
}

const COMPLETED_COURT_0: SessionLiveMatchRow = { ...LIVE_MATCH_COURT_0, status: 'completed', ended_at: '2026-07-27T00:10:00.000Z' }
const COMPLETED_COURT_1: SessionLiveMatchRow = { ...LIVE_MATCH_COURT_1, status: 'completed', ended_at: '2026-07-27T00:10:30.000Z' }
const PERSISTED_COURT_0_REFILL = {
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
}

function buildSnapshot() {
  const liveMatchRows = snapshotPhase === 'initial'
    ? [LIVE_MATCH_COURT_0, LIVE_MATCH_COURT_1, CLEAN_SUGGESTED_COURT_2]
    : snapshotPhase === 'court0_completed'
      ? [COMPLETED_COURT_0, LIVE_MATCH_COURT_1, CLEAN_SUGGESTED_COURT_2]
      : snapshotPhase === 'court0_persisted'
        ? [COMPLETED_COURT_0, LIVE_MATCH_COURT_1, CLEAN_SUGGESTED_COURT_2, PERSISTED_COURT_0_REFILL]
        : [COMPLETED_COURT_0, COMPLETED_COURT_1, CLEAN_SUGGESTED_COURT_2, PERSISTED_COURT_0_REFILL]
  return {
    live_state_version: SNAPSHOT_VERSION[snapshotPhase],
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: liveMatchRows,
  }
}

function buildCourt0RefillResponse() {
  return {
    ok: true as const,
    live_state_version: 3,
    live_state_version_used: 3,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        ...PERSISTED_COURT_0_REFILL,
        preview_live_state_version: 3,
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
  snapshotPhase = 'initial'
  ;(AppState as unknown as { currentState: string }).currentState = 'active'
})

describe('preview requests are single-flight across board changes', () => {
  it('does not start a second request while one is in flight, and re-evaluates once it lands', async () => {
    const deferredCompleteCourt0 = makeDeferred<{ data: unknown; error: null }>()
    const deferredCompleteCourt1 = makeDeferred<{ data: unknown; error: null }>()
    mockSupabaseRpc.mockImplementation(async (fn: string, params?: Record<string, unknown>) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildSnapshot(), error: null }
      }
      if (fn === 'complete_live_session_match_versioned') {
        return params?.p_match_id === 'live-match-court-1'
          ? deferredCompleteCourt1.promise
          : deferredCompleteCourt0.promise
      }
      return { data: null, error: null }
    })
    mockApi.fetchLiveSessionVersion.mockImplementation(async () => SNAPSHOT_VERSION[snapshotPhase])

    // The court-0 refill answer is held open. The edge has already persisted it (prod behaviour):
    // the version bumps while the client is still waiting.
    const deferredPreview = makeDeferred<ReturnType<typeof buildCourt0RefillResponse>>()
    mockApi.fetchLiveMatchesPreview.mockImplementation(async () => {
      snapshotPhase = 'court0_persisted'
      return deferredPreview.promise
    })

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 3,
    })

    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 10000 })

    fireEvent.press(getByTestId('nrv2-complete-match-court-0'))
    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'complete_live_session_match_versioned',
        expect.objectContaining({ p_match_id: 'live-match-court-0' }),
      )
    }, { timeout: 10000 })
    snapshotPhase = 'court0_completed'
    deferredCompleteCourt0.resolve({
      data: {
        match: COMPLETED_COURT_0,
        changed_player_state: [],
        changed_pair_history: [],
        live_state_version: 2,
      },
      error: null,
    })

    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })

    // Board moves under the in-flight request: court 1 completes too, and the version poll reloads.
    fireEvent.press(getByTestId('nrv2-complete-match-court-1'))
    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'complete_live_session_match_versioned',
        expect.objectContaining({ p_match_id: 'live-match-court-1' }),
      )
    }, { timeout: 10000 })
    snapshotPhase = 'court1_completed'
    deferredCompleteCourt1.resolve({
      data: {
        match: COMPLETED_COURT_1,
        changed_player_state: [],
        changed_pair_history: [],
        live_state_version: 4,
      },
      error: null,
    })

    // Past the 4s version poll: the reload must not fire a second edge call behind the first one.
    await new Promise(resolve => setTimeout(resolve, 6000))
    expect(mockApi.fetchLiveSessionVersion.mock.calls.length).toBeGreaterThan(0)
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)

    // ...and the answer must still be able to land and drive the next step (no stuck board).
    deferredPreview.resolve(buildCourt0RefillResponse())
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview.mock.calls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 15000 })
    const followUp = mockApi.fetchLiveMatchesPreview.mock.calls[1][1] as { mode: string; court_idxs: number[] }
    expect(followUp.mode === 'full_board' || followUp.court_idxs.includes(1)).toBe(true)
  }, 60000)
})
