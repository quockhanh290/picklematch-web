import { renderHook, act } from '@testing-library/react-native'

// usePreviewTelemetry -> @/lib/supabase -> lib/storage.ts -> AsyncStorage; needs the same
// mocks the host-live screen harness uses (tests/host-live/helpers/renderHostLive.tsx),
// otherwise importing the hook throws at module-load time in Jest (missing AsyncStorage
// native module, then missing EXPO_PUBLIC_SUPABASE_* env vars in a bare `jest` shell).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(async () => ({ error: null })),
    })),
  },
}))

import { usePreviewTelemetry } from '@/features/host/session-detail/next-round-v2/hooks/usePreviewTelemetry'
import * as api from '@/features/host/session-detail/next-round-v2/api'

describe('usePreviewTelemetry', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('trace forwards event to the audit queue with sessionId + eventType', () => {
    const spy = jest.spyOn(api, 'recordClientSessionAuditEvent').mockImplementation(async () => undefined)
    const { result } = renderHook(() => usePreviewTelemetry('s1'))

    act(() => {
      result.current.trace('client_preview_blocked_incomplete_noop', { detail: { court: 2 } })
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('s1', 'client_preview_blocked_incomplete_noop', {
      requestId: null,
      clientRequestId: null,
      requestPayload: undefined,
      responsePayload: undefined,
      detail: { screen: 'NextRoundSuggesterScreenV2', court: 2 },
    })
  })

  it('trace defaults detail to just the screen tag when called with no input', () => {
    const spy = jest.spyOn(api, 'recordClientSessionAuditEvent').mockImplementation(async () => undefined)
    const { result } = renderHook(() => usePreviewTelemetry('s1'))

    act(() => {
      result.current.trace('client_start_blocked_untrusted_preview')
    })

    expect(spy).toHaveBeenCalledWith('s1', 'client_start_blocked_untrusted_preview', {
      requestId: null,
      clientRequestId: null,
      requestPayload: undefined,
      responsePayload: undefined,
      detail: { screen: 'NextRoundSuggesterScreenV2' },
    })
  })

  it('trace forwards requestId as both requestId and clientRequestId, plus request/response payloads', () => {
    const spy = jest.spyOn(api, 'recordClientSessionAuditEvent').mockImplementation(async () => undefined)
    const { result } = renderHook(() => usePreviewTelemetry('s1'))

    act(() => {
      result.current.trace('client_preview_edge_response', {
        requestId: 'req-1',
        requestPayload: { court_idxs: [1] },
        responsePayload: { ok: true },
      })
    })

    expect(spy).toHaveBeenCalledWith('s1', 'client_preview_edge_response', {
      requestId: 'req-1',
      clientRequestId: 'req-1',
      requestPayload: { court_idxs: [1] },
      responsePayload: { ok: true },
      detail: { screen: 'NextRoundSuggesterScreenV2' },
    })
  })

  it('trace wraps a non-object detail value under a `value` key', () => {
    const spy = jest.spyOn(api, 'recordClientSessionAuditEvent').mockImplementation(async () => undefined)
    const { result } = renderHook(() => usePreviewTelemetry('s1'))

    act(() => {
      result.current.trace('client_preview_request_cancelled', { detail: 'stale' })
    })

    expect(spy).toHaveBeenCalledWith('s1', 'client_preview_request_cancelled', expect.objectContaining({
      detail: { screen: 'NextRoundSuggesterScreenV2', value: 'stale' },
    }))
  })

  it('exposes the stuck-tracker refs and a resolveStuckTracker that safely no-ops when nothing is armed', () => {
    const { result } = renderHook(() => usePreviewTelemetry('s1'))

    expect(result.current.stuckTrackerRef.current).toBeNull()
    expect(result.current.lastStuckHintRef.current).toEqual({ kind: 'unknown', courtIdxs: [] })

    expect(() => {
      act(() => {
        result.current.resolveStuckTracker('unresolved')
      })
    }).not.toThrow()

    expect(result.current.stuckTrackerRef.current).toBeNull()
  })
})
