/**
 * Board scorecard over the 60-session corpus, replayed through the real live path.
 *
 * This is the measuring stick for P2-2 (merging the seven post-passes). Without it, any claim that a
 * new optimizer is "better" rests on eyeballing a few boards — which is how several conclusions in this
 * work went wrong before being caught by measurement.
 *
 * Two things are reported separately, because they are not the same kind of claim:
 *   HARD  constraints that must never be violated. A single one is a regression, no matter the averages.
 *   SOFT  quality the objective is allowed to trade off. Compare these as distributions, not one board.
 *
 * Usage: npx tsx scratch/board-scorecard.ts [numSessions] [outFile]
 *   Run on the current tree, stash, run again, diff the two JSON files.
 */
const FROZEN = 1_000_000
Date.now = () => FROZEN
if (typeof performance !== 'undefined') performance.now = () => FROZEN

import fs from 'node:fs'
import crypto from 'node:crypto'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
  type SuggestedMatchPayload,
} from '../lib/next-round-suggester/live-preview'
import { computeQualityCost } from '../lib/next-round-suggester/quality-cost'
import { AVOID_PARTNER_PENALTY, getAvoidPenalty } from '../lib/next-round-suggester/avoid'
import { INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'
import { getEffectivePvna } from '../lib/next-round-suggester/state'
import type { PlayerSessionState, SessionLiveMatchRow, SessionState, Team } from '../lib/next-round-suggester/types'

const rd = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))
const gmap = (g: any) => g === 'female' ? 'F' : g === 'male' ? 'M' : null
const pmap = (p: any) => typeof p === 'string' && p.includes('female') ? 'F' : typeof p === 'string' && p.includes('male') ? 'M' : 'any'
const BASE_W = { pvna: 1, partner_repeat: 3, opponent_repeat: 1.5, group_bonus: 6, partner_gender_pref: 4, opponent_gender_pref: 2, consecutive_play: 4 }

const matches = rd('scratch/data/matches.json')
const roster = rd('scratch/data/roster2.json')
const settings: any[] = rd('scratch/data/settings.json')
const tolBySid: Record<string, number> = {}; for (const s of settings) tolBySid[s.sid] = Number(s.ptol) || 0.5
const mBySid: Record<string, any[]> = {}; for (const m of matches) (mBySid[m.sid] ??= []).push(m)
const rBySid: Record<string, any[]> = {}; for (const r of roster) (rBySid[r.sid] ??= []).push(r)

const NUM = Number(process.argv[2] || 30)
const OUT = process.argv[3] || 'scratch/out/board-scorecard.json'
const ROUNDS = 8

const sids = Object.keys(mBySid)
  .filter(sid => (rBySid[sid] || []).length > 0 && !(rBySid[sid] || []).some(r => r.co != null))
  .sort()
  .slice(0, NUM)

function buildState(sid: string): { state: SessionState; courts: number } | null {
  const rost = rBySid[sid]; const ms = mBySid[sid]
  if (!rost || !ms) return null
  const courts = Math.max(...ms.map((m: any) => m.court_idx)) + 1
  const players: PlayerSessionState[] = rost.map(r => ({
    player_id: r.pid, pvna: Number(r.pvna), gender: gmap(r.gender), group_id: r.group_id ?? null,
    partner_gender_pref: pmap(r.ppref), opponent_gender_pref: pmap(r.opref),
    checked_in_at: new Date('2026-05-15T12:00:00Z'), checked_out_at: null,
    matches_played: 0, last_played_round: -1, consecutive_play: 0, consecutive_rest: 0,
    partner_counts: new Map(), opponent_counts: new Map(), opted_rest: false, rounds_available: 0,
  })) as never
  const state = {
    session_id: sid, current_round: 1, status: 'active',
    config: { courts, pvna_tolerance: tolBySid[sid] ?? 0.5, court_preset: 'balanced', weights: BASE_W, planned_total_rounds: 8 },
    players: new Map(players.map(p => [p.player_id, p])), rounds: [],
  } as unknown as SessionState
  return { state, courts }
}

const asLive = (p: SuggestedMatchPayload, seq: number, lr: number): SessionLiveMatchRow => ({
  id: `r-${seq}`, session_id: 'x', sequence_no: seq, round_no: lr, cycle_no: lr, court_idx: p.court_idx,
  status: 'live', team_a: p.team_a, team_b: p.team_b, resting: p.resting, score_a: 0, score_b: 0,
  suggested_at: new Date(seq * 1000).toISOString(), started_at: new Date(seq * 1000).toISOString(), ended_at: null,
} as never)

const suggest = (s: SessionState, live: SessionLiveMatchRow[], count: number, courts: number, ci?: number[]) =>
  buildSuggestedMatchPayloads({
    count, sessionId: s.session_id, courtCount: courts, state: s,
    rows: { liveMatchRows: live, liveStateVersion: live.length },
    completingLiveMatchIds: new Set(), fairnessAdjustment: correctForFairness(s),
    fairnessWarnings: detectFairnessIssues(s),
    playersById: new Map([...s.players.keys()].map(id => [id, { name: id }])) as never,
    pvnaTolerance: s.config.pvna_tolerance,
    options: { courtIdxs: ci, ignoreCapacityLock: true, rollingHorizon: false, rollingPlanTarget: null },
  } as never)

type Score = {
  requested: number; seated: number
  cost: number
  hardAvoidPartner: number; intraOverCap: number
  overTol: number; repeat3: number; blowout: number
  panels: number
  lineups: string[]
  // The board metrics above price lineup quality only. Anything that constrains WHO may be seated buys
  // fairness and spends quality, and without these two the trade looks like a pure regression.
  playSpread: number; worstRest: number
}

const emptyScore = (): Score => ({
  requested: 0, seated: 0, cost: 0,
  hardAvoidPartner: 0, intraOverCap: 0,
  overTol: 0, repeat3: 0, blowout: 0, panels: 0, lineups: [],
  playSpread: 0, worstRest: 0,
})

function scoreMatchInto(acc: Score, s: SessionState, p: SuggestedMatchPayload, tol: number) {
  const A = p.team_a as Team; const B = p.team_b as Team
  const P = (id: string) => s.players.get(id)!
  const qc = computeQualityCost(A, B, s, { tolerance: tol })
  const pv = (id: string) => { const q = s.players.get(id); return q ? getEffectivePvna(q) : 0 }
  const intra = Math.max(Math.abs(pv(A[0]) - pv(A[1])), Math.abs(pv(B[0]) - pv(B[1])))

  acc.lineups.push(`${p.court_idx}:${[...A].sort().join('+')}|${[...B].sort().join('+')}`)
  acc.seated += 1
  acc.cost += qc.cost
  // HARD: avoid-partner is the only constraint the engine will not trade. It is Infinity in scoreMatch
  // and mirrored in bestSplitForFoursome, with no relaxation stage that lifts it.
  if (getAvoidPenalty(P(A[0]), P(A[1]), 'partner') === AVOID_PARTNER_PENALTY
    || getAvoidPenalty(P(B[0]), P(B[1]), 'partner') === AVOID_PARTNER_PENALTY) acc.hardAvoidPartner += 1
  // NOT hard, despite the name. INTRA_TEAM_PVNA_GAP_LIMIT is lifted by allowIntraTeamGapOverflow in the
  // relaxation ladder, and 311 of 1520 corpus matches sit above it. Treating it as a hard constraint in
  // a replacement optimizer would make boards unfillable — measured here before that mistake was made.
  if (intra > INTRA_TEAM_PVNA_GAP_LIMIT) acc.intraOverCap += 1
  // SOFT: what the objective is allowed to trade.
  if (qc.gap > tol) acc.overTol += 1
  if (qc.maxProjectedMeeting >= 3) acc.repeat3 += 1
  if (qc.gap > tol + 1.0) acc.blowout += 1
  if ((p.tradeoff_choices?.length ?? 0) > 0 || p.forced_tradeoff) acc.panels += 1
}

function run(sid: string): Score | null {
  const built = buildState(sid); if (!built) return null
  let { state, courts } = built
  const tol = state.config.pvna_tolerance
  const acc = emptyScore()
  let live: SessionLiveMatchRow[] = []; let seq = 0
  const lane = new Map<number, number>(Array.from({ length: courts }, (_, c) => [c, 0]))

  acc.requested += courts
  const init = suggest(state, live, courts, courts)
  if (init.length === 0) return null
  for (const p of init) { scoreMatchInto(acc, state, p, tol); live.push(asLive(p, seq++, 0)) }

  let done = 0, batch = new Set<string>(), guard = 0
  while (done < courts * ROUNDS && guard++ < courts * ROUNDS * 4) {
    for (let c = 0; c < courts; c++) {
      if ((lane.get(c) ?? 0) >= ROUNDS) continue
      const l = live.find(r => r.status === 'live' && r.court_idx === c); if (!l) continue
      state = buildProjectedStateAfterLiveMatch(state, { ...l, status: 'completed', ended_at: new Date((seq + 1) * 1000).toISOString() } as never, l.round_no ?? 0)
      ;[...l.team_a, ...l.team_b].forEach(id => batch.add(id))
      live = live.filter(r => r.id !== l.id); lane.set(c, (lane.get(c) ?? 0) + 1); done++
      if (done % courts === 0) {
        state = { ...buildProjectedStateAfterCompletedLiveRound(state, batch), current_round: Math.floor(done / courts) + 1 } as never
        batch = new Set()
      }
      const idle = Array.from({ length: courts }, (_, i) => i)
        .filter(i => (lane.get(i) ?? 0) < ROUNDS && !live.some(r => r.status === 'live' && r.court_idx === i))
      for (const ic of idle) {
        acc.requested += 1
        const n = suggest(state, live, 1, courts, [ic])
        if (n.length !== 1) continue
        scoreMatchInto(acc, state, n[0], tol)
        live.push(asLive(n[0], seq++, lane.get(ic) ?? 0))
      }
    }
  }

  const played = [...state.players.values()].map(p => p.matches_played)
  acc.playSpread = played.length ? Math.max(...played) - Math.min(...played) : 0
  acc.worstRest = Math.max(0, ...[...state.players.values()].map(p => p.consecutive_rest))
  return acc
}

const totals = emptyScore()
let sessions = 0
for (const sid of sids) {
  const s = run(sid); if (!s) continue
  sessions += 1
  for (const k of Object.keys(totals) as (keyof Score)[]) {
    if (k === 'lineups') totals.lineups.push(...s.lineups)
    else (totals[k] as number) += s[k] as number
  }
}

const pct = (n: number) => totals.seated ? (100 * n / totals.seated) : 0
const boardHash = crypto.createHash('sha1').update(totals.lineups.join(',')).digest('hex').slice(0, 12)
const report = {
  board_hash: boardHash,
  sessions, requested: totals.requested, seated: totals.seated,
  fill_rate_pct: totals.requested ? +(100 * totals.seated / totals.requested).toFixed(2) : 0,
  hard: {
    avoid_partner: totals.hardAvoidPartner,
  },
  soft: {
    avg_cost: +(totals.cost / Math.max(1, totals.seated)).toFixed(4),
    over_tol_pct: +pct(totals.overTol).toFixed(2),
    repeat3_pct: +pct(totals.repeat3).toFixed(2),
    blowout_pct: +pct(totals.blowout).toFixed(2),
    intra_over_cap_pct: +pct(totals.intraOverCap).toFixed(2),
    panel_pct: +pct(totals.panels).toFixed(2),
  },
  fair: {
    avg_play_spread: +(totals.playSpread / Math.max(1, sessions)).toFixed(3),
    avg_worst_rest: +(totals.worstRest / Math.max(1, sessions)).toFixed(3),
  },
}

fs.mkdirSync('scratch/out', { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(`--- board scorecard: ${sessions} sessions, ${totals.seated} matches seated ---`)
console.log(`fill rate      ${report.fill_rate_pct}%  (${totals.seated}/${totals.requested})`)
console.log(`HARD avoid-partner ${report.hard.avoid_partner}   <-- must stay 0`)
console.log(`SOFT avg cost ${report.soft.avg_cost} | over-tol ${report.soft.over_tol_pct}% | intra>${INTRA_TEAM_PVNA_GAP_LIMIT} ${report.soft.intra_over_cap_pct}% | repeat3 ${report.soft.repeat3_pct}% | blowout ${report.soft.blowout_pct}% | panel ${report.soft.panel_pct}%`)
console.log(`FAIR play-spread ${report.fair.avg_play_spread} | worst-rest ${report.fair.avg_worst_rest}   <-- lower is fairer`)
console.log(`board_hash ${boardHash}`)
console.log(`written to ${OUT}`)
