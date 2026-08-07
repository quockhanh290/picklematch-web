// Task 3 (last-court-blowout-outlier-defer): proves SuggestedLiveMatchCard renders the BLOWOUT
// variant of the forced-court 3-way panel when match.forced_tradeoff.kind === 'blowout' — labels
// "Chịu lệch" (play the outlier, seated acceptRepeat lineup) / "Cho nghỉ tiếp" (rest the outlier,
// balanced acceptImbalance lineup) instead of the repeat-variant "Chịu lặp" / "Chịu lệch", plus a
// "Vì sao lệch" explanation. Modeled on tests/host-live/forced-tradeoff-panel.test.tsx (same
// renderHostLiveScreen/mockApi/mockSupabaseRpc harness + fixtures), swapping only the
// forced_tradeoff payload (kind + explanation).

import { act } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from './helpers/renderHostLive'

jest.setTimeout(30000)

const SESSION_ID = 'forced-tradeoff-blowout-panel-session'
const CHECKED_IN_AT = '2026-07-27T00:00:00.000Z'

type Seed = { id: string; name: string; pvna: number; gender: 'male' | 'female' }

const SEEDS: Seed[] = [
  { id: 'p1', name: 'P1', pvna: 3.2, gender: 'male' },
  { id: 'p2', name: 'P2', pvna: 3.3, gender: 'male' },
  { id: 'p3', name: 'P3', pvna: 3.1, gender: 'female' },
  { id: 'p4', name: 'P4', pvna: 3.0, gender: 'female' },
  { id: 'p5', name: 'P5', pvna: 4.8, gender: 'male' },
  { id: 'p6', name: 'P6', pvna: 2.0, gender: 'male' },
  { id: 'p7', name: 'P7', pvna: 3.4, gender: 'female' },
  { id: 'p8', name: 'P8', pvna: 3.5, gender: 'female' },
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
    pair_rows: [] as unknown[],
    round_rows: [],
    live_match_rows: [LIVE_MATCH_COURT_0],
  }
}

const ACCEPT_REPEAT = { team_a: ['p5', 'p6'] as [string, string], team_b: ['p7', 'p8'] as [string, string] }
const ACCEPT_IMBALANCE = { team_a: ['p5', 'p7'] as [string, string], team_b: ['p6', 'p8'] as [string, string] }
const EXPLANATION_TEXT = 'P5 (4.8) lệch trình so với P6/P7/P8; không còn ai rảnh để ghép cân, chờ sẽ để trống sân.'

function buildForcedBlowoutPreviewResponse() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-1-forced-blowout-match',
        session_id: SESSION_ID,
        sequence_no: 1,
        round_no: 1,
        court_idx: 1,
        status: 'suggested' as const,
        team_a: ACCEPT_REPEAT.team_a,
        team_b: ACCEPT_REPEAT.team_b,
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
        forced_tradeoff: {
          kind: 'blowout' as const,
          explanation: EXPLANATION_TEXT,
          acceptRepeat: ACCEPT_REPEAT,
          acceptImbalance: ACCEPT_IMBALANCE,
        },
        wait_rescue_options: [] as { court_idx: number; started_at: string | null }[],
      },
    ],
  }
}

// Repeat-variant fixture (kind omitted, defaults to 'repeat') for the no-regression assertion —
// mirrors tests/host-live/forced-tradeoff-panel.test.tsx's forced court exactly.
function buildForcedRepeatPreviewResponse() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-1-forced-repeat-match',
        session_id: SESSION_ID,
        sequence_no: 1,
        round_no: 1,
        court_idx: 1,
        status: 'suggested' as const,
        team_a: ACCEPT_REPEAT.team_a,
        team_b: ACCEPT_REPEAT.team_b,
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
        forced_tradeoff: { acceptRepeat: ACCEPT_REPEAT, acceptImbalance: ACCEPT_IMBALANCE },
        wait_rescue_options: [] as { court_idx: number; started_at: string | null }[],
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

async function mountWithPreview(previewResponse: unknown) {
  jest.useFakeTimers()
  mockSnapshotOnlyRpc()
  mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(previewResponse)

  const view = renderHostLiveScreen({
    sessionId: SESSION_ID,
    players: PLAYERS,
    courts: 2,
  })

  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    await jest.advanceTimersByTimeAsync(80)
  })
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })

  return view
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('SuggestedLiveMatchCard: BLOWOUT variant of the forced-court decision panel', () => {
  it('shows "Chịu lệch" / "Cho nghỉ tiếp" + the "Vì sao lệch" explanation, NOT the repeat labels', async () => {
    const { getByTestId, queryByText } = await mountWithPreview(buildForcedBlowoutPreviewResponse())

    const acceptRepeatCard = getByTestId('nrv2-decision-accept_repeat-1')
    const acceptImbalanceCard = getByTestId('nrv2-decision-accept_imbalance-1')

    expect(acceptRepeatCard).toHaveTextContent('Chịu lệch', { exact: false })
    expect(acceptImbalanceCard).toHaveTextContent('Cho nghỉ tiếp', { exact: false })

    // Repeat-variant labels must NOT appear anywhere on the card.
    expect(queryByText('Chịu lặp')).toBeNull()

    expect(queryByText('Vì sao lệch')).toBeTruthy()
    expect(queryByText(EXPLANATION_TEXT)).toBeTruthy()

    // Default selection is still accept_repeat (the seated/outlier lineup) — mapping unchanged.
    expect(acceptRepeatCard.props.accessibilityState.selected).toBe(true)
    expect(acceptImbalanceCard.props.accessibilityState.selected).toBe(false)
  })

  it('does not regress the repeat-variant panel: still "Chịu lặp" / "Chịu lệch", no "Vì sao lệch" block', async () => {
    const { getByTestId, queryByText } = await mountWithPreview(buildForcedRepeatPreviewResponse())

    const acceptRepeatCard = getByTestId('nrv2-decision-accept_repeat-1')
    const acceptImbalanceCard = getByTestId('nrv2-decision-accept_imbalance-1')

    expect(acceptRepeatCard).toHaveTextContent('Chịu lặp', { exact: false })
    expect(acceptImbalanceCard).toHaveTextContent('Chịu lệch', { exact: false })
    expect(queryByText('Cho nghỉ tiếp')).toBeNull()
    expect(queryByText('Vì sao lệch')).toBeNull()
  })
})
