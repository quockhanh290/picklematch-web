/**
 * Simulate per-court staggered suggestions: greedy vs beam look-ahead.
 *
 * Models real production flow: courts complete in random order within a round.
 * Greedy = each court picks best match from currently-available players.
 * Beam   = each court tries K alternatives, simulates remaining courts, picks best.
 *
 * Usage: npx tsx scripts/sim-per-court-beam.ts
 */
import seedrandom from 'seedrandom'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { generatePlayers, initState } from '../tests/next-round-suggester/simulation/generators'
import type { PlayerSessionState, SessionState } from '../lib/next-round-suggester/types'

// ─── config ────────────────────────────────────────────────────────────────

// n=10..60 step 5, courts = floor(n/5) → bench ~20% consistently
const SCENARIOS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(n => {
  const courts = Math.max(2, Math.floor(n / 5))
  return { label: `${n}p/${courts}c`, n_players: n, courts }
})
const ROUNDS = 8
const SEEDS = ['s1', 's2', 's3']  // fewer seeds to keep runtime manageable
const BEAM_K = 3   // alternatives to try per court
const MAX_RUNTIME_MS = 300

// ─── quality metric (lower = better) ───────────────────────────────────────

const MODES = ['greedy', 'beam-current', 'beam-equal', 'beam-dynamic', 'beam-pareto', 'beam-hybrid'] as const
type Mode = typeof MODES[number]

function matchComponents(teamA: [string, string], teamB: [string, string], state: SessionState) {
  const pvna = (id: string) => state.players.get(id)?.pvna ?? 0
  const inter = Math.abs((pvna(teamA[0]) + pvna(teamA[1])) - (pvna(teamB[0]) + pvna(teamB[1])))
  const intra = Math.max(Math.abs(pvna(teamA[0]) - pvna(teamA[1])), Math.abs(pvna(teamB[0]) - pvna(teamB[1])))
  const partnerRepeat =
    ((state.players.get(teamA[0])?.partner_counts.get(teamA[1]) ?? 0) > 0 ? 1 : 0) +
    ((state.players.get(teamB[0])?.partner_counts.get(teamB[1]) ?? 0) > 0 ? 1 : 0)
  const oppRepeat = teamA.some(a => teamB.some(b => (state.players.get(a)?.opponent_counts.get(b) ?? 0) > 0)) ? 1 : 0
  return { inter, intra, partnerRepeat, oppRepeat }
}

function matchQualityW(teamA: [string, string], teamB: [string, string], state: SessionState, interW = 8, intraW = 6): number {
  const { inter, intra, partnerRepeat, oppRepeat } = matchComponents(teamA, teamB, state)
  return inter * interW + intra * intraW + partnerRepeat * 4 + oppRepeat * 2
}

// For reporting: fixed neutral weights (inter=intra=7)
function matchQuality(teamA: [string, string], teamB: [string, string], state: SessionState): number {
  return matchQualityW(teamA, teamB, state, 7, 7)
}

function computePoolSpread(busyIds: Set<string>, state: SessionState): number {
  const pvnas: number[] = []
  state.players.forEach((p, id) => {
    if (!busyIds.has(id) && p.checked_out_at === null && !p.opted_rest) pvnas.push(p.pvna)
  })
  if (pvnas.length < 2) return 0
  return Math.max(...pvnas) - Math.min(...pvnas)
}

// ─── state helpers ──────────────────────────────────────────────────────────

function applyMatch(
  state: SessionState,
  teamA: [string, string],
  teamB: [string, string],
  roundNo: number,
): SessionState {
  const players = new Map(state.players)
  const played = new Set([...teamA, ...teamB])

  players.forEach((p, id) => {
    if (played.has(id)) {
      players.set(id, {
        ...p,
        matches_played: p.matches_played + 1,
        last_played_round: roundNo,
        consecutive_play: p.consecutive_play + 1,
        consecutive_rest: 0,
      })
    } else if (p.checked_out_at === null && !p.opted_rest) {
      players.set(id, { ...p, consecutive_rest: p.consecutive_rest + 1, consecutive_play: 0 })
    }
  })

  // Update pair counts
  const incr = (a: string, b: string, type: 'partner' | 'opponent') => {
    const pA = players.get(a)
    const pB = players.get(b)
    if (pA) {
      const map = type === 'partner' ? new Map(pA.partner_counts) : new Map(pA.opponent_counts)
      map.set(b, (map.get(b) ?? 0) + 1)
      players.set(a, type === 'partner' ? { ...pA, partner_counts: map } : { ...pA, opponent_counts: map })
    }
    if (pB) {
      const map = type === 'partner' ? new Map(pB.partner_counts) : new Map(pB.opponent_counts)
      map.set(a, (map.get(a) ?? 0) + 1)
      players.set(b, type === 'partner' ? { ...pB, partner_counts: map } : { ...pB, opponent_counts: map })
    }
  }
  incr(teamA[0], teamA[1], 'partner')
  incr(teamB[0], teamB[1], 'partner')
  for (const a of teamA) for (const b of teamB) incr(a, b, 'opponent')

  return { ...state, players, current_round: roundNo + 1 }
}

function applyRoundRest(
  state: SessionState,
  playedIds: Set<string>,
): SessionState {
  const players = new Map(state.players)
  players.forEach((p, id) => {
    if (!playedIds.has(id) && p.checked_out_at === null && !p.opted_rest) {
      players.set(id, { ...p, consecutive_rest: p.consecutive_rest + 1, consecutive_play: 0 })
    }
  })
  return { ...state, players }
}

// ─── per-court staggered round ──────────────────────────────────────────────

type CourtAssignment = {
  courtIdx: number
  teamA: [string, string]
  teamB: [string, string]
  quality: number
  completionRank: number  // 0 = first to complete, C-1 = last
}

function runStaggeredRound(
  state: SessionState,
  lockedByCourt: Map<number, string[]>,
  courtOrder: number[],
  mode: Mode,
): CourtAssignment[] {
  const assignments: CourtAssignment[] = []
  const alreadyAssigned = new Set<string>()

  for (let rank = 0; rank < courtOrder.length; rank++) {
    const courtIdx = courtOrder[rank]
    const completedCourts = new Set(assignments.map(a => a.courtIdx))
    const stillLocked = new Set<string>()
    for (const [cIdx, players] of lockedByCourt) {
      if (cIdx !== courtIdx && !completedCourts.has(cIdx)) players.forEach(id => stillLocked.add(id))
    }
    const busyIds = new Set([...stillLocked, ...alreadyAssigned])

    if (mode === 'greedy') {
      const result = suggestNextMatch(state, { busy_player_ids: busyIds, max_alternatives: 1, max_runtime_ms: MAX_RUNTIME_MS, court_idx: courtIdx })
      const match = result.alternatives[0]?.matches[0]
      if (match) {
        assignments.push({ courtIdx, teamA: match.team_a, teamB: match.team_b, quality: matchQuality(match.team_a, match.team_b, state), completionRank: rank })
        for (const id of [...match.team_a, ...match.team_b]) alreadyAssigned.add(id)
      }
      continue
    }

    // ── Beam modes ─────────────────────────────────────────────────────────
    const result = suggestNextMatch(state, { busy_player_ids: busyIds, max_alternatives: BEAM_K, max_runtime_ms: MAX_RUNTIME_MS, court_idx: courtIdx })
    const futureCourts = [...courtOrder.slice(rank + 1)].sort((a, b) => a - b)
    const alts = result.alternatives.slice(0, BEAM_K).map(a => a.matches[0]).filter(Boolean) as { team_a: [string,string]; team_b: [string,string] }[]

    // Determine inter/intra weights for selection
    let interW: number, intraW: number
    if (mode === 'beam-current') { interW = 8; intraW = 6 }
    else if (mode === 'beam-equal') { interW = 7; intraW = 7 }
    else if (mode === 'beam-hybrid') {
      // n<25 → dynamic (prioritize inter), n>=25 → equal
      const n = state.players.size
      if (n < 25) {
        const spread = computePoolSpread(busyIds, state)
        interW = 7 + spread * 3
        intraW = Math.max(2, 7 - spread * 2)
      } else {
        interW = 7; intraW = 7
      }
    } else {
      // beam-dynamic and beam-pareto: dynamic weights
      const spread = computePoolSpread(busyIds, state)
      interW = 7 + spread * 3
      intraW = Math.max(2, 7 - spread * 2)
    }

    // Pareto filter: remove alternatives dominated in (inter, intra) space
    let candidates = alts
    if (mode === 'beam-pareto') {
      const scores = alts.map(m => matchComponents(m.team_a, m.team_b, state))
      candidates = alts.filter((_, i) =>
        !scores.some((s, j) => j !== i && s.inter <= scores[i].inter && s.intra <= scores[i].intra && (s.inter < scores[i].inter || s.intra < scores[i].intra))
      )
      if (candidates.length === 0) candidates = alts
    }

    // Look-ahead: score each candidate
    let bestMatch = candidates[0]
    let bestScore = Infinity

    for (const match of candidates) {
      const simBusy = new Set([...busyIds, ...match.team_a, ...match.team_b])
      for (const fc of futureCourts) {
        for (const id of lockedByCourt.get(fc) ?? []) simBusy.delete(id)
      }
      let totalScore = matchQualityW(match.team_a, match.team_b, state, interW, intraW)
      for (const fc of futureCourts) {
        const fr = suggestNextMatch(state, { busy_player_ids: new Set(simBusy), max_alternatives: 1, max_runtime_ms: MAX_RUNTIME_MS, court_idx: fc })
        const fm = fr.alternatives[0]?.matches[0]
        if (fm) {
          totalScore += matchQualityW(fm.team_a, fm.team_b, state, interW, intraW)
          for (const id of [...fm.team_a, ...fm.team_b]) simBusy.add(id)
        }
      }
      if (totalScore < bestScore) { bestScore = totalScore; bestMatch = match }
    }

    if (bestMatch) {
      assignments.push({ courtIdx, teamA: bestMatch.team_a, teamB: bestMatch.team_b, quality: matchQuality(bestMatch.team_a, bestMatch.team_b, state), completionRank: rank })
      for (const id of [...bestMatch.team_a, ...bestMatch.team_b]) alreadyAssigned.add(id)
    }
  }

  return assignments
}

// ─── session simulation ─────────────────────────────────────────────────────

type CourtRoundDetail = {
  round: number
  courtIdx: number
  completionRank: number
  teamA: [string, string]
  teamB: [string, string]
  interPvna: number
  intraPvna: number
  partnerRepeat: boolean
  oppRepeat: boolean
  quality: number
}

type RoundMetrics = {
  qualityByRank: number[]
  interPvnaByRank: number[]
  intraByRank: number[]
}

type SessionMetrics = {
  totalQuality: number
  avgInterPvna: number
  avgIntra: number
  partnerRepeatRate: number
  oppRepeatRate: number
  // consecutive metrics: % of player-rounds with consec_rest>=2 or consec_play>=3
  highRestRate: number
  highPlayRate: number
  // avg consecutive_rest among bench players (non-playing) per round
  avgBenchConsecRest: number
  qualityByRank: number[]
  interPvnaByRank: number[]
  intraByRank: number[]
  details: CourtRoundDetail[]
  elapsedMs: number
}

function interPvnaFn(teamA: [string, string], teamB: [string, string], state: SessionState): number {
  const pvna = (id: string) => state.players.get(id)?.pvna ?? 0
  return Math.abs((pvna(teamA[0]) + pvna(teamA[1])) - (pvna(teamB[0]) + pvna(teamB[1])))
}

function intraPvnaFn(teamA: [string, string], teamB: [string, string], state: SessionState): number {
  const pvna = (id: string) => state.players.get(id)?.pvna ?? 0
  return Math.max(
    Math.abs(pvna(teamA[0]) - pvna(teamA[1])),
    Math.abs(pvna(teamB[0]) - pvna(teamB[1])),
  )
}

function hasPartnerRepeat(teamA: [string, string], teamB: [string, string], state: SessionState): boolean {
  return (
    (state.players.get(teamA[0])?.partner_counts.get(teamA[1]) ?? 0) > 0 ||
    (state.players.get(teamB[0])?.partner_counts.get(teamB[1]) ?? 0) > 0
  )
}

function hasOppRepeat(teamA: [string, string], teamB: [string, string], state: SessionState): boolean {
  return teamA.some(a => teamB.some(b => (state.players.get(a)?.opponent_counts.get(b) ?? 0) > 0))
}

function stdDev(vals: number[]): number {
  if (vals.length === 0) return 0
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
}

function simulateSession(
  players: PlayerSessionState[],
  courts: number,
  rounds: number,
  rng: seedrandom.PRNG,
  mode: 'greedy' | 'beam',
): SessionMetrics {
  const startedAt = Date.now()
  let state = initState(players, { courts })
  const courtIdxs = Array.from({ length: courts }, (_, i) => i)

  let lockedByCourt = new Map<number, string[]>(courtIdxs.map(i => [i, []]))
  const allRoundMetrics: RoundMetrics[] = []
  const allDetails: CourtRoundDetail[] = []
  let totalQuality = 0
  let totalPartnerRepeat = 0
  let totalOppRepeat = 0
  let totalMatches = 0
  // consecutive tracking: sampled after each round's state is applied
  let totalHighRest = 0     // player-rounds with consecutive_rest >= 2
  let totalHighPlay = 0     // player-rounds with consecutive_play >= 3
  let totalBenchConsecRest = 0
  let totalBenchSamples = 0
  let totalPlayerRounds = 0

  for (let round = 0; round < rounds; round++) {
    const courtOrder = [...courtIdxs]
    for (let i = courtOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng.quick() * (i + 1))
      ;[courtOrder[i], courtOrder[j]] = [courtOrder[j], courtOrder[i]]
    }

    const assignments = runStaggeredRound(state, lockedByCourt, courtOrder, mode)

    const qualityByRank = new Array(courts).fill(0)
    const interByRank = new Array(courts).fill(0)
    const intraByRank = new Array(courts).fill(0)

    for (const a of assignments) {
      const ip = interPvnaFn(a.teamA, a.teamB, state)
      const ia = intraPvnaFn(a.teamA, a.teamB, state)
      const pr = hasPartnerRepeat(a.teamA, a.teamB, state)
      const or_ = hasOppRepeat(a.teamA, a.teamB, state)
      qualityByRank[a.completionRank] = a.quality
      interByRank[a.completionRank] = ip
      intraByRank[a.completionRank] = ia
      totalQuality += a.quality
      if (pr) totalPartnerRepeat++
      if (or_) totalOppRepeat++
      totalMatches++
      allDetails.push({
        round,
        courtIdx: a.courtIdx,
        completionRank: a.completionRank,
        teamA: a.teamA,
        teamB: a.teamB,
        interPvna: ip,
        intraPvna: ia,
        partnerRepeat: pr,
        oppRepeat: or_,
        quality: a.quality,
      })
    }
    allRoundMetrics.push({ qualityByRank, interPvnaByRank: interByRank, intraByRank })

    const playedIds = new Set<string>()
    for (const a of assignments) {
      state = applyMatch(state, a.teamA, a.teamB, round)
      for (const id of [...a.teamA, ...a.teamB]) playedIds.add(id)
    }
    state = applyRoundRest(state, playedIds)

    // Sample consecutive stats after state update
    state.players.forEach(p => {
      if (p.checked_out_at !== null || p.opted_rest) return
      totalPlayerRounds++
      if (p.consecutive_rest >= 2) totalHighRest++
      if (p.consecutive_play >= 3) totalHighPlay++
      if (!playedIds.has(p.player_id)) {
        // bench player this round
        totalBenchConsecRest += p.consecutive_rest
        totalBenchSamples++
      }
    })

    lockedByCourt = new Map(assignments.map(a => [a.courtIdx, [...a.teamA, ...a.teamB]]))
    for (const cIdx of courtIdxs) {
      if (!lockedByCourt.has(cIdx)) lockedByCourt.set(cIdx, [])
    }
  }

  const avgByRank = (key: keyof RoundMetrics) =>
    Array.from({ length: courts }, (_, rank) => {
      const vals = allRoundMetrics.map(r => (r[key] as number[])[rank])
      return vals.reduce((s, v) => s + v, 0) / vals.length
    })

  const allInterPvna = allRoundMetrics.flatMap(r => r.interPvnaByRank)
  const allIntra = allRoundMetrics.flatMap(r => r.intraByRank)

  return {
    totalQuality,
    avgInterPvna: allInterPvna.reduce((s, v) => s + v, 0) / allInterPvna.length,
    avgIntra: allIntra.reduce((s, v) => s + v, 0) / allIntra.length,
    partnerRepeatRate: totalMatches > 0 ? totalPartnerRepeat / totalMatches : 0,
    oppRepeatRate: totalMatches > 0 ? totalOppRepeat / totalMatches : 0,
    highRestRate: totalPlayerRounds > 0 ? totalHighRest / totalPlayerRounds : 0,
    highPlayRate: totalPlayerRounds > 0 ? totalHighPlay / totalPlayerRounds : 0,
    avgBenchConsecRest: totalBenchSamples > 0 ? totalBenchConsecRest / totalBenchSamples : 0,
    qualityByRank: avgByRank('qualityByRank'),
    interPvnaByRank: avgByRank('interPvnaByRank'),
    intraByRank: avgByRank('intraByRank'),
    details: allDetails,
    elapsedMs: Date.now() - startedAt,
  }
}

// ─── reporting ──────────────────────────────────────────────────────────────

const pe = (s: string, n: number) => s.padEnd(n)
const ps = (s: string, n: number) => s.padStart(n)

function pct(b: number, g: number): string {
  if (g === 0) return '  n/a'
  const d = (b - g) / g * 100
  return (d > 0 ? '+' : '') + d.toFixed(1) + '%'
}

function bar(val: number, max: number, width = 20): string {
  const filled = Math.round(val / max * width)
  return '[' + '#'.repeat(filled) + '.'.repeat(width - filled) + ']'
}

// ─── seed diagnostics ───────────────────────────────────────────────────────

function printSeedPlayers(scenario: typeof SCENARIOS[0]): void {
  console.log(`\nPlayer details per seed (${scenario.label}):`)
  for (const seed of SEEDS) {
    const rng = seedrandom(seed)
    const players = generatePlayers(
      { n_players: scenario.n_players, pvna_distribution: 'bimodal', gender_ratio: 0.4, gender_pref_rate: 0.3, group_count: 0, group_size_range: [2, 4] },
      rng,
    )
    const pvnas = players.map(p => p.pvna).sort((a, b) => a - b)
    const low = pvnas.filter(v => v < 3.5)
    const high = pvnas.filter(v => v >= 3.5)
    const mean = pvnas.reduce((s, v) => s + v, 0) / pvnas.length
    const females = players.filter(p => p.gender === 'F').length
    const hasPref = players.filter(p => p.gender_pref !== null).length
    console.log(
      `  ${seed}: n=${players.length}  ` +
      `pvna=[${pvnas[0].toFixed(2)}..${pvnas.at(-1)!.toFixed(2)}] mean=${mean.toFixed(2)}  ` +
      `low(${low.length}) high(${high.length})  ` +
      `F=${females}/${players.length}  pref=${hasPref}`,
    )
    console.log(
      `       pvna list: ${pvnas.map(v => v.toFixed(2)).join(' ')}`,
    )
  }
  console.log()
}

// ─── main ───────────────────────────────────────────────────────────────────

console.log('=== Per-Court Beam Look-ahead vs Greedy — Detailed Results ===')
console.log(`Rounds=${ROUNDS}  Seeds=${SEEDS.length}  BeamK=${BEAM_K}`)
console.log('PVNA distribution: bimodal (L~2.7-3.0, H~4.0-4.5)\n')

// Print seed details for first scenario only (players scale but structure same)
printSeedPlayers(SCENARIOS[0])

// Results indexed by [scenario][mode]
type ModeResults = Record<Mode, SessionMetrics[]>
const allScenarioResults: ModeResults[] = []

for (const scenario of SCENARIOS) {
  process.stdout.write(`\n${scenario.label}: `)
  const modeResults: ModeResults = { greedy: [], 'beam-current': [], 'beam-equal': [], 'beam-dynamic': [], 'beam-pareto': [], 'beam-hybrid': [] }

  for (const seed of SEEDS) {
    const rng = seedrandom(seed)
    const players = generatePlayers(
      { n_players: scenario.n_players, pvna_distribution: 'bimodal', gender_ratio: 0.4, gender_pref_rate: 0.3, group_count: 0, group_size_range: [2, 4] },
      rng,
    )
    for (const mode of MODES) {
      const rngM = seedrandom(`${seed}-${mode}`)
      modeResults[mode].push(simulateSession([...players], scenario.courts, ROUNDS, rngM, mode))
      process.stdout.write('.')
    }
  }
  allScenarioResults.push(modeResults)
  console.log()

}

// ── Summary tables: all 5 modes ───────────────────────────────────────────
const avgM = (results: SessionMetrics[], fn: (m: SessionMetrics) => number) => {
  const vals = results.map(fn)
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

const METRIC_LABELS: Array<{ label: string; fn: (m: SessionMetrics) => number; fmt: (v: number) => string }> = [
  { label: 'Total quality',       fn: m => m.totalQuality,           fmt: v => v.toFixed(1) },
  { label: 'Inter-team PVNA',     fn: m => m.avgInterPvna,           fmt: v => v.toFixed(3) },
  { label: 'Intra-team PVNA',     fn: m => m.avgIntra,               fmt: v => v.toFixed(3) },
  { label: 'Partner repeat',      fn: m => m.partnerRepeatRate * 100, fmt: v => v.toFixed(1)+'%' },
  { label: 'Opp repeat',          fn: m => m.oppRepeatRate * 100,     fmt: v => v.toFixed(1)+'%' },
  { label: 'Elapsed ms',          fn: m => m.elapsedMs,              fmt: v => v.toFixed(0) },
]

const COL = 14
const MODE_LABELS: Record<Mode, string> = {
  'greedy': 'Greedy',
  'beam-current': 'B.Current',
  'beam-equal': 'B.Equal',
  'beam-dynamic': 'B.Dynamic',
  'beam-pareto': 'B.Pareto',
  'beam-hybrid': 'B.Hybrid',
}

console.log('\n\n' + '='.repeat(100))
console.log('SUMMARY: All modes across scenarios (lower=better for all metrics except elapsed ms)')
console.log('='.repeat(100))

for (const metric of METRIC_LABELS) {
  console.log(`\n${metric.label}:`)
  const header = `  ${pe('Scenario', 10)} ${pe('Bench', 5)}` + MODES.map(m => ps(MODE_LABELS[m], COL)).join('')
  console.log(header)
  console.log(`  ${'-'.repeat(10 + 5 + MODES.length * COL + 2)}`)
  SCENARIOS.forEach((scenario, si) => {
    const mr = allScenarioResults[si]
    const bench = scenario.n_players - scenario.courts * 4
    const vals = MODES.map(m => avgM(mr[m], metric.fn))
    const greedy = vals[0]
    const row = `  ${pe(scenario.label, 10)} ${pe(String(bench), 5)}` +
      vals.map((v, i) => {
        const fmt = metric.fmt(v)
        const delta = i === 0 ? '' : ` (${pct(v, greedy)})`
        return ps(fmt + delta, COL)
      }).join('')
    console.log(row)
  })
}

console.log('\n=== Done ===')
