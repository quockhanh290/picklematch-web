// Host report: pressing "Bắt đầu trận" on a manually chosen lineup ("Xem lineup thay thế") is
// rejected with "Gợi ý vừa cũ sau khi có trận kết thúc. Đang tạo lại trận phù hợp hơn.", and the card
// disappears. Frequent on a 6-court board, because the host has to read the alternatives before
// picking and a completion lands somewhere every few tens of seconds.
//
// The guard (useLiveBoard.startLiveMatch) rejects on "ANY match completed after this preview was
// computed" — it never asks whether that completion touches THIS lineup. A completion only FREES
// players, and the two checks right after it are the precise ones: a player of this lineup now being
// live, or the court now being occupied. The persist itself sends the CURRENT live_state_version, so
// a stale preview does not break the RPC either.
//
// Nothing in this path has telemetry, which is why prod shows zero events for it.

import { fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'manual-lineup-start-session'
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

// Court 0 finished a while ago. Its players are FREE — the completion cannot invalidate a lineup.
const COMPLETED_MATCH_COURT_0: SessionLiveMatchRow = {
  id: 'completed-match-court-0',
  session_id: SESSION_ID,
  sequence_no: 0,
  round_no: 0,
  court_idx: 0,
  status: 'completed',
  team_a: ['p1', 'p2'],
  team_b: ['p3', 'p4'],
  resting: [],
  score_a: 11,
  score_b: 9,
  suggested_at: CHECKED_IN_AT,
  started_at: CHECKED_IN_AT,
  ended_at: '2026-07-27T00:20:00.000Z',
}

// The lineup the host picked from "Xem lineup thay thế": four free players, on a free court. Its
// preview_countable_match_count predates the completion above, which is what trips the guard.
const MANUAL_LINEUP_COURT_1 = {
  id: 'manual-available-pool-court-1',
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
  preview_source: 'manual_available_pool' as const,
  available_pool_only: true,
  preview_live_state_version: 1,
  preview_countable_match_count: 0,
}

function buildSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: [COMPLETED_MATCH_COURT_0, MANUAL_LINEUP_COURT_1],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('a manually chosen lineup survives an unrelated completion', () => {
  it('starts it instead of rejecting it as stale', async () => {
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return { data: buildSnapshot(), error: null }
      }
      return { data: null, error: null }
    })
    mockApi.persistAndStartLiveMatch.mockResolvedValue({
      match: {
        ...MANUAL_LINEUP_COURT_1,
        id: 'live-match-court-1',
        status: 'live',
        started_at: '2026-07-27T00:21:00.000Z',
      },
      live_state_version: 2,
    })

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 2,
    })

    await waitFor(() => {
      expect(queryByTestId('nrv2-start-match-court-1')).toBeTruthy()
    }, { timeout: 10000 })

    fireEvent.press(getByTestId('nrv2-start-match-court-1'))

    await waitFor(() => {
      expect(mockApi.persistAndStartLiveMatch).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })
  }, 45000)

  // The other half of the contract: narrowing the guard must not remove it. A completion on THIS
  // court retires the cycle the lineup's round_no was computed for, so that one still rejects.
  it('still rejects when the completion is on the lineup own court', async () => {
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_live_session_snapshot_versioned') {
        return {
          data: {
            ...buildSnapshot(),
            live_match_rows: [
              { ...COMPLETED_MATCH_COURT_0, court_idx: 1, id: 'completed-match-court-1' },
              MANUAL_LINEUP_COURT_1,
            ],
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    const { getByTestId, queryByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 2,
    })

    await waitFor(() => {
      expect(queryByTestId('nrv2-start-match-court-1')).toBeTruthy()
    }, { timeout: 10000 })

    fireEvent.press(getByTestId('nrv2-start-match-court-1'))

    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(mockApi.persistAndStartLiveMatch).not.toHaveBeenCalled()
  }, 45000)
})
