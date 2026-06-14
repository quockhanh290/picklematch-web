/**
 * Production-chain timing benchmark.
 *
 * Simulation tests (targets.test.ts, live-preview-timing.test.ts) only measure
 * suggestNextRound() in isolation using pre-built SessionState objects.
 * In production, every realtime DB push triggers a longer chain:
 *
 *   DB rows
 *     → rowsFingerprint (string concat, O(players + pairs + rounds + live))
 *     → mapRowsToSessionState()
 *     → buildCompletedLiveCycleRows()         ← not measured in simulation
 *     → correctForFairness()
 *     → applyFairnessAdjustment()
 *     → suggestNextRound()
 *     → computeSessionFairness()              ← not measured in simulation
 *     → buildLatestFairnessAudit()            ← not measured in simulation
 *     → buildFairnessPreview() × 3 alts       ← not measured in simulation
 *     → buildSuggestedRoundActionsCache()     ← not measured in simulation
 *
 * This file benchmarks each step AND the total chain so we can detect
 * regressions in parts the simulation runner never exercises.
 */

import {
  applyFairnessAdjustment,
  correctForFairness,
} from '../../../lib/next-round-suggester/fairness/corrector'
import {
  buildFairnessPreview,
  buildLatestFairnessAudit,
} from '../../../lib/next-round-suggester/fairness/audit'
import { computeSessionFairness } from '../../../lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { buildSuggestedRoundActionsCache } from '../../../lib/next-round-suggester/alternatives'
import { computeRowsFingerprint, serializeStateToDbRows, type DbRows } from '../helpers/db-rows'
import { runSimulation, type SimulationConfig } from './runner'

// ─── types ────────────────────────────────────────────────────────────────────

type StepTimings = {
  fingerprint_ms: number
  map_rows_ms: number
  live_cycle_rows_ms: number
  correct_fairness_ms: number
  suggest_ms: number
  post_fairness_ms: number       // computeSessionFairness + buildLatestFairnessAudit
  fairness_previews_ms: number   // buildFairnessPreview × alternatives
  actions_cache_ms: number       // buildSuggestedRoundActionsCache
  total_chain_ms: number
}

type TimingStats = {
  samples: number
  avg_ms: number
  p50_ms: number
  p95_ms: number
  max_ms: number
}

type ChainBenchmarkResult = {
  scenario: string
  n_players: number
  courts: number
  warm_rounds: number
  per_step: Record<keyof StepTimings, TimingStats>
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function computeStats(values: number[]): TimingStats {
  const sorted = [...values].sort((a, b) => a - b)
  const avg = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1)
  return {
    samples: sorted.length,
    avg_ms: avg,
    p50_ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95_ms: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0,
    max_ms: sorted[sorted.length - 1] ?? 0,
  }
}

function timed<T>(fn: () => T): { result: T; ms: number } {
  const t0 = performance.now()
  const result = fn()
  return { result, ms: performance.now() - t0 }
}

/**
 * Inline the liveMatchRows → roundRows grouping logic.
 * Mirrors buildCompletedLiveCycleRows from live-cycle-rows.ts without the
 * per-round timestamp filter (which requires real timestamps).
 */
function buildLiveCycleRows(rows: DbRows, courtCount: number, sessionId: string) {
  const normalizedCourtCount = Math.max(1, Math.floor(courtCount))
  const completed = [...rows.liveMatchRows]
    .filter(m => m.status === 'completed')
    .sort((a, b) => a.sequence_no - b.sequence_no)
  const presentPlayerIds = rows.playerRows
    .filter(r => !r.checked_out_at)
    .map(r => r.player_id)
  const optedRestIds = new Set(
    rows.playerRows.filter(r => !r.checked_out_at && r.opted_rest).map(r => r.player_id),
  )
  const baseRoundNo = rows.roundRows.reduce((max, r) => Math.max(max, r.round_no), -1) + 1
  const liveRoundRows = []

  for (let idx = 0; idx + normalizedCourtCount <= completed.length; idx += normalizedCourtCount) {
    const matches = completed.slice(idx, idx + normalizedCourtCount)
    const playedIds = new Set(matches.flatMap(m => [...m.team_a, ...m.team_b]))
    const resting = presentPlayerIds.filter(id => !playedIds.has(id) && !optedRestIds.has(id))
    liveRoundRows.push({
      id: matches[0].id,
      session_id: sessionId,
      round_no: baseRoundNo + liveRoundRows.length,
      status: 'completed' as const,
      matches: matches.map(m => ({ court_idx: m.court_idx ?? 0, team_a: m.team_a, team_b: m.team_b })),
      resting,
      started_at: matches[0].started_at,
      ended_at: matches[matches.length - 1].ended_at,
    })
  }

  return liveRoundRows
}

/**
 * Run the full production chain N times against a warm state serialized to
 * DB rows. Returns per-step timing statistics.
 */
async function benchmarkProductionChain(params: {
  scenario: SimulationConfig
  iterations: number
}): Promise<ChainBenchmarkResult> {
  const { final_state: warmState } = await runSimulation(params.scenario)

  // Serialize once — this is the "DB snapshot" we'll repeatedly ingest.
  const dbRows = serializeStateToDbRows(warmState)
  const courtCount = params.scenario.courts
  const sessionId = warmState.session_id

  const samples: Record<keyof StepTimings, number[]> = {
    fingerprint_ms: [],
    map_rows_ms: [],
    live_cycle_rows_ms: [],
    correct_fairness_ms: [],
    suggest_ms: [],
    post_fairness_ms: [],
    fairness_previews_ms: [],
    actions_cache_ms: [],
    total_chain_ms: [],
  }

  for (let i = 0; i < params.iterations; i++) {
    const chainStart = performance.now()

    // 1. rowsFingerprint — mirrors useNextRoundModel rowsFingerprint useMemo
    const { ms: fp } = timed(() => computeRowsFingerprint(dbRows, i))
    samples.fingerprint_ms.push(fp)

    // 2. mapRowsToSessionState
    const { result: state, ms: mapMs } = timed(() =>
      mapRowsToSessionState({
        sessionId,
        playerRows: dbRows.playerRows,
        pairRows: dbRows.pairRows,
        roundRows: dbRows.roundRows,
        courts: courtCount,
        pvnaTolerance: 0.5,
      }),
    )
    samples.map_rows_ms.push(mapMs)

    // 3. buildCompletedLiveCycleRows — live path that simulation never exercises
    const { ms: liveCycleMs } = timed(() => buildLiveCycleRows(dbRows, courtCount, sessionId))
    samples.live_cycle_rows_ms.push(liveCycleMs)

    // 4. correctForFairness + applyFairnessAdjustment
    const { result: adjustment, ms: correctMs } = timed(() => correctForFairness(state))
    const { result: adjustedState } = timed(() => applyFairnessAdjustment(state, adjustment))
    samples.correct_fairness_ms.push(correctMs)

    // 5. suggestNextRound — what simulation already measures
    const { result: suggestion, ms: suggestMs } = timed(() =>
      suggestNextRound(adjustedState, { tier_overrides: adjustment.tier_overrides }),
    )
    samples.suggest_ms.push(suggestMs)

    // 6. computeSessionFairness + buildLatestFairnessAudit
    const { ms: postFairnessMs } = timed(() => {
      computeSessionFairness(state)
      buildLatestFairnessAudit(state)
    })
    samples.post_fairness_ms.push(postFairnessMs)

    // 7. buildFairnessPreview × alternatives (typically 3)
    const { ms: previewsMs } = timed(() => {
      for (const alt of suggestion.alternatives) {
        buildFairnessPreview(adjustedState, alt)
      }
    })
    samples.fairness_previews_ms.push(previewsMs)

    // 8. buildSuggestedRoundActionsCache — auditAlternative × alternatives
    const { ms: cacheMs } = timed(() =>
      buildSuggestedRoundActionsCache(adjustedState, suggestion.alternatives, courtCount),
    )
    samples.actions_cache_ms.push(cacheMs)

    samples.total_chain_ms.push(performance.now() - chainStart)
  }

  const per_step = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [key, computeStats(values)]),
  ) as Record<keyof StepTimings, TimingStats>

  return {
    scenario: params.scenario.scenario_name ?? '',
    n_players: params.scenario.n_players,
    courts: params.scenario.courts,
    warm_rounds: params.scenario.rounds,
    per_step,
  }
}

// ─── budget constants ─────────────────────────────────────────────────────────
// Full-chain avg_ms budgets. Set conservatively — purpose is regression
// detection, not micro-optimization. suggestNextRound alone has a 500ms budget
// for large sessions per targets.test.ts; we add ~500ms headroom for the rest
// of the chain.

const CHAIN_BUDGET = {
  small: 100,   // ≤12 players, ≤3 courts
  medium: 300,  // ~20 players
  large: 1000,  // ~40 players
}

// Per-step avg_ms budgets (for diagnosing which step regressed).
const STEP_BUDGET = {
  fingerprint_ms:       { small: 2,   medium: 5,   large: 12  },
  map_rows_ms:          { small: 3,   medium: 8,   large: 20  },
  live_cycle_rows_ms:   { small: 3,   medium: 8,   large: 20  },
  correct_fairness_ms:  { small: 8,   medium: 20,  large: 50  },
  suggest_ms:           { small: 50,  medium: 150, large: 500 },
  post_fairness_ms:     { small: 8,   medium: 20,  large: 50  },
  fairness_previews_ms: { small: 8,   medium: 25,  large: 80  },
  actions_cache_ms:     { small: 8,   medium: 25,  large: 80  },
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Production Chain Timing', () => {
  it(
    'small session (12p, 3 courts, 8 warm rounds) — full chain within budget',
    async () => {
      const result = await benchmarkProductionChain({
        scenario: {
          scenario_name: 'prodchain_small_12',
          n_players: 12,
          courts: 3,
          rounds: 8,
          pvna_distribution: 'wide',
          gender_ratio: 0.5,
          gender_pref_rate: 0.25,
          group_count: 1,
          group_size_range: [2, 3],
          use_corrector: true,
          seed: 42,
        },
        iterations: 30,
      })

      console.log('[prodchain] small 12p/3c\n' + formatResult(result))
      const s = result.per_step

      expect(s.fingerprint_ms.avg_ms).toBeLessThan(STEP_BUDGET.fingerprint_ms.small)
      expect(s.map_rows_ms.avg_ms).toBeLessThan(STEP_BUDGET.map_rows_ms.small)
      expect(s.live_cycle_rows_ms.avg_ms).toBeLessThan(STEP_BUDGET.live_cycle_rows_ms.small)
      expect(s.correct_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.correct_fairness_ms.small)
      expect(s.suggest_ms.avg_ms).toBeLessThan(STEP_BUDGET.suggest_ms.small)
      expect(s.post_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.post_fairness_ms.small)
      expect(s.fairness_previews_ms.avg_ms).toBeLessThan(STEP_BUDGET.fairness_previews_ms.small)
      expect(s.actions_cache_ms.avg_ms).toBeLessThan(STEP_BUDGET.actions_cache_ms.small)
      expect(s.total_chain_ms.avg_ms).toBeLessThan(CHAIN_BUDGET.small)
      expect(s.total_chain_ms.p95_ms).toBeLessThan(CHAIN_BUDGET.small * 2)
    },
    120000,
  )

  it(
    'medium session (20p, 5 courts, 10 warm rounds) — full chain within budget',
    async () => {
      const result = await benchmarkProductionChain({
        scenario: {
          scenario_name: 'prodchain_medium_20',
          n_players: 20,
          courts: 5,
          rounds: 10,
          pvna_distribution: 'wide',
          gender_ratio: 0.5,
          gender_pref_rate: 0.3,
          group_count: 2,
          group_size_range: [2, 4],
          use_corrector: true,
          seed: 42,
        },
        iterations: 20,
      })

      console.log('[prodchain] medium 20p/5c\n' + formatResult(result))
      const s = result.per_step

      expect(s.fingerprint_ms.avg_ms).toBeLessThan(STEP_BUDGET.fingerprint_ms.medium)
      expect(s.map_rows_ms.avg_ms).toBeLessThan(STEP_BUDGET.map_rows_ms.medium)
      expect(s.live_cycle_rows_ms.avg_ms).toBeLessThan(STEP_BUDGET.live_cycle_rows_ms.medium)
      expect(s.correct_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.correct_fairness_ms.medium)
      expect(s.suggest_ms.avg_ms).toBeLessThan(STEP_BUDGET.suggest_ms.medium)
      expect(s.post_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.post_fairness_ms.medium)
      expect(s.fairness_previews_ms.avg_ms).toBeLessThan(STEP_BUDGET.fairness_previews_ms.medium)
      expect(s.actions_cache_ms.avg_ms).toBeLessThan(STEP_BUDGET.actions_cache_ms.medium)
      expect(s.total_chain_ms.avg_ms).toBeLessThan(CHAIN_BUDGET.medium)
      expect(s.total_chain_ms.p95_ms).toBeLessThan(CHAIN_BUDGET.medium * 2)
    },
    180000,
  )

  it(
    'large session (40p, 10 courts, 15 warm rounds) — full chain within budget',
    async () => {
      const result = await benchmarkProductionChain({
        scenario: {
          scenario_name: 'prodchain_large_40',
          n_players: 40,
          courts: 10,
          rounds: 15,
          pvna_distribution: 'wide',
          gender_ratio: 0.5,
          gender_pref_rate: 0.3,
          group_count: 3,
          group_size_range: [3, 5],
          use_corrector: true,
          seed: 42,
        },
        iterations: 10,
      })

      console.log('[prodchain] large 40p/10c\n' + formatResult(result))
      const s = result.per_step

      expect(s.fingerprint_ms.avg_ms).toBeLessThan(STEP_BUDGET.fingerprint_ms.large)
      expect(s.map_rows_ms.avg_ms).toBeLessThan(STEP_BUDGET.map_rows_ms.large)
      expect(s.live_cycle_rows_ms.avg_ms).toBeLessThan(STEP_BUDGET.live_cycle_rows_ms.large)
      expect(s.correct_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.correct_fairness_ms.large)
      expect(s.suggest_ms.avg_ms).toBeLessThan(STEP_BUDGET.suggest_ms.large)
      expect(s.post_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.post_fairness_ms.large)
      expect(s.fairness_previews_ms.avg_ms).toBeLessThan(STEP_BUDGET.fairness_previews_ms.large)
      expect(s.actions_cache_ms.avg_ms).toBeLessThan(STEP_BUDGET.actions_cache_ms.large)
      expect(s.total_chain_ms.avg_ms).toBeLessThan(CHAIN_BUDGET.large)
      expect(s.total_chain_ms.p95_ms).toBeLessThan(CHAIN_BUDGET.large * 2)
    },
    600000,
  )

  it(
    'real 40-player session fixture (12 warm rounds) — full chain within large budget',
    async () => {
      const { createRealSessionPlayers } = await import('./real-session-fixture')
      const players = createRealSessionPlayers()

      const result = await benchmarkProductionChain({
        scenario: {
          scenario_name: 'prodchain_real_40',
          n_players: players.length,
          courts: 10,
          rounds: 12,
          pvna_distribution: 'wide',
          gender_ratio: 0.5,
          gender_pref_rate: 0.3,
          group_count: 0,
          group_size_range: [2, 3],
          use_corrector: true,
          seed: 42,
          initial_players: players,
        },
        iterations: 10,
      })

      console.log('[prodchain] real 40p fixture\n' + formatResult(result))
      const s = result.per_step

      // Full chain budget
      expect(s.total_chain_ms.avg_ms).toBeLessThan(CHAIN_BUDGET.large)
      expect(s.total_chain_ms.p95_ms).toBeLessThan(CHAIN_BUDGET.large * 2)

      // These two are the most likely to regress silently in large sessions:
      // fingerprint scales with pair count (O(n²)), audit rebuilds state history (O(rounds))
      expect(s.fingerprint_ms.avg_ms).toBeLessThan(STEP_BUDGET.fingerprint_ms.large)
      expect(s.post_fairness_ms.avg_ms).toBeLessThan(STEP_BUDGET.post_fairness_ms.large)
    },
    600000,
  )
})

// ─── output formatting ────────────────────────────────────────────────────────

function formatResult(result: ChainBenchmarkResult): string {
  const header = `  scenario=${result.scenario} players=${result.n_players} courts=${result.courts} warm_rounds=${result.warm_rounds}`
  const rows = Object.entries(result.per_step).map(([step, timing]) =>
    `  ${step.padEnd(26)} avg=${timing.avg_ms.toFixed(1).padStart(7)}ms  p95=${timing.p95_ms.toFixed(1).padStart(7)}ms  max=${timing.max_ms.toFixed(1).padStart(7)}ms`,
  )
  return [header, ...rows].join('\n')
}
