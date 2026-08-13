// P2-2 Task 4 — bốn nguyên tử nước đi.
//
// Tính chất quan trọng nhất ở đây không phải "sinh đủ nước đi" mà là "sinh ĐÚNG MỘT thứ tự, không
// phụ thuộc thứ tự chèn". Engine hiện không tất định theo ngân sách thời gian, và đó là một nửa
// nguyên nhân bug flicker; nếu optimizer lại phụ thuộc thứ tự lặp của Set/Map thì đổi một cái không
// tất định lấy một cái không tất định khác.

import {
  MOVE_SET_SPLIT_ONLY,
  MOVE_SET_WITH_BENCH,
  generateMoves,
} from '@/lib/next-round-suggester/board-optimizer/moves'
import type { BoardSnapshot } from '@/lib/next-round-suggester/board-optimizer/constraints'

const TWO_COURTS: BoardSnapshot = [
  { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] },
  { court_idx: 1, team_a: ['e', 'f'], team_b: ['g', 'h'] },
]

const key = (board: BoardSnapshot) =>
  board.map(court => `${court.court_idx}:${court.team_a.join('+')}v${court.team_b.join('+')}`).join('|')

const playerSet = (board: BoardSnapshot) =>
  board.flatMap(court => [...court.team_a, ...court.team_b]).sort().join(',')

describe('generateMoves', () => {
  it('thứ tự nước đi không phụ thuộc thứ tự truyền băng ghế vào', () => {
    const forward = [...generateMoves(TWO_COURTS, ['x', 'y', 'z'], MOVE_SET_WITH_BENCH)].map(key)
    const reversed = [...generateMoves(TWO_COURTS, ['z', 'y', 'x'], MOVE_SET_WITH_BENCH)].map(key)
    expect(forward).toEqual(reversed)
  })

  it('chạy hai lần cho đúng cùng một dãy', () => {
    const first = [...generateMoves(TWO_COURTS, ['x'], MOVE_SET_WITH_BENCH)].map(key)
    const second = [...generateMoves(TWO_COURTS, ['x'], MOVE_SET_WITH_BENCH)].map(key)
    expect(first).toEqual(second)
  })

  it('bỏ W3 thì không nước đi nào đổi tập người chơi', () => {
    const seedSet = playerSet(TWO_COURTS)
    const moves = [...generateMoves(TWO_COURTS, ['x', 'y'], MOVE_SET_SPLIT_ONLY)]
    expect(moves.length).toBeGreaterThan(0)
    for (const candidate of moves) expect(playerSet(candidate)).toBe(seedSet)
  })

  it('có W3 thì sinh ra nước đưa người băng ghế vào sân', () => {
    const moves = [...generateMoves(TWO_COURTS, ['x'], MOVE_SET_WITH_BENCH)]
    expect(moves.some(candidate => playerSet(candidate).includes('x'))).toBe(true)
  })

  it('không nước đi nào trả về đúng board cũ', () => {
    const seedKey = key(TWO_COURTS)
    for (const candidate of generateMoves(TWO_COURTS, ['x'], MOVE_SET_WITH_BENCH)) {
      expect(key(candidate)).not.toBe(seedKey)
    }
  })

  it('W4 cần ba sân — với hai sân thì nó không sinh gì thêm', () => {
    const withRotation = [...generateMoves(TWO_COURTS, [], ['W1', 'W2', 'W4'])].length
    const withoutRotation = [...generateMoves(TWO_COURTS, [], ['W1', 'W2'])].length
    expect(withRotation).toBe(withoutRotation)
  })
})
