/**
 * Contract model of the server-side "start suggested live match" gate.
 *
 * This is a faithful TS mirror of the plpgsql RPC
 * `start_live_session_match_versioned` (supabase/migrations/20260703000007).
 * It exists so the intended gate contract is locked by a runnable CI test even
 * though the real gate is SQL (not executable in Jest). Keep in sync with the
 * migration: if the SQL gate changes, change this model and its tests together.
 *
 * The pgTAP test in supabase/tests/ exercises the REAL SQL; this only guards intent.
 */

export type StartGatePlayerState = {
  present: boolean        // row exists in session_player_state
  checkedOut: boolean     // checked_out_at is not null
  optedRest: boolean
}

export type StartGateLiveMatch = {
  id: string
  status: 'suggested' | 'live' | 'completed' | 'cancelled'
  court_idx: number | null
  round_no: number
  team_a: string[]
  team_b: string[]
}

export type StartGateInput = {
  callerId: string
  hostId: string | null
  expectedVersion: number
  currentVersion: number
  match: StartGateLiveMatch | null      // the row identified by p_match_id
  playerStates: Record<string, StartGatePlayerState>
  liveMatches: StartGateLiveMatch[]     // all rows for the session (excluding the target)
}

export type StartGateResult = { ok: true } | { ok: false; error: string }

function playersOf(match: StartGateLiveMatch): string[] {
  return [...match.team_a, ...match.team_b]
}

export function evaluateStartGate(input: StartGateInput): StartGateResult {
  const { callerId, hostId, expectedVersion, currentVersion, match, playerStates, liveMatches } = input

  if (hostId === null) return { ok: false, error: 'Session not found' }
  if (hostId !== callerId) return { ok: false, error: 'Only the host can start live match' }

  // NOTE: no coarse whole-session `live_state_version` CAS here. The specific
  // checks below (status='suggested', players available, no player already
  // live / played this round, court free) — evaluated under the RPC's row lock —
  // fully guarantee correctness. Gating on the churny session version only
  // produced false 'Session changed' rejections during normal rolling play.
  void currentVersion; void expectedVersion

  if (match === null) return { ok: false, error: 'Live match not found' }
  if (match.status !== 'suggested') return { ok: false, error: 'Only suggested matches can be started' }

  const players = playersOf(match)

  const unavailable = players.some((id) => {
    const s = playerStates[id]
    return !s || !s.present || s.checkedOut || s.optedRest
  })
  if (unavailable) return { ok: false, error: 'Live match must use available checked-in players' }

  const playerConflict = players.some((id) =>
    liveMatches.some((other) =>
      other.id !== match.id &&
      (other.team_a.includes(id) || other.team_b.includes(id)) &&
      (other.status === 'live' ||
        (other.round_no === match.round_no && other.status !== 'cancelled' && other.status !== 'suggested')),
    ),
  )
  if (playerConflict) return { ok: false, error: 'A player is already in a live match or already played in this round' }

  const courtOccupied =
    match.court_idx !== null &&
    liveMatches.some((other) =>
      other.id !== match.id && other.status === 'live' && other.court_idx === match.court_idx,
    )
  if (courtOccupied) return { ok: false, error: 'Court already has a live match' }

  return { ok: true }
}

// ── Complete / Cancel gates (same coarse-CAS redundancy as start) ──────────────
// Mirror complete_live_session_match_versioned / cancel_live_session_match_versioned.
// Completing/cancelling a specific match by id is safe as long as it is still in the
// right status (checked under the row lock); the whole-session version CAS only adds
// false 'Session changed' positives during unrelated rolling churn.

export type MatchActionGateInput = {
  callerId: string
  hostId: string | null
  expectedVersion: number
  currentVersion: number
  match: Pick<StartGateLiveMatch, 'id' | 'status'> | null
}

export function evaluateCompleteGate(input: MatchActionGateInput): StartGateResult {
  const { callerId, hostId, match } = input
  if (hostId === null) return { ok: false, error: 'Session not found' }
  if (hostId !== callerId) return { ok: false, error: 'Only the host can complete live match' }
  // No coarse `live_state_version` CAS — the status check below is the real guard.
  void input.currentVersion; void input.expectedVersion
  if (match === null) return { ok: false, error: 'Live match not found' }
  if (match.status !== 'live') return { ok: false, error: 'Only live matches can be completed' }
  return { ok: true }
}

export function evaluateCancelGate(input: MatchActionGateInput): StartGateResult {
  const { callerId, hostId, match } = input
  if (hostId === null) return { ok: false, error: 'Session not found' }
  if (hostId !== callerId) return { ok: false, error: 'Only the host can cancel live match' }
  // No coarse `live_state_version` CAS — the status check below is the real guard.
  void input.currentVersion; void input.expectedVersion
  if (match === null) return { ok: false, error: 'Live match not found' }
  if (match.status !== 'suggested' && match.status !== 'live') {
    return { ok: false, error: 'Only suggested/live matches can be cancelled' }
  }
  return { ok: true }
}

// ── Start-from-payload gate (secondary start path) ────────────────────────────
// Mirror start_live_session_match_from_payload_versioned (20260624000001, minus the
// coarse CAS). This path INSERTS a new match instead of flipping an existing suggested
// row, so its version guard is the lenient "Preview is stale" check: version churn is
// allowed, only a DECREASE in the countable match count (a cancellation freed players
// the preview didn't know about) is rejected.

export type StartPayloadGateInput = {
  callerId: string
  hostId: string | null
  expectedVersion: number
  currentVersion: number
  isClientPreviewStart: boolean
  previewVersion: number | null           // preview_live_state_version from audit payload
  previewCountableCount: number | null    // preview_countable_match_count
  currentCountableCount: number           // live count of non-cancelled/non-suggested rows now
  matchPlayers: string[]
  playerStates: Record<string, StartGatePlayerState>
  liveMatches: StartGateLiveMatch[]       // other rows for the session
  courtIdx: number | null
  roundNo: number                         // v_round_no the inserted match would land in
}

export function evaluateStartFromPayloadGate(input: StartPayloadGateInput): StartGateResult {
  const { callerId, hostId, isClientPreviewStart, previewVersion, previewCountableCount,
    currentCountableCount, currentVersion, matchPlayers, playerStates, liveMatches, courtIdx } = input

  if (hostId === null) return { ok: false, error: 'Session not found' }
  if (hostId !== callerId) return { ok: false, error: 'Only the host can start live match' }
  // No coarse `live_state_version` CAS — the lenient preview-stale + specific checks guard.
  void input.expectedVersion

  if (isClientPreviewStart) {
    if (previewVersion === null) return { ok: false, error: 'Preview is stale' }
    if (previewVersion !== currentVersion) {
      if (previewCountableCount === null) return { ok: false, error: 'Preview is stale' }
      if (currentVersion < previewVersion || currentCountableCount < previewCountableCount) {
        return { ok: false, error: 'Preview is stale' }
      }
    }
  }

  const unavailable = matchPlayers.some((id) => {
    const s = playerStates[id]
    return !s || !s.present || s.checkedOut || s.optedRest
  })
  if (unavailable) return { ok: false, error: 'Live match must use available checked-in players' }

  const playerInLive = matchPlayers.some((id) =>
    liveMatches.some((m) => m.status === 'live' && (m.team_a.includes(id) || m.team_b.includes(id))),
  )
  if (playerInLive) return { ok: false, error: 'A player is already in a live match' }

  // Prevent a player from playing twice in the same round (guard from migration
  // 20260625000001 — must survive the CAS removal). Catches a re-picked player whose
  // first match this round already COMPLETED (no longer 'live').
  const playedThisRound = matchPlayers.some((id) =>
    liveMatches.some((m) =>
      m.round_no === input.roundNo &&
      m.status !== 'cancelled' && m.status !== 'suggested' &&
      (m.team_a.includes(id) || m.team_b.includes(id))),
  )
  if (playedThisRound) return { ok: false, error: 'A player already played in this round' }

  const courtOccupied =
    courtIdx !== null &&
    liveMatches.some((m) => m.status === 'live' && m.court_idx === courtIdx)
  if (courtOccupied) return { ok: false, error: 'Court already has a live match' }

  return { ok: true }
}
