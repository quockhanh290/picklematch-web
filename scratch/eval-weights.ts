/**
 * Evaluate a set of scoring weights by running greedy simulation.
 * Called by bo-weights.py as subprocess.
 *
 * Usage: npx tsx scripts/eval-weights.ts \
 *   --pvna=4 --partner_repeat=3 --opponent_repeat=1.5 \
 *   --group_bonus=6 --partner_gender_pref=4 \
 *   --opponent_gender_pref=2 --consecutive_play=4
 *
 * Outputs JSON: { quality: number, metrics: { ... } }
 */

import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionState,
  ScoringWeights,
} from '../lib/next-round-suggester/types'
import { initState } from '../tests/next-round-suggester/simulation/generators'

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, '').split('=')
    if (k && v !== undefined) out[k] = parseFloat(v)
  }
  return out
}

const args = parseArgs()

const WEIGHTS: ScoringWeights = {
  pvna:                args.pvna                ?? 1,
  partner_repeat:      args.partner_repeat      ?? 3,
  opponent_repeat:     args.opponent_repeat     ?? 1.5,
  group_bonus:         args.group_bonus         ?? 6,
  partner_gender_pref: args.partner_gender_pref ?? 4,
  opponent_gender_pref: args.opponent_gender_pref ?? 2,
  consecutive_play:    args.consecutive_play    ?? 4,
}

// ─── External quality priority weights (independent of engine weights) ────────
// Priority order (user-defined): intra > inter > p-rpt > c-rest > o-rpt > c-play > gender > group
const Q = { intra: 8, inter: 7, p_rpt: 6, c_rest: 5, o_rpt: 4, c_play: 3, gender: 2, group: 1 }

// ─── Scenario: 32p/4c ────────────────────────────────────────────────────────
const N_PLAYERS  = 32
const N_LOW      = 8
const N_COURTS   = 4
const N_ROUNDS   = 12
const RUNTIME_MS = 1500
const PVNA_TOL   = 0.5

// ─── Player generation ───────────────────────────────────────────────────────

function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo]
  return Array.from({ length: n }, (_, i) => lo + (hi - lo) * (i / (n - 1)))
}

function createPlayers(): PlayerSessionState[] {
  const nHigh = N_PLAYERS - N_LOW
  const lowPvnas  = linspace(2.3, 2.9, N_LOW).map(v => Math.round(v * 100) / 100)
  const highPvnas = linspace(4.0, 4.5, nHigh).map(v => Math.round(v * 100) / 100)
  const defs = [
    ...lowPvnas.map((pvna, i)  => ({ id: `L${i + 1}`, pvna })),
    ...highPvnas.map((pvna, i) => ({ id: `H${i + 1}`, pvna })),
  ]
  const checkedInAt = new Date('2026-05-15T12:00:00.000Z')

  return defs.map(({ id, pvna }, idx) => {
    const gender = (idx % 2 === 0 ? 'M' : 'F') as 'M' | 'F'
    // 50% prefer mixed partner: male prefers 'F', female prefers 'M'
    const prefersMixed = idx % 2 === 0  // every other player
    const partnerPref = prefersMixed ? (gender === 'M' ? 'F' : 'M') : 'any'
    // 33% prefer mixed opponent
    const prefersOppMixed = idx % 3 === 0
    const oppPref = prefersOppMixed ? (gender === 'M' ? 'F' : 'M') : 'any'
    return {
      player_id: id,
      pvna,
      gender,
      group_id: null,
      partner_gender_pref: partnerPref as 'any' | 'M' | 'F',
      opponent_gender_pref: oppPref as 'any' | 'M' | 'F',
      checked_in_at: checkedInAt,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: false,
      rounds_available: 0,
    }
  })
}

// ─── State helpers ───────────────────────────────────────────────────────────

function applyPairHistory(
  players: Map<string, PlayerSessionState>,
  pairHistory: SessionPairHistoryRow[],
) {
  for (const p of players.values()) {
    p.partner_counts = new Map()
    p.opponent_counts = new Map()
  }
  for (const row of pairHistory) {
    const a = players.get(row.player_a)
    const b = players.get(row.player_b)
    if (!a || !b) continue
    a.partner_counts.set(row.player_b, row.partner_count)
    b.partner_counts.set(row.player_a, row.partner_count)
    a.opponent_counts.set(row.player_b, row.opponent_count)
    b.opponent_counts.set(row.player_a, row.opponent_count)
  }
}

function advanceState(state: SessionState, round: RoundRecord): SessionState {
  const committed = commitCompletedRound(state, round, pairHistoryRowsFromState(state))
  applyPairHistory(committed.players, committed.pairHistory)
  return {
    ...state,
    current_round: round.round_no + 1,
    players: committed.players,
    rounds: [...state.rounds, round],
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

type Accum = {
  intra_pvna_sum: number
  inter_pvna_sum: number
  partner_repeats: number
  opp_repeats: number
  gender_violations: number
  gender_checks: number
  match_count: number
  consec_rest_violations: number
  consec_play_violations: number
  player_round_checks: number
}

function accumulateRoundMetrics(
  state: SessionState,
  matches: Match[],
  acc: Accum,
) {
  for (const m of matches) {
    const [a1id, a2id, b1id, b2id] = [...m.team_a, ...m.team_b]
    const a1 = state.players.get(a1id)!
    const a2 = state.players.get(a2id)!
    const b1 = state.players.get(b1id)!
    const b2 = state.players.get(b2id)!

    // Intra-team PVNA (partner diff)
    const pa = Math.abs(a1.pvna - a2.pvna)
    const pb = Math.abs(b1.pvna - b2.pvna)
    acc.intra_pvna_sum += (pa + pb) / 2

    // Inter-team PVNA (team avg diff)
    const teamGap = Math.abs((a1.pvna + a2.pvna) / 2 - (b1.pvna + b2.pvna) / 2)
    acc.inter_pvna_sum += teamGap

    // Partner repeats
    if ((a1.partner_counts.get(a2id) ?? 0) > 0) acc.partner_repeats++
    if ((b1.partner_counts.get(b2id) ?? 0) > 0) acc.partner_repeats++

    // Opponent repeats (any cross-pair seen before)
    const hasOpp = (
      (a1.opponent_counts.get(b1id) ?? 0) > 0 ||
      (a1.opponent_counts.get(b2id) ?? 0) > 0 ||
      (a2.opponent_counts.get(b1id) ?? 0) > 0 ||
      (a2.opponent_counts.get(b2id) ?? 0) > 0
    )
    if (hasOpp) acc.opp_repeats++

    // Gender violations (partner pref only for quality score)
    const checkGender = (player: PlayerSessionState, partner: PlayerSessionState) => {
      if (player.partner_gender_pref === 'any') return
      acc.gender_checks++
      if (player.partner_gender_pref !== partner.gender) acc.gender_violations++
    }
    checkGender(a1, a2); checkGender(a2, a1)
    checkGender(b1, b2); checkGender(b2, b1)

    acc.match_count++
  }
}

function accumulatePlayerMetrics(state: SessionState, acc: Accum) {
  for (const p of state.players.values()) {
    if (p.checked_out_at !== null) continue
    acc.player_round_checks++
    if (p.consecutive_rest >= 2) acc.consec_rest_violations++
    if (p.consecutive_play >= 3) acc.consec_play_violations++
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const players = createPlayers()
  let state: SessionState = {
    ...initState(players, { courts: N_COURTS, pvna_tolerance: PVNA_TOL }),
    weights: WEIGHTS,
  }

  const acc: Accum = {
    intra_pvna_sum: 0, inter_pvna_sum: 0,
    partner_repeats: 0, opp_repeats: 0,
    gender_violations: 0, gender_checks: 0,
    match_count: 0,
    consec_rest_violations: 0, consec_play_violations: 0,
    player_round_checks: 0,
  }

  for (let roundNo = 1; roundNo <= N_ROUNDS; roundNo++) {
    const result = suggestNextRound(state, {
      max_alternatives: 1,
      max_runtime_ms: RUNTIME_MS,
    })
    const alt = result.alternatives[0]
    if (!alt) break

    accumulateRoundMetrics(state, alt.matches, acc)

    const round: RoundRecord = {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed',
      matches: alt.matches,
      resting: alt.resting,
      started_at: null,
      ended_at: null,
    }
    state = advanceState(state, round)
    accumulatePlayerMetrics(state, acc)
  }

  const n = acc.match_count || 1
  const pr = acc.player_round_checks || 1
  const gc = acc.gender_checks || 1

  const metrics = {
    intra_pvna:      acc.intra_pvna_sum / n,
    inter_pvna:      acc.inter_pvna_sum / n,
    p_rpt_rate:      acc.partner_repeats / (N_ROUNDS * N_COURTS),
    c_rest_rate:     acc.consec_rest_violations / pr,
    o_rpt_rate:      acc.opp_repeats / (N_ROUNDS * N_COURTS),
    c_play_rate:     acc.consec_play_violations / pr,
    gender_viol_rate: acc.gender_violations / gc,
    group_viol_rate: 0,
  }

  const quality =
    metrics.intra_pvna       * Q.intra  +
    metrics.inter_pvna       * Q.inter  +
    metrics.p_rpt_rate       * Q.p_rpt  +
    metrics.c_rest_rate      * Q.c_rest +
    metrics.o_rpt_rate       * Q.o_rpt  +
    metrics.c_play_rate      * Q.c_play +
    metrics.gender_viol_rate * Q.gender +
    metrics.group_viol_rate  * Q.group

  process.stdout.write(JSON.stringify({ quality, metrics }) + '\n')
}

main()
