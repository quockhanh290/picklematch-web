const mockGetSession = jest.fn(async () => ({
  data: { session: { access_token: 'test-access-token' } },
}))
const mockRpc = jest.fn()

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      refreshSession: jest.fn(),
    },
    rpc: mockRpc,
  },
}))

describe('live preview request ownership', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey
    jest.restoreAllMocks()
  })

  it('does not share an abortable request between effect generations', async () => {
    const responses: Array<(response: Response) => void> = []
    const fetchMock = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      responses.push(resolve)
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))
    global.fetch = fetchMock as typeof fetch

    const { fetchLiveMatchesPreview } = require('../../features/host/session-detail/next-round-v2/api') as typeof import('../../features/host/session-detail/next-round-v2/api')
    const body = {
      count: 1,
      court_count: 1,
      pvna_tolerance: 0.5,
      live_match_rows: [],
      live_state_version: 1,
      completing_live_match_ids: [],
      players: [],
      player_rows: [],
      pair_rows: [],
      round_rows: [],
    }
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = fetchLiveMatchesPreview('session-1', body, { signal: firstController.signal })
    const second = fetchLiveMatchesPreview('session-1', body, { signal: secondController.signal })

    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    firstController.abort()
    responses[1](new Response(JSON.stringify({ ok: true, payloads: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(first).rejects.toThrow('Request cancelled')
    await expect(second).resolves.toMatchObject({ ok: true, payloads: [] })
  })

  it('persists a manual lineup before starting it by persisted identity', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        live_state_version: 8,
        matches: [{ id: 'persisted-match-1' }],
      },
      error: null,
    })
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      ok: true,
      live_state_version: 9,
      match: { id: 'persisted-match-1', status: 'live' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    global.fetch = fetchMock as typeof fetch
    const { persistAndStartLiveMatch } = require('../../features/host/session-detail/next-round-v2/api') as typeof import('../../features/host/session-detail/next-round-v2/api')

    await expect(persistAndStartLiveMatch('session-1', {
      expectedLiveStateVersion: 7,
      match: { court_idx: 1, team_a: ['p1', 'p2'], team_b: ['p3', 'p4'], resting: [], round_no: 2 },
      auditPayload: { client_request_id: 'request-1' },
    })).resolves.toMatchObject({ match: { id: 'persisted-match-1', status: 'live' } })

    expect(mockRpc).toHaveBeenCalledWith('replace_manual_live_session_suggestion_versioned', expect.objectContaining({
      p_expected_live_state_version: 7,
      p_match: expect.objectContaining({
        court_idx: 1,
        team_a: ['p1', 'p2'],
        team_b: ['p3', 'p4'],
      }),
    }))
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_matches')
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_replace_all')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      expected_live_state_version: 8,
      match_id: 'persisted-match-1',
    })
  })
})
