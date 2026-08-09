/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost } from '../_shared/live-session.ts'
import { loadSessionState } from '../../../lib/next-round-suggester/state.ts'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest.ts'
import { resolveQualityCostEnabledForSession } from '../../../lib/next-round-suggester/quality-cost-flag.ts'
import {
  applyFairnessAdjustment,
  correctForFairness,
} from '../../../lib/next-round-suggester/fairness/corrector.ts'

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400)
  }

  const auth = await requireHost(request, sessionId)
  if (auth.error) return auth.error

  try {
    const body = await readJson(request)
    const state = await loadSessionState(auth.supabase, sessionId, {
      courts: optionalNumber(body.courts),
      pvnaTolerance: optionalNumber(body.pvna_tolerance),
    })
    state.config.quality_cost_enabled = resolveQualityCostEnabledForSession(sessionId)
    const adjustment = correctForFairness(state)
    const adjustedState = applyFairnessAdjustment(state, adjustment)
    const suggestion = suggestNextRound(adjustedState, {
      tier_overrides: adjustment.tier_overrides,
    })
    return jsonResponse({ ok: true, suggestion, adjustment })
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
