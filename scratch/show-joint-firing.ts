/* Show the JOINT PASS firing on a REAL session: same seated set, scoring-only vs scoring+joint,
   with actual lineups + names, so you can see what the joint re-partition changed.
   Uses the clean `disableJointRepartition` option to isolate the pass (no env hacks).
   Run: npx tsx scratch/show-joint-firing.ts tmp/dump-fb48 */
import fs from 'node:fs'
import { buildSuggestedMatchPayloads, buildTightPoolQualityDeferUntilByCourt } from '../lib/next-round-suggester/live-preview'
import { getProjectedRepeatSummary } from '../lib/next-round-suggester/score'
import { getEffectivePvna, DEFAULT_SCORING_WEIGHTS } from '../lib/next-round-suggester/state'
import { __setQualityCostModelOverrideForTests } from '../lib/next-round-suggester/quality-cost-flag'
import type { PlayerSessionState, RoundRecord, SessionLiveMatchRow, SessionState, Team } from '../lib/next-round-suggester/types'
type J = Record<string, any>
const num = (v: any, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const dt = (v: any) => (v ? new Date(v) : null)
const dir = process.argv[2] || 'tmp/dump-fb48'
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
function run(disableJoint: boolean, onJoint?: () => void) {
  __setQualityCostModelOverrideForTests(true)
  const { state, liveRows } = freshState()
  const deferUntil = buildTightPoolQualityDeferUntilByCourt(liveRows, courtIdxs)
  const o = console.log; console.log = () => undefined
  let pl: any
  try {
    pl = buildSuggestedMatchPayloads({ count: courtIdxs.length, sessionId: 'r', courtCount: 6, state, rows: { liveMatchRows: liveRows, liveStateVersion: 31 }, completingLiveMatchIds: new Set<string>(), fairnessAdjustment: p.fairness?.adjustment ?? { config_changes: {}, tier_overrides: {}, applied_for_warnings: [] }, fairnessWarnings: p.fairness?.warnings ?? [], playersById: new Map([...state.players.keys()].map(id => [id, { name: nm(id) }])) as any, pvnaTolerance: num(p.pvna_tolerance, 0.5), options: { courtIdxs, ignoreCapacityLock: true, blowoutRescue: true, deferExtremeTightPool: true, tightPoolQualityDeferUntilByCourt: deferUntil, nowMs: Date.parse(p.request_received_at ?? d.created_at), rollingHorizon: true, rollingPlanTarget: null, disableJointRepartition: disableJoint, onInstrumentEvent: ((e: unknown) => { if (String(e) === 'joint') onJoint?.() }) as any } as any })
  } finally { console.log = o; __setQualityCostModelOverrideForTests(null) }
  return pl ?? []
}
const { state: st } = freshState()
const pv = (id: string) => getEffectivePvna(st.players.get(id)!)
const fmt = (m: any) => {
  const a = m.team_a as Team, b = m.team_b as Team
  const g = Math.abs(pv(a[0]) + pv(a[1]) - pv(b[0]) - pv(b[1]))
  const iv = Math.max(Math.abs(pv(a[0]) - pv(a[1])), Math.abs(pv(b[0]) - pv(b[1])))
  const pr = getProjectedRepeatSummary(a, b, st); const meet = Math.max(pr.max_opponent_pair_count, pr.max_partner_pair_count)
  const t = (x: Team) => x.map(id => `${nm(id)}·${pv(id).toFixed(1)}`).join(' ')
  return `c${m.court_idx} gap ${g.toFixed(2)}${g > 1.5 ? ' ⚠BLOW' : ''}${meet >= 3 ? ` rep${meet}` : ''}${iv > 1 ? ' stack' : ''}  [${t(a)}] v [${t(b)}]`
}
const scoringOnly = run(true)
const withJoint = run(false)
const byCourt = (arr: any[]) => new Map(arr.map(m => [m.court_idx, m]))
const so = byCourt(scoringOnly), wj = byCourt(withJoint)
// ground truth: the pass "fired" iff the seated set re-partitioned (compare disableJoint=true vs false)
let changedCourts = 0
for (const ci of so.keys()) { const a = so.get(ci), b = wj.get(ci); if (a && b && JSON.stringify([a.team_a, a.team_b]) !== JSON.stringify([b.team_a, b.team_b])) changedCourts++ }
console.log(`\n===== JOINT PASS on real session ${dir.replace('tmp/dump-', '')} · courts ${JSON.stringify(courtIdxs)} =====`)
console.log(`joint pass ${changedCourts > 0 ? `FIRED — re-partitioned ${changedCourts} court(s)` : 'no-op (greedy already optimal)'}\n`)
for (const ci of [...new Set([...so.keys(), ...wj.keys()])].sort()) {
  const a = so.get(ci), b = wj.get(ci)
  const changed = a && b && JSON.stringify([a.team_a, a.team_b]) !== JSON.stringify([b.team_a, b.team_b])
  console.log(`── court ${ci} ──${changed ? '  (joint CHANGED this court)' : ''}`)
  console.log(`  scoring-only : ${a ? fmt(a) : '(none)'}`)
  console.log(`  scoring+JOINT: ${b ? fmt(b) : '(none)'}`)
}
const totGap = (arr: any[]) => arr.reduce((s, m) => s + Math.abs(pv(m.team_a[0]) + pv(m.team_a[1]) - pv(m.team_b[0]) - pv(m.team_b[1])), 0)
const blow = (arr: any[]) => arr.filter(m => Math.abs(pv(m.team_a[0]) + pv(m.team_a[1]) - pv(m.team_b[0]) - pv(m.team_b[1])) > 1.5).length
console.log(`\nTOTAL  scoring-only: gap=${totGap(scoringOnly).toFixed(2)} blowout=${blow(scoringOnly)}   |   scoring+JOINT: gap=${totGap(withJoint).toFixed(2)} blowout=${blow(withJoint)}`)
