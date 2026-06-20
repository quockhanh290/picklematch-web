/**
 * Beam search vs greedy — multi-scenario, multi-invariant comparison.
 *
 * Beam search applies K alternatives at EVERY round, keeps B best paths.
 * Reports: PVNA partner mismatch, inter-team gap, partner repeats,
 *          opponent repeats, rest std dev, play std dev.
 *
 * Run: npx tsx scripts/sim-beam-vs-greedy.ts
 */

import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionState,
} from '../lib/next-round-suggester/types'
import { initState } from '../tests/next-round-suggester/simulation/generators'

// ─── scenarios ─────────────────────────────────────────────────────────────

type Scenario = {
  label: string
  n_players: number
  n_low: number     // players with pvna ~2.3–2.9
  courts: number
  rounds: number
  runtime_ms: number  // per suggestNextRound call; larger courts need more time
}

const SCENARIOS: Scenario[] = [
  // Design rules:
  // 1. n_low must be a multiple of 4 so Stage-1 finds homogeneous L/H courts immediately
  //    (avoids exhaustive failed search → timeout → NO_VALID_MATCH).
  // 2. n_players is 2× n_playing so bench = n_playing; stable L/H split across all rounds.
  // 3. runtime_ms scales up with n_players since bestPartitioning over more courts is slower.
  { label: '16p/2c',  n_players: 16, n_low: 4,  courts: 2, rounds: 12, runtime_ms: 1000 },
  { label: '32p/4c',  n_players: 32, n_low: 8,  courts: 4, rounds: 12, runtime_ms: 2000 },
  { label: '48p/6c',  n_players: 48, n_low: 12, courts: 6, rounds: 12, runtime_ms: 4000 },
  { label: '64p/8c',  n_players: 64, n_low: 16, courts: 8, rounds: 12, runtime_ms: 8000 },
]

const BEAM_WIDTH = 5
const K_ALTERNATIVES = 3
const PVNA_TOLERANCE = 0.5

// ─── player generation ─────────────────────────────────────────────────────

function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo]
  return Array.from({ length: n }, (_, i) => lo + (hi - lo) * (i / (n - 1)))
}

function round2(x: number) { return Math.round(x * 100) / 100 }

function createScenarioPlayers(s: Scenario): PlayerSessionState[] {
  const checkedInAt = new Date('2026-05-15T12:00:00.000Z')
  const nHigh = s.n_players - s.n_low

  // Spread evenly within each group so the algorithm has varied PVNA to work with
  const lowPvnas  = linspace(2.3, 2.9, s.n_low).map(round2)
  const highPvnas = linspace(4.0, 4.5, nHigh).map(round2)

  const defs = [
    ...lowPvnas.map((pvna, i)  => ({ id: `L${i + 1}`,  pvna })),
    ...highPvnas.map((pvna, i) => ({ id: `H${i + 1}`,  pvna })),
  ]

  // Realistic gender mix: alternate M/F.
  // 50% prefer mixed partner, 33% prefer mixed opponents — typical recreational session.
  return defs.map(({ id, pvna }, idx) => ({
    player_id: id,
    pvna,
    gender: (idx % 2 === 0 ? 'M' : 'F') as 'M' | 'F',
    group_id: null,
    partner_gender_pref: (idx % 2 === 0 ? 'mixed' : 'any') as 'mixed' | 'any',
    opponent_gender_pref: (idx % 3 === 0 ? 'mixed' : 'any') as 'mixed' | 'any',
    checked_in_at: checkedInAt,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_play: 0,
    consecutive_rest: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    rounds_available: 0,
  }))
}

// ─── state commit ──────────────────────────────────────────────────────────

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

// ─── per-round metrics ──────────────────────────────────────────────────────

type RoundMetrics = {
  pvna_partner_avg: number   // avg intra-team partner PVNA diff
  pvna_partner_max: number   // worst intra-team partner diff this round
  pvna_team_gap_avg: number  // avg |team_a_avg - team_b_avg| per match
  partner_repeats: number    // # partner pairs seen before
  opp_repeats: number        // # matches with ≥1 opponent pair seen before
  algo_score: number         // raw engine score (scoreMatch sum) — beam optimizes this
}

function computeRoundMetrics(state: SessionState, alt: { matches: Match[]; score: number }): RoundMetrics {
  const matches = alt.matches
  let partnerAvgAcc = 0
  let partnerMax = 0
  let teamGapAcc = 0
  let partnerRepeats = 0
  let oppRepeats = 0

  for (const m of matches) {
    const [a1, a2, b1, b2] = [...m.team_a, ...m.team_b].map(
      id => state.players.get(id)?.pvna ?? 0,
    )
    const pA = Math.abs(a1 - a2)
    const pB = Math.abs(b1 - b2)
    const maxP = Math.max(pA, pB)
    partnerAvgAcc += (pA + pB) / 2
    if (maxP > partnerMax) partnerMax = maxP

    const teamGap = Math.abs((a1 + a2) / 2 - (b1 + b2) / 2)
    teamGapAcc += teamGap

    // Partner repeats: check both partner pairs
    const pa1 = state.players.get(m.team_a[0])
    const pa2 = state.players.get(m.team_a[1])
    const pb1 = state.players.get(m.team_b[0])
    const pb2 = state.players.get(m.team_b[1])
    if (pa1?.partner_counts.get(m.team_a[1]) ?? 0 > 0) partnerRepeats++
    if (pb1?.partner_counts.get(m.team_b[1]) ?? 0 > 0) partnerRepeats++

    // Opponent repeats: at least 1 of the 4 cross-pairs seen before
    const oppPairs = [
      [m.team_a[0], m.team_b[0]], [m.team_a[0], m.team_b[1]],
      [m.team_a[1], m.team_b[0]], [m.team_a[1], m.team_b[1]],
    ] as const
    const hasOppRepeat = oppPairs.some(
      ([x, y]) => (state.players.get(x)?.opponent_counts.get(y) ?? 0) > 0,
    )
    if (hasOppRepeat) oppRepeats++
  }

  const n = matches.length || 1
  return {
    pvna_partner_avg: partnerAvgAcc / n,
    pvna_partner_max: partnerMax,
    pvna_team_gap_avg: teamGapAcc / n,
    partner_repeats: partnerRepeats,
    opp_repeats: oppRepeats,
    algo_score: alt.score,
  }
}

// ─── final-state metrics ────────────────────────────────────────────────────

function computeFinalMetrics(state: SessionState) {
  const players = [...state.players.values()].filter(p => p.checked_out_at === null)
  const plays = players.map(p => p.matches_played)
  const rests = players.map(p => {
    const totalRounds = state.rounds.length
    return totalRounds - p.matches_played
  })

  const meanPlay = plays.reduce((s, x) => s + x, 0) / plays.length
  const meanRest = rests.reduce((s, x) => s + x, 0) / rests.length
  const playStd  = Math.sqrt(plays.reduce((s, x) => s + (x - meanPlay) ** 2, 0) / plays.length)
  const restStd  = Math.sqrt(rests.reduce((s, x) => s + (x - meanRest) ** 2, 0) / rests.length)

  return { playStd, restStd, meanPlay, meanRest }
}

// ─── beam types ─────────────────────────────────────────────────────────────

type BeamPath = {
  state: SessionState
  rounds: RoundMetrics[]
}

function beamScore(path: BeamPath): number {
  // Minimize cumulative engine penalty (same objective as scoreMatch).
  // Lower algo_score = better across all factors: pvna, repeats, gender_pref, etc.
  return path.rounds.reduce((s, r) => s + r.algo_score, 0)
}

// ─── suggest wrapper ────────────────────────────────────────────────────────

function callSuggest(state: SessionState, k: number, runtimeMs: number) {
  const result = suggestNextRound(state, {
    max_alternatives: k,
    max_runtime_ms: runtimeMs,
  })
  return { result, effectiveState: state }
}

// ─── runners ────────────────────────────────────────────────────────────────

function runGreedy(initial: SessionState, nRounds: number, runtimeMs: number): BeamPath {
  let path: BeamPath = { state: initial, rounds: [] }
  for (let roundNo = 1; roundNo <= nRounds; roundNo++) {
    const { result } = callSuggest(path.state, 1, runtimeMs)
    const alt = result.alternatives[0]
    if (!alt) {
      process.stderr.write(`    [greedy] R${roundNo}: NO_VALID_MATCH\n`)
      break
    }
    const metrics = computeRoundMetrics(path.state, alt)
    const round: RoundRecord = {
      session_id: path.state.session_id, round_no: roundNo, status: 'completed',
      matches: alt.matches, resting: alt.resting, started_at: null, ended_at: null,
    }
    path = { state: advanceState(path.state, round), rounds: [...path.rounds, metrics] }
  }
  return path
}

function runBeam(initial: SessionState, nRounds: number, runtimeMs: number): BeamPath {
  let beams: BeamPath[] = [{ state: initial, rounds: [] }]
  for (let roundNo = 1; roundNo <= nRounds; roundNo++) {
    const candidates: BeamPath[] = []
    for (const beam of beams) {
      const { result } = callSuggest(beam.state, K_ALTERNATIVES, runtimeMs)
      for (const alt of result.alternatives) {
        const metrics = computeRoundMetrics(beam.state, alt)
        const round: RoundRecord = {
          session_id: beam.state.session_id, round_no: roundNo, status: 'completed',
          matches: alt.matches, resting: alt.resting, started_at: null, ended_at: null,
        }
        candidates.push({ state: advanceState(beam.state, round), rounds: [...beam.rounds, metrics] })
      }
    }
    if (candidates.length === 0) break
    candidates.sort((a, b) => beamScore(a) - beamScore(b))
    beams = candidates.slice(0, BEAM_WIDTH)
  }
  return beams[0]
}

// ─── reporting ───────────────────────────────────────────────────────────────

function f3(n: number) { return n.toFixed(3) }
function f1(n: number) { return n.toFixed(1) }
function pct(delta: number, base: number) {
  if (base === 0) return '  n/a'
  return `${delta >= 0 ? '-' : '+'}${Math.abs(delta / base * 100).toFixed(0)}%`
}

type PathSummary = {
  pvnaPartnerAvg: number
  pvnaPartnerMax: number
  pvnaTeamGapAvg: number
  partnerRepeats: number
  oppRepeats: number
  playStd: number
  restStd: number
  crossRounds: number
  rounds: number
  totalAlgoScore: number
}

function summarisePath(path: BeamPath): PathSummary {
  const n = path.rounds.length || 1
  const pvnaPartnerAvg  = path.rounds.reduce((s, r) => s + r.pvna_partner_avg, 0) / n
  const pvnaPartnerMax  = Math.max(0, ...path.rounds.map(r => r.pvna_partner_max))
  const pvnaTeamGapAvg  = path.rounds.reduce((s, r) => s + r.pvna_team_gap_avg, 0) / n
  const partnerRepeats  = path.rounds.reduce((s, r) => s + r.partner_repeats, 0)
  const oppRepeats      = path.rounds.reduce((s, r) => s + r.opp_repeats, 0)
  const crossRounds     = path.rounds.filter(r => r.pvna_partner_max > PVNA_TOLERANCE).length
  const totalAlgoScore  = path.rounds.reduce((s, r) => s + r.algo_score, 0)
  const { playStd, restStd } = computeFinalMetrics(path.state)
  return { pvnaPartnerAvg, pvnaPartnerMax, pvnaTeamGapAvg, partnerRepeats, oppRepeats, playStd, restStd, crossRounds, rounds: n, totalAlgoScore }
}

function printTable(g: PathSummary, b: PathSummary) {
  const rows: [string, string, string, string][] = [
    ['Invariant',               'Greedy',          'Beam',           'Δ (beam)'],
    ['─────────────────────',   '──────────',       '──────────',     '──────────'],
    ['Engine score (total)',     String(Math.round(g.totalAlgoScore)), String(Math.round(b.totalAlgoScore)), pct(g.totalAlgoScore - b.totalAlgoScore, g.totalAlgoScore || 1)],
    ['PVNA partner avg',        f3(g.pvnaPartnerAvg),  f3(b.pvnaPartnerAvg),  pct(g.pvnaPartnerAvg - b.pvnaPartnerAvg, g.pvnaPartnerAvg)],
    ['PVNA partner worst-rnd',  f3(g.pvnaPartnerMax),  f3(b.pvnaPartnerMax),  pct(g.pvnaPartnerMax - b.pvnaPartnerMax, g.pvnaPartnerMax)],
    ['PVNA inter-team gap avg', f3(g.pvnaTeamGapAvg),  f3(b.pvnaTeamGapAvg),  pct(g.pvnaTeamGapAvg - b.pvnaTeamGapAvg, g.pvnaTeamGapAvg)],
    ['Partner repeats (total)', String(g.partnerRepeats), String(b.partnerRepeats), pct(g.partnerRepeats - b.partnerRepeats, g.partnerRepeats || 1)],
    ['Opp repeats (total)',     String(g.oppRepeats),      String(b.oppRepeats),      pct(g.oppRepeats - b.oppRepeats, g.oppRepeats || 1)],
    ['Play count std dev',      f3(g.playStd),         f3(b.playStd),         pct(g.playStd - b.playStd, g.playStd || 1)],
    ['Rest count std dev',      f3(g.restStd),         f3(b.restStd),         pct(g.restStd - b.restStd, g.restStd || 1)],
    [`Cross-PVNA rounds`,       `${g.crossRounds}/${g.rounds}`, `${b.crossRounds}/${b.rounds}`, pct(g.crossRounds - b.crossRounds, g.crossRounds || 1)],
  ]
  const cols = [0, 1, 2, 3].map(c => Math.max(...rows.map(r => r[c].length)))
  for (const row of rows) {
    process.stdout.write(
      '  ' + row.map((cell, i) => cell.padEnd(cols[i])).join('  ') + '\n',
    )
  }
}

function printRoundDetail(greedy: BeamPath, beam: BeamPath) {
  const nRounds = Math.max(greedy.rounds.length, beam.rounds.length)
  process.stdout.write('\n  Per-round detail (PVNA partner avg | algo score):\n')
  process.stdout.write('  Rnd  G.pvna  B.pvna  Δpvna   G.score  B.score  Δscore\n')
  process.stdout.write('  ───  ──────  ──────  ──────  ───────  ───────  ──────\n')
  for (let i = 0; i < nRounds; i++) {
    const g = greedy.rounds[i]
    const b = beam.rounds[i]
    const gpvna = g ? g.pvna_partner_avg : NaN
    const bpvna = b ? b.pvna_partner_avg : NaN
    const gscore = g ? g.algo_score : NaN
    const bscore = b ? b.algo_score : NaN
    const pvnaStr = (!isNaN(gpvna) && !isNaN(bpvna)) ? pct(gpvna - bpvna, gpvna || 0.001) : '  n/a'
    const scoreStr = (!isNaN(gscore) && !isNaN(bscore)) ? pct(gscore - bscore, gscore || 1) : '  n/a'
    const cross = (g && g.pvna_partner_max > PVNA_TOLERANCE) || (b && b.pvna_partner_max > PVNA_TOLERANCE) ? ' ★' : ''
    process.stdout.write(
      `  R${String(i + 1).padStart(2)}  ` +
      `${isNaN(gpvna) ? ' n/a  ' : f3(gpvna)}  ` +
      `${isNaN(bpvna) ? ' n/a  ' : f3(bpvna)}  ` +
      `${pvnaStr.padStart(6)}  ` +
      `${isNaN(gscore) ? '   n/a  ' : String(Math.round(gscore)).padStart(7)}  ` +
      `${isNaN(bscore) ? '   n/a  ' : String(Math.round(bscore)).padStart(7)}  ` +
      `${scoreStr}${cross}\n`,
    )
  }
  process.stdout.write('  (★ = cross-PVNA match this round)\n')
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const allResults: { label: string; gMs: number; bMs: number; g: PathSummary; b: PathSummary }[] = []

  for (const scenario of SCENARIOS) {
    const players = createScenarioPlayers(scenario)
    const initial = initState(players, { courts: scenario.courts, pvna_tolerance: PVNA_TOLERANCE })

    process.stdout.write(`\n${'═'.repeat(62)}\n`)
    process.stdout.write(
      `Scenario: ${scenario.label}  (${scenario.n_low} low / ${scenario.n_players - scenario.n_low} high,` +
      ` ${scenario.courts} courts, ${scenario.rounds} rounds)\n`,
    )
    process.stdout.write(`${'═'.repeat(62)}\n`)

    process.stdout.write('  Running greedy... ')
    const gT0 = Date.now()
    const greedy = runGreedy(initial, scenario.rounds, scenario.runtime_ms)
    const gMs = Date.now() - gT0
    process.stdout.write(`done (${gMs}ms, ${greedy.rounds.length} rounds)\n`)

    process.stdout.write('  Running beam...   ')
    const bT0 = Date.now()
    const beam = runBeam(initial, scenario.rounds, scenario.runtime_ms)
    const bMs = Date.now() - bT0
    process.stdout.write(`done (${bMs}ms, ${beam.rounds.length} rounds)\n\n`)

    const g = summarisePath(greedy)
    const b = summarisePath(beam)
    printTable(g, b)
    printRoundDetail(greedy, beam)
    allResults.push({ label: scenario.label, gMs, bMs, g, b })
  }

  // ── summary across scenarios ──
  process.stdout.write(`\n${'═'.repeat(62)}\n`)
  process.stdout.write('SUMMARY — avg improvement across scenarios\n')
  process.stdout.write(`${'═'.repeat(62)}\n`)
  process.stdout.write('  Scenario    PVNA-partner  worst-rnd  partner-rpt  rest-std  overhead\n')
  for (const { label, gMs, bMs, g, b } of allResults) {
    const pvnaPct    = pct(g.pvnaPartnerAvg - b.pvnaPartnerAvg, g.pvnaPartnerAvg)
    const worstPct   = pct(g.pvnaPartnerMax - b.pvnaPartnerMax, g.pvnaPartnerMax)
    const repeatPct  = pct(g.partnerRepeats - b.partnerRepeats, g.partnerRepeats || 1)
    const restPct    = pct(g.restStd - b.restStd, g.restStd || 1)
    const overheadX  = (bMs / gMs).toFixed(1)
    process.stdout.write(
      `  ${label.padEnd(10)}` +
      `  ${pvnaPct.padStart(12)}` +
      `  ${worstPct.padStart(9)}` +
      `  ${repeatPct.padStart(11)}` +
      `  ${restPct.padStart(8)}` +
      `  ${overheadX}x\n`,
    )
  }
}

main().catch(console.error)
