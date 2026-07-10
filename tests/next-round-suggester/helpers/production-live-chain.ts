import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../../lib/next-round-suggester/fairness/detector'
import {
  buildSuggestedMatchPayloads,
  type BuildSuggestedMatchOptions,
  type SuggestedMatchPayload,
} from '../../../lib/next-round-suggester/live-preview'
import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionState } from '../../../lib/next-round-suggester/types'
import type { DbRows } from './db-rows'

export type AuthoritativeLiveSnapshot = DbRows & {
  sessionId: string
  courtCount: number
  pvnaTolerance: number
  liveStateVersion: number
}

export function runProductionLiveChain({
  snapshot,
  count,
  completingLiveMatchIds = new Set<string>(),
  stripPersistedPreviews = false,
  options = {},
}: {
  snapshot: AuthoritativeLiveSnapshot
  count: number
  completingLiveMatchIds?: Set<string>
  stripPersistedPreviews?: boolean
  options?: BuildSuggestedMatchOptions
}): {
  state: SessionState
  adjustment: ReturnType<typeof correctForFairness>
  warnings: ReturnType<typeof detectFairnessIssues>
  payloads: SuggestedMatchPayload[]
  elapsedMs: number
} {
  const startedAt = performance.now()
  const state = mapRowsToSessionState({
    sessionId: snapshot.sessionId,
    playerRows: snapshot.playerRows,
    pairRows: snapshot.pairRows,
    roundRows: snapshot.roundRows,
    courts: snapshot.courtCount,
    pvnaTolerance: snapshot.pvnaTolerance,
  })
  const adjustment = correctForFairness(state)
  const warnings = detectFairnessIssues(state)
  const liveMatchRows = stripPersistedPreviews
    ? snapshot.liveMatchRows.filter(match => match.status !== 'suggested')
    : snapshot.liveMatchRows
  const playersById = new Map(
    [...state.players.values()].map(player => [player.player_id, { name: player.player_id }]),
  )
  const payloads = buildSuggestedMatchPayloads({
    count,
    sessionId: snapshot.sessionId,
    courtCount: snapshot.courtCount,
    state,
    rows: {
      liveMatchRows,
      liveStateVersion: snapshot.liveStateVersion,
    },
    completingLiveMatchIds,
    fairnessAdjustment: adjustment,
    fairnessWarnings: warnings,
    playersById,
    pvnaTolerance: snapshot.pvnaTolerance,
    options,
  })

  return {
    state,
    adjustment,
    warnings,
    payloads,
    elapsedMs: performance.now() - startedAt,
  }
}

export function persistPreviewRows({
  payloads,
  snapshot,
  sequenceStart,
  suggestedAt = new Date().toISOString(),
}: {
  payloads: SuggestedMatchPayload[]
  snapshot: AuthoritativeLiveSnapshot
  sequenceStart: number
  suggestedAt?: string
}): SessionLiveMatchRow[] {
  return payloads.map((payload, index) => ({
    id: `persisted-preview-${sequenceStart + index}`,
    session_id: snapshot.sessionId,
    sequence_no: sequenceStart + index,
    round_no: payload.round_no,
    court_idx: payload.court_idx,
    status: 'suggested',
    team_a: payload.team_a,
    team_b: payload.team_b,
    resting: payload.resting,
    score_a: 0,
    score_b: 0,
    suggested_at: suggestedAt,
    started_at: null,
    ended_at: null,
  }))
}
