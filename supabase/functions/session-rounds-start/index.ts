/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost } from '../_shared/live-session.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest.ts'
import {
  buildSessionStateFingerprint,
  sessionStateFingerprintEquals,
} from '../../../lib/next-round-suggester/state-version.ts'
import {
  applyFairnessAdjustment,
  correctForFairness,
} from '../../../lib/next-round-suggester/fairness/corrector.ts'
import { computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics.ts'
import { insertSuggesterAuditEvent } from '../_shared/suggester-audit.ts'

type ManualMatch = {
  court_idx: number
  team_a: [string, string]
  team_b: [string, string]
}

function getPlayedIds(matches: ManualMatch[]) {
  return new Set(matches.flatMap((match) => [...match.team_a, ...match.team_b]))
}

function isValidMatch(value: unknown): value is ManualMatch {
  if (!value || typeof value !== 'object') return false
  const match = value as ManualMatch
  return (
    typeof match.court_idx === 'number' &&
    Array.isArray(match.team_a) &&
    match.team_a.length === 2 &&
    match.team_a.every((id) => typeof id === 'string') &&
    Array.isArray(match.team_b) &&
    match.team_b.length === 2 &&
    match.team_b.every((id) => typeof id === 'string') &&
    new Set([...match.team_a, ...match.team_b]).size === 4
  )
}

function compactMatches(matches: ManualMatch[]) {
  return matches.map((match) => ({
    court_idx: match.court_idx,
    team_a: match.team_a,
    team_b: match.team_b,
  }))
}

function matchKey(match: ManualMatch) {
  return JSON.stringify({
    court_idx: match.court_idx,
    team_a: [...match.team_a].sort(),
    team_b: [...match.team_b].sort(),
  })
}

function matchesEqual(left: ManualMatch[], right: ManualMatch[]) {
  if (left.length !== right.length) return false
  const leftKeys = left.map(matchKey).sort()
  const rightKeys = right.map(matchKey).sort()
  return leftKeys.every((key, index) => key === rightKeys[index])
}

function validateManualCourtIndexes(matches: ManualMatch[], courtCount: number): string | null {
  const courtIndexes = new Set<number>()

  for (const match of matches) {
    if (!Number.isInteger(match.court_idx) || match.court_idx < 0 || match.court_idx >= courtCount) {
      return 'Manual match has invalid court index'
    }
    if (courtIndexes.has(match.court_idx)) {
      return 'Manual matches cannot reuse the same court'
    }
    courtIndexes.add(match.court_idx)
  }

  return null
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)
  }

  const auth = await requireHost(request, sessionId)
  if (auth.error) return auth.error

  try {
    const body = await readJson(request)
    const state = await loadSessionState(auth.supabase, sessionId, {
      courts: optionalNumber(body.courts),
      pvnaTolerance: optionalNumber(body.pvna_tolerance),
    })
    if (state.rounds.some((round) => round.status === 'active')) {
      return jsonResponse({ ok: false, error: 'A round is already active' }, 409, request)
    }

    const adjustment = correctForFairness(state)
    const adjustedState = applyFairnessAdjustment(state, adjustment)
    const fairnessScoreBefore = computeSessionFairness(state).total

    const manual = Array.isArray(body.manual) ? body.manual : null
    const suggestionIdx = typeof body.suggestion_idx === 'number' ? body.suggestion_idx : 0
    const decisionContext =
      body.decision_context && typeof body.decision_context === 'object'
        ? body.decision_context as Record<string, unknown>
        : {}
    let matches: ManualMatch[]
    let resting: string[]
    let decisionMode: 'host_selected_alternative' | 'host_manual_matches' | 'engine_suggestion' = 'engine_suggestion'

    if (manual) {
      const currentFingerprint = buildSessionStateFingerprint(state)
      if (!sessionStateFingerprintEquals(body.expected_state_fingerprint, currentFingerprint)) {
        return jsonResponse({
          ok: false,
          error: 'Session changed. Refresh and review the swapped round before starting.',
          code: 'STATE_CHANGED',
        }, 409, request)
      }

      if (!manual.every(isValidMatch)) {
        return jsonResponse({ ok: false, error: 'Invalid manual matches' }, 400, request)
      }

      matches = manual
      if (matches.length > state.config.courts) {
        return jsonResponse({ ok: false, error: 'Manual matches exceed court count' }, 400, request)
      }

      const courtIndexError = validateManualCourtIndexes(matches, state.config.courts)
      if (courtIndexError) {
        return jsonResponse({ ok: false, error: courtIndexError }, 400, request)
      }

      const playedIds = getPlayedIds(matches)
      if (playedIds.size !== matches.length * 4) {
        return jsonResponse({ ok: false, error: 'A player can only be assigned once per round' }, 400, request)
      }

      const presentIds = new Set(
        [...state.players.values()]
          .filter((player) => player.checked_out_at === null && !player.opted_rest)
          .map((player) => player.player_id),
      )

      if ([...playedIds].some((playerId) => !presentIds.has(playerId))) {
        return jsonResponse({ ok: false, error: 'Manual matches must use checked-in players' }, 400, request)
      }

      resting = [...state.players.values()]
        .filter((player) => player.checked_out_at === null && !player.opted_rest && !playedIds.has(player.player_id))
        .map((player) => player.player_id)
        .sort()

      const suggestion = suggestNextRound(adjustedState, {
        tier_overrides: adjustment.tier_overrides,
      })
      const alternative = suggestion.alternatives[suggestionIdx]
      decisionMode = alternative && matchesEqual(matches, alternative.matches)
        ? 'host_selected_alternative'
        : 'host_manual_matches'
    } else {
      const suggestion = suggestNextRound(adjustedState, {
        tier_overrides: adjustment.tier_overrides,
      })
      const alternative = suggestion.alternatives[suggestionIdx]

      if (!alternative) {
        return jsonResponse({ ok: false, error: 'No suggestion available', suggestion }, 409, request)
      }

      matches = alternative.matches
      resting = alternative.resting
    }

    const { data, error } = await auth.supabase
      .from('session_rounds')
      .insert({
        session_id: sessionId,
        round_no: state.current_round,
        status: 'active',
        matches,
        resting,
        started_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      console.error('session-rounds-start insert failed', error)
      return jsonResponse({ ok: false, error: 'Could not start round' }, 500, request)
    }

    if (adjustment.applied_for_warnings.length > 0) {
      const { error: adjustmentError } = await auth.supabase
        .from('suggester_adjustments')
        .insert({
          session_id: sessionId,
          round_no: state.current_round,
          triggered_by_warnings: adjustment.applied_for_warnings,
          config_changes: adjustment.config_changes,
          tier_overrides: adjustment.tier_overrides,
          fairness_score_before: fairnessScoreBefore,
        })

      if (adjustmentError) {
        console.error('session-rounds-start adjustment insert failed', adjustmentError)
        return jsonResponse({ ok: false, error: 'Could not record fairness adjustment' }, 500, request)
      }
    }

    const auditError = await insertSuggesterAuditEvent(auth.supabase, {
      session_id: sessionId,
      round_no: state.current_round,
      event_type: 'round_started',
      event_source: decisionMode === 'engine_suggestion' ? 'engine' : 'host',
      actor_id: auth.userId,
      payload: {
        decision_mode: decisionMode,
        selected_alternative_index: suggestionIdx,
        matches: compactMatches(matches),
        resting,
        fairness_score_before: fairnessScoreBefore,
        adjustment_applied: adjustment.applied_for_warnings,
        adjustment_config_changes: adjustment.config_changes,
        adjustment_tier_overrides: adjustment.tier_overrides,
        decision_context: decisionContext,
      },
    })

    return jsonResponse({ ok: true, round: data, adjustment, audit_error: auditError }, 200, request)
  } catch (error) {
    console.error('session-rounds-start failed', error)
    return jsonResponse(
      { ok: false, error: 'Could not start round' },
      500,
      request,
    )
  }
})
