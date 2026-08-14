// Board optimizer (P2-2, spec §5) — một vòng leo dốc tất định thay cho sáu post-pass.
//
// Sáu pass cũ tiêu ~42% số lượt viết vào việc ghi đè lẫn nhau, vì mỗi pass mang một ý niệm "tốt hơn"
// riêng và không pass nào biết pass khác. Ở đây chỉ có một thước đo và một bộ ràng buộc; board gốc
// greedy là điểm xuất phát và cũng là mốc của mọi ràng buộc "không tệ hơn".
//
// Ngân sách là SỐ VÒNG LẶP, không phải đồng hồ. Engine hiện không tất định vì deadline theo Date.now()
// — đó là một nửa nguyên nhân bug flicker, nên optimizer không được phép mang lại đúng cái bệnh đó.

// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { firstViolation } from './constraints.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { BoardSnapshot, ConstraintContext, ConstraintRejection } from './constraints.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { isBetter, scoreBoard } from './objective.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { ObjectiveName } from './objective.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { generateMoves, MOVE_SET_NO_ROTATION } from './moves.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { boardMetrics, createCourtCostCache } from './court-metrics.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { MoveSet } from './moves.ts'

// @ts-ignore Deno edge-function bundling needs the local .ts extension.
export { MOVE_SET_NO_ROTATION, MOVE_SET_SPLIT_ONLY, MOVE_SET_WITH_BENCH } from './moves.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
export type { BoardSnapshot, ConstraintContext, ConstraintRejection } from './constraints.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
export type { ObjectiveName } from './objective.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
export type { MoveKind, MoveSet } from './moves.ts'

/** Ngưỡng chống-lắc, lấy đúng con số hai pass kéo băng ghế đang dùng (`bestScore - 0.01`). */
export const OPTIMIZER_EPSILON = 0.01
export const DEFAULT_MAX_ITERATIONS = 30

export type OptimizeOptions = {
  objective: ObjectiveName
  moveSet: MoveSet
  maxIterations: number
  onReject?: (reason: ConstraintRejection) => void
  onAccept?: (iteration: number) => void
}

export type OptimizeResult = {
  board: BoardSnapshot
  iterations: number
  changed: boolean
}

/**
 * Cấu hình engine dùng khi cờ BẬT. Task 8 sẽ chốt con số ở đây bằng bảng đo, nên nó phải là MỘT chỗ
 * duy nhất — không rải literal ở live-preview.
 */
export type BoardOptimizerTuning = {
  objective: ObjectiveName
  moveSet: MoveSet
  maxIterations: number
}

// Chốt bằng bảng corpus 60 phiên, không bằng lập luận (spec §8):
//   W1–W4 (có xoay vòng 3 sân): overtol 3.37 · rep3 2.01 · cost 1.769 — nhưng 1620 ms/board
//   W1–W3 (bỏ xoay vòng):       overtol 3.47 · rep3 2.07 · cost 1.710 —  331 ms/board
// W4 ngốn 77% khối lượng để mua 0.1pp overtol, còn thua ở blowout/intra/cost. Prod engine_search
// hiện 131–785 ms, nên 1.6 giây là tự đánh sập thứ optimizer định chữa.
const DEFAULT_TUNING: BoardOptimizerTuning = {
  objective: 'lex',
  moveSet: MOVE_SET_NO_ROTATION,
  maxIterations: DEFAULT_MAX_ITERATIONS,
}

let tuningOverride: BoardOptimizerTuning | null = null

export function resolveBoardOptimizerTuning(): BoardOptimizerTuning {
  return tuningOverride ?? DEFAULT_TUNING
}

// Chỉ dành cho test/harness đo (scratch/board-scorecard.ts). Cùng khuôn với
// __setBoardOptimizerOverrideForTests: null = trả về mặc định của engine.
export function __setBoardOptimizerTuningForTests(value: Partial<BoardOptimizerTuning> | null): void {
  tuningOverride = value === null ? null : { ...DEFAULT_TUNING, ...value }
}

const boardKey = (board: BoardSnapshot): string =>
  board
    .map(court => `${court.court_idx}:${court.team_a.join('+')}v${court.team_b.join('+')}`)
    .join('|')

export function optimizeBoard(
  seed: BoardSnapshot,
  ctx: ConstraintContext,
  opts: OptimizeOptions,
): OptimizeResult {
  const seedKey = boardKey(seed)
  // Số đo của board gốc tính đúng một lần cho cả lượt chạy: H3/H4/H5 luôn so với nó.
  const seedMetrics = boardMetrics(ctx.seed, ctx)
  const costCache = createCourtCostCache()
  let current = seed
  let currentMetrics = current === ctx.seed ? seedMetrics : boardMetrics(current, ctx)
  let currentScore = scoreBoard(current, ctx, opts.objective, currentMetrics, costCache)

  for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
    let best: BoardSnapshot | null = null
    let bestMetrics: typeof currentMetrics | null = null
    let bestScore = currentScore

    for (const candidate of generateMoves(current, ctx.benchIds, opts.moveSet)) {
      // Một nước đi đụng nhiều nhất 3 sân, và moves.ts giữ nguyên tham chiếu các sân không đụng —
      // nên chỉ những sân đó phải chấm lại. Đây thuần tăng tốc: kết quả không đổi một bit, và hash
      // corpus là thứ chứng minh điều đó.
      const candidateMetrics = boardMetrics(candidate, ctx, { board: current, metrics: currentMetrics })
      // `current` là origin: H6 là luật của từng nước đi, còn H3/H4/H5/H8 so với ctx.seed.
      const rejection = firstViolation(candidate, current, ctx, { candidate: candidateMetrics, seed: seedMetrics })
      if (rejection) {
        opts.onReject?.(rejection)
        continue
      }
      const score = scoreBoard(candidate, ctx, opts.objective, candidateMetrics, costCache)
      if (!isBetter(score, bestScore, OPTIMIZER_EPSILON)) continue
      best = candidate
      bestMetrics = candidateMetrics
      bestScore = score
    }

    if (!best) {
      return { board: current, iterations: iteration, changed: boardKey(current) !== seedKey }
    }
    current = best
    currentMetrics = bestMetrics!
    currentScore = bestScore
    opts.onAccept?.(iteration)
  }

  return { board: current, iterations: opts.maxIterations, changed: boardKey(current) !== seedKey }
}
