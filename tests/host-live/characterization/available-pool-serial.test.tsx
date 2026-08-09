// REPRO: fetchAvailablePoolPreview must abort/clear the in-flight board preview before
// fetching the manual available-pool lineup. If it only bumps previewRequestSerialRef,
// the stale in-flight board response is discarded and the still-busy preview slot prevents
// an immediate replacement request for the empty court.

import { act, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '@/tests/host-live/helpers/renderHostLive'
import { CourtLaneLiveMatchBoard } from '@/features/host/session-detail/next-round-v2/components/ScreenComponents'

const SESSION_ID = 'availpool-serial-session'
const CHECKED_IN_AT = '2026-07-27T00:00:00.000Z'

type Seed = { id: string; name: string; pvna: number; gender: 'male' | 'female' }

const SEEDS: Seed[] = Array.from({ length: 16 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `P${i + 1}`,
  pvna: 3.0 + (i % 5) * 0.1,
  gender: i % 2 === 0 ? 'male' : 'female',
}))

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

const LIVE_C0: SessionLiveMatchRow = {
  id: 'live-c0', session_id: SESSION_ID, sequence_no: 0, round_no: 0, court_idx: 0,
  status: 'live', team_a: ['p1', 'p2'], team_b: ['p3', 'p4'], resting: [],
  score_a: 0, score_b: 0, suggested_at: CHECKED_IN_AT, started_at: CHECKED_IN_AT, ended_at: null,
}
const LIVE_C1: SessionLiveMatchRow = {
  id: 'live-c1', session_id: SESSION_ID, sequence_no: 1, round_no: 0, court_idx: 1,
  status: 'live', team_a: ['p5', 'p6'], team_b: ['p7', 'p8'], resting: [],
  score_a: 0, score_b: 0, suggested_at: CHECKED_IN_AT, started_at: CHECKED_IN_AT, ended_at: null,
}
const SUGGESTED_C2_LOCKED: SessionLiveMatchRow = {
  id: 'db-court-2-locked', session_id: SESSION_ID, sequence_no: 2, round_no: 1, court_idx: 2,
  status: 'suggested', team_a: ['p1', 'p2'], team_b: ['p9', 'p10'], resting: [],
  score_a: 0, score_b: 0, suggested_at: CHECKED_IN_AT, started_at: null, ended_at: null,
  preview_live_state_version: 1, preview_countable_match_count: 0,
  locked_player_ids: ['p1', 'p2'],
  live_availability_context: { locked_beam_quality: 0.9, available_pool_quality: 0.6, degraded_reason: null },
} as SessionLiveMatchRow
function buildSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: [LIVE_C0, LIVE_C1, SUGGESTED_C2_LOCKED],
  }
}

// Edge board #1: only court 2 is filled, and with a "wait for court" lineup whose
// team_a (p1,p2) is LIVE on court 0 -> lockedPlayerIds non-empty -> the
// "Xem lineup thay thế" button renders. Court 3 stays missing -> follow-up request.
function buildCourt2LockedBoard() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    missing_target_courts: [] as number[],
    target_count_shortfall: 0,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-2-locked', session_id: SESSION_ID, sequence_no: 2, round_no: 1, court_idx: 2,
        status: 'suggested' as const, team_a: ['p1', 'p2'], team_b: ['p9', 'p10'], resting: [] as string[],
        score_a: 0, score_b: 0, suggested_at: CHECKED_IN_AT, started_at: null, ended_at: null,
        preview_live_state_version: 1, preview_countable_match_count: 0,
        locked_player_ids: ['p1', 'p2'],
        live_availability_context: { locked_beam_quality: 0.9, available_pool_quality: 0.6, degraded_reason: null },
        warnings: [] as string[], tradeoffs: [] as unknown[], approval_required: false,
        configured_pvna_tolerance: 0.5, effective_pvna_tolerance: 0.5,
      },
    ],
  }
}

// The in-flight preview effect response: fills the empty court 3.
function buildCourt3Board() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-3', session_id: SESSION_ID, sequence_no: 3, round_no: 1, court_idx: 3,
        status: 'suggested' as const, team_a: ['p11', 'p12'], team_b: ['p13', 'p14'], resting: [] as string[],
        score_a: 0, score_b: 0, suggested_at: CHECKED_IN_AT, started_at: null, ended_at: null,
        preview_live_state_version: 1, preview_countable_match_count: 0,
        warnings: [] as string[], tradeoffs: [] as unknown[], approval_required: false,
        configured_pvna_tolerance: 0.5, effective_pvna_tolerance: 0.5,
      },
    ],
  }
}

function buildAvailablePoolBoard() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-2-pool', session_id: SESSION_ID, sequence_no: 4, round_no: 1, court_idx: 2,
        status: 'suggested' as const, team_a: ['p15', 'p16'], team_b: ['p13', 'p14'], resting: [] as string[],
        score_a: 0, score_b: 0, suggested_at: CHECKED_IN_AT, started_at: null, ended_at: null,
        preview_live_state_version: 1, preview_countable_match_count: 0,
        warnings: [] as string[], tradeoffs: [] as unknown[], approval_required: false,
        configured_pvna_tolerance: 0.5, effective_pvna_tolerance: 0.5,
      },
    ],
  }
}

beforeEach(() => { jest.clearAllMocks() })

type Harness = {
  calls: any[]
  getResolveBoard: () => ((v: unknown) => void) | null
}

function installMocks(): Harness {
  mockSupabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_live_session_snapshot_versioned') return { data: buildSnapshot(), error: null }
    return { data: null, error: null }
  })
  let resolveBoard: ((v: unknown) => void) | null = null
  const calls: any[] = []
  mockApi.fetchLiveMatchesPreview.mockImplementation(async (_sid: string, body: any) => {
    calls.push(body)
    if (body?.prefer_available_pool === true) return buildAvailablePoolBoard()
    if (resolveBoard === null) return new Promise(resolve => { resolveBoard = resolve })
    return buildCourt3Board()
  })
  return { calls, getResolveBoard: () => resolveBoard }
}

const fmtCalls = (calls: any[]) =>
  calls.map(c => `${c.mode}:${JSON.stringify(c.court_idxs)}${c.prefer_available_pool ? ':POOL' : ''}`)

describe('available-pool serial bump vs in-flight preview', () => {
  it('press "Xem lineup thay thế" mid-flight -> replacement board request is rescheduled before stale response lands', async () => {
    const h = installMocks()
    const { UNSAFE_getByType } = renderHostLiveScreen({ sessionId: SESSION_ID, players: PLAYERS, courts: 4 })

    await waitFor(() => { expect(h.getResolveBoard()).not.toBeNull() }, { timeout: 10000 })

    const nonPoolCallsBeforePress = h.calls.filter(c => c?.prefer_available_pool !== true).length
    await act(async () => {
      await UNSAFE_getByType((CourtLaneLiveMatchBoard as any).type).props.onFetchAvailablePool(SUGGESTED_C2_LOCKED)
    })
    await waitFor(() => {
      expect(h.calls.some(c => c?.prefer_available_pool === true)).toBe(true)
    }, { timeout: 8000 })

    await waitFor(() => {
      const nonPoolCalls = h.calls.filter(c => c?.prefer_available_pool !== true)
      expect(nonPoolCalls.length).toBeGreaterThan(nonPoolCallsBeforePress)
    }, { timeout: 8000 })

    // The stale in-flight response has not landed yet. With the fix, abortPreviewRequest()
    // cleared the slot and bumped previewRefreshNonce, so the replacement non-pool request
    // above is scheduled anyway.
    h.getResolveBoard()!(buildCourt3Board())

    // eslint-disable-next-line no-console
    console.log('[RESCHEDULED] calls:', fmtCalls(h.calls))
  }, 40000)
})
