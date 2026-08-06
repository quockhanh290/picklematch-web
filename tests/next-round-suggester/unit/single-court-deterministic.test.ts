import { suggestNextMatch, type ExhaustiveFallbackDiagnostic } from '../../../lib/next-round-suggester/suggest'
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

describe('single-court deterministic lineup', () => {
  it('seats a clean lineup even when the request budget is near-zero (fix for the timeout flakiness)', () => {
    const state = flakyState()
    const res = suggestNextMatch(state, { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const m = res.alternatives[0].matches[0]
    const meet = (a: string, b: string) => (state.players.get(a)!.opponent_counts.get(b) ?? 0) + 1
    const maxMeet = Math.max(
      ...m.team_a.flatMap(a => m.team_b.map(b => meet(a, b))),
    )
    expect(maxMeet).toBeLessThan(3) // clean, not the repeat-3 the greedy path would seat under timeout
  })

  it('is deterministic under different simulated budgets', () => {
    const key = (r: ReturnType<typeof suggestNextMatch>) => {
      const m = r.alternatives[0].matches[0]
      return [[...m.team_a].sort(), [...m.team_b].sort()].sort().join('|')
    }
    const a = suggestNextMatch(flakyState(), { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const b = suggestNextMatch(flakyState(), { court_idx: 5, max_alternatives: 1, max_runtime_ms: 100000 })
    expect(key(a)).toEqual(key(b))
  })

  it('keeps a rested-required player in the lineup (fairness hard-filter preserved)', () => {
    const state = flakyState()
    state.players.get('hu')!.consecutive_rest = 2 // hu must play now
    const res = suggestNextMatch(state, { court_idx: 5, max_alternatives: 1, max_runtime_ms: 1 })
    const ids = [...res.alternatives[0].matches[0].team_a, ...res.alternatives[0].matches[0].team_b]
    expect(ids).toContain('hu')
  })

  it('fails fast for a > 20-player pool under a near-zero budget instead of ballooning to the legacy loop\'s 2500ms default', () => {
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
})
