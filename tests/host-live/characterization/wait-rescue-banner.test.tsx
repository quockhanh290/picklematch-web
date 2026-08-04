// Closes the audit gap noted in task-WQA-brief.md: prior tests (preview-happy-path,
// mutation-flows) proved the edge round-trip but never asserted that
// `SuggestedLiveMatchCard` (ScreenComponents.tsx:1890-2168) actually reads
// `match.degraded_reason` / `match.rescue_court_idxs` / `match.match_explanations`
// off a board returned by the edge and renders the wait-rescue banner + "Vì sao xếp
// trận này" explanation list from them. If the client silently ignored those fields
// (e.g. a future refactor drops the read, or a typo breaks the mapping), these
// assertions fail because the banner/label/explanation text is derived ONLY from the
// mocked degraded fields below -- nothing else in the fixture would produce it.
//
// Card logic pinned here (read directly off ScreenComponents.tsx, not assumed):
//   isDegradedRescue = degraded_reason is 'blowout' | 'repeat' | 'both'
//   degradedRescueCourtIdxs = isDegradedRescue ? (rescue_court_idxs ?? []) : []
//   showDegradedRescue = degradedRescueCourtIdxs.length > 0   <- entire banner hidden
//                                                                 when rescue list is empty,
//                                                                 not just the "Chờ Sân" part
//   title: repeat -> '⏳ Trận này bị trùng người'
//          both   -> '⏳ Trận này hơi lệch & trùng'
//          blowout-> '⏳ Trận này hơi lệch trình'
//   benefit: repeat -> 'đỡ trùng', both -> 'tốt hơn', blowout -> 'cân hơn'
//   label: `Chờ Sân ${idxs.map(i => i+1).join(' hoặc ')} xong sẽ ${benefit}`
//   full banner line: `${label} — hoặc bấm Bắt đầu để chơi luôn.`
//   explanations: matchExplanations.length > 0 renders a "Vì sao xếp trận này" header
//                 + one `• {line}` Text per entry, independent of the rescue banner.
//   Start button: testID `nrv2-start-match-court-${courtIdx}`, disabled only by
//                 busy / hasBlockingLivePlayers / previewTrustIssue -- NOT by the
//                 presence/absence of degraded fields, so a degraded-but-seated match
//                 must stay startable either way ("Chơi luôn").
//
// Mount pattern copied from preview-happy-path.test.tsx (proven deterministic): fake
// timers, court 0 occupied by a live match so court 1 is the only open lane, which
// forces the engine to request `full_board` and the mocked edge response supplies the
// one match we control. Fixture is self-contained (not shared) per that file's stated
// convention.

import { act } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from '../helpers/renderHostLive'

const SESSION_ID = 'wait-rescue-banner-session'
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
    pair_rows: [],
    round_rows: [],
    live_match_rows: [LIVE_MATCH_COURT_0],
  }
}

type DegradedOverrides = {
  degraded_reason: 'blowout' | 'repeat' | 'both'
  rescue_court_idxs: number[]
  match_explanations: string[]
}

// Court 0 is occupied -> court 1 is the only open lane -> engine requests `full_board`
// (shouldRequestFullBoardPreview's reusableMatches.length === 0 branch) and the edge
// returns exactly this one match, carrying the degraded-rescue fields under test.
function buildDegradedPreviewResponse(overrides: DegradedOverrides) {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-1-degraded-match',
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
        degraded_reason: overrides.degraded_reason,
        rescue_court_idxs: overrides.rescue_court_idxs,
        match_explanations: overrides.match_explanations,
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

const EXPLANATIONS = [
  'P5(4.8)+P6(2.0) cùng đội để cân tổng',
  'Trận lệch 2.5 điểm',
]

async function mountWithDegradedBoard(overrides: DegradedOverrides) {
  jest.useFakeTimers()
  mockSnapshotOnlyRpc()
  mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(buildDegradedPreviewResponse(overrides))

  const view = renderHostLiveScreen({
    sessionId: SESSION_ID,
    players: PLAYERS,
    courts: 2,
  })

  // Let mount-time snapshot microtasks settle before the preview effect's own
  // 80ms request-debounce timer starts (same driver as preview-happy-path.test.tsx).
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

describe('NextRoundSuggesterScreenV2: wait-rescue banner renders from degraded-match fields', () => {
  it('degraded_reason "blowout" renders the blowout title/benefit, the rescue court, and the explanations list', async () => {
    const { getByTestId, getByText } = await mountWithDegradedBoard({
      degraded_reason: 'blowout',
      rescue_court_idxs: [2],
      match_explanations: EXPLANATIONS,
    })

    expect(getByTestId('nrv2-suggested-card-court-1')).toBeTruthy()
    expect(getByText('⏳ Trận này hơi lệch trình')).toBeTruthy()
    expect(getByTestId('nrv2-decision-play-1')).toBeTruthy()
    expect(getByTestId('nrv2-decision-wait-1')).toBeTruthy()
    expect(getByText('→ Kết quả: Đội hình sạch hơn (cân hơn)')).toBeTruthy()
    expect(getByText('→ Giá: chờ Sân 3 xong · sân này để trống')).toBeTruthy()

    expect(getByText('Vì sao xếp trận này')).toBeTruthy()
    expect(getByText(`• ${EXPLANATIONS[0]}`)).toBeTruthy()
    expect(getByText(`• ${EXPLANATIONS[1]}`)).toBeTruthy()

    const startButton = getByTestId('nrv2-start-match-court-1')
    expect(startButton.props.accessibilityState.disabled).toBe(false)
    expect(getByText('Bắt đầu trận')).toBeTruthy()
  })

  it('degraded_reason "repeat" renders the repeat title and "đỡ trùng" wait result', async () => {
    const { getByText, getByTestId } = await mountWithDegradedBoard({
      degraded_reason: 'repeat',
      rescue_court_idxs: [0],
      match_explanations: EXPLANATIONS,
    })

    expect(getByText('⏳ Trận này bị trùng người')).toBeTruthy()
    expect(getByTestId('nrv2-decision-wait-1')).toBeTruthy()
    expect(getByText('→ Kết quả: Đội hình sạch hơn (đỡ trùng)')).toBeTruthy()
    expect(getByText('→ Giá: chờ Sân 1 xong · sân này để trống')).toBeTruthy()
  })

  it('degraded_reason "both" renders the combined title and "tốt hơn" benefit', async () => {
    const { getByText } = await mountWithDegradedBoard({
      degraded_reason: 'both',
      rescue_court_idxs: [0, 2],
      match_explanations: EXPLANATIONS,
    })

    expect(getByText('⏳ Trận này hơi lệch & trùng')).toBeTruthy()
    expect(getByText('→ Kết quả: Đội hình sạch hơn (tốt hơn)')).toBeTruthy()
    expect(getByText('→ Giá: chờ Sân 1 hoặc 3 xong · sân này để trống')).toBeTruthy()
  })

  it('empty rescue_court_idxs hides the wait option but STILL shows the degraded warning + Chơi-luôn panel (unavoidable repeat/blowout), keeps the match startable, and renders the explanations list', async () => {
    const { getByTestId, getByText, queryByText, queryByTestId } = await mountWithDegradedBoard({
      degraded_reason: 'blowout',
      rescue_court_idxs: [],
      match_explanations: EXPLANATIONS,
    })

    // No court to wait on -> no "Chờ" option. But the lineup is still degraded, so the panel must
    // surface the warning (title) + the Chơi-luôn card (whose cost line tells the host it's degraded);
    // only the dead "Chờ Sân X" option is suppressed, never the warning itself.
    expect(getByText('⏳ Trận này hơi lệch trình')).toBeTruthy()
    expect(getByTestId('nrv2-decision-play-1')).toBeTruthy()
    expect(queryByTestId('nrv2-decision-wait-1')).toBeNull()
    expect(queryByText(/chờ Sân/)).toBeNull()

    // The explanations list is independent of the rescue banner -- it must still render.
    expect(getByText('Vì sao xếp trận này')).toBeTruthy()
    expect(getByText(`• ${EXPLANATIONS[0]}`)).toBeTruthy()

    // Still seated & startable ("Chơi luôn"): the Start button is present and enabled.
    const startButton = getByTestId('nrv2-start-match-court-1')
    expect(startButton.props.accessibilityState.disabled).toBe(false)
    expect(getByText('Bắt đầu trận')).toBeTruthy()
  })
})
