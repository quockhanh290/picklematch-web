export type NextRoundTelemetryStage =
  | 'route_mount'
  | 'screen_shell_paint'
  | 'rows_request_start'
  | 'rows_loaded'
  | 'state_mapped'
  | 'suggestion_ready'
  | 'preview_request_scheduled'
  | 'preview_request_start'
  | 'preview_ready'

type StageEvent = {
  stage: NextRoundTelemetryStage
  atMs: number
  sinceRouteMs: number | null
  detail?: Record<string, unknown>
}

export type NextRoundTelemetrySnapshot = {
  sessionId: string
  routeStartedAtMs: number
  stages: Partial<Record<NextRoundTelemetryStage, number>>
  stageDurationsMs: Partial<Record<NextRoundTelemetryStage, number>>
  events: StageEvent[]
  lastUpdatedAtMs: number
}

const GLOBAL_KEY = '__NEXT_ROUND_V2_TELEMETRY__'

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

function globalBag(): any {
  return globalThis as any
}

function ensureTelemetry(sessionId: string): NextRoundTelemetrySnapshot {
  const bag = globalBag()
  const current = bag[GLOBAL_KEY] as NextRoundTelemetrySnapshot | undefined
  if (current?.sessionId === sessionId) return current

  const startedAt = nowMs()
  const next: NextRoundTelemetrySnapshot = {
    sessionId,
    routeStartedAtMs: startedAt,
    stages: {},
    stageDurationsMs: {},
    events: [],
    lastUpdatedAtMs: startedAt,
  }
  bag[GLOBAL_KEY] = next
  return next
}

export function resetNextRoundTelemetry(sessionId: string, detail?: Record<string, unknown>) {
  const startedAt = nowMs()
  const next: NextRoundTelemetrySnapshot = {
    sessionId,
    routeStartedAtMs: startedAt,
    stages: {},
    stageDurationsMs: {},
    events: [],
    lastUpdatedAtMs: startedAt,
  }
  globalBag()[GLOBAL_KEY] = next
  markNextRoundStage(sessionId, 'route_mount', detail)
  return next
}

export function markNextRoundStage(
  sessionId: string,
  stage: NextRoundTelemetryStage,
  detail?: Record<string, unknown>,
  options: { firstOnly?: boolean } = { firstOnly: true },
) {
  const telemetry = ensureTelemetry(sessionId)
  if (options.firstOnly !== false && telemetry.stages[stage] != null) return telemetry

  const atMs = nowMs()
  const sinceRouteMs = telemetry.stages.route_mount != null
    ? atMs - telemetry.stages.route_mount
    : atMs - telemetry.routeStartedAtMs

  telemetry.stages[stage] = atMs
  telemetry.stageDurationsMs[stage] = Math.round(sinceRouteMs)
  telemetry.events.push({
    stage,
    atMs: Math.round(atMs),
    sinceRouteMs: Math.round(sinceRouteMs),
    detail,
  })
  telemetry.lastUpdatedAtMs = atMs

  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    try {
      performance.mark(`next-round-v2:${stage}`)
    } catch {
      // Performance marks are diagnostics only.
    }
  }

  return telemetry
}

export function getNextRoundTelemetry(sessionId: string) {
  return ensureTelemetry(sessionId)
}
