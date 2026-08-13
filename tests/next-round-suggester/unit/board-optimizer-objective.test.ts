// P2-2 Task 3 — hai thước đo của optimizer.
//
// Cả hai trả về cùng một kiểu (vector số) để vòng tìm chỉ có MỘT đường code so sánh. O-lex là sáu
// bậc từ điển; O-cost là vector một phần tử. Spec cố ý chưa chọn cái nào: cả hai đem đo trên corpus
// rồi mới chốt.

import { isBetter, scoreBoard } from '@/lib/next-round-suggester/board-optimizer/objective'
import type { BoardSnapshot, ConstraintContext } from '@/lib/next-round-suggester/board-optimizer/constraints'
import { createPlayer, createState } from '../helpers/factories'

const board = (teamA: [string, string], teamB: [string, string]): BoardSnapshot =>
  [{ court_idx: 0, team_a: teamA, team_b: teamB }]

function buildCtx(): ConstraintContext {
  const state = createState({
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a', { pvna: 4.0 }),
      createPlayer('b', { pvna: 2.0 }),
      createPlayer('c', { pvna: 3.0 }),
      createPlayer('d', { pvna: 3.0 }),
      createPlayer('e', { pvna: 3.0, consecutive_rest: 2 }),
    ],
  })
  return { state, pvnaTolerance: 0.5, seed: board(['a', 'b'], ['c', 'd']), benchIds: ['e'], lockPlayerSet: false }
}

describe('isBetter', () => {
  it('lex: ít lặp-3 hơn thắng, dù cost cao hơn nhiều', () => {
    const fewerRepeats = [0, 3, 2.5, 0, 0, 9.9]
    const moreRepeats = [1, 0, 0, 0, 0, 1.0]
    expect(isBetter(fewerRepeats, moreRepeats, 0.01)).toBe(true)
    expect(isBetter(moreRepeats, fewerRepeats, 0.01)).toBe(false)
  })

  it('bậc cost: chênh dưới epsilon không tính là tốt hơn', () => {
    expect(isBetter([2.500], [2.505], 0.01)).toBe(false)
    expect(isBetter([2.480], [2.505], 0.01)).toBe(true)
  })

  it('bằng nhau hoàn toàn thì không ai tốt hơn ai', () => {
    expect(isBetter([0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 1], 0.01)).toBe(false)
  })
})

describe('scoreBoard', () => {
  it('lex trả về sáu bậc, và đếm đúng sân vượt tolerance', () => {
    const ctx = buildCtx()
    const balanced = scoreBoard(board(['a', 'b'], ['c', 'd']), ctx, 'lex')   // 6.0 vs 6.0
    const lopsided = scoreBoard(board(['a', 'c'], ['b', 'd']), ctx, 'lex')   // 7.0 vs 5.0
    expect(balanced).toHaveLength(6)
    expect(balanced[1]).toBe(0)
    expect(lopsided[1]).toBe(1)
    expect(lopsided[2]).toBeCloseTo(1.5, 5)   // 2.0 - 0.5 tolerance
  })

  it('lex bậc 4 đếm người còn nợ nghỉ mà vẫn ngồi ngoài', () => {
    const ctx = buildCtx()
    const benchedOwed = scoreBoard(board(['a', 'b'], ['c', 'd']), ctx, 'lex')   // e (nợ 2) ngồi ngoài
    const seatedOwed = scoreBoard(board(['a', 'b'], ['c', 'e']), ctx, 'lex')    // e được xếp
    expect(benchedOwed[3]).toBe(1)
    expect(seatedOwed[3]).toBe(0)
  })

  it('cost trả về đúng một phần tử', () => {
    const ctx = buildCtx()
    expect(scoreBoard(board(['a', 'b'], ['c', 'd']), ctx, 'cost')).toHaveLength(1)
  })
})
