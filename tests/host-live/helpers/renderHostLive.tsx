// Mock boundary reference — real exports of features/host/session-detail/next-round-v2/api.ts
// (verified against source on 2026-07-27, NOT the names assumed by the task brief):
//   invokeLiveSessionFunction, prewarmLiveSessionVersionGuard, loadLatestSyncablePlayerIds,
//   syncLiveRosterFromSessionPlayers, checkInLiveSessionPlayers, checkOutLiveSessionPlayers,
//   repairLiveSessionPlayerStateFromRounds, loadNextRoundSessionSettings, saveNextRoundSessionSettings,
//   markSessionPlayersPresent, loadAvoidPairs, addAvoidPair, removeAvoidPair, setEffectivePvna,
//   createClientTraceId, recordClientSessionAuditEvent, fetchLiveMatchesPreview,
//   startPersistedLiveMatch, persistAndStartLiveMatch, fetchLiveSessionVersion.
//
// IMPORTANT DEVIATION FROM BRIEF: api.ts is NOT the sole I/O boundary for this screen.
// `useLiveSessionQuery` (next-round-v2/queries.ts) calls `supabase.rpc('get_live_session_snapshot_versioned', ...)`
// directly, and the screen itself calls `supabase.from('board_stuck_events').insert(...)` and
// `supabase.rpc('cancel_live_session_match_versioned', ...)` directly — bypassing api.ts entirely.
// mutations.ts also calls `supabase.rpc('complete_live_session_match_versioned', ...)` directly.
// Mocking only api.ts is therefore NOT sufficient to render the screen deterministically: the
// initial board-loading query would otherwise fire a real network call against the live Supabase
// project configured in .env (EXPO_PUBLIC_SUPABASE_URL is inlined into process.env by
// babel-preset-expo at transform time, so it is defined even under Jest). We mock '@/lib/supabase'
// as well, at the lowest practical level (auth/rpc/from stubs), to keep tests hermetic. See
// task-A1-report.md for the full rationale.
//
// IMPLEMENTATION NOTE: every jest.mock(...) factory below returns a self-contained object
// literal — it must NOT read an outer `const` at the factory's top level. Babel hoists ALL
// `import` statements in this file (including the screen import at the bottom) above regular
// statements, so a factory like `() => mockApi` would run before `const mockApi = {...}`
// executes and observe `mockApi` as undefined. Referencing outer state from *inside* a jest.fn's
// async body is fine (that closure only runs later, at call time, once the module has finished
// loading) — only the factory's own top-level return value must be self-contained.

import React from 'react'
import { render, type RenderResult } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { NextRoundSuggesterV2Props } from '@/features/host/session-detail/next-round-v2/types'
import { makeSessionFixture } from './fixtures'

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

const mockDefaultFixture = makeSessionFixture()

jest.mock('@/lib/supabase', () => {
  function mockCreateSupabaseFromStub() {
    const chain: Record<string, unknown> = {}
    const chainable = ['select', 'eq', 'neq', 'in', 'order', 'update', 'insert', 'upsert', 'delete']
    chainable.forEach(method => {
      chain[method] = jest.fn(() => chain)
    })
    chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }))
    chain.single = jest.fn(async () => ({ data: null, error: null }))
    chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)
    return chain
  }

  return {
    supabase: {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: { access_token: 'test-access-token', user: { id: 'test-user' } } }, error: null })),
        refreshSession: jest.fn(async () => ({ data: { session: { access_token: 'test-access-token', user: { id: 'test-user' } } }, error: null })),
      },
      rpc: jest.fn(async (fn: string) => {
        if (fn === 'get_live_session_snapshot_versioned') {
          return { data: mockDefaultFixture.snapshot, error: null }
        }
        return { data: null, error: null }
      }),
      from: jest.fn(() => mockCreateSupabaseFromStub()),
    },
  }
})

jest.mock('@/features/host/session-detail/next-round-v2/api', () => ({
  invokeLiveSessionFunction: jest.fn(async () => ({})),
  prewarmLiveSessionVersionGuard: jest.fn(async () => undefined),
  loadLatestSyncablePlayerIds: jest.fn(async () => []),
  syncLiveRosterFromSessionPlayers: jest.fn(async () => ({ synced: false, playerIds: [] })),
  checkInLiveSessionPlayers: jest.fn(async () => ({})),
  checkOutLiveSessionPlayers: jest.fn(async () => ({})),
  repairLiveSessionPlayerStateFromRounds: jest.fn(async () => ({})),
  loadNextRoundSessionSettings: jest.fn(async () => null),
  saveNextRoundSessionSettings: jest.fn(async () => undefined),
  markSessionPlayersPresent: jest.fn(async () => undefined),
  loadAvoidPairs: jest.fn(async () => []),
  addAvoidPair: jest.fn(async () => undefined),
  removeAvoidPair: jest.fn(async () => undefined),
  setEffectivePvna: jest.fn(async () => undefined),
  createClientTraceId: jest.fn((prefix = 'client') => `${prefix}-test-trace-id`),
  recordClientSessionAuditEvent: jest.fn(async () => undefined),
  fetchLiveMatchesPreview: jest.fn(async () => mockDefaultFixture.previewResponse),
  startPersistedLiveMatch: jest.fn(async () => ({})),
  persistAndStartLiveMatch: jest.fn(async () => ({})),
  fetchLiveSessionVersion: jest.fn(async () => 1),
}))

jest.mock('expo-router', () => {
  const ReactActual = require('react')
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactActual.useEffect(() => effect(), [])
    },
  }
})

jest.mock('react-native-safe-area-context', () => {
  // The upstream mock module uses `export default {...}`; unwrap it so named
  // imports like `useSafeAreaInsets` resolve to real functions under Babel's CJS interop.
  const mock = require('react-native-safe-area-context/jest/mock')
  return mock.default ?? mock
})

// Re-import the now-mocked modules to obtain typed handles for tests to assert on / override
// (e.g. `mockApi.fetchLiveMatchesPreview.mockResolvedValueOnce(...)`). Safe to do here because,
// unlike the factories above, these run against an already-registered mock.
import { supabase as mockedSupabase } from '@/lib/supabase'
import * as mockedApi from '@/features/host/session-detail/next-round-v2/api'
import { router as mockedRouter } from 'expo-router'

export const mockSupabaseAuth = mockedSupabase.auth as unknown as {
  getSession: jest.Mock
  refreshSession: jest.Mock
}
export const mockSupabaseRpc = mockedSupabase.rpc as unknown as jest.Mock
export const mockSupabaseFrom = mockedSupabase.from as unknown as jest.Mock
export const mockApi = mockedApi as unknown as {
  [K in keyof typeof mockedApi]: jest.Mock
}
export const mockRouter = mockedRouter as unknown as {
  push: jest.Mock
  replace: jest.Mock
  back: jest.Mock
}

// Imported after the mocks above so the screen module picks them up.
// eslint-disable-next-line import/first
import { NextRoundSuggesterScreenV2 } from '@/features/host/session-detail/NextRoundSuggesterScreenV2'

export function renderHostLiveScreen(props: Partial<NextRoundSuggesterV2Props> = {}): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const defaults: NextRoundSuggesterV2Props = {
    sessionId: mockDefaultFixture.sessionId,
    players: mockDefaultFixture.players,
    courts: 1,
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <NextRoundSuggesterScreenV2 {...defaults} {...props} />
    </QueryClientProvider>,
  )
}
