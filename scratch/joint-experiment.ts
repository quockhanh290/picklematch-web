/* Bounded joint-allocation experiment: take the NEW-model greedy fill, hold the SEATED SET fixed
   (fairness/participation unchanged), and RE-PARTITION those players across courts + re-split to
   minimise TOTAL quality-cost (hill-climb swaps). Measure greedy-new vs joint-new vs old. */
import fs from 'node:fs'
import { buildSuggestedMatchPayloads, buildTightPoolQualityDeferUntilByCourt } from '../lib/next-round-suggester/live-preview.ts'
import { computeQualityCost, bestSplitForFoursome, jointRepartition, type Foursome } from '../lib/next-round-suggester/quality-cost.ts'
import { getProjectedRepeatSummary } from '../lib/next-round-suggester/score.ts'
import { getEffectivePvna, DEFAULT_SCORING_WEIGHTS } from '../lib/next-round-suggester/state.ts'
import { __setQualityCostModelOverrideForTests } from '../lib/next-round-suggester/quality-cost-flag.ts'
import type { PlayerSessionState, RoundRecord, SessionLiveMatchRow, SessionState, Team } from '../lib/next-round-suggester/types.ts'
type J = Record<string, any>
const num = (v: any, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const dt = (v: any) => (v ? new Date(v) : null)
const dir = process.argv[2]
const d = JSON.parse(fs.readFileSync(`${dir}/dump.json`, 'utf8'))
const p = d.payload
const names: J[] = JSON.parse(fs.readFileSync(`${dir}/names.json`, 'utf8'))
const nmMap = new Map<string, string>(names.map(x => [x.id, x.name ?? x.id.slice(0, 4)]))
const nm = (id: string) => nmMap.get(id) ?? id.slice(0, 4)
const toPlayer = (raw: J): PlayerSessionState => ({ player_id: String(raw.id), pvna: num(raw.pvna, 2.1), effective_pvna: raw.effective_pvna == null ? undefined : num(raw.effective_pvna), group_id: raw.group_id ?? null, checked_in_at: dt(raw.checked_in_at) ?? new Date(), checked_out_at: dt(raw.checked_out_at), matches_played: num(raw.matches_played), last_played_round: num(raw.last_played_round, -1), consecutive_rest: num(raw.consecutive_rest), consecutive_play: num(raw.consecutive_play), partner_counts: new Map(Object.entries(raw.partner_counts ?? {}).map(([k, v]: any) => [k, num(v)])), opponent_counts: new Map(Object.entries(raw.opponent_counts ?? {}).map(([k, v]: any) => [k, num(v)])), opted_rest: !!raw.opted_rest, gender: raw.gender === 'M' || raw.gender === 'F' ? raw.gender : null, partner_gender_pref: raw.partner_gender_pref ?? 'any', opponent_gender_pref: raw.opponent_gender_pref ?? 'any', rounds_available: num(raw.rounds_available) } as PlayerSessionState)
const toRound = (raw: J): RoundRecord => ({ id: raw.id, session_id: 'r', round_no: num(raw.round_no), status: raw.status === 'active' ? 'active' : 'completed', matches: (raw.matches ?? []).map((m: J, ci: number) => ({ court_idx: num(m.court_idx, ci), team_a: m.team_a, team_b: m.team_b })), resting: raw.resting ?? [], started_at: null, ended_at: null }) as RoundRecord
const toLive = (raw: J): SessionLiveMatchRow => ({ id: String(raw.id), session_id: 'r', sequence_no: num(raw.sequence_no), round_no: raw.round_no == null ? null : num(raw.round_no), cycle_no: raw.cycle_no == null ? null : num(raw.cycle_no), court_idx: raw.court_idx == null ? null : num(raw.court_idx), status: raw.status, team_a: raw.team_a, team_b: raw.team_b, resting: raw.resting ?? [], score_a: 0, score_b: 0, suggested_at: null, started_at: null, ended_at: null, created_at: raw.created_at, updated_at: raw.updated_at, suggestion_metadata: null }) as SessionLiveMatchRow
const roundMembers: Record<number, Set<string>> = {}
const addM = (rn: number, ids: string[]) => { (roundMembers[rn] ??= new Set()); for (const id of ids) roundMembers[rn].add(id) }
for (const m of (p.round_records_lite?.[0]?.matches ?? [])) addM(0, [...(m.team_a ?? []), ...(m.team_b ?? [])])
for (const r of p.live_match_rows_lite) { if (r.round_no == null) continue; addM(Number(r.round_no), [...(r.team_a ?? []), ...(r.team_b ?? [])]) }
const completed = Object.entries(roundMembers).filter(([, v]) => (v as Set<string>).size >= 24).map(([k]) => Number(k)).sort((a, b) => a - b)
const maxC = completed.length ? Math.max(...completed) : -1
function freshState(): { state: SessionState; liveRows: SessionLiveMatchRow[] } {
  const players = new Map<string, PlayerSessionState>()
  for (const raw of p.player_snapshot_lite) { const pl = toPlayer(raw); let cr = 0; for (let rn = maxC; rn >= 0; rn -= 1) { if (!completed.includes(rn)) continue; if (roundMembers[rn]?.has(pl.player_id)) break; cr += 1 } pl.consecutive_rest = cr; players.set(pl.player_id, pl) }
  const state = { session_id: 'r', current_round: num(p.derived_state_summary?.current_round), status: 'active' as any, config: { courts: 6, pvna_tolerance: num(p.pvna_tolerance, 0.5), avoid_pairs: [], weights: { ...DEFAULT_SCORING_WEIGHTS } } as any, players, rounds: (p.round_records_lite ?? []).map(toRound) } as SessionState
  return { state, liveRows: (p.live_match_rows_lite ?? []).map(toLive) }
}
const courtIdxs = p.target_court_idxs?.length ? p.target_court_idxs : [0]
function greedy(flagOn: boolean) {
  __setQualityCostModelOverrideForTests(flagOn)
  const { state, liveRows } = freshState()
  const deferUntil = buildTightPoolQualityDeferUntilByCourt(liveRows, courtIdxs)
  const o = console.log; console.log = () => undefined
  let pl: any
  try { pl = buildSuggestedMatchPayloads({ count: courtIdxs.length, sessionId: 'r', courtCount: 6, state, rows: { liveMatchRows: liveRows, liveStateVersion: 31 }, completingLiveMatchIds: new Set<string>(), fairnessAdjustment: p.fairness?.adjustment ?? { config_changes: {}, tier_overrides: {}, applied_for_warnings: [] }, fairnessWarnings: p.fairness?.warnings ?? [], playersById: new Map([...state.players.keys()].map(id => [id, { name: nm(id) }])) as any, pvnaTolerance: num(p.pvna_tolerance, 0.5), options: { courtIdxs, ignoreCapacityLock: true, blowoutRescue: true, deferExtremeTightPool: true, tightPoolQualityDeferUntilByCourt: deferUntil, nowMs: Date.parse(p.request_received_at ?? d.created_at), rollingHorizon: true, rollingPlanTarget: null } as any }) }
  finally { console.log = o; __setQualityCostModelOverrideForTests(null) }
  return pl ?? []
}
const { state: st } = freshState()
const pv = (id: string) => getEffectivePvna(st.players.get(id)!)
const tol = num(p.pvna_tolerance, 0.5)
const INTRA_OVER = process.env.INTRA_OVER ? Number(process.env.INTRA_OVER) : undefined
const W = INTRA_OVER != null ? { intraOver: INTRA_OVER } : undefined
// Validation now delegates to the SHIPPED search (quality-cost.ts) so this measures the exact prod code.
// NOTE: to ISOLATE the joint pass's contribution (scoring-only vs scoring+joint), run with the engine's
// internal joint temporarily disabled — buildSuggestedMatchPayloads flag-ON already applies jointRepartition,
// so without that the greedy(true) payloads are already jointed and re-applying here is a fixed-point no-op.
function bestSplitCost(four: string[]) {
  const r = bestSplitForFoursome(four as Foursome, st, { tolerance: tol, weights: W })
  return { cost: r.cost, a: r.team_a as string[], b: r.team_b as string[] }
}
function joint(courts: string[][]) {
  const { splits } = jointRepartition(
    courts.map((four, i) => ({ court_idx: i, four: four as Foursome })), st,
    { tolerance: tol, weights: W },
  )
  return splits.map(s => ({ cost: 0, a: s.team_a as string[], b: s.team_b as string[] }))
}
function metrics(lineups: { a: string[]; b: string[] }[]) {
  let gap = 0, blow = 0, rep = 0, intra = 0
  for (const { a, b } of lineups) {
    const s = (t: string[]) => t.reduce((x, id) => x + pv(id), 0)
    const g = Math.abs(s(a) - s(b)); gap += g; if (g > 1.5) blow++
    const iv = Math.max(Math.abs(pv(a[0]) - pv(a[1])), Math.abs(pv(b[0]) - pv(b[1]))); if (iv > 1.0) intra++
    const pr = getProjectedRepeatSummary(a as Team, b as Team, st); if (Math.max(pr.max_opponent_pair_count, pr.max_partner_pair_count) >= 3) rep++
  }
  return { gap: +gap.toFixed(2), blow, rep, intra }
}
const oldPl = greedy(false), newPl = greedy(true)
const oldLu = oldPl.map((m: any) => ({ a: m.team_a, b: m.team_b }))
const newLu = newPl.map((m: any) => ({ a: m.team_a, b: m.team_b }))
const jointLu = joint(newPl.map((m: any) => [...m.team_a, ...m.team_b]))
const mo = metrics(oldLu), mn = metrics(newLu), mj = metrics(jointLu)
const f = (m: any) => `gap=${m.gap} blow=${m.blow} rep=${m.rep} intra>1=${m.intra}`
console.log(`JLINE\t${dir.replace('tmp/dump-', '')}\t${courtIdxs.length}\t${mo.gap}\t${mo.blow}\t${mo.rep}\t${mo.intra}\t${mn.gap}\t${mn.blow}\t${mn.rep}\t${mn.intra}\t${mj.gap}\t${mj.blow}\t${mj.rep}\t${mj.intra}`)
