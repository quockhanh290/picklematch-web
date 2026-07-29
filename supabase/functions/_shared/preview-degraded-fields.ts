// Re-attaches degraded-preview fields that the persistence RPC does not store.
// `replace_live_session_suggestions_versioned` / `replace_planned_live_session_suggestions_versioned`
// only INSERT 8 columns (session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting) —
// `degraded_reason` / `rescue_court_idxs` / `match_explanations` set by the engine are dropped on the
// persist round-trip. Both fixes below run purely on in-memory payloads (no DB/Deno APIs) so they can be
// unit-tested without spinning up the edge function's Deno.serve handler.

export type DegradedPreviewFields = {
  degraded_reason?: 'blowout' | 'repeat' | 'both'
  rescue_court_idxs?: number[]
  match_explanations?: string[]
}

type PrePersistPayload = {
  court_idx?: unknown
} & Partial<DegradedPreviewFields>

/**
 * Builds a court_idx -> degraded fields map from the pre-persist board (the engine output that
 * still carries degraded_reason/rescue_court_idxs/match_explanations). Courts without any of the
 * 3 fields are skipped so re-attach never writes `undefined` onto a clean row.
 */
export function buildDegradedPreviewFieldsByCourtIdx(
  prePersistBoard: ReadonlyArray<PrePersistPayload>,
): Map<number, DegradedPreviewFields> {
  const byCourtIdx = new Map<number, DegradedPreviewFields>()
  for (const payload of prePersistBoard) {
    const hasDegradedField = payload.degraded_reason !== undefined
      || payload.rescue_court_idxs !== undefined
      || payload.match_explanations !== undefined
    if (!hasDegradedField) continue
    const courtIdx = Number(payload.court_idx)
    if (!Number.isFinite(courtIdx)) continue
    byCourtIdx.set(courtIdx, {
      ...(payload.degraded_reason !== undefined ? { degraded_reason: payload.degraded_reason } : {}),
      ...(payload.rescue_court_idxs !== undefined ? { rescue_court_idxs: payload.rescue_court_idxs } : {}),
      ...(payload.match_explanations !== undefined ? { match_explanations: payload.match_explanations } : {}),
    })
  }
  return byCourtIdx
}

/**
 * Re-attaches degraded fields (by court_idx) onto the post-persist board (read back from DB,
 * stripped of the 3 fields). Matches with no entry in the map are returned unchanged.
 */
export function reattachDegradedPreviewFields<T extends { court_idx: unknown }>(
  persistedBoard: ReadonlyArray<T>,
  degradedFieldsByCourtIdx: Map<number, DegradedPreviewFields>,
): T[] {
  if (degradedFieldsByCourtIdx.size === 0) return persistedBoard as T[]
  return persistedBoard.map(payload => {
    const extra = degradedFieldsByCourtIdx.get(Number(payload.court_idx))
    if (!extra) return payload
    return { ...payload, ...extra }
  })
}
