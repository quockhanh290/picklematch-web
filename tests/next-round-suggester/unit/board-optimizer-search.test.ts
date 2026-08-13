// P2-2 Task 5 — vòng tìm steepest descent.
//
// Ba tính chất được đóng đinh ở đây, theo đúng thứ tự quan trọng:
//   1. không cải thiện được thì trả về ĐÚNG board gốc (để metadata phía sau không bị khuấy vô ích)
//   2. tất định — chạy lại cho kết quả giống hệt
//   3. không bao giờ trả về board vi phạm ràng buộc cứng

import { optimizeBoard } from '@/lib/next-round-suggester/board-optimizer'
import { firstViolation } from '@/lib/next-round-suggester/board-optimizer/constraints'
import type { BoardSnapshot, ConstraintContext } from '@/lib/next-round-suggester/board-optimizer/constraints'
import { MOVE_SET_SPLIT_ONLY, MOVE_SET_WITH_BENCH } from '@/lib/next-round-suggester/board-optimizer/moves'
import { createPlayer, createState } from '../helpers/factories'

function buildCtx(seed: BoardSnapshot, benchIds: string[] = []): ConstraintContext {
  const state = createState({
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a', { pvna: 4.0 }),
      createPlayer('b', { pvna: 2.0 }),
      createPlayer('c', { pvna: 3.0 }),
      createPlayer('d', { pvna: 3.0 }),
      createPlayer('e', { pvna: 3.0, consecutive_rest: 1 }),
    ],
  })
  return { state, pvnaTolerance: 0.5, seed, benchIds, lockPlayerSet: false }
}

const OPTS = { objective: 'lex' as const, moveSet: MOVE_SET_WITH_BENCH, maxIterations: 30 }

describe('optimizeBoard', () => {
  it('board đã tốt nhất thì trả về nguyên nó, changed = false', () => {
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }]   // 6.0 vs 6.0
    const result = optimizeBoard(seed, buildCtx(seed), OPTS)
    expect(result.changed).toBe(false)
    expect(result.board).toEqual(seed)
  })

  it('chia lại được cân hơn thì nó tìm ra', () => {
    // Bộ sát trình: p=3.0 q=3.4 r=3.2 s=3.2. seed (p,s) v (q,r) = 6.2 vs 6.6.
    // Cách chia cân hơn: (p,q) v (r,s) = 6.4 vs 6.4, và intra chỉ 0.4 nên không đụng trần.
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p', { pvna: 3.0 }),
        createPlayer('q', { pvna: 3.4 }),
        createPlayer('r', { pvna: 3.2 }),
        createPlayer('s', { pvna: 3.2 }),
      ],
    })
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['p', 's'], team_b: ['q', 'r'] }]
    const ctx: ConstraintContext = { state, pvnaTolerance: 0.5, seed, benchIds: [], lockPlayerSet: false }
    const result = optimizeBoard(seed, ctx, { ...OPTS, moveSet: MOVE_SET_SPLIT_ONLY })
    expect(result.changed).toBe(true)
    const teams = [result.board[0].team_a.slice().sort(), result.board[0].team_b.slice().sort()]
    expect(teams).toContainEqual(['p', 'q'])
    expect(teams).toContainEqual(['r', 's'])
  })

  it('KHÔNG cân tổng bằng cách ghép mạnh nhất với yếu nhất — H3 cấm, và đó là chủ ý', () => {
    // seed a+c = 7.0 vs b+d = 5.0 (lệch 2.0). Cách chia cân tổng duy nhất là (a,b) v (c,d), nhưng nó
    // đẩy intra lên 2.0 — vượt trần cứng 1.0. Engine hiện tại cũng từ chối đúng nước này; trên corpus
    // `intraCap` là lý do từ chối nhiều nhất (6773 lần). Optimizer phải giữ nguyên hành vi đó.
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
    const rejections: string[] = []
    const result = optimizeBoard(seed, buildCtx(seed), {
      ...OPTS, moveSet: MOVE_SET_SPLIT_ONLY, onReject: reason => rejections.push(reason),
    })
    expect(result.changed).toBe(false)
    expect(rejections).toContain('intra_cap')
  })

  it('tất định: hai lần chạy cho kết quả giống hệt', () => {
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
    const ctx = buildCtx(seed, ['e'])
    const first = optimizeBoard(seed, ctx, OPTS).board
    const second = optimizeBoard(seed, ctx, OPTS).board
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('không bao giờ trả về board vi phạm ràng buộc cứng', () => {
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
    const ctx = buildCtx(seed, ['e'])
    const result = optimizeBoard(seed, ctx, OPTS)
    expect(firstViolation(result.board, seed, ctx)).toBeNull()
  })

  it('trần vòng lặp bằng 0 thì không đụng gì', () => {
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
    const result = optimizeBoard(seed, buildCtx(seed), { ...OPTS, maxIterations: 0 })
    expect(result.changed).toBe(false)
    expect(result.board).toEqual(seed)
  })

  it('đếm được lý do từ chối để phép đo sau này phân loại được', () => {
    const seed: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }]
    const rejections: string[] = []
    optimizeBoard(seed, buildCtx(seed, ['e']), { ...OPTS, onReject: reason => rejections.push(reason) })
    expect(rejections.length).toBeGreaterThan(0)
  })
})
