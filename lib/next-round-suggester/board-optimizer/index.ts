// Board optimizer (P2-2, spec §5) — một vòng leo dốc tất định thay cho sáu post-pass.
//
// Sáu pass cũ tiêu ~42% số lượt viết vào việc ghi đè lẫn nhau, vì mỗi pass mang một ý niệm "tốt hơn"
// riêng và không pass nào biết pass khác. Ở đây chỉ có một thước đo và một bộ ràng buộc; board gốc
// greedy là điểm xuất phát và cũng là mốc của mọi ràng buộc "không tệ hơn".
//
// Ngân sách là SỐ VÒNG LẶP, không phải đồng hồ. Engine hiện không tất định vì deadline theo Date.now()
// — đó là một nửa nguyên nhân bug flicker, nên optimizer không được phép mang lại đúng cái bệnh đó.

import { firstViolation } from './constraints'
import type { BoardSnapshot, ConstraintContext, ConstraintRejection } from './constraints'
import { isBetter, scoreBoard } from './objective'
import type { ObjectiveName } from './objective'
import { generateMoves } from './moves'
import type { MoveSet } from './moves'

export { MOVE_SET_SPLIT_ONLY, MOVE_SET_WITH_BENCH } from './moves'
export type { BoardSnapshot, ConstraintContext, ConstraintRejection } from './constraints'
export type { ObjectiveName } from './objective'
export type { MoveKind, MoveSet } from './moves'

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
  let current = seed
  let currentScore = scoreBoard(current, ctx, opts.objective)

  for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
    let best: BoardSnapshot | null = null
    let bestScore = currentScore

    for (const candidate of generateMoves(current, ctx.benchIds, opts.moveSet)) {
      // `current` là origin: H6/H8 là luật của từng nước đi, còn H3/H4/H5 so với ctx.seed.
      const rejection = firstViolation(candidate, current, ctx)
      if (rejection) {
        opts.onReject?.(rejection)
        continue
      }
      const score = scoreBoard(candidate, ctx, opts.objective)
      if (!isBetter(score, bestScore, OPTIMIZER_EPSILON)) continue
      best = candidate
      bestScore = score
    }

    if (!best) {
      return { board: current, iterations: iteration, changed: boardKey(current) !== seedKey }
    }
    current = best
    currentScore = bestScore
    opts.onAccept?.(iteration)
  }

  return { board: current, iterations: opts.maxIterations, changed: boardKey(current) !== seedKey }
}
