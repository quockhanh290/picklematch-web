// P2-2 — bất biến của board optimizer trên board sinh ngẫu nhiên.
//
// Test đơn vị chỉ chứng minh những tình huống tôi nghĩ ra được. Hai bất biến dưới đây phải đúng với
// MỌI board, kể cả những board tôi không nghĩ tới:
//   1. kết quả không bao giờ vi phạm ràng buộc cứng
//   2. kết quả không bao giờ TỆ HƠN board gốc theo chính thước đo đang dùng
// Bất biến 2 là thứ cho phép bật optimizer mà không cần tin vào chất lượng của nó: xấu nhất là hoà.
//
// PRNG cố định trong file (mulberry32) thay vì Math.random để chạy lại cho đúng cùng bộ board.

import { optimizeBoard } from '@/lib/next-round-suggester/board-optimizer'
import { firstViolation } from '@/lib/next-round-suggester/board-optimizer/constraints'
import type { BoardSnapshot, ConstraintContext } from '@/lib/next-round-suggester/board-optimizer/constraints'
import { isBetter, scoreBoard } from '@/lib/next-round-suggester/board-optimizer/objective'
import type { ObjectiveName } from '@/lib/next-round-suggester/board-optimizer/objective'
import { MOVE_SET_SPLIT_ONLY, MOVE_SET_WITH_BENCH } from '@/lib/next-round-suggester/board-optimizer/moves'
import { createPlayer, createState } from '../helpers/factories'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Scenario = { name: string; seed: BoardSnapshot; ctx: ConstraintContext }

function buildScenario(index: number): Scenario {
  const rand = mulberry32(index * 7919 + 13)
  const courts = 1 + Math.floor(rand() * 3)             // 1..3 sân
  const benchSize = Math.floor(rand() * 5)              // 0..4 người chờ
  const total = courts * 4 + benchSize
  const tolerance = 0.4 + rand() * 0.4

  const players = Array.from({ length: total }, (_, i) =>
    createPlayer(`p${String(i).padStart(2, '0')}`, {
      pvna: Number((2.0 + rand() * 3.0).toFixed(2)),
      consecutive_rest: Math.floor(rand() * 3),
      matches_played: Math.floor(rand() * 6),
    }),
  )
  const state = createState({ players, courts, pvnaTolerance: tolerance })

  // Lịch sử gặp nhau ngẫu nhiên, để ràng buộc lặp-3 có việc để làm.
  const ids = players.map(player => player.player_id)
  for (const id of ids) {
    for (const other of ids) {
      if (id === other) continue
      if (rand() < 0.12) state.players.get(id)!.partner_counts.set(other, 1 + Math.floor(rand() * 2))
      if (rand() < 0.12) state.players.get(id)!.opponent_counts.set(other, 1 + Math.floor(rand() * 2))
    }
  }

  const shuffled = [...ids].sort(() => rand() - 0.5)
  const seed: BoardSnapshot = Array.from({ length: courts }, (_, court) => ({
    court_idx: court,
    team_a: [shuffled[court * 4], shuffled[court * 4 + 1]] as [string, string],
    team_b: [shuffled[court * 4 + 2], shuffled[court * 4 + 3]] as [string, string],
  }))
  const benchIds = shuffled.slice(courts * 4)

  return {
    name: `#${index} (${courts} sân, ${benchIds.length} chờ, tol ${tolerance.toFixed(2)})`,
    seed,
    ctx: { state, pvnaTolerance: tolerance, seed, benchIds, lockPlayerSet: index % 11 === 0 },
  }
}

const SCENARIOS = Array.from({ length: 120 }, (_, index) => buildScenario(index))
const CONFIGS: { objective: ObjectiveName; moveSet: typeof MOVE_SET_WITH_BENCH }[] = [
  { objective: 'lex', moveSet: MOVE_SET_WITH_BENCH },
  { objective: 'cost', moveSet: MOVE_SET_WITH_BENCH },
  { objective: 'lex', moveSet: MOVE_SET_SPLIT_ONLY },
]

describe('bất biến của optimizer trên board ngẫu nhiên', () => {
  it.each(SCENARIOS)('$name không bao giờ vi phạm ràng buộc cứng và không bao giờ tệ hơn', ({ seed, ctx }) => {
    for (const config of CONFIGS) {
      const result = optimizeBoard(seed, ctx, { ...config, maxIterations: 30 })

      expect(firstViolation(result.board, seed, ctx)).toBeNull()

      const seedScore = scoreBoard(seed, ctx, config.objective)
      const resultScore = scoreBoard(result.board, ctx, config.objective)
      expect(isBetter(seedScore, resultScore, 0.01)).toBe(false)

      if (ctx.lockPlayerSet) {
        const key = (board: BoardSnapshot) =>
          board.flatMap(court => [...court.team_a, ...court.team_b]).sort().join(',')
        expect(key(result.board)).toBe(key(seed))
      }
    }
  })
})
