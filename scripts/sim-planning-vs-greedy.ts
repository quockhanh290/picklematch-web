/**
 * Validate "planning vs greedy" concept.
 * Với cùng player set cố định, thử K alternatives cho round 1 rồi simulate
 * toàn session còn lại (greedy). So sánh final fairness.
 *
 * Chạy: npx tsx scripts/sim-planning-vs-greedy.ts [n_seeds]
 */
import seedrandom from 'seedrandom'

import { commitCompletedRound } from '../lib/next-round-suggester/commit'
import { correctForFairness, applyFairnessAdjustment } from '../lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { createSearchBudget } from '../lib/next-round-suggester/search-budget'
import { SEARCH_UNITS_PER_LEGACY_MS, suggestNextRound } from '../lib/next-round-suggester/suggest'
import type { PlayerSessionState, RoundRecord, SessionPairHistoryRow, SessionState } from '../lib/next-round-suggester/types'
import { generatePlayers, initState } from '../tests/next-round-suggester/simulation/generators'
import type { SimulationConfig } from '../tests/next-round-suggester/simulation/runner'

const BASE: SimulationConfig = {
  n_players: 16,
  courts: 3,
  rounds: 6,
  pvna_distribution: 'bimodal',
  gender_ratio: 0.5,
  gender_pref_rate: 0,
  group_count: 0,
  group_size_range: [2, 3],
  use_corrector: false,
  seed: 0,
  scenario_name: 'bimodal_16',
  first_round_alt_idx: 0,
}

function pad(s: string | number, w: number) { return String(s).padStart(w) }
function fmt(n: number) { return n.toFixed(1) }

function pairRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows = new Map<string, SessionPairHistoryRow>()
  for (const player of state.players.values()) {
    for (const [pid, count] of player.partner_counts) {
      const [a, b] = player.player_id < pid ? [player.player_id, pid] : [pid, player.player_id]
      const key = `${a}:${b}`
      const ex = rows.get(key) ?? { session_id: state.session_id, player_a: a, player_b: b, partner_count: 0, opponent_count: 0 }
      rows.set(key, { ...ex, partner_count: Math.max(ex.partner_count, count) })
    }
    for (const [pid, count] of player.opponent_counts) {
      const [a, b] = player.player_id < pid ? [player.player_id, pid] : [pid, player.player_id]
      const key = `${a}:${b}`
      const ex = rows.get(key) ?? { session_id: state.session_id, player_a: a, player_b: b, partner_count: 0, opponent_count: 0 }
      rows.set(key, { ...ex, opponent_count: Math.max(ex.opponent_count, count) })
    }
  }
  return [...rows.values()]
}

function applyPairs(players: Map<string, PlayerSessionState>, pairs: SessionPairHistoryRow[]) {
  for (const p of players.values()) { p.partner_counts = new Map(); p.opponent_counts = new Map() }
  for (const row of pairs) {
    const a = players.get(row.player_a); const b = players.get(row.player_b)
    if (!a || !b) continue
    a.partner_counts.set(row.player_b, row.partner_count); b.partner_counts.set(row.player_a, row.partner_count)
    a.opponent_counts.set(row.player_b, row.opponent_count); b.opponent_counts.set(row.player_a, row.opponent_count)
  }
}

function commitRound(state: SessionState, round: RoundRecord): SessionState {
  const committed = commitCompletedRound(state, round, pairRowsFromState(state))
  applyPairs(committed.players, committed.pairHistory)
  return { ...state, current_round: round.round_no + 1, players: committed.players, rounds: [...state.rounds, round] }
}

type SimResult = { fairness: number; pvnaAvg: number; pvnaMax: number; pvnaWorstRound: number }

// Lean simulation: no post-processing, search budget cap per round
function simulateForward(initialState: SessionState, maxRounds: number, firstRoundAltIdx = 0): SimResult {
  let state = initialState
  const pvnaDiffs: number[] = []
  const roundWorstPvna: number[] = []

  for (let roundNo = 1; roundNo <= maxRounds; roundNo++) {
    const adjustment = BASE.use_corrector ? correctForFairness(state) : null
    const effectiveState = adjustment ? applyFairnessAdjustment(state, adjustment) : state
    const altIdx = roundNo === 1 ? firstRoundAltIdx : 0
    const suggestion = suggestNextRound(effectiveState, {
      tier_overrides: adjustment?.tier_overrides ?? {},
      max_alternatives: altIdx > 0 ? altIdx + 1 : 1,
      search_budget: createSearchBudget(500 * SEARCH_UNITS_PER_LEGACY_MS),
    })
    const alternative = suggestion.alternatives[altIdx] ?? suggestion.alternatives[0]
    if (!alternative) break

    // Track PVNA partner mismatch (intra-team) — this is what causes bad matches
    let worstThisRound = 0
    for (const match of alternative.matches) {
      const pvnas = [...match.team_a, ...match.team_b].map(id => state.players.get(id)?.pvna ?? 0)
      const partnerDiffA = Math.abs(pvnas[0] - pvnas[1])
      const partnerDiffB = Math.abs(pvnas[2] - pvnas[3])
      const maxPartnerDiff = Math.max(partnerDiffA, partnerDiffB)
      pvnaDiffs.push(maxPartnerDiff)
      worstThisRound = Math.max(worstThisRound, maxPartnerDiff)
    }
    roundWorstPvna.push(worstThisRound)

    const round: RoundRecord = {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed',
      matches: alternative.matches,
      resting: alternative.resting,
      started_at: null,
      ended_at: null,
    }
    state = commitRound(state, round)
  }

  return {
    fairness: computeSessionFairness(state).total,
    pvnaAvg: pvnaDiffs.length > 0 ? pvnaDiffs.reduce((a, b) => a + b, 0) / pvnaDiffs.length : 0,
    pvnaMax: pvnaDiffs.length > 0 ? Math.max(...pvnaDiffs) : 0,
    pvnaWorstRound: roundWorstPvna.length > 0 ? roundWorstPvna.reduce((a, b) => a + b, 0) / roundWorstPvna.length : 0,
  }
}

async function main() {
  const nSeeds = parseInt(process.argv[2] ?? '5', 10)
  console.log(`\nPlanning vs Greedy — ${BASE.n_players} players, ${BASE.courts} courts, ${BASE.rounds} rounds, ${BASE.pvna_distribution} PVNA`)
  console.log(`Testing ${nSeeds} seeds × 3 alternatives each...\n`)

  const results: { seed: number; greedy: number; alt1: number; alt2: number; best: number; delta: number }[] = []

  for (let seed = 0; seed < nSeeds; seed++) {
    const rng = seedrandom(String(seed))
    const players = generatePlayers({ ...BASE, seed }, rng)
    const state = initState(players, { courts: BASE.courts, pvna_tolerance: 0.5 })

    const greedy = simulateForward(state, BASE.rounds, 0)
    const alt1 = simulateForward(state, BASE.rounds, 1)
    const alt2 = simulateForward(state, BASE.rounds, 2)
    // "best" = lowest avg PVNA mismatch
    const best = [greedy, alt1, alt2].reduce((a, b) => a.pvnaAvg < b.pvnaAvg ? a : b)
    const delta = greedy.pvnaAvg - best.pvnaAvg

    results.push({ seed, greedy: greedy.pvnaAvg, alt1: alt1.pvnaAvg, alt2: alt2.pvnaAvg, best: best.pvnaAvg, delta })
    process.stdout.write(
      `  seed=${seed}  greedy=${fmt(greedy.pvnaAvg)}(max=${fmt(greedy.pvnaMax)})` +
      `  alt1=${fmt(alt1.pvnaAvg)}  alt2=${fmt(alt2.pvnaAvg)}  best=${fmt(best.pvnaAvg)}  Δ=${fmt(delta)}\n`
    )
  }

  const avgGreedy = results.reduce((s, r) => s + r.greedy, 0) / results.length
  const avgBest = results.reduce((s, r) => s + r.best, 0) / results.length
  const avgDelta = results.reduce((s, r) => s + r.delta, 0) / results.length
  const maxDelta = Math.max(...results.map(r => r.delta))
  const improved = results.filter(r => r.delta > 0.05).length

  console.log('\n' + '─'.repeat(60))
  console.log('Metric: avg max-partner-PVNA-diff per match (lower = better)')
  console.log(`Avg greedy:     ${fmt(avgGreedy)}`)
  console.log(`Avg best-of-3:  ${fmt(avgBest)}`)
  console.log(`Avg improvement: -${fmt(avgDelta)} (${fmt(avgDelta / avgGreedy * 100)}%)`)
  console.log(`Max improvement (1 seed): -${fmt(maxDelta)}`)
  console.log(`Seeds improved >0.05: ${improved}/${results.length}`)

  if (avgDelta / avgGreedy > 0.05) console.log('\n✓ Concept validated: planning improves PVNA quality >5%')
  else if (avgDelta > 0.01) console.log('\n~ Marginal PVNA improvement')
  else console.log('\n✗ Greedy near-optimal for PVNA — alternatives are equivalent')
}

main().catch(console.error)
