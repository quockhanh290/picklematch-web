// Hai thước đo của board optimizer (P2-2, spec §4).
//
// Sáu post-pass cũ mỗi cái mang một ý niệm "tốt hơn" riêng — đó là lý do chúng ghi đè lẫn nhau ~42%
// số lượt viết. Ở đây chỉ có một hàm chấm điểm, và nó trả về VECTOR để cả hai thước dùng chung một
// đường so sánh: O-lex là sáu bậc từ điển, O-cost là vector một phần tử.
//
// Spec cố ý KHÔNG chọn trước cái nào. Cả hai chạy trên corpus 60 phiên rồi mới chốt bằng bảng số.

// @ts-ignore Deno-style extension: the edge runtime resolves .ts, tsc strips it
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { INTRA_TEAM_PVNA_GAP_LIMIT } from '../score.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { BoardSnapshot, ConstraintContext } from './constraints.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { courtCost, courtMetrics } from './court-metrics.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { BoardMetrics, CourtCostCache } from './court-metrics.ts'

/** Vector từ điển: so phần tử đầu trước, hoà mới xét phần tử sau. */
export type BoardScore = number[]
export type ObjectiveName = 'lex' | 'cost'

/**
 * Người đã lỡ ít nhất một lượt mà vẫn ngồi ngoài. Băng ghế được tính lại từ board ứng viên chứ không
 * lấy ctx.benchIds nguyên xi: sau một nước đổi người, ai ra ai vào đã khác.
 */
const restDebtCount = (board: BoardSnapshot, ctx: ConstraintContext): number => {
  const seated = new Set(board.flatMap(court => [...court.team_a, ...court.team_b]))
  const eligible = new Set([
    ...ctx.seed.flatMap(court => [...court.team_a, ...court.team_b]),
    ...ctx.benchIds,
  ])
  let owed = 0
  for (const playerId of eligible) {
    if (seated.has(playerId)) continue
    if ((ctx.state.players.get(playerId)?.consecutive_rest ?? 0) > 0) owed += 1
  }
  return owed
}

export function scoreBoard(
  board: BoardSnapshot,
  ctx: ConstraintContext,
  objective: ObjectiveName,
  /** Số đo dựng sẵn (court-metrics). Bỏ trống thì tính tại chỗ — kết quả y hệt, chỉ chậm hơn. */
  precomputed?: BoardMetrics,
  costCache?: CourtCostCache,
): BoardScore {
  const metrics = precomputed ?? board.map(court => courtMetrics(court, ctx))
  let cost = 0
  for (const court of board) cost += courtCost(court, ctx, costCache)
  if (objective === 'cost') return [cost]

  let repeat3Courts = 0
  let overTolCourts = 0
  let overTolTotal = 0
  let intraExcessTotal = 0
  for (const metric of metrics) {
    if (metric.meeting >= 3) repeat3Courts += 1
    if (metric.over > 0) {
      overTolCourts += 1
      overTolTotal += metric.over
    }
    intraExcessTotal += Math.max(0, metric.intra - INTRA_TEAM_PVNA_GAP_LIMIT)
  }
  return [repeat3Courts, overTolCourts, overTolTotal, restDebtCount(board, ctx), intraExcessTotal, cost]
}

/**
 * ε chỉ áp cho bậc CUỐI (thang cost liên tục). Các bậc trên là số đếm hoặc tổng mức vượt — chênh một
 * đơn vị ở đó là chênh thật, không phải nhiễu số thực, nên nới ε ra sẽ nuốt mất đúng thứ đang xếp hạng.
 */
export function isBetter(a: BoardScore, b: BoardScore, epsilon: number): boolean {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    const margin = i === length - 1 ? epsilon : 0
    if (av < bv - margin) return true
    if (av > bv + margin) return false
  }
  return false
}
