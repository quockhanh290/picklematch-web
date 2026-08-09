import { within } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'shortage-empty-board-session'
const CHECKED_IN_AT = '2026-07-27T00:00:00.000Z'

type Seed = { id: string; name: string; pvna: number; gender: 'male' | 'female' }

const SEEDS: Seed[] = Array.from({ length: 16 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `P${index + 1}`,
  pvna: 3 + (index % 5) * 0.1,
  gender: index % 2 === 0 ? 'male' : 'female',
}))

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

function liveMatch(courtIdx: number, ids: string[], sequenceNo: number): SessionLiveMatchRow {
  return {
    id: `live-court-${courtIdx}`,
    session_id: SESSION_ID,
    sequence_no: sequenceNo,
    round_no: 0,
    court_idx: courtIdx,
    status: 'live',
    team_a: [ids[0], ids[1]],
    team_b: [ids[2], ids[3]],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: CHECKED_IN_AT,
    started_at: CHECKED_IN_AT,
    ended_at: null,
  }
}

function buildSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [],
    round_rows: [],
    live_match_rows: [
      liveMatch(0, ['p1', 'p2', 'p3', 'p4'], 0),
      liveMatch(1, ['p5', 'p6', 'p7', 'p8'], 1),
    ],
  }
}

function laneTextLengths(lane: ReturnType<typeof within>) {
  return lane.queryAllByText(/./).map(node => String(node.props.children).length)
}

const PLAYERS = SEEDS.map(buildArrangementPlayer)

beforeEach(() => {
  jest.clearAllMocks()
  mockSupabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_live_session_snapshot_versioned') return { data: buildSnapshot(), error: null }
    return { data: null, error: null }
  })
})

describe('court shortage breakdown on empty-board responses', () => {
  it('clears a stale temporary-shortage lane label when a later empty board reports no shortage fields', async () => {
    const firstBoard = {
      ok: true as const,
      live_state_version: 1,
      live_state_version_used: 1,
      payloads: [] as unknown[],
      final_preview_board: [
        {
          id: 'edge-court-2',
          session_id: SESSION_ID,
          sequence_no: 2,
          round_no: 0,
          court_idx: 2,
          status: 'suggested' as const,
          team_a: ['p9', 'p11'],
          team_b: ['p10', 'p12'],
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
      temp_limited_courts: 1,
      real_limited_courts: 0,
      player_limited_courts: 1,
      missing_target_courts: [3],
      target_count_shortfall: 1,
    }
    const laterEmptyNoShortage = {
      ok: true as const,
      live_state_version: 1,
      live_state_version_used: 1,
      payloads: [] as unknown[],
      final_preview_board: [] as unknown[],
      missing_target_courts: [3],
      target_count_shortfall: 1,
    }
    mockApi.fetchLiveMatchesPreview.mockResolvedValue(laterEmptyNoShortage)
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(firstBoard)

    const { getByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 4,
    })

    await new Promise(resolve => setTimeout(resolve, 8000))

    expect(mockApi.fetchLiveMatchesPreview.mock.calls.length).toBeGreaterThanOrEqual(2)
    const lane3 = within(getByTestId('nrv2-court-lane-3'))
    expect(Math.max(...laneTextLengths(lane3))).toBeLessThan(60)
  }, 40000)
})
