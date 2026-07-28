import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, Platform } from 'react-native'

export type ScrollDebugMetrics = {
  viewportHeight: number | null
  visualViewportHeight: number | null
  innerHeight: number | null
  layoutHeight: number | null
  contentHeight: number | null
  scrollY: number
  distanceToBottom: number | null
}

function getWebVisualViewportHeight() {
  if (Platform.OS !== 'web') return null
  if (typeof window === 'undefined') return null
  const visualViewportHeight = window.visualViewport?.height
  if (typeof visualViewportHeight === 'number' && Number.isFinite(visualViewportHeight)) {
    return Math.round(visualViewportHeight)
  }
  return Math.round(window.innerHeight || Dimensions.get('window').height)
}

function isScrollDebugEnabled() {
  if (Platform.OS !== 'web') return false
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return params.get('debugScroll') === '1'
      || hashParams.get('debugScroll') === '1'
      || window.localStorage?.getItem('nrv2ScrollDebug') === '1'
  } catch {
    return false
  }
}

function getWebDocumentScrollMetrics(): Partial<ScrollDebugMetrics> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return {}
  const doc = document.documentElement
  const body = document.body
  const layoutHeight = Math.round(window.visualViewport?.height ?? window.innerHeight ?? doc.clientHeight ?? 0)
  const contentHeight = Math.round(Math.max(
    doc.scrollHeight,
    body?.scrollHeight ?? 0,
    doc.offsetHeight,
    body?.offsetHeight ?? 0,
  ))
  const scrollY = Math.round(window.scrollY ?? doc.scrollTop ?? body?.scrollTop ?? 0)
  return { layoutHeight, contentHeight, scrollY }
}

export function useScrollDebug() {
  const [webViewportHeight, setWebViewportHeight] = useState<number | null>(() => getWebVisualViewportHeight())
  const scrollDebugEnabled = useMemo(() => isScrollDebugEnabled(), [])
  const [scrollDebugMetrics, setScrollDebugMetrics] = useState<ScrollDebugMetrics>({
    viewportHeight: getWebVisualViewportHeight(),
    visualViewportHeight: null,
    innerHeight: null,
    layoutHeight: null,
    contentHeight: null,
    scrollY: 0,
    distanceToBottom: null,
  })
  const scrollDebugMetricsRef = useRef(scrollDebugMetrics)

  const updateScrollDebugMetrics = useCallback((patch: Partial<ScrollDebugMetrics>) => {
    if (!scrollDebugEnabled) return
    const visualViewportHeight = typeof window !== 'undefined' && typeof window.visualViewport?.height === 'number'
      ? Math.round(window.visualViewport.height)
      : null
    const innerHeight = typeof window !== 'undefined' ? Math.round(window.innerHeight || 0) : null
    const next = {
      ...scrollDebugMetricsRef.current,
      viewportHeight: getWebVisualViewportHeight(),
      visualViewportHeight,
      innerHeight,
      ...patch,
    }
    next.distanceToBottom = next.contentHeight != null && next.layoutHeight != null
      ? Math.round(next.contentHeight - next.layoutHeight - next.scrollY)
      : null
    scrollDebugMetricsRef.current = next
    setScrollDebugMetrics(next)
  }, [scrollDebugEnabled])

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return

    let frame: number | null = null
    const updateViewportHeight = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const nextHeight = getWebVisualViewportHeight()
        setWebViewportHeight(current => current === nextHeight ? current : nextHeight)
        updateScrollDebugMetrics({ viewportHeight: nextHeight, ...getWebDocumentScrollMetrics() })
      })
    }

    updateViewportHeight()
    window.addEventListener('resize', updateViewportHeight)
    window.addEventListener('scroll', updateViewportHeight, { passive: true })
    window.addEventListener('orientationchange', updateViewportHeight)
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    window.visualViewport?.addEventListener('scroll', updateViewportHeight)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateViewportHeight)
      window.removeEventListener('scroll', updateViewportHeight)
      window.removeEventListener('orientationchange', updateViewportHeight)
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight)
    }
  }, [updateScrollDebugMetrics])

  return { scrollDebugMetrics, updateScrollDebugMetrics, webViewportHeight, scrollDebugEnabled }
}
