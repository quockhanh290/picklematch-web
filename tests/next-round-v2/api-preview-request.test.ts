const mockGetSession = jest.fn(async () => ({
  data: { session: { access_token: 'test-access-token' } },
}))

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      refreshSession: jest.fn(),
    },
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
})
