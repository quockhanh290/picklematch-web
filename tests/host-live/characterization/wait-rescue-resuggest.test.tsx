// Reproducing test for the "chờ Sân X" re-suggest bug (session 724475bd / 5a87688f):
// a degraded (repeat/blowout) persisted suggestion must be RE-SUGGESTED when the host completes
// any live court — the completion frees players that can seat a cleaner lineup. The trigger is the
// completion EVENT (completedLiveMatchCommitNonce), NOT rescue_court_idxs: the edge's board-wide
// pass rewrites that list every request, and a completed court is routinely absent from it (see the
// dump trace: c1 rescue [0,3,4,5] → [0,2,4], dropping the very court the host completes). This test
// pins that completing court 0 targets the degraded court 2 for re-suggest even though court 2's
// rescue_court_idxs = [1] (a court that STAYS live) — which the old rescue-list detection would miss.

import { fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

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
// Persisted, DEGRADED suggestion on court 2. rescue_court_idxs = [1] on purpose: court 1 stays live
// through the whole test, so the old "a rescue court left the live set" detection can NEVER fire for
// it. Only the completion-event trigger re-suggests it.
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

describe('wait-rescue: completing a live court re-suggests the degraded court', () => {
  it('adds the degraded court to the follow-up preview request court_idxs on completion', async () => {
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

    // Court 2's persisted degraded suggestion fills the only open lane -- board complete, no edge at mount.
    await waitFor(() => {
      expect(queryByTestId('nrv2-suggested-card-court-2')).toBeTruthy()
    }, { timeout: 10000 })
    expect(getByTestId('nrv2-live-card-court-0')).toBeTruthy()
    expect(getByTestId('nrv2-live-card-court-1')).toBeTruthy()

    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildCourt0RefillResponse())

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

    // The completion fires a follow-up replace_courts preview. The freed court 0 is expected; the
    // degraded court 2 MUST be in it too (the whole point of "chờ Sân X" — re-suggest on completion).
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })
    const requestBody = mockApi.fetchLiveMatchesPreview.mock.calls[0][1] as { mode: string; court_idxs: number[] }
    expect(requestBody.mode).toBe('replace_courts')
    expect(requestBody.court_idxs).toEqual(expect.arrayContaining([2]))
  }, 25000)
})
