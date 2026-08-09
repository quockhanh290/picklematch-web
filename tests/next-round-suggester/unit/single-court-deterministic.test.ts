import { suggestNextMatch, type ExhaustiveFallbackDiagnostic } from '../../../lib/next-round-suggester/suggest'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionState } from '../../../lib/next-round-suggester/types'

// A single-court pool where the greedy/fairness top pairs a partner-saturated foursome (a repeat-3),
// while a clean foursome exists using the 5th player at equal fairness (all uniform rest/matches).
function flakyState(): SessionState {
  const players = [
    createPlayer('vk', { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('hu', { pvna: 4.7, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('pt', { pvna: 4.4, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('dt', { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('vl', { pvna: 2.8, matches_played: 3, consecutive_rest: 0 }),
    createPlayer('pd', { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
  ]
  const s = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 4 })
  // saturate the "balanced" foursome so its every split is a 3rd opponent meeting
  for (const [x, y] of [['vk', 'pt'], ['vk', 'dt'], ['hu', 'pt'], ['hu', 'dt'], ['vk', 'hu'], ['pt', 'dt']]) {
    const px = s.players.get(x)!, py = s.players.get(y)!
    px.opponent_counts.set(y, 3); py.opponent_counts.set(x, 3)
  }
  return s
}

function enableQualityCost(state: SessionState): SessionState {
  state.config.quality_cost_enabled = true
  return state
}

describe('single-court deterministic lineup', () => {
  afterEach(() => {
    __setQualityCostModelOverrideForTests(null)
  })

  it('flag ON: uses the deterministic fast path even when the request budget is near-zero', () => {
    __setQualityCostModelOverrideForTests(true)
    const state = enableQualityCost(flakyState())
    const diag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0, combinationsEvaluated: 0,
      bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    const res = suggestNextMatch(state, {
      court_idx: 5, max_alternatives: 1, max_runtime_ms: 1, _exhaustiveDiag: diag,
    })
    expect(res.alternatives).toHaveLength(1)
    expect(diag.deterministicFastPath).toBe(true)
  })

  it('flag ON: records deterministic fast-path diagnostics independently of the caller budget', () => {
    __setQualityCostModelOverrideForTests(true)
    const shortDiag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0, combinationsEvaluated: 0,
      bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    const longDiag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0, combinationsEvaluated: 0,
      bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    suggestNextMatch(enableQualityCost(flakyState()), {
      court_idx: 5, max_alternatives: 1, max_runtime_ms: 1, _exhaustiveDiag: shortDiag,
    })
    suggestNextMatch(enableQualityCost(flakyState()), {
      court_idx: 5, max_alternatives: 1, max_runtime_ms: 100000, _exhaustiveDiag: longDiag,
    })
    expect(shortDiag.deterministicFastPath).toBe(true)
    expect(longDiag.deterministicFastPath).toBe(true)
  })

  it('keeps a rested-required player in the lineup (fairness hard-filter preserved)', () => {
    __setQualityCostModelOverrideForTests(true)
    const state = enableQualityCost(flakyState())
    state.players.get('hu')!.consecutive_rest = 2 // hu must play now
    const res = suggestNextMatch(state, { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const ids = [...res.alternatives[0].matches[0].team_a, ...res.alternatives[0].matches[0].team_b]
    expect(ids).toContain('hu')
  })

  // Determinism and the scoring model are separate concerns. The fast path exists to remove
  // timing-dependent truncation, which every session needs; the flag only decides which model ranks the
  // candidates. Gating the fast path itself on the flag drops flag-OFF sessions back into the legacy
  // timed loop, which measurably costs them lineup quality.
  it('flag OFF still uses the deterministic fast path to choose the single-court foursome', () => {
    __setQualityCostModelOverrideForTests(null)
    const state = flakyState()
    const diag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0, combinationsEvaluated: 0,
      bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }

    suggestNextMatch(state, {
      court_idx: 5, max_alternatives: 1, max_runtime_ms: 1, _exhaustiveDiag: diag,
    })

    expect(diag.deterministicFastPath).toBe(true)
  })

  it('fails fast for a > 20-player pool under a near-zero budget instead of ballooning to the legacy loop\'s 2500ms default', () => {
    __setQualityCostModelOverrideForTests(true)
    // A required outlier (must-play via consecutive_rest) whose pvna is far outside the tight tolerance
    // forces the primary pick into tradeoffs, so shouldCheckFallback is true — but the pool (24) is over
    // the deterministic fast path's 20-player cap, so this exercises the legacy loop's budget guard.
    const outlier = createPlayer('outlier', { pvna: 1.0, matches_played: 3, consecutive_rest: 2 })
    const rest = Array.from({ length: 23 }, (_, i) =>
      createPlayer(`p${i}`, { pvna: 3.5, matches_played: 3, consecutive_rest: 0 }),
    )
    const state = createState({
      players: [outlier, ...rest], courts: 6, pvnaTolerance: 0.2, currentRound: 4,
    })
    state.config.quality_cost_enabled = true
    const diag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0, combinationsEvaluated: 0,
      bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    const res = suggestNextMatch(state, {
      court_idx: 5, max_alternatives: 1, max_runtime_ms: 1, _exhaustiveDiag: diag,
    })
    // diag.timedOut flips true only inside the exhaustive fallback's near-zero-budget bail, so this also
    // proves the fallback was actually invoked (shouldCheckFallback was true) rather than the assertions
    // below passing vacuously off the diag's untouched initial values.
    expect(diag.timedOut).toBe(true)
    expect(diag.ran).toBe(false)
    expect(diag.combinationsEvaluated).toBe(0) // the legacy stage loop never ran a single combo
    expect(res.warnings).not.toContain('EXHAUSTIVE_FALLBACK') // the legacy loop's alternatives never materialized
  })

  it('flag OFF: bails the same way when its chosen foursome cannot be materialized', () => {
    // findMinCostFoursome (forced-tradeoff.ts) never checks recent-group-rematch, but makeAlternative's
    // bestPartitioning hard-rejects it (allowRecentGroupRematch is fixed false in the fast path) at every
    // relaxation stage, since "same 4 players regrouped" is a group-level block independent of the team
    // split chosen. With exactly 4 players present, findMinCostFoursome's only candidate foursome is
    // this exact rematch group, so it selects it — and makeAlternative then fails to materialize any of
    // its 3 splits. This is the realistic shape of the "best found but unmaterializable" gap: a case
    // findMinCostFoursome doesn't screen for that makeAlternative's own (stricter) invariants reject.
    const players = [
      createPlayer('a', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
      createPlayer('b', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
      createPlayer('c', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
      createPlayer('d', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
    ]
    const state = createState({ players, courts: 1, pvnaTolerance: 0.5, currentRound: 2 })
    state.rounds.push({
      session_id: state.session_id,
      round_no: 1,
      status: 'completed',
      matches: [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }],
      resting: [],
      started_at: new Date('2026-05-14T12:00:00.000Z'),
      ended_at: new Date('2026-05-14T12:15:00.000Z'),
    })
    const diag: ExhaustiveFallbackDiagnostic = {
      ran: false, timedOut: false, eligibleCount: 0, combinationsEvaluated: 0,
      bestPvnaDiff: null, bestHasTradeoffs: false, elapsedMs: 0,
    }
    // Ample budget (well over the 100ms fast-fail threshold) — this must resolve via the deterministic
    // fast path's own bail, not by falling through to spend that budget in the legacy timed loop.
    suggestNextMatch(state, {
      court_idx: 0, max_alternatives: 1, max_runtime_ms: 100000, _exhaustiveDiag: diag,
    })
    // Same outcome as the flag-ON case above: the flag picks the ranking model, not whether the
    // deterministic scan runs.
    expect(diag.deterministicFastPath).toBe(true)
  })

  it('still materializes an allow_recent_group_rematch rescue when only a rematch lineup is possible', () => {
    // suggestNextMatch's allow_recent_group_rematch===true branch calls suggestNextMatchExhaustiveFallback
    // directly and returns its result AS-IS — there is no mappedResult safety net on this branch (unlike
    // the default path). Reuses the exact same forced-rematch pool as the previous test: findMinCostFoursome
    // would pick this foursome as its only candidate, and the deterministic fast path's makeAlternative call
    // is fixed allowRecentGroupRematch=false, so if the fast path ran here it would bail to an empty result
    // and this rare rescue call would silently return nothing. The fast path must be gated off whenever
    // allow_recent_group_rematch is true, letting the legacy loop's allowRecentGroupRematch-aware stages
    // materialize the rescue lineup instead.
    const players = [
      createPlayer('a', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
      createPlayer('b', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
      createPlayer('c', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
      createPlayer('d', { pvna: 3.5, matches_played: 1, consecutive_rest: 0 }),
    ]
    const state = createState({ players, courts: 1, pvnaTolerance: 0.5, currentRound: 2 })
    state.rounds.push({
      session_id: state.session_id,
      round_no: 1,
      status: 'completed',
      matches: [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }],
      resting: [],
      started_at: new Date('2026-05-14T12:00:00.000Z'),
      ended_at: new Date('2026-05-14T12:15:00.000Z'),
    })
    const res = suggestNextMatch(state, {
      court_idx: 0, max_alternatives: 1, allow_recent_group_rematch: true,
    })
    expect(res.alternatives.length).toBeGreaterThan(0) // the rescue still materializes via the legacy loop
  })
})
