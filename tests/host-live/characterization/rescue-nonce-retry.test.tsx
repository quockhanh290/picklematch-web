// AUDIT VERIFY (read-only, scratch): candidate bug "rescueHandledNonceRef consumed at DISPATCH".
// Same fixture as tests/host-live/characterization/wait-rescue-resuggest.test.tsx, except the FIRST
// preview request after the completion FAILS (soft timeout). We then assert on the RETRY request.

import { fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '@/tests/host-live/helpers/renderHostLive'

const SESSION_ID = 'wait-rescue-resuggest-session'
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
const DEGRADED_SUGGESTED_COURT_2 = {
  id: 'persisted-degraded-court-2',
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
  degraded_reason: 'repeat' as const,
  rescue_court_idxs: [1],
}

function buildSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: [LIVE_MATCH_COURT_0, LIVE_MATCH_COURT_1, DEGRADED_SUGGESTED_COURT_2],
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

describe('AUDIT: rescue nonce consumed at dispatch survives a failed request?', () => {
  it('retry after soft-timeout still targets the degraded court', async () => {
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

    // FIRST post-completion preview request FAILS with the soft-timeout error, later ones succeed.
    mockApi.fetchLiveMatchesPreview.mockRejectedValueOnce(new Error('Preview suggest soft timeout'))
    mockApi.fetchLiveMatchesPreview.mockResolvedValue(buildCourt0RefillResponse())

    fireEvent.press(getByTestId('nrv2-complete-match-court-0'))

    await waitFor(() => {
      expect(mockSupabaseRpc).toHaveBeenCalledWith(
        'complete_live_session_match_versioned',
        expect.objectContaining({ p_match_id: 'live-match-court-0' }),
      )
    }, { timeout: 10000 })

    deferredComplete.resolve({
      data: {
        match: { ...LIVE_MATCH_COURT_0, status: 'completed', ended_at: new Date().toISOString() },
        changed_player_state: [],
        changed_pair_history: [],
        live_state_version: 2,
      },
      error: null,
    })

    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })
    const firstBody = mockApi.fetchLiveMatchesPreview.mock.calls[0][1] as { mode: string; court_idxs: number[] }
    // eslint-disable-next-line no-console
    console.log('AUDIT first(failed) request', JSON.stringify({ mode: firstBody.mode, court_idxs: firstBody.court_idxs }))

    // Retry after LIVE_PREVIEW_SOFT_TIMEOUT_RETRY_MS = 3500ms.
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview.mock.calls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 20000, interval: 100 })

    const allBodies = mockApi.fetchLiveMatchesPreview.mock.calls.map((call: any[]) => ({
      mode: call[1].mode,
      court_idxs: call[1].court_idxs,
    }))
    // eslint-disable-next-line no-console
    console.log('AUDIT all requests', JSON.stringify(allBodies))

    const retryBody = mockApi.fetchLiveMatchesPreview.mock.calls[1][1] as { mode: string; court_idxs: number[] }
    // EXPECTED (correct behaviour): the retry still re-suggests the degraded court 2.
    expect(retryBody.mode === 'full_board' || retryBody.court_idxs.includes(2)).toBe(true)
  }, 60000)
})
