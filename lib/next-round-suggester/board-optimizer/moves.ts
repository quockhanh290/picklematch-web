// Bốn nguyên tử nước đi của board optimizer (P2-2, spec §5).
//
// W1 đổi chỗ trong cùng một sân (chia lại đội), W2 đổi chỗ giữa hai sân, W3 đổi một người đang ngồi
// lấy một người ở băng ghế, W4 xoay vòng ba người giữa ba sân. W4 tồn tại vì audit ghi rõ "local
// 2-opt không với tới re-partition 3+ người" — chính là luận điểm gốc của P2-2; một vòng xoay ba
// không tách được thành hai lần đổi đôi mà bước giữa cũng tốt lên.
//
// TẤT ĐỊNH là hợp đồng, không phải ý tốt: sân theo court_idx tăng dần, ghế theo chỉ số 0..3, băng
// ghế được sort MỘT LẦN ở đây thay vì tin vào thứ tự người gọi truyền vào.

import type { BoardSnapshot, CourtSnapshot } from './constraints'

export type MoveKind = 'W1' | 'W2' | 'W3' | 'W4'
export type MoveSet = readonly MoveKind[]

export const MOVE_SET_SPLIT_ONLY: MoveSet = ['W1', 'W2', 'W4']
export const MOVE_SET_WITH_BENCH: MoveSet = ['W1', 'W2', 'W3', 'W4']

/** Bốn ghế của một sân: 0,1 = team_a; 2,3 = team_b. */
const SEATS = [0, 1, 2, 3] as const
type Seat = (typeof SEATS)[number]

const seatOf = (court: CourtSnapshot, seat: Seat): string =>
  seat === 0 ? court.team_a[0]
    : seat === 1 ? court.team_a[1]
      : seat === 2 ? court.team_b[0]
        : court.team_b[1]

const withSeat = (court: CourtSnapshot, seat: Seat, playerId: string): CourtSnapshot =>
  seat < 2
    ? { ...court, team_a: (seat === 0 ? [playerId, court.team_a[1]] : [court.team_a[0], playerId]) as [string, string] }
    : { ...court, team_b: (seat === 2 ? [playerId, court.team_b[1]] : [court.team_b[0], playerId]) as [string, string] }

const replaceCourt = (board: BoardSnapshot, index: number, court: CourtSnapshot): BoardSnapshot =>
  board.map((existing, i) => (i === index ? court : existing))

/** Sân đã sắp theo court_idx — mọi nước đi sinh ra từ thứ tự này. */
const orderedIndices = (board: BoardSnapshot): number[] =>
  board
    .map((court, index) => ({ courtIdx: court.court_idx, index }))
    .sort((left, right) => left.courtIdx - right.courtIdx)
    .map(entry => entry.index)

export function* generateMoves(
  board: BoardSnapshot,
  benchIds: readonly string[],
  moveSet: MoveSet,
): Generator<BoardSnapshot> {
  const order = orderedIndices(board)
  const enabled = new Set(moveSet)
  const bench = [...benchIds].sort()

  // W1 — đổi chỗ giữa hai đội của cùng một sân. Đổi trong cùng một đội là vô nghĩa (đội là tập hai
  // người), nên chỉ sinh bốn tổ hợp cắt ngang hai đội.
  if (enabled.has('W1')) {
    for (const index of order) {
      const court = board[index]
      for (const seatA of [0, 1] as Seat[]) {
        for (const seatB of [2, 3] as Seat[]) {
          const swapped = withSeat(withSeat(court, seatA, seatOf(court, seatB)), seatB, seatOf(court, seatA))
          yield replaceCourt(board, index, swapped)
        }
      }
    }
  }

  // W2 — đổi chỗ giữa hai sân khác nhau.
  if (enabled.has('W2')) {
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const leftIndex = order[i]
        const rightIndex = order[j]
        for (const leftSeat of SEATS) {
          for (const rightSeat of SEATS) {
            const leftCourt = board[leftIndex]
            const rightCourt = board[rightIndex]
            const nextLeft = withSeat(leftCourt, leftSeat, seatOf(rightCourt, rightSeat))
            const nextRight = withSeat(rightCourt, rightSeat, seatOf(leftCourt, leftSeat))
            yield replaceCourt(replaceCourt(board, leftIndex, nextLeft), rightIndex, nextRight)
          }
        }
      }
    }
  }

  // W3 — đổi một người đang ngồi lấy một người ở băng ghế.
  if (enabled.has('W3')) {
    for (const index of order) {
      const court = board[index]
      for (const seat of SEATS) {
        for (const incomingId of bench) {
          yield replaceCourt(board, index, withSeat(court, seat, incomingId))
        }
      }
    }
  }

  // W4 — xoay vòng ba người giữa ba sân, cả hai chiều.
  if (enabled.has('W4')) {
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        for (let k = j + 1; k < order.length; k++) {
          const indices = [order[i], order[j], order[k]]
          for (const seatI of SEATS) {
            for (const seatJ of SEATS) {
              for (const seatK of SEATS) {
                const seats: Seat[] = [seatI, seatJ, seatK]
                const players = indices.map((courtIndex, slot) => seatOf(board[courtIndex], seats[slot]))
                for (const shift of [1, 2]) {
                  let next = board
                  for (let slot = 0; slot < 3; slot++) {
                    const courtIndex = indices[slot]
                    const incoming = players[(slot + shift) % 3]
                    next = replaceCourt(next, courtIndex, withSeat(next[courtIndex], seats[slot], incoming))
                  }
                  yield next
                }
              }
            }
          }
        }
      }
    }
  }
}
