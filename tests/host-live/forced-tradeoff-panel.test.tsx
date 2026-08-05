// Task 1 (forced-court-tradeoff-client): proves SuggestedLiveMatchCard re-sources its unified
// decision panel from `match.forced_tradeoff` + `match.wait_rescue_options` (Plan 1-2 engine
// fields) instead of `tradeoff_choices` / `rescue_court_idxs` when the court is FORCED (no clean
// lineup available). Modeled on tests/host-live/characterization/wait-rescue-banner.test.tsx:
// same renderHostLiveScreen/mockApi/mockSupabaseRpc harness, same "court 0 live -> court 1 is the
// only open lane -> engine requests full_board -> mocked edge returns exactly one controlled
// match" mount pattern.
//
// Card logic pinned here (read directly off ScreenComponents.tsx, not assumed):
//   forced = match.forced_tradeoff; forcedWait = match.wait_rescue_options ?? []
//   forcedSelection state, default 'accept_repeat', drives which of forced.acceptRepeat /
//   forced.acceptImbalance is fed into the displayed lineup (SuggestedMatchTile team_a/team_b).
//   decisionCards (forced branch): accept_repeat ('Chịu lặp'), accept_imbalance ('Chịu lệch'),
//   and — only when forcedWait.length > 0 — wait ('Chờ Sân {idx+1}').
//   testIDs: nrv2-decision-accept_repeat-${courtIdx}, nrv2-decision-accept_imbalance-${courtIdx},
//   nrv2-decision-wait-${courtIdx}.

import { act, fireEvent, waitFor } from '@testing-library/react-native'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
import { renderHostLiveScreen, mockApi, mockSupabaseRpc } from './helpers/renderHostLive'

jest.setTimeout(30000)

const SESSION_ID = 'forced-tradeoff-panel-session'
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

// p5+p6 already played together once (partner_count 1) -> acceptRepeat's team_a pairing is a
// genuine 2nd-meeting repeat. acceptImbalance repairs to p5+p7 / p6+p8, both fresh (count 0).
function buildSnapshot() {
  return {
    live_state_version: 1,
    player_rows: SEEDS.map(buildPlayerStateRow),
    registered_player_rows: SEEDS.map(buildRegisteredPlayerRow),
    pair_rows: [
      { session_id: SESSION_ID, player_a: 'p5', player_b: 'p6', partner_count: 1, opponent_count: 0 },
    ],
    round_rows: [],
    live_match_rows: [LIVE_MATCH_COURT_0],
  }
}

const ACCEPT_REPEAT = { team_a: ['p5', 'p6'] as [string, string], team_b: ['p7', 'p8'] as [string, string] }
const ACCEPT_IMBALANCE = { team_a: ['p5', 'p7'] as [string, string], team_b: ['p6', 'p8'] as [string, string] }

function buildForcedPreviewResponse(options: { wait_rescue_options: { court_idx: number; started_at: string | null }[] }) {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-1-forced-match',
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
        wait_rescue_options: options.wait_rescue_options,
      },
    ],
  }
}

// Clean (non-forced) court fixture for the "no forced_tradeoff" case: no repeat/imbalance data at
// all, plain suggested lineup.
function buildCleanPreviewResponse() {
  return {
    ok: true as const,
    live_state_version: 1,
    live_state_version_used: 1,
    payloads: [] as unknown[],
    final_preview_board: [
      {
        id: 'edge-court-1-clean-match',
        session_id: SESSION_ID,
        sequence_no: 1,
        round_no: 1,
        court_idx: 1,
        status: 'suggested' as const,
        team_a: ['p5', 'p7'] as [string, string],
        team_b: ['p6', 'p8'] as [string, string],
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

describe('SuggestedLiveMatchCard: forced-court decision panel from forced_tradeoff data', () => {
  it('shows Chịu lặp (default, selected) + Chịu lệch + Chờ Sân 3 for a forced court, lineup defaults to acceptRepeat', async () => {
    const { getByTestId } = await mountWithPreview(
      buildForcedPreviewResponse({ wait_rescue_options: [{ court_idx: 2, started_at: '2026-07-27T00:10:00.000Z' }] }),
    )

    const acceptRepeatCard = getByTestId('nrv2-decision-accept_repeat-1')
    const acceptImbalanceCard = getByTestId('nrv2-decision-accept_imbalance-1')
    const waitCard = getByTestId('nrv2-decision-wait-1')
    expect(acceptRepeatCard).toBeTruthy()
    expect(acceptImbalanceCard).toBeTruthy()
    expect(waitCard).toBeTruthy()

    // Default selection = accept_repeat.
    expect(acceptRepeatCard.props.accessibilityState.selected).toBe(true)
    expect(acceptImbalanceCard.props.accessibilityState.selected).toBe(false)
    expect(waitCard.props.accessibilityState.selected).toBe(false)

    // court_idx 2 -> "Sân 3" (1-indexed display).
    expect(waitCard).toHaveTextContent('Chờ Sân 3', { exact: false })

    // Displayed lineup = acceptRepeat's teams: p5+p6 total pvna 6.8, p7+p8 total pvna 6.9.
    expect(getByTestId('nrv2-suggested-card-court-1')).toHaveTextContent('6.8', { exact: false })
    expect(getByTestId('nrv2-suggested-card-court-1')).toHaveTextContent('6.9', { exact: false })
  })

  it('hides the Chờ option when wait_rescue_options is empty', async () => {
    const { queryByTestId } = await mountWithPreview(buildForcedPreviewResponse({ wait_rescue_options: [] }))

    expect(queryByTestId('nrv2-decision-accept_repeat-1')).toBeTruthy()
    expect(queryByTestId('nrv2-decision-accept_imbalance-1')).toBeTruthy()
    expect(queryByTestId('nrv2-decision-wait-1')).toBeNull()
  })

  it('tapping Chịu lệch swaps the displayed lineup to acceptImbalance', async () => {
    const { getByTestId } = await mountWithPreview(
      buildForcedPreviewResponse({ wait_rescue_options: [{ court_idx: 2, started_at: null }] }),
    )

    await act(async () => {
      fireEvent.press(getByTestId('nrv2-decision-accept_imbalance-1'))
    })

    expect(getByTestId('nrv2-decision-accept_imbalance-1').props.accessibilityState.selected).toBe(true)
    expect(getByTestId('nrv2-decision-accept_repeat-1').props.accessibilityState.selected).toBe(false)

    // acceptImbalance's teams: p5+p7 total pvna 8.2, p6+p8 total pvna 5.5 -- distinct from the
    // acceptRepeat totals (6.8 / 6.9) asserted above, proving the lineup actually swapped.
    expect(getByTestId('nrv2-suggested-card-court-1')).toHaveTextContent('8.2', { exact: false })
    expect(getByTestId('nrv2-suggested-card-court-1')).toHaveTextContent('5.5', { exact: false })
  })

  it('a court with NO forced_tradeoff renders the plain lineup and none of the forced decision testIDs', async () => {
    const { queryByTestId, getByTestId } = await mountWithPreview(buildCleanPreviewResponse())

    expect(getByTestId('nrv2-suggested-card-court-1')).toBeTruthy()
    expect(queryByTestId('nrv2-decision-accept_repeat-1')).toBeNull()
    expect(queryByTestId('nrv2-decision-accept_imbalance-1')).toBeNull()
    expect(queryByTestId('nrv2-decision-wait-1')).toBeNull()
  })
})

// Task 2 (forced-court-tradeoff-client): wires "Chờ Sân Y" to useLiveBoard's wait-rescue
// re-suggest (generalizing isDegradedMatchAwaitingRescue -> also isForcedWaitAwaitingRescue,
// armed via setForcedWaitSelection from the card's wait decision, sourced from
// match.wait_rescue_options instead of rescue_court_idxs) and persists the host's forced
// choice on Start (SuggestedLiveMatchCard's activeMatch stamps preview_source:
// 'forced_tradeoff_manual' whenever the displayed lineup no longer matches what the server
// already committed, routing Start through persistAndStartLiveMatch instead of the
// match_id-only startPersistedLiveMatch fast path). Modeled on
// tests/host-live/characterization/wait-rescue-resuggest.test.tsx for the re-suggest half.
describe('Task 2: Chờ Sân Y wires the verified wait re-suggest + persists the forced choice on start', () => {
  it('tapping Chờ Sân 1 parks the court in a waiting state, does not start, and arms a re-suggest that fires when court 0 completes', async () => {
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
    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(
      buildForcedPreviewResponse({ wait_rescue_options: [{ court_idx: 0, started_at: CHECKED_IN_AT }] }),
    )
    jest.useFakeTimers()

    const { getByTestId } = renderHostLiveScreen({
      sessionId: SESSION_ID,
      players: PLAYERS,
      courts: 2,
    })

    await act(async () => { await jest.advanceTimersByTimeAsync(0) })
    await act(async () => { await jest.advanceTimersByTimeAsync(80) })
    await act(async () => { await jest.advanceTimersByTimeAsync(0) })

    // court_idx 0 -> "Sân 1" (1-indexed display) -- the live court this forced court is waiting on.
    expect(getByTestId('nrv2-decision-wait-1')).toHaveTextContent('Chờ Sân 1', { exact: false })

    await act(async () => {
      fireEvent.press(getByTestId('nrv2-decision-wait-1'))
    })

    expect(getByTestId('nrv2-decision-wait-1').props.accessibilityState.selected).toBe(true)
    expect(getByTestId('nrv2-start-match-court-1').props.accessibilityState.disabled).toBe(true)

    mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce({
      ok: true as const,
      live_state_version: 2,
      live_state_version_used: 2,
      payloads: [] as unknown[],
      final_preview_board: [] as unknown[],
    })

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

    // The completion fires a follow-up preview request that MUST target court 1 -- the forced
    // court the host is explicitly waiting on -- so it gets re-suggested (Plan 1 guarantees the
    // wait was verified-clean, so the panel disappears once the fresh lineup lands).
    await waitFor(() => {
      expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(2)
    }, { timeout: 10000 })
    const requestBody = mockApi.fetchLiveMatchesPreview.mock.calls[1][1] as { mode: string; court_idxs?: number[] }
    if (requestBody.mode === 'replace_courts') {
      expect(requestBody.court_idxs).toEqual(expect.arrayContaining([1]))
    } else {
      expect(requestBody.mode).toBe('full_board')
    }
  }, 25000)

  it('starting after picking Chịu lệch persists + starts the acceptImbalance lineup (not acceptRepeat)', async () => {
    const { getByTestId } = await mountWithPreview(buildForcedPreviewResponse({ wait_rescue_options: [] }))

    await act(async () => {
      fireEvent.press(getByTestId('nrv2-decision-accept_imbalance-1'))
    })
    expect(getByTestId('nrv2-decision-accept_imbalance-1').props.accessibilityState.selected).toBe(true)

    fireEvent.press(getByTestId('nrv2-start-match-court-1'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50)
    })

    expect(mockApi.persistAndStartLiveMatch).toHaveBeenCalledTimes(1)
    expect(mockApi.startPersistedLiveMatch).not.toHaveBeenCalled()
    const [sessionIdArg, payloadArg] = mockApi.persistAndStartLiveMatch.mock.calls[0]
    expect(sessionIdArg).toBe(SESSION_ID)
    expect(payloadArg.match.team_a).toEqual(ACCEPT_IMBALANCE.team_a)
    expect(payloadArg.match.team_b).toEqual(ACCEPT_IMBALANCE.team_b)
  })

  it('starting with the default Chịu lặp selection uses the already-committed persisted-start path', async () => {
    const { getByTestId } = await mountWithPreview(buildForcedPreviewResponse({ wait_rescue_options: [] }))

    fireEvent.press(getByTestId('nrv2-start-match-court-1'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50)
    })

    expect(mockApi.startPersistedLiveMatch).toHaveBeenCalledTimes(1)
    expect(mockApi.persistAndStartLiveMatch).not.toHaveBeenCalled()
    expect(mockApi.startPersistedLiveMatch.mock.calls[0][1]).toMatchObject({
      match_id: 'edge-court-1-forced-match',
    })
  })
})

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
