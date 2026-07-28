import { renderHook, act } from '@testing-library/react-native'

import { useScrollDebug } from '@/features/host/session-detail/next-round-v2/hooks/useScrollDebug'

describe('useScrollDebug', () => {
  it('exposes scroll-debug state + updater + webViewportHeight', () => {
    const { result } = renderHook(() => useScrollDebug())

    expect(result.current).toHaveProperty('scrollDebugMetrics')
    expect(result.current).toHaveProperty('webViewportHeight')
    expect(result.current).toHaveProperty('scrollDebugEnabled')
    expect(typeof result.current.updateScrollDebugMetrics).toBe('function')

    expect(result.current.scrollDebugMetrics).toEqual({
      viewportHeight: null,
      visualViewportHeight: null,
      innerHeight: null,
      layoutHeight: null,
      contentHeight: null,
      scrollY: 0,
      distanceToBottom: null,
    })
  })

  it('updateScrollDebugMetrics is a guarded no-op when scroll-debug is disabled (non-web test platform)', () => {
    const { result } = renderHook(() => useScrollDebug())
    const before = result.current.scrollDebugMetrics

    expect(result.current.scrollDebugEnabled).toBe(false)

    act(() => {
      result.current.updateScrollDebugMetrics({ layoutHeight: 640, contentHeight: 900, scrollY: 120 })
    })

    expect(result.current.scrollDebugMetrics).toBe(before)
    expect(result.current.scrollDebugMetrics).toEqual({
      viewportHeight: null,
      visualViewportHeight: null,
      innerHeight: null,
      layoutHeight: null,
      contentHeight: null,
      scrollY: 0,
      distanceToBottom: null,
    })
  })
})
