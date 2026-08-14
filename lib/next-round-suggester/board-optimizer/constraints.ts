// Ràng buộc cứng của board optimizer (P2-2, spec §3).
//
// Sáu post-pass mà optimizer thay thế mỗi cái mang một bộ guard riêng. Gộp chúng lại ở đây, nguyên
// ngữ nghĩa, để có đúng MỘT chỗ trả lời câu "board này có được phép không". Vi phạm là loại thẳng —
// không có bậc nào ở đây đánh đổi được với chất lượng.
//
// Ba nhóm khác nhau ở chỗ so với cái gì, và đó là lý do hàm nhận cả `origin` lẫn `ctx.seed`:
//   H3/H4/H5  "không tệ hơn board gốc"        → so với ctx.seed
//   H8        tính chất của BĂNG GHẾ CUỐI      → so với ctx.seed
//   H6        luật của TỪNG nước đi            → so với origin (board mà nước đi xuất phát)
// H6 phải theo từng nước, nếu không thì một chuỗi nước đi mỗi bước đều hợp lệ so với board gốc vẫn
// cộng dồn thành việc bench đúng người đang bị nợ nhiều nhất. H8 thì ngược lại: kiểm theo từng nước
// là chưa đủ, vì người bạn cùng trình còn trên ghế lúc này có thể bị đẩy đi ở nước sau.

// @ts-ignore Deno-style extension: the edge runtime resolves .ts, tsc strips it
import { hasAvoidedPartnerPair } from '../board-metrics.ts'
// @ts-ignore
import { INTRA_TEAM_PVNA_GAP_LIMIT } from '../score.ts'
// @ts-ignore
import { getEffectivePvna } from '../state.ts'
import type { SessionState } from '../types'
import type { SuggestedMatchPayload } from '../live-preview'
import { courtMetrics } from './court-metrics'
import type { BoardMetrics } from './court-metrics'

export type CourtSnapshot = {
  court_idx: number
  team_a: [string, string]
  team_b: [string, string]
}
export type BoardSnapshot = CourtSnapshot[]

export type ConstraintContext = {
  state: SessionState
  pvnaTolerance: number
  /** Board greedy ban đầu — mốc của mọi ràng buộc "không tệ hơn". */
  seed: BoardSnapshot
  /** Người đủ điều kiện nhưng chưa được xếp ở board gốc. */
  benchIds: string[]
  /** H7: rolling-plan target đang bật → tập người chơi không được đổi. */
  lockPlayerSet: boolean
}

export type ConstraintRejection =
  | 'seat_integrity'
  | 'player_set_locked'
  | 'avoid_pair'
  | 'intra_cap'
  | 'over_tol_increase'
  | 'new_repeat3'
  | 'owed_rank'
  | 'stranded_outlier'

const asPayload = (court: CourtSnapshot): SuggestedMatchPayload =>
  ({ court_idx: court.court_idx, team_a: court.team_a, team_b: court.team_b } as SuggestedMatchPayload)

const seatedIds = (board: BoardSnapshot): string[] =>
  board.flatMap(court => [...court.team_a, ...court.team_b])

const playerSetKey = (board: BoardSnapshot): string => [...seatedIds(board)].sort().join('|')

/** Giống hệt `owedRank` trong hai pass kéo băng ghế: nghỉ trước, rồi tới số trận đã chơi. */
const owedRank = (state: SessionState, playerId: string) => {
  const player = state.players.get(playerId)
  return { rest: player?.consecutive_rest ?? 0, matches: player?.matches_played ?? 0 }
}

/** Bản sao ngữ nghĩa của `mayReplace`: người vào phải nợ ít nhất bằng người ra. */
const mayReplace = (state: SessionState, incomingId: string, outgoingId: string): boolean => {
  const incoming = owedRank(state, incomingId)
  const outgoing = owedRank(state, outgoingId)
  if (incoming.rest !== outgoing.rest) return incoming.rest > outgoing.rest
  return incoming.matches <= outgoing.matches
}

const pvnaOf = (state: SessionState, playerId: string): number => {
  const player = state.players.get(playerId)
  return player ? getEffectivePvna(player) : 0
}

/** Bản sao ngữ nghĩa của `hasNearLevelPeer` trong pass blowout. */
const hasNearLevelPeer = (state: SessionState, pvnaTolerance: number, playerId: string, pool: string[]): boolean => {
  const pv = pvnaOf(state, playerId)
  return pool.some(other => other !== playerId && Math.abs(pvnaOf(state, other) - pv) <= pvnaTolerance)
}

const overTolStats = (metrics: BoardMetrics) => {
  let courts = 0
  let total = 0
  for (const metric of metrics) {
    if (metric.over > 0) {
      courts += 1
      total += metric.over
    }
  }
  return { courts, total }
}

export function firstViolation(
  candidate: BoardSnapshot,
  origin: BoardSnapshot,
  ctx: ConstraintContext,
  /** Số đo dựng sẵn (court-metrics). Bỏ trống thì tính tại chỗ — kết quả y hệt, chỉ chậm hơn. */
  precomputed?: { candidate: BoardMetrics; seed: BoardMetrics },
): ConstraintRejection | null {
  // H2 — mỗi sân đúng 4 người, không ai hai chỗ, chỉ người engine biết.
  const seated = seatedIds(candidate)
  if (candidate.some(court => court.team_a.length !== 2 || court.team_b.length !== 2)) return 'seat_integrity'
  if (new Set(seated).size !== seated.length) return 'seat_integrity'
  if (seated.some(playerId => !ctx.state.players.has(playerId))) return 'seat_integrity'
  if (candidate.length !== ctx.seed.length) return 'seat_integrity'

  // H7 — khoá tập người chơi.
  if (ctx.lockPlayerSet && playerSetKey(candidate) !== playerSetKey(ctx.seed)) return 'player_set_locked'

  // H1 — cặp tránh nhau.
  if (hasAvoidedPartnerPair(candidate.map(asPayload), ctx.state)) return 'avoid_pair'

  // Số đo dùng chung cho H3/H4/H5. Chỉ số của mảng seed khớp theo court_idx, không theo vị trí, vì
  // ứng viên luôn giữ nguyên thứ tự sân của board gốc (moves.ts chỉ thay nội dung, không xáo mảng).
  const candidateMetrics = precomputed?.candidate ?? candidate.map(court => courtMetrics(court, ctx))
  const seedMetrics = precomputed?.seed ?? ctx.seed.map(court => courtMetrics(court, ctx))
  const seedIndexByCourt = new Map(ctx.seed.map((court, index) => [court.court_idx, index]))

  // H3 — trần intra, từng sân so với chính sân đó ở board gốc.
  for (let i = 0; i < candidate.length; i++) {
    const seedIndex = seedIndexByCourt.get(candidate[i].court_idx)
    if (seedIndex === undefined) return 'seat_integrity'
    const cap = Math.max(INTRA_TEAM_PVNA_GAP_LIMIT, seedMetrics[seedIndex].intra)
    if (candidateMetrics[i].intra > cap + 1e-9) return 'intra_cap'
  }

  // H4 — (số sân vượt tolerance, tổng mức vượt) không vế nào được tăng.
  const before = overTolStats(seedMetrics)
  const after = overTolStats(candidateMetrics)
  if (after.courts > before.courts || after.total > before.total + 1e-9) return 'over_tol_increase'

  // H5 — không tạo lần gặp thứ 3 mà board gốc chưa có.
  for (let i = 0; i < candidate.length; i++) {
    const seedIndex = seedIndexByCourt.get(candidate[i].court_idx)!
    if (candidateMetrics[i].meeting >= 3 && seedMetrics[seedIndex].meeting < 3) return 'new_repeat3'
  }

  // H8 — "bị bỏ lại một mình trên băng ghế" là tính chất của băng ghế CUỐI CÙNG, nên phải so với
  // board gốc chứ không phải với nước đi vừa rồi. Kiểm theo từng nước là chưa đủ: mỗi bước đều thấy
  // người vừa xuống còn bạn cùng trình, nhưng bước sau đẩy nốt người bạn ấy lên sân là người đầu bị
  // kẹt lại một mình — property test bắt đúng ca này (#48) trước khi nó kịp ra tới corpus.
  const candidateSeated = new Set(seated)
  const eligible = [...new Set([...seatedIds(ctx.seed), ...ctx.benchIds])]
  const benchAfter = eligible.filter(id => !candidateSeated.has(id)).sort()
  const benchedVersusSeed = seatedIds(ctx.seed).filter(id => !candidateSeated.has(id)).sort()
  for (const outgoingId of benchedVersusSeed) {
    if (!hasNearLevelPeer(ctx.state, ctx.pvnaTolerance, outgoingId, benchAfter)) return 'stranded_outlier'
  }

  // H6 — luật của từng nước đi, so với board nó xuất phát.
  const originSeated = new Set(seatedIds(origin))
  const incoming = [...candidateSeated].filter(id => !originSeated.has(id)).sort()
  const outgoing = [...originSeated].filter(id => !candidateSeated.has(id)).sort()

  if (incoming.length > 0 || outgoing.length > 0) {
    if (incoming.length !== outgoing.length) return 'seat_integrity'
    // Ghép theo mức nợ giảm dần ở cả hai phía: nếu tồn tại một cách ghép hợp lệ thì cách này tìm ra.
    const byOwedDesc = (left: string, right: string) => {
      const l = owedRank(ctx.state, left)
      const r = owedRank(ctx.state, right)
      if (l.rest !== r.rest) return r.rest - l.rest
      if (l.matches !== r.matches) return l.matches - r.matches
      return left < right ? -1 : left > right ? 1 : 0
    }
    const incomingRanked = [...incoming].sort(byOwedDesc)
    const outgoingRanked = [...outgoing].sort(byOwedDesc)
    for (let i = 0; i < incomingRanked.length; i++) {
      if (!mayReplace(ctx.state, incomingRanked[i], outgoingRanked[i])) return 'owed_rank'
    }
  }

  return null
}
