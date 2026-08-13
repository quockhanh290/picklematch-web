// P2-2 Task 2 — ràng buộc cứng H1–H8 của board optimizer.
//
// Mỗi ràng buộc ở đây là bản nâng lên cấp board của một guard đang chạy trong hai pass kéo băng ghế
// và pass joint. Chúng KHÔNG phải phát minh mới: `mayReplace`, `hasNearLevelPeer`, trần intra, và
// luật "không tạo lần gặp thứ 3 mới" đều trích nguyên ngữ nghĩa từ live-preview.ts.
//
// Hai loại ràng buộc khác nhau ở chỗ SO VỚI CÁI GÌ, và đó là lý do firstViolation nhận cả `origin`
// lẫn `ctx.seed`:
//   - H3/H4/H5 là "không tệ hơn board gốc"  → so với ctx.seed (board greedy ban đầu)
//   - H6/H8 là luật của TỪNG nước đi        → so với origin (board mà nước đi này xuất phát)
// Gộp hai cái làm một sẽ cho phép một chuỗi nước đi, mỗi bước đều "công bằng" so với board gốc, cộng
// dồn lại thành bench đúng người đang bị nợ nhất.

import { firstViolation } from '@/lib/next-round-suggester/board-optimizer/constraints'
import type { BoardSnapshot, ConstraintContext } from '@/lib/next-round-suggester/board-optimizer/constraints'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionState } from '@/lib/next-round-suggester/types'

const COURT_0: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }]

function buildState(overrides: { avoidPair?: [string, string] } = {}): SessionState {
  const state = createState({
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a', { pvna: 4.0 }),
      createPlayer('b', { pvna: 2.0 }),
      createPlayer('c', { pvna: 3.0 }),
      createPlayer('d', { pvna: 3.0 }),
      createPlayer('e', { pvna: 3.1 }),
      createPlayer('f', { pvna: 2.9 }),
    ],
  })
  if (overrides.avoidPair) {
    state.config.avoid_pairs = [{ player_a: overrides.avoidPair[0], player_b: overrides.avoidPair[1] }]
  }
  return state
}

/** Bộ bốn người cùng trình: mọi cách chia đều cân, nên chỉ còn đúng ràng buộc đang kiểm chặn. */
function buildLevelState(): SessionState {
  return createState({
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a', { pvna: 3.0 }),
      createPlayer('b', { pvna: 3.0 }),
      createPlayer('c', { pvna: 3.0 }),
      createPlayer('d', { pvna: 3.0 }),
      createPlayer('e', { pvna: 3.0 }),
      createPlayer('f', { pvna: 3.0 }),
    ],
  })
}

function buildCtx(state: SessionState, overrides: Partial<ConstraintContext> = {}): ConstraintContext {
  return {
    state,
    pvnaTolerance: 0.5,
    seed: COURT_0,
    benchIds: ['e', 'f'],
    lockPlayerSet: false,
    ...overrides,
  }
}

describe('firstViolation', () => {
  it('board gốc luôn hợp lệ với chính nó', () => {
    const ctx = buildCtx(buildState())
    expect(firstViolation(COURT_0, COURT_0, ctx)).toBeNull()
  })

  it('H2: một người ngồi hai chỗ bị loại', () => {
    const ctx = buildCtx(buildState())
    const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'a'], team_b: ['c', 'd'] }]
    expect(firstViolation(candidate, COURT_0, ctx)).toBe('seat_integrity')
  })

  it('H4: chia lại thành lệch quá tolerance bị loại', () => {
    // seed: a+b = 6.0 vs c+d = 6.0 → gap 0. candidate: a+c = 7.0 vs b+d = 5.0 → gap 2.0 > tol 0.5
    const ctx = buildCtx(buildState())
    const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
    expect(firstViolation(candidate, COURT_0, ctx)).toBe('over_tol_increase')
  })

  it('H5: tạo lần gặp thứ 3 mà board gốc chưa có thì bị loại', () => {
    // PVNA bằng nhau nên mọi cách chia đều cân — cô lập đúng ràng buộc lặp, không vướng H4 trước.
    const state = buildLevelState()
    state.players.get('a')!.partner_counts.set('c', 2)
    const ctx = buildCtx(state)
    const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
    expect(firstViolation(candidate, COURT_0, ctx)).toBe('new_repeat3')
  })

  it('H1: cặp tránh nhau bị loại', () => {
    const ctx = buildCtx(buildState({ avoidPair: ['a', 'b'] }))
    expect(firstViolation(COURT_0, COURT_0, ctx)).toBe('avoid_pair')
  })

  it('H6: đưa người nợ ít vào thay người đang bị nợ thì bị loại', () => {
    const state = buildLevelState()
    state.players.get('b')!.consecutive_rest = 2   // b bị bỏ nghỉ 2 vòng
    state.players.get('e')!.consecutive_rest = 0   // e vừa chơi xong
    const ctx = buildCtx(state)
    const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'e'], team_b: ['c', 'd'] }]
    expect(firstViolation(candidate, COURT_0, ctx)).toBe('owed_rank')
  })

  it('H7: khoá tập người chơi thì mọi thay đổi thành phần bị loại', () => {
    const state = buildLevelState()
    state.players.get('e')!.consecutive_rest = 5   // e nợ nhiều nên H6 không phải cái chặn
    const ctx = buildCtx(state, { lockPlayerSet: true })
    const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'e'], team_b: ['c', 'd'] }]
    expect(firstViolation(candidate, COURT_0, ctx)).toBe('player_set_locked')
  })

  it('H8: đẩy một người xuống băng ghế mà ở đó không còn ai cùng trình thì bị loại', () => {
    // Sau khi đổi, băng ghế chỉ còn mình b — không còn ai cùng trình để b ghép vòng sau.
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 3.0 }),
        createPlayer('b', { pvna: 3.0, consecutive_rest: 0 }),
        createPlayer('c', { pvna: 3.0 }),
        createPlayer('d', { pvna: 3.0 }),
        createPlayer('g', { pvna: 3.0, consecutive_rest: 3 }),
      ],
    })
    const ctx = buildCtx(state, { benchIds: ['g'] })
    const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'g'], team_b: ['c', 'd'] }]
    expect(firstViolation(candidate, COURT_0, ctx)).toBe('stranded_outlier')
  })
})
