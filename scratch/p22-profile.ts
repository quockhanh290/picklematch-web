// Thời gian đi đâu? Đếm ứng viên và tách thời gian theo ba giai đoạn, thay vì đoán.
// Lần trước tôi đoán là do chấm điểm lặp lại cả board → thêm cache → chỉ nhanh 15%. Đo trước đã.

// @ts-ignore
import { MOVE_SET_WITH_BENCH } from '../lib/next-round-suggester/board-optimizer/moves.ts'
// @ts-ignore
import { generateMoves } from '../lib/next-round-suggester/board-optimizer/moves.ts'
// @ts-ignore
import { firstViolation } from '../lib/next-round-suggester/board-optimizer/constraints.ts'
// @ts-ignore
import { boardMetrics } from '../lib/next-round-suggester/board-optimizer/court-metrics.ts'
// @ts-ignore
import { scoreBoard } from '../lib/next-round-suggester/board-optimizer/objective.ts'
// @ts-ignore
import type { BoardSnapshot, ConstraintContext } from '../lib/next-round-suggester/board-optimizer/constraints.ts'
// @ts-ignore
import type { PlayerSessionState, SessionState } from '../lib/next-round-suggester/types.ts'

function player(id: string, pvna: number, rest: number, played: number): PlayerSessionState {
  return {
    player_id: id, pvna, group_id: null, checked_in_at: new Date('2026-01-01'), checked_out_at: null,
    matches_played: played, last_played_round: 0, consecutive_rest: rest, consecutive_play: 0,
    partner_counts: new Map<string, number>(), opponent_counts: new Map<string, number>(),
    opted_rest: false, gender: null, partner_gender_pref: 'any', opponent_gender_pref: 'any',
  } as unknown as PlayerSessionState
}

const courts = 6
const bench = 20
const total = courts * 4 + bench
const players = Array.from({ length: total }, (_, i) =>
  player(`p${String(i).padStart(2, '0')}`, 2.5 + (i % 11) * 0.25, i % 3, i % 7))
players.forEach((p, i) => { if (i + 1 < players.length) p.partner_counts.set(players[i + 1].player_id, 1) })
const state = {
  session_id: 's', current_round: 5, status: 'active',
  config: { courts, pvna_tolerance: 0.5, weights: {}, avoid_pairs: [] },
  players: new Map(players.map(p => [p.player_id, p])), rounds: [], pairs: new Map(),
} as unknown as SessionState
const seed: BoardSnapshot = Array.from({ length: courts }, (_, c) => ({
  court_idx: c,
  team_a: [players[c * 4].player_id, players[c * 4 + 1].player_id] as [string, string],
  team_b: [players[c * 4 + 2].player_id, players[c * 4 + 3].player_id] as [string, string],
}))
const ctx: ConstraintContext = {
  state, pvnaTolerance: 0.5, seed,
  benchIds: players.slice(courts * 4).map(p => p.player_id), lockPlayerSet: false,
}

const seedMetrics = boardMetrics(seed, ctx)

// 1) chỉ sinh nước đi, không chấm gì
let candidates = 0
let t = process.hrtime.bigint()
for (const _candidate of generateMoves(seed, ctx.benchIds, MOVE_SET_WITH_BENCH)) candidates += 1
const genMs = Number(process.hrtime.bigint() - t) / 1e6

// 2) sinh + tính metrics (có dùng lại sân không đụng)
t = process.hrtime.bigint()
for (const candidate of generateMoves(seed, ctx.benchIds, MOVE_SET_WITH_BENCH)) {
  boardMetrics(candidate, ctx, { board: seed, metrics: seedMetrics })
}
const metricsMs = Number(process.hrtime.bigint() - t) / 1e6 - genMs

// 3) sinh + metrics + ràng buộc
t = process.hrtime.bigint()
let passed = 0
for (const candidate of generateMoves(seed, ctx.benchIds, MOVE_SET_WITH_BENCH)) {
  const m = boardMetrics(candidate, ctx, { board: seed, metrics: seedMetrics })
  if (firstViolation(candidate, seed, ctx, { candidate: m, seed: seedMetrics }) === null) passed += 1
}
const constraintMs = Number(process.hrtime.bigint() - t) / 1e6 - genMs - metricsMs

// 4) toàn bộ, gồm chấm điểm cho ứng viên sống sót
t = process.hrtime.bigint()
for (const candidate of generateMoves(seed, ctx.benchIds, MOVE_SET_WITH_BENCH)) {
  const m = boardMetrics(candidate, ctx, { board: seed, metrics: seedMetrics })
  if (firstViolation(candidate, seed, ctx, { candidate: m, seed: seedMetrics }) !== null) continue
  scoreBoard(candidate, ctx, 'lex', m)
}
const totalMs = Number(process.hrtime.bigint() - t) / 1e6

console.log(`ứng viên/vòng: ${candidates}  (sống sót ràng buộc: ${passed})`)
console.log(`sinh nước đi   : ${genMs.toFixed(1)} ms`)
console.log(`tính metrics   : ${metricsMs.toFixed(1)} ms`)
console.log(`kiểm ràng buộc : ${constraintMs.toFixed(1)} ms`)
console.log(`cả vòng        : ${totalMs.toFixed(1)} ms  → × ~18 vòng = ${(totalMs * 18 / 1000).toFixed(1)} s`)
