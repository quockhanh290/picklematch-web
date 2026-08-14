// Đo thời gian optimizer trên board cỡ thật.
//
// KHÔNG dùng board-scorecard cho việc này: harness đó đóng băng Date.now/performance.now (đúng cho
// việc so board tất định, vô dụng cho việc đo giờ). Ở đây dùng process.hrtime.
//
// Con số cần so: engine_search trên prod đo được 131–785ms. Nếu optimizer đẩy tổng vượt xa mức đó thì
// nó tự đánh sập thứ nó định chữa — request chậm hơn chu kỳ poll 4s là đúng vòng lặp đẻ ra flicker.

// @ts-ignore
import { MOVE_SET_NO_ROTATION, MOVE_SET_SPLIT_ONLY, MOVE_SET_WITH_BENCH, optimizeBoard } from '../lib/next-round-suggester/board-optimizer/index.ts'
// @ts-ignore
import type { BoardSnapshot, ConstraintContext } from '../lib/next-round-suggester/board-optimizer/constraints.ts'
// @ts-ignore
import type { PlayerSessionState, SessionState } from '../lib/next-round-suggester/types.ts'

function player(id: string, pvna: number, rest: number, played: number): PlayerSessionState {
  return {
    player_id: id,
    pvna,
    group_id: null,
    checked_in_at: new Date('2026-01-01'),
    checked_out_at: null,
    matches_played: played,
    last_played_round: 0,
    consecutive_rest: rest,
    consecutive_play: 0,
    partner_counts: new Map<string, number>(),
    opponent_counts: new Map<string, number>(),
    opted_rest: false,
    gender: null,
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
  } as unknown as PlayerSessionState
}

function scenario(courts: number, bench: number) {
  const total = courts * 4 + bench
  const players = Array.from({ length: total }, (_, i) =>
    player(`p${String(i).padStart(2, '0')}`, 2.5 + (i % 11) * 0.25, i % 3, i % 7))
  players.forEach((p, i) => {
    if (i + 1 < players.length) p.partner_counts.set(players[i + 1].player_id, 1)
  })
  const state = {
    session_id: 's',
    current_round: 5,
    status: 'active',
    config: { courts, pvna_tolerance: 0.5, weights: {}, avoid_pairs: [] },
    players: new Map(players.map(p => [p.player_id, p])),
    rounds: [],
    pairs: new Map(),
  } as unknown as SessionState

  const seed: BoardSnapshot = Array.from({ length: courts }, (_, c) => ({
    court_idx: c,
    team_a: [players[c * 4].player_id, players[c * 4 + 1].player_id] as [string, string],
    team_b: [players[c * 4 + 2].player_id, players[c * 4 + 3].player_id] as [string, string],
  }))
  const ctx: ConstraintContext = {
    state,
    pvnaTolerance: 0.5,
    seed,
    benchIds: players.slice(courts * 4).map(p => p.player_id),
    lockPlayerSet: false,
  }
  return { seed, ctx }
}

const SHAPES: [number, number][] = [[1, 4], [3, 8], [6, 12], [6, 20]]
const RUNS = 20

for (const [courts, bench] of SHAPES) {
  const { seed, ctx } = scenario(courts, bench)
  for (const [label, moveSet] of [['bench', MOVE_SET_WITH_BENCH], ['norot', MOVE_SET_NO_ROTATION], ['split', MOVE_SET_SPLIT_ONLY]] as const) {
    const start = process.hrtime.bigint()
    let iterations = 0
    for (let i = 0; i < RUNS; i++) {
      iterations += optimizeBoard(seed, ctx, { objective: 'lex', moveSet, maxIterations: 30 }).iterations
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6 / RUNS
    console.log(`${courts} sân / ${bench} chờ · ${label}: ${ms.toFixed(1)} ms/board (vòng lặp TB ${(iterations / RUNS).toFixed(1)})`)
  }
}
