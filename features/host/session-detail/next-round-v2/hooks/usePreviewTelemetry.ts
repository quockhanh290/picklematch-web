import { useCallback, useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'
import { recordClientSessionAuditEvent } from '../api'

// Board-stuck observability (read-only — no recovery logic touched)
export const STUCK_THRESHOLD_MS = 5000

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export type StuckTracker = {
  startedAt: number
  firedAt: number | null
  kind: string
  courtIdxs: number[]
  resolvedBy: string
  timer: ReturnType<typeof setTimeout> | null
} | null

export type PreviewTelemetryTraceInput = {
  requestId?: string | null
  requestPayload?: unknown
  responsePayload?: unknown
  detail?: unknown
}

export function usePreviewTelemetry(sessionId: string) {
  const stuckTrackerRef = useRef<StuckTracker>(null)
  const lastStuckHintRef = useRef<{ kind: string; courtIdxs: number[] }>({ kind: 'unknown', courtIdxs: [] })

  const trace = useCallback((
    eventType: string,
    input: PreviewTelemetryTraceInput = {},
  ) => {
    void recordClientSessionAuditEvent(sessionId, eventType, {
      requestId: input.requestId ?? null,
      clientRequestId: input.requestId ?? null,
      requestPayload: input.requestPayload,
      responsePayload: input.responsePayload,
      detail: {
        screen: 'NextRoundSuggesterScreenV2',
        ...(input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail)
          ? input.detail as Record<string, unknown>
          : input.detail === undefined
            ? {}
            : { value: input.detail }),
      },
    })
  }, [sessionId])

  // ── Board-stuck tracker (observability only) ──────────────────────────────
  const resolveStuckTracker = useCallback((resolvedBy: string) => {
    const tracker = stuckTrackerRef.current
    if (!tracker) return
    if (tracker.timer) clearTimeout(tracker.timer)
    stuckTrackerRef.current = null
    if (tracker.firedAt === null) return
    try {
      supabase.from('board_stuck_events').insert({
        session_id: sessionId,
        stuck_kind: tracker.kind,
        court_idxs: tracker.courtIdxs,
        duration_ms: Math.round(nowMs() - tracker.startedAt),
        resolved_by: resolvedBy,
        detail: {},
      }).then(({ error }) => {
        if (error && __DEV__) console.warn('[stuck-tracker] insert failed', error.message)
      })
    } catch { /* noop */ }
  }, [sessionId])

  useEffect(() => {
    return () => { resolveStuckTracker('unresolved') }
  }, [resolveStuckTracker])
  // ── end board-stuck tracker ───────────────────────────────────────────────

  return { trace, stuckTrackerRef, lastStuckHintRef, resolveStuckTracker }
}
