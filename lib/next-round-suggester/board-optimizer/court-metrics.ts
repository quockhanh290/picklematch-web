// Số đo của từng sân, kèm cơ chế dùng lại cho những sân một nước đi không đụng tới.
//
// Vì sao cần: đo trên board 6 sân, optimizer mất 2060 ms/board — trong khi engine_search trên prod chỉ
// 131–785 ms. Nguyên nhân không phải số nước đi mà là mỗi ứng viên đều bị chấm lại TỪ ĐẦU cả 6 sân,
// trong khi một nước đi nhiều nhất đụng 3 sân.
//
// Chỗ dựa để dùng lại là tham chiếu: moves.ts dựng ứng viên bằng cách map mảng sân và chỉ thay đúng
// những sân bị đụng, nên sân không đụng tới giữ NGUYÊN object cũ. So bằng `===` là đủ, không cần
// hash hay so nội dung — và nếu ai đó sau này sửa moves.ts thành clone toàn bộ, cache tự vô hiệu
// (chỉ chậm lại, không bao giờ sai).

// @ts-ignore Deno-style extension: the edge runtime resolves .ts, tsc strips it
import { getPayloadIntraTeamGap, getPayloadProjectedMaxMeeting } from '../board-metrics.ts'
// @ts-ignore
import { getMatchPvnaGap } from '../state.ts'
// @ts-ignore
import { computeQualityCost } from '../quality-cost.ts'
import type { SuggestedMatchPayload } from '../live-preview'
import type { BoardSnapshot, ConstraintContext, CourtSnapshot } from './constraints'

// Cost KHÔNG nằm trong đây, và đó là chủ ý. Đo được: 3304 ứng viên mỗi vòng nhưng chỉ 700 sống sót
// ràng buộc (21%), mà computeQualityCost chiếm 70% thời gian. Tính cost cho cả 3304 là trả giá cho
// 79% ứng viên sẽ bị vứt ngay sau đó.
export type CourtMetrics = {
  intra: number
  gap: number
  /** Phần vượt tolerance, 0 nếu trong tolerance. */
  over: number
  meeting: number
}

export type BoardMetrics = CourtMetrics[]

const asPayload = (court: CourtSnapshot): SuggestedMatchPayload =>
  ({ court_idx: court.court_idx, team_a: court.team_a, team_b: court.team_b } as SuggestedMatchPayload)

export function courtMetrics(court: CourtSnapshot, ctx: ConstraintContext): CourtMetrics {
  const payload = asPayload(court)
  const gap = getMatchPvnaGap(court.team_a, court.team_b, ctx.state)
  return {
    intra: getPayloadIntraTeamGap(payload, ctx.state),
    gap,
    over: Math.max(0, gap - ctx.pvnaTolerance),
    meeting: getPayloadProjectedMaxMeeting(payload, ctx.state),
  }
}

/** Cache cost theo đúng object sân: sân không bị nước đi đụng giữ nguyên tham chiếu nên chỉ tính một lần. */
export type CourtCostCache = WeakMap<CourtSnapshot, number>

export const createCourtCostCache = (): CourtCostCache => new WeakMap<CourtSnapshot, number>()

export function courtCost(court: CourtSnapshot, ctx: ConstraintContext, cache?: CourtCostCache): number {
  const cached = cache?.get(court)
  if (cached !== undefined) return cached
  const cost = computeQualityCost(court.team_a, court.team_b, ctx.state, { tolerance: ctx.pvnaTolerance }).cost
  cache?.set(court, cost)
  return cost
}

/**
 * Số đo của cả board. Nếu truyền vào board trước đó cùng số đo của nó, những sân giữ nguyên tham
 * chiếu sẽ được dùng lại thay vì tính lại.
 */
export function boardMetrics(
  board: BoardSnapshot,
  ctx: ConstraintContext,
  previous?: { board: BoardSnapshot; metrics: BoardMetrics },
): BoardMetrics {
  if (!previous || previous.board.length !== board.length) {
    return board.map(court => courtMetrics(court, ctx))
  }
  return board.map((court, index) =>
    court === previous.board[index] ? previous.metrics[index] : courtMetrics(court, ctx))
}
