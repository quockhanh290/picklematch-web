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
 *
 * P2-2 knobs (Task 7 matrix). Default OPT=0 keeps the flag-off path byte-identical (f1b6d8ac0b0c):
 *   OPT=1|0                                 bật/tắt board optimizer (mặc định 0)
 *   OPT_MOVES=split|bench|bench_norot|bench_unbounded    tập nước đi (mặc định bench)
 *   OPT_OBJ=lex|cost                         thước đo (mặc định lex)
 * bench_unbounded = tập WITH_BENCH nhưng trần vòng lặp 10000 — cận trên rẻ tiền của "chọn lại cả 4
 * người mỗi sân" (spec §5). Cờ bật qua __setBoardOptimizerOverrideForTests, KHÔNG đụng env thật.
 */
// REALCLOCK=1 leaves the clock alone. Freezing it is what USED to make this harness reproducible; the
// point of P2-5 is that it no longer has to. Run twice under REALCLOCK=1 and diff the board_hash.
// Captured before any freeze so the latency probe still measures real time.
const REAL_NOW = (typeof performance !== 'undefined' ? performance.now.bind(performance) : Date.now) as () => number
const FROZEN = 1_000_000
if (process.env.REALCLOCK !== '1') {
  Date.now = () => FROZEN
  if (typeof performance !== 'undefined') performance.now = () => FROZEN
}

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
import { __setBoardOptimizerOverrideForTests } from '../lib/next-round-suggester/board-optimizer-flag'
import { __setRollingBeamMaxFutureSearchesForTests } from '../lib/next-round-suggester/planner/rolling-horizon'
import {
  MOVE_SET_NO_ROTATION,
  MOVE_SET_SPLIT_ONLY,
  MOVE_SET_WITH_BENCH,
  __setBoardOptimizerTuningForTests,
  type BoardOptimizerTuning,
} from '../lib/next-round-suggester/board-optimizer/index'
import { INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'
import { getEffectivePvna } from '../lib/next-round-suggester/state'
import type { PlayerSessionState, SessionLiveMatchRow, SessionState, Team } from '../lib/next-round-suggester/types'

const rd = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))
const gmap = (g: any) => g === 'female' ? 'F' : g === 'male' ? 'M' : null
const pmap = (p: any) => typeof p === 'string' && p.includes('female') ? 'F' : typeof p === 'string' && p.includes('male') ? 'M' : 'any'
// GPREF/OPREF: quét trọng số ý muốn giới tính. Mặc định 4/2 = đúng DEFAULT_SCORING_WEIGHTS của engine.
// Engine đang thoả 55.28% đồng đội trên corpus thật, trong khi ghép BỪA được 49.54% — quét để thấy
// đường đánh đổi giữa "thoả ý muốn" và "tránh lặp" thay vì chọn mù.
const GPREF = process.env.GPREF ? Number(process.env.GPREF) : 4
const OPREF = process.env.OPREF ? Number(process.env.OPREF) : 2
const BASE_W = { pvna: 1, partner_repeat: 3, opponent_repeat: 1.5, group_bonus: 6, partner_gender_pref: GPREF, opponent_gender_pref: OPREF, consecutive_play: 4 }

const matches = rd('scratch/data/matches.json')
const roster = rd('scratch/data/roster2.json')
const settings: any[] = rd('scratch/data/settings.json')
const tolBySid: Record<string, number> = {}; for (const s of settings) tolBySid[s.sid] = Number(s.ptol) || 0.5
const mBySid: Record<string, any[]> = {}; for (const m of matches) (mBySid[m.sid] ??= []).push(m)
const rBySid: Record<string, any[]> = {}; for (const r of roster) (rBySid[r.sid] ??= []).push(r)

const NUM = Number(process.argv[2] || 30)
const OUT = process.argv[3] || 'scratch/out/board-scorecard.json'
const ROUNDS = 8

// OPT=0 phải để MỌI thứ y như cũ: không bật cờ, không đặt tuning override, không đổi một byte nào của
// đường greedy + sáu pass. Chỉ khi OPT=1 mới đụng vào hai hook test.
const OPT_ON = process.env.OPT === '1'
const REFILL_BATCH = Math.max(1, Number(process.env.REFILL_BATCH || 1))
const OPT_MOVES = process.env.OPT_MOVES || 'bench'
// Beam A/B (2026-08-14). ROLLING=1 bật đường rolling-horizon — đường DUY NHẤT beam sống. BEAM=<n> đặt
// trần số lượt nhìn trước: 1 = beam không so sánh gì (đúng hành vi prod xưa nay), 12+ = beam chạy thật.
const ROLLING_ON = process.env.ROLLING === '1'
const BEAM_MAX_FUTURE_SEARCHES = process.env.BEAM ? Number(process.env.BEAM) : null
if (BEAM_MAX_FUTURE_SEARCHES !== null) {
  if (!Number.isFinite(BEAM_MAX_FUTURE_SEARCHES) || BEAM_MAX_FUTURE_SEARCHES < 1) throw new Error(`BEAM không hợp lệ: ${process.env.BEAM}`)
  __setRollingBeamMaxFutureSearchesForTests(BEAM_MAX_FUTURE_SEARCHES)
}
const OPT_OBJ = (process.env.OPT_OBJ || 'lex') as BoardOptimizerTuning['objective']
if (OPT_OBJ !== 'lex' && OPT_OBJ !== 'cost') throw new Error(`OPT_OBJ không hợp lệ: ${OPT_OBJ}`)
if (!['split', 'bench', 'bench_unbounded', 'bench_norot'].includes(OPT_MOVES)) throw new Error(`OPT_MOVES không hợp lệ: ${OPT_MOVES}`)
if (OPT_ON) {
  __setBoardOptimizerOverrideForTests(true)
  __setBoardOptimizerTuningForTests({
    objective: OPT_OBJ,
    moveSet: OPT_MOVES === 'split'
      ? MOVE_SET_SPLIT_ONLY
      : OPT_MOVES === 'bench_norot' ? MOVE_SET_NO_ROTATION : MOVE_SET_WITH_BENCH,
    maxIterations: OPT_MOVES === 'bench_unbounded' ? 10_000 : 30,
  })
}

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
  // P2-1: the two scoring models are chosen per session by this flag, so the corpus can be replayed
  // under either. QC=1 answers "what would the board look like if the cost model were switched on for
  // everyone", which is the decision the flag exists to gate.
  const state = {
    session_id: sid, current_round: 1, status: 'active',
    config: { courts, pvna_tolerance: tolBySid[sid] ?? 0.5, court_preset: 'balanced', weights: BASE_W, planned_total_rounds: 8,
      quality_cost_enabled: process.env.QC === '1' },
    players: new Map(players.map(p => [p.player_id, p])), rounds: [],
  } as unknown as SessionState
  return { state, courts }
}

const asLive = (p: SuggestedMatchPayload, seq: number, lr: number): SessionLiveMatchRow => ({
  id: `r-${seq}`, session_id: 'x', sequence_no: seq, round_no: lr, cycle_no: lr, court_idx: p.court_idx,
  status: 'live', team_a: p.team_a, team_b: p.team_b, resting: p.resting, score_a: 0, score_b: 0,
  suggested_at: new Date(seq * 1000).toISOString(), started_at: new Date(seq * 1000).toISOString(), ended_at: null,
} as never)

// P2-2 groundwork: before merging the seven post-passes into one optimizer, find out which of them still
// fire at all. The engine already reports every repair through onInstrumentEvent, so counting is enough —
// no ablation switch needed, and no risk of measuring a pass that was never entered.
export const repairTally = new Map<string, number>()
// Keep the phase. instrumentPostPass emits 'entered' when a pass is merely reached and 'changed' only
// when it altered the board — collapsing them counts consideration as effect, which made blowoutPool
// look like it fired on nearly every match.
// 'optimizer:reject:<reason>' mang ba đoạn; cắt hai đoạn như các pass khác sẽ gộp mọi lý do vào một ô
// và làm mất đúng thứ cần để đọc bảng. Giữ riêng lý do ở đây.
const optimizerRejects = new Map<string, number>()
const tallyRepair = (detail: string) => {
  const parts = detail.split(':')
  if (parts[0] === 'optimizer' && parts[1] === 'reject' && parts[2]) {
    optimizerRejects.set(parts[2], (optimizerRejects.get(parts[2]) ?? 0) + 1)
  }
  const key = parts.length > 1 ? `${parts[0]}:${parts[1]}` : parts[0]
  repairTally.set(key, (repairTally.get(key) ?? 0) + 1)
}

// Per-call wall time for the live entry point. The averages over a whole corpus hide the tail, and the
// tail is what an edge timeout actually sees.
export const suggestLatencies: number[] = []
const suggest = (s: SessionState, live: SessionLiveMatchRow[], count: number, courts: number, ci?: number[]) => {
  const startedAt = REAL_NOW()
  const out = suggestInner(s, live, count, courts, ci)
  suggestLatencies.push(REAL_NOW() - startedAt)
  return out
}
const suggestInner = (s: SessionState, live: SessionLiveMatchRow[], count: number, courts: number, ci?: number[]) =>
  buildSuggestedMatchPayloads({
    count, sessionId: s.session_id, courtCount: courts, state: s,
    rows: { liveMatchRows: live, liveStateVersion: live.length },
    completingLiveMatchIds: new Set(), fairnessAdjustment: correctForFairness(s),
    fairnessWarnings: detectFairnessIssues(s),
    playersById: new Map([...s.players.keys()].map(id => [id, { name: id }])) as never,
    pvnaTolerance: s.config.pvna_tolerance,
    // blowoutRescue gates the whole degraded-detection block, and degraded_reason is what the blowout
    // repair keys on. Leaving it off meant every measurement of that pass was taken with the feature
    // switched off — the pass bailed before reaching a single one of its guards.
    options: { courtIdxs: ci, ignoreCapacityLock: true, rollingHorizon: ROLLING_ON, rollingPlanTarget: null,
      blowoutRescue: true,
      onInstrumentEvent: (e: { event?: string; detail?: string }) => {
        if (e?.event === 'repair' && typeof e.detail === 'string') tallyRepair(e.detail)
      } },
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
  // Panels come from two sources and only one is a scoring difference: tradeoff_choices exist under
  // both models, forced_tradeoff/wait_rescue is built ONLY when the cost-model flag is on
  // (live-preview.ts:5383). Counting them together compares a feature being present against absent.
  panelsForced: number; panelsChoices: number
  // Fatigue is deliberately left to the selection layer, not the cost model (quality-cost-sim.ts:75).
  // This measures whether that costs anything: how tired the most-fatigued seated player was, and how
  // often anyone is seated at or past the rest threshold.
  worstPlay: number; seatedTired: number
  // classify.ts makes anyone who sat out a single round MUST_PLAY (mustPlayAt is the constant 1) while
  // mustRestAt scales with bench depth. If nearly everyone idle carries that tier, the tier cannot
  // discriminate and everything downstream reading it as "must be seated" is working from noise.
  owedSamples: number; owedIdle: number
  // Ý muốn về giới tính đồng đội/đối thủ: 65.69% người chơi THẬT trong corpus có đặt (1455/2215, cả
  // 60/60 kèo). Test tổng hợp `full-session` đo 0.611 trên một fixture ép cực đoan; cho tới khi đo trên
  // kèo thật thì không ai biết engine đang phục vụ nhóm này tốt hay tệ.
  partnerPrefChecked: number; partnerPrefSatisfied: number
  opponentPrefChecked: number; opponentPrefSatisfied: number
  // Trần khả dĩ khi BỘ TỨ đã chốt: trong 4 người đã ngồi cùng sân, chỉ có 3 cách chia đội. Nếu số thực
  // tế xấp xỉ trần này thì tầng chia-đội đã làm hết sức, và chỗ mất nằm ở tầng TRÊN — ai được xếp chung
  // sân với ai. Nâng trọng số không sửa được tầng trên.
  partnerPrefBestInFoursome: number
  // Trần khi chỉ xét cách chia có cân bằng KHÔNG TỆ HƠN cái engine đã chọn (gap ≤ gap đã chọn VÀ intra ≤
  // intra đã chọn). Chênh giữa nó và số thực tế là phần lấy được mà KHÔNG PHẢI TRẢ GÌ.
  // (Bản trước so với tolerance danh nghĩa là SAI: trận vốn đã vượt tolerance thì không cách chia nào hợp
  // lệ, bị tính 0, kéo tụt trung bình xuống dưới cả số thực tế.)
  partnerPrefBestNoWorseBalance: number
}

const emptyScore = (): Score => ({
  requested: 0, seated: 0, cost: 0,
  hardAvoidPartner: 0, intraOverCap: 0,
  overTol: 0, repeat3: 0, blowout: 0, panels: 0, lineups: [],
  playSpread: 0, worstRest: 0, panelsForced: 0, panelsChoices: 0, worstPlay: 0, seatedTired: 0,
  owedSamples: 0, owedIdle: 0,
  partnerPrefChecked: 0, partnerPrefSatisfied: 0,
  opponentPrefChecked: 0, opponentPrefSatisfied: 0,
  partnerPrefBestInFoursome: 0,
  partnerPrefBestNoWorseBalance: 0,
})

function scoreMatchInto(acc: Score, s: SessionState, p: SuggestedMatchPayload, tol: number) {
  const A = p.team_a as Team; const B = p.team_b as Team
  const P = (id: string) => s.players.get(id)!
  const qc = computeQualityCost(A, B, s, { tolerance: tol })
  const pv = (id: string) => { const q = s.players.get(id); return q ? getEffectivePvna(q) : 0 }
  const intra = Math.max(Math.abs(pv(A[0]) - pv(A[1])), Math.abs(pv(B[0]) - pv(B[1])))

  for (const id of [...A, ...B]) {
    const cp = s.players.get(id)?.consecutive_play ?? 0
    if (cp > acc.worstPlay) acc.worstPlay = cp
    if (cp >= 2) acc.seatedTired += 1
  }
  {
    const four = [...A, ...B]
    const SPLITS: Array<[number, number, number, number]> = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]
    let best = 0
    let bestLegal = 0
    for (const [a1, a2, b1, b2] of SPLITS) {
      let sat = 0
      for (const [id, mate] of [[four[a1], four[a2]], [four[a2], four[a1]], [four[b1], four[b2]], [four[b2], four[b1]]] as const) {
        const self = s.players.get(id)
        if (!self || self.partner_gender_pref === 'any') continue
        const partner = s.players.get(mate)
        if (!partner?.gender || partner.gender === self.partner_gender_pref) sat += 1
      }
      if (sat > best) best = sat
      const gap = Math.abs(pv(four[a1]) + pv(four[a2]) - pv(four[b1]) - pv(four[b2]))
      const intraSplit = Math.max(Math.abs(pv(four[a1]) - pv(four[a2])), Math.abs(pv(four[b1]) - pv(four[b2])))
      const chosenGap = Math.abs(pv(A[0]) + pv(A[1]) - pv(B[0]) - pv(B[1]))
      if (gap <= chosenGap + 1e-9 && intraSplit <= intra + 1e-9 && sat > bestLegal) bestLegal = sat
    }
    acc.partnerPrefBestInFoursome += best
    acc.partnerPrefBestNoWorseBalance += bestLegal
  }
  // Đếm giống hệt cách `full-session.test.ts` đếm: chỉ tính người CÓ đòi hỏi, và đồng đội không rõ giới
  // tính thì tính là thoả (không có gì để trái ý).
  for (const [team, other] of [[A, B], [B, A]] as const) {
    for (const [id, mate] of [[team[0], team[1]], [team[1], team[0]]] as const) {
      const self = s.players.get(id)
      if (!self) continue
      if (self.partner_gender_pref !== 'any') {
        acc.partnerPrefChecked += 1
        const partner = s.players.get(mate)
        if (!partner?.gender || partner.gender === self.partner_gender_pref) acc.partnerPrefSatisfied += 1
      }
      if (self.opponent_gender_pref !== 'any') {
        for (const oppId of other) {
          acc.opponentPrefChecked += 1
          const opp = s.players.get(oppId)
          if (!opp?.gender || opp.gender === self.opponent_gender_pref) acc.opponentPrefSatisfied += 1
        }
      }
    }
  }
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
  if (p.forced_tradeoff) acc.panelsForced += 1
  if ((p.tradeoff_choices?.length ?? 0) > 0) acc.panelsChoices += 1
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

  let done = 0, batch = new Set<string>(), guard = 0, completedSinceRefill = 0
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
      // REFILL_BATCH=k: giữ lại k sân xong TRƯỚC khi lấp, để tạo ra hình dạng "lấp nhiều sân cùng lúc
      // trong khi sân khác đang chạy". Cờ MULTI=1 trước đây không ăn vì vòng lặp lấp ngay sau mỗi sân
      // xong, nên idle.length không bao giờ > 1 — phải đổi cấu trúc chứ không phải thêm cờ.
      // Hình dạng này CÓ THẬT trên prod: dump kèo 260878a4 có request court_idxs=[2,1] và [5,4].
      // k=1 giữ nguyên hành vi cũ (điều kiện dưới không bao giờ đúng) → hash baseline không đổi.
      completedSinceRefill += 1
      if (completedSinceRefill < REFILL_BATCH && c < courts - 1) continue
      completedSinceRefill = 0
      const idle = Array.from({ length: courts }, (_, i) => i)
        .filter(i => (lane.get(i) ?? 0) < ROUNDS && !live.some(r => r.status === 'live' && r.court_idx === i))
      // Owed share: how many idle players carry consecutive_rest >= 1, the condition classify.ts turns
      // into MUST_PLAY. Sampled once per refill decision, before any seat is taken.
      const idlePlayers = [...state.players.values()].filter(p =>
        p.checked_out_at === null && !p.opted_rest
        && !live.some(r => r.status === 'live' && [...r.team_a, ...r.team_b].includes(p.player_id)))
      acc.owedSamples += idlePlayers.length
      acc.owedIdle += idlePlayers.filter(p => p.consecutive_rest >= 1).length

      // MULTI=1 asks for every idle court in ONE request instead of one call each. repeatPool only acts
      // when two or more courts are filled together WHILE others are live, and the default loop never
      // produces that shape — its only multi-court request is the opening fill on an empty board. So the
      // pass has only ever been measured in the situation where it cannot help.
      const groups = (process.env.MULTI === '1' || REFILL_BATCH > 1) && idle.length > 1
        ? [idle]
        : idle.map(ic => [ic])
      for (const group of groups) {
        acc.requested += group.length
        const n = suggest(state, live, group.length, courts, group)
        for (const payload of n) {
          scoreMatchInto(acc, state, payload, tol)
          live.push(asLive(payload, seq++, lane.get(payload.court_idx) ?? 0))
        }
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
const sortedLatencies = [...suggestLatencies].sort((a, b) => a - b)
const pctl = (q: number) => sortedLatencies.length
  ? +sortedLatencies[Math.min(sortedLatencies.length - 1, Math.floor(q * sortedLatencies.length))].toFixed(1)
  : 0
const report = {
  board_hash: boardHash,
  rolling: ROLLING_ON ? { beam_max_future_searches: BEAM_MAX_FUTURE_SEARCHES ?? 'default' } : null,
  latency_ms: {
    calls: sortedLatencies.length,
    p50: pctl(0.5),
    p90: pctl(0.9),
    p99: pctl(0.99),
    max: sortedLatencies.length ? +sortedLatencies[sortedLatencies.length - 1].toFixed(1) : 0,
    total: +sortedLatencies.reduce((a, b) => a + b, 0).toFixed(0),
  },
  refill_batch: REFILL_BATCH,
  optimizer: OPT_ON ? { moves: OPT_MOVES, objective: OPT_OBJ } : null,
  // Số lần optimizer THỰC SỰ vào (nhãn 'optimizer:entered') và số board nó đổi. Trước khi tin bất kỳ
  // con số chất lượng nào của một lượt OPT=1: invoked phải > 0, nếu không là phép đo hỏng.
  optimizer_invoked: repairTally.get('optimizer:entered') ?? 0,
  optimizer_changed: repairTally.get('optimizer:changed') ?? 0,
  optimizer_rejects: Object.fromEntries([...optimizerRejects.entries()].sort((a, b) => b[1] - a[1])),
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
    panel_forced_pct: +pct(totals.panelsForced).toFixed(2),
    panel_choices_pct: +pct(totals.panelsChoices).toFixed(2),
  },
  gender_pref: {
    weights: { partner: GPREF, opponent: OPREF },
    partner_checked: totals.partnerPrefChecked,
    partner_satisfied_pct: totals.partnerPrefChecked
      ? +(100 * totals.partnerPrefSatisfied / totals.partnerPrefChecked).toFixed(2) : 0,
    partner_ceiling_given_foursome_pct: totals.partnerPrefChecked
      ? +(100 * totals.partnerPrefBestInFoursome / totals.partnerPrefChecked).toFixed(2) : 0,
    partner_ceiling_no_worse_balance_pct: totals.partnerPrefChecked
      ? +(100 * totals.partnerPrefBestNoWorseBalance / totals.partnerPrefChecked).toFixed(2) : 0,
    opponent_checked: totals.opponentPrefChecked,
    opponent_satisfied_pct: totals.opponentPrefChecked
      ? +(100 * totals.opponentPrefSatisfied / totals.opponentPrefChecked).toFixed(2) : 0,
  },
  fair: {
    avg_play_spread: +(totals.playSpread / Math.max(1, sessions)).toFixed(3),
    avg_worst_rest: +(totals.worstRest / Math.max(1, sessions)).toFixed(3),
    // SUM of each session's maximum, not a global maximum — the totals loop adds every numeric
    // field. Comparable between runs because both aggregate the same way; do not read it as "someone
    // played N in a row".
    summed_session_max_consecutive_play: totals.worstPlay,
    owed_share_of_idle_pct: +(100 * totals.owedIdle / Math.max(1, totals.owedSamples)).toFixed(2),
    seated_at_or_past_rest_pct: +(100 * totals.seatedTired / Math.max(1, totals.seated * 4)).toFixed(2),
  },
}

fs.mkdirSync('scratch/out', { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(`--- board scorecard: ${sessions} sessions, ${totals.seated} matches seated ---`)
console.log(`fill rate      ${report.fill_rate_pct}%  (${totals.seated}/${totals.requested})`)
console.log(`HARD avoid-partner ${report.hard.avoid_partner}   <-- must stay 0`)
console.log(`SOFT avg cost ${report.soft.avg_cost} | over-tol ${report.soft.over_tol_pct}% | intra>${INTRA_TEAM_PVNA_GAP_LIMIT} ${report.soft.intra_over_cap_pct}% | repeat3 ${report.soft.repeat3_pct}% | blowout ${report.soft.blowout_pct}% | panel ${report.soft.panel_pct}%`)
console.log(`PANEL forced ${report.soft.panel_forced_pct}% | choices ${report.soft.panel_choices_pct}%   <-- forced chỉ tồn tại khi bật cờ`)
console.log(`FAIR play-spread ${report.fair.avg_play_spread} | worst-rest ${report.fair.avg_worst_rest}   <-- lower is fairer`)
console.log(`OWED người rảnh mang tier MUST_PLAY (consecutive_rest>=1): ${report.fair.owed_share_of_idle_pct}%`)
console.log(`FATIGUE tổng max consecutive_play mỗi phiên ${report.fair.summed_session_max_consecutive_play} | ghế cho người đã chơi >=2 liên tiếp ${report.fair.seated_at_or_past_rest_pct}%`)
console.log(`GENDER trần khi cân bằng KHÔNG TỆ HƠN cái đã chọn: ${report.gender_pref.partner_ceiling_no_worse_balance_pct}%  <-- phần này lấy được mà KHÔNG phải trả gì`)
console.log(`GENDER trần khả dĩ khi bộ tứ đã chốt: ${report.gender_pref.partner_ceiling_given_foursome_pct}%  <-- nếu thực tế ~ trần này thì chỗ mất nằm ở tầng chọn bộ tứ`)
console.log(`GENDER PREF đồng đội ${report.gender_pref.partner_satisfied_pct}% (${totals.partnerPrefSatisfied}/${totals.partnerPrefChecked}) | đối thủ ${report.gender_pref.opponent_satisfied_pct}% (${totals.opponentPrefSatisfied}/${totals.opponentPrefChecked})`)
console.log(`board_hash ${boardHash}${ROLLING_ON ? `  [rolling ON, beam=${BEAM_MAX_FUTURE_SEARCHES ?? 'default'}]` : ''}`)
console.log(`LATENCY per suggest call (ms): p50 ${report.latency_ms.p50} | p90 ${report.latency_ms.p90} | p99 ${report.latency_ms.p99} | max ${report.latency_ms.max} over ${report.latency_ms.calls} calls`)
if (OPT_ON) {
  console.log(`OPTIMIZER moves=${OPT_MOVES} obj=${OPT_OBJ} | invoked ${report.optimizer_invoked} | changed ${report.optimizer_changed}`)
  const rejects = Object.entries(report.optimizer_rejects)
  console.log(`OPTIMIZER rejects (${rejects.length} lý do): ${rejects.length ? rejects.map(([r, n]) => `${r}=${n}`).join(' · ') : '(không có)'}`)
  if (report.optimizer_invoked === 0) console.log('!!! optimizer_invoked = 0 → PHÉP ĐO HỎNG, đừng tin số nào ở trên')
}
const tallied = [...repairTally.entries()].sort((a, b) => b[1] - a[1])
console.log(`REPAIR passes that fired (${tallied.length} kinds):`)
for (const [kind, n] of tallied) console.log(`   ${String(n).padStart(6)}  ${kind}`)
if (tallied.length === 0) console.log('   (không pass nào bắn)')
console.log(`written to ${OUT}`)
