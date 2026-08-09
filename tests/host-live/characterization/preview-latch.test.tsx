// TEMP audit repro (read-only investigation). Not part of the repo test suite:
// jest testMatch only picks up tests/**, this file is run via an explicit --testMatch override.
import React from 'react'
import { act, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { SessionLiveMatchRow, SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'
// helper import MUST come first: it registers the jest.mock factories and pulls in the screen
import { mockApi, mockSupabaseRpc } from '@/tests/host-live/helpers/renderHostLive'
import { NextRoundSuggesterScreenV2 } from '@/features/host/session-detail/NextRoundSuggesterScreenV2'
import { liveSessionQueryKeys } from '@/features/host/session-detail/next-round-v2/queries'

const SESSION_ID = 'latch-repro-session'
const AT = '2026-07-27T00:00:00.000Z'

type Seed = { id: string; name: string; pvna: number; gender: 'male' | 'female' }
const SEEDS: Seed[] = Array.from({ length: 16 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `P${i + 1}`,
  pvna: 3 + ((i % 5) * 0.1),
  gender: i % 2 === 0 ? 'male' : 'female',
}))

const eloFor = (pvna: number) => Math.round(pvna * 400)

function arrangementPlayer(seed: Seed): ArrangementPlayer {
  const elo = eloFor(seed.pvna)
  return {
    id: seed.id, name: seed.name, elo, team: 0, reliability: 90,
    levelId: getLevelIdForElo(elo), skillTag: 'PVNA', gender: seed.gender,
    pvna: seed.pvna, status: 'confirmed', checkInStatus: 'present', metadata: null,
  }
}
function playerStateRow(seed: Seed): SessionPlayerStateRow {
  const elo = eloFor(seed.pvna)
  return {
    session_id: SESSION_ID, player_id: seed.id, group_id: null, checked_in_at: AT,
    checked_out_at: null, matches_played: 0, last_played_round: 0, consecutive_rest: 0,
    consecutive_play: 0, opted_rest: false,
    players: {
      name: seed.name, pvna: seed.pvna, current_elo: elo, elo, gender: seed.gender,
      partner_gender_pref: null, opponent_gender_pref: null,
    },
    session_players: { metadata: null },
  } as SessionPlayerStateRow
}
function registeredRow(seed: Seed): RegisteredSessionPlayerRow {
  const elo = eloFor(seed.pvna)
  return {
    player_id: seed.id, team_no: 0, status: 'confirmed', check_in_status: 'present', metadata: null,
    players: {
      name: seed.name, pvna: seed.pvna, current_elo: elo, elo, gender: seed.gender,
      reliability_score: 90, sessions_joined: 5, no_show_count: 0,
      self_assessed_level: null, skill_label: null,
      partner_gender_pref: null, opponent_gender_pref: null,
    },
  } as RegisteredSessionPlayerRow
}

const LIVE_COURT_0: SessionLiveMatchRow = {
  id: 'live-court-0', session_id: SESSION_ID, sequence_no: 0, round_no: 0, court_idx: 0,
  status: 'live', team_a: ['p1', 'p2'], team_b: ['p3', 'p4'], resting: [],
  score_a: 0, score_b: 0, suggested_at: AT, started_at: AT, ended_at: null,
}
// what a successful start on court 1 writes into the query cache via applyLiveMatches()
const LIVE_COURT_1: SessionLiveMatchRow = {
  id: 'live-court-1', session_id: SESSION_ID, sequence_no: 1, round_no: 0, court_idx: 1,
  status: 'live', team_a: ['p5', 'p6'], team_b: ['p7', 'p8'], resting: [],
  score_a: 0, score_b: 0, suggested_at: AT, started_at: AT, ended_at: null,
}

const snapshot = () => ({
  live_state_version: 1,
  player_rows: SEEDS.map(playerStateRow),
  registered_player_rows: SEEDS.map(registeredRow),
  pair_rows: [],
  round_rows: [],
  live_match_rows: [LIVE_COURT_0],
})

describe('preview in-flight latch repro', () => {
  afterEach(() => { jest.useRealTimers() })

  it('a rows change while a started preview request is in flight drops the re-request', async () => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockSupabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_live_session_snapshot_versioned') return { data: snapshot(), error: null }
      return { data: null, error: null }
    })
    // faithful stand-in for api.ts fetchJsonWithTimeout: an aborted caller signal
    // rejects the request with 'Request cancelled.' (api.ts:96-97)
    mockApi.fetchLiveMatchesPreview.mockImplementation((_sid: string, _body: unknown, opts: any) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener?.('abort', () => reject(new Error('Request cancelled.')))
      }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <NextRoundSuggesterScreenV2 sessionId={SESSION_ID} players={SEEDS.map(arrangementPlayer)} courts={3} />
      </QueryClientProvider>,
    )

    await act(async () => { await jest.advanceTimersByTimeAsync(0) })
    await act(async () => { await jest.advanceTimersByTimeAsync(80) })
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(1)
    const firstBody = mockApi.fetchLiveMatchesPreview.mock.calls[0][1]

    // simulate startLiveMatch success: applyLiveMatches -> queryClient.setQueryData
    await act(async () => {
      queryClient.setQueryData(liveSessionQueryKeys.detail(SESSION_ID), (current: any) => ({
        ...current,
        liveMatchRows: [...current.liveMatchRows, LIVE_COURT_1],
        liveStateVersion: 2,
      }))
    })
    await act(async () => { await jest.advanceTimersByTimeAsync(0) })
    await act(async () => { await jest.advanceTimersByTimeAsync(200) })
    await act(async () => { await jest.advanceTimersByTimeAsync(10000) })

    // eslint-disable-next-line no-console
    console.log('REPRO preview calls =', mockApi.fetchLiveMatchesPreview.mock.calls.length,
      'first body courts =', JSON.stringify((firstBody as any)?.court_idxs), (firstBody as any)?.mode)
    expect(mockApi.fetchLiveMatchesPreview).toHaveBeenCalledTimes(2)
  })
})
