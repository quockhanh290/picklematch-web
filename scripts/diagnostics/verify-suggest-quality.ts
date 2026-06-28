/**
 * verify-suggest-quality.ts
 *
 * Kiểm chứng OFFLINE: trận engine đã chọn có phải tối ưu tuyệt đối cho từng sân không.
 *
 * Cách dùng:
 *   1. Lấy 1 dòng dump từ debug_dumps (SQL Editor):
 *        select json_build_object('payload', payload, 'chosen_matches', chosen_matches)
 *        from debug_dumps order by created_at desc limit 1;
 *      Lưu kết quả vào 1 file .json, vd dump.json
 *      (file phải có dạng { "payload": {...}, "chosen_matches": [...] }
 *       hoặc chỉ { ...payload..., "chosen_matches": [...] } — script tự nhận cả hai)
 *
 *   2. Chạy:
 *        npx tsx --tsconfig tsconfig.sandbox.json scripts/diagnostics/verify-suggest-quality.ts dump.json
 *
 * Ý nghĩa kết quả:
 *   delta = chosen_score - brute_best_score (đã chuẩn hoá: số CÀNG NHỎ càng tốt)
 *     delta ≈ 0  → engine ra ĐÚNG trận tốt nhất tuyệt đối cho sân đó.
 *     delta > 0  → engine BỎ LỠ; script in ra trận tối ưu vs trận engine chọn.
 *
 * LƯU Ý FIDELITY:
 *   - scoreMatch dùng aggregate partner/opponent counts (có trong dump) → phần repeat-overflow
 *     + partner/opponent repeat penalty CHÍNH XÁC.
 *   - recentRepeatCost (phạt lặp theo cửa sổ 3 vòng gần nhất) cần state.rounds. Dump KHÔNG có
 *     per-round history → recentRepeatCost = 0 cho MỌI ứng viên. Vì cả chosen lẫn brute-force
 *     đều bị thiếu phần này NHƯ NHAU, delta tương đối vẫn có nghĩa, nhưng nếu muốn tuyệt đối
 *     chính xác thì cần thêm `rounds` vào dump (xem ghi chú cuối file).
 */

// @ts-ignore
import { scoreMatch } from '@/lib/next-round-suggester/score.ts'
// @ts-ignore
import { DEFAULT_SCORING_WEIGHTS } from '@/lib/next-round-suggester/state.ts'
import type { PlayerSessionState, SessionState, Team, RoundRecord } from '@/lib/next-round-suggester/types.ts'
import { readFileSync } from 'node:fs'

type DumpPlayer = {
  id: string
  pvna: number
  gender: 'M' | 'F'
  partner_gender_pref: 'M' | 'F' | 'any'
  opponent_gender_pref: 'M' | 'F' | 'any'
  matches_played: number
  consecutive_rest: number
  consecutive_play: number
  rounds_available: number
  opted_rest: boolean
  checked_out: boolean
  partner_counts: Record<string, number>
  opponent_counts: Record<string, number>
  group_id?: string | null
  last_played_round?: number
}

type Dump = {
  players: DumpPlayer[]
  court_count: number
  current_round: number
  busy_player_ids: string[]
  avoid_pairs?: Array<{ player_a: string; player_b: string }>
  pvna_tolerance?: number
  rounds?: RoundRecord[]
  chosen_matches?: Array<{ court_idx: number; team_a: Team; team_b: Team }>
}

function loadDump(path: string): Dump {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // chấp nhận { payload, chosen_matches } hoặc payload phẳng
  const payload = raw.payload ?? raw
  const chosen = raw.chosen_matches ?? payload.chosen_matches
  return { ...payload, chosen_matches: chosen }
}

function toPlayer(p: DumpPlayer): PlayerSessionState {
  return {
    player_id: p.id,
    pvna: p.pvna,
    group_id: p.group_id ?? null,
    checked_in_at: new Date(),
    checked_out_at: p.checked_out ? new Date() : null,
    matches_played: p.matches_played,
    last_played_round: p.last_played_round ?? 0,
    consecutive_rest: p.consecutive_rest,
    consecutive_play: p.consecutive_play,
    partner_counts: new Map(Object.entries(p.partner_counts ?? {})),
    opponent_counts: new Map(Object.entries(p.opponent_counts ?? {})),
    opted_rest: p.opted_rest,
    gender: p.gender,
    partner_gender_pref: p.partner_gender_pref,
    opponent_gender_pref: p.opponent_gender_pref,
    rounds_available: p.rounds_available,
  }
}

function buildState(dump: Dump): SessionState {
  const players = new Map<string, PlayerSessionState>()
  for (const p of dump.players) players.set(p.id, toPlayer(p))
  return {
    session_id: 'verify',
    current_round: dump.current_round,
    status: 'active',
    config: {
      courts: dump.court_count,
      pvna_tolerance: dump.pvna_tolerance ?? 0.5,
      weights: DEFAULT_SCORING_WEIGHTS as any,
      avoid_pairs: dump.avoid_pairs ?? [],
    },
    players,
    rounds: dump.rounds ?? [],
  }
}

function* combinations<T>(items: T[], k: number): Generator<T[]> {
  const n = items.length
  if (k > n) return
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx.map((i) => items[i])
    let i = k - 1
    while (i >= 0 && idx[i] === i + n - k) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

// 3 cách chia 4 người thành 2v2
function splits(four: string[]): [Team, Team][] {
  const [a, b, c, d] = four
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ]
}

// Brute-force: tìm trận điểm thấp nhất (tốt nhất) từ pool available cho 1 sân
function bruteForceBest(available: string[], state: SessionState, tolerance: number) {
  let best: { score: number; teamA: Team; teamB: Team } | null = null
  for (const four of combinations(available, 4)) {
    for (const [teamA, teamB] of splits(four)) {
      // allow mọi overflow để brute-force thấy CẢ trận thỏa hiệp (so công bằng với rescue)
      const r = scoreMatch(teamA, teamB, state, {
        tolerance,
        allowRepeatOverflow: true,
        allowIntraTeamGapOverflow: true,
        allowRecentGroupRematch: true,
      })
      if (!Number.isFinite(r.score)) continue
      if (!best || r.score < best.score) best = { score: r.score, teamA, teamB }
    }
  }
  return best
}

function scoreChosen(teamA: Team, teamB: Team, state: SessionState, tolerance: number) {
  const r = scoreMatch(teamA, teamB, state, {
    tolerance,
    allowRepeatOverflow: true,
    allowIntraTeamGapOverflow: true,
    allowRecentGroupRematch: true,
  })
  return r.score
}

function short(id: string) { return id.slice(0, 8) }
function fmtTeam(t: Team, state: SessionState) {
  return t.map((id) => `${short(id)}(${state.players.get(id)?.pvna?.toFixed(1) ?? '?'})`).join('+')
}
function fmtMatch(a: Team, b: Team, state: SessionState) {
  return `${fmtTeam(a, state)} vs ${fmtTeam(b, state)}`
}

function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('Cách dùng: npx tsx --tsconfig tsconfig.sandbox.json scripts/diagnostics/verify-suggest-quality.ts <dump.json>')
    process.exit(1)
  }
  const dump = loadDump(path)
  const state = buildState(dump)
  const tolerance = dump.pvna_tolerance ?? 0.5

  if (!dump.chosen_matches || dump.chosen_matches.length === 0) {
    console.error('Dump KHÔNG có chosen_matches — cần thêm field này vào debug_dumps để verify.')
    console.error('(Xem prompt thêm chosen_matches trong hội thoại.)')
    process.exit(1)
  }
  if (!dump.rounds || dump.rounds.length === 0) {
    console.warn('⚠️  Dump không có `rounds` → recentRepeatCost bị bỏ qua (cả 2 phía như nhau, delta vẫn dùng được nhưng không tuyệt đối chính xác).\n')
  }

  const busy = new Set(dump.busy_player_ids ?? [])
  // pool available ban đầu: không busy, không checked_out, không opted_rest
  let pool = dump.players
    .filter((p) => !p.checked_out && !p.opted_rest && !busy.has(p.id))
    .map((p) => p.id)

  console.log(`State: ${dump.players.length} players, court_count=${dump.court_count}, round=${dump.current_round}`)
  console.log(`Available ban đầu: ${pool.length} | busy=${busy.size} | tolerance=${tolerance}`)
  console.log(`Engine chọn ${dump.chosen_matches.length} sân.\n`)

  // Replay per-court GREEDY ORDER: mỗi sân, brute-force trên pool CÒN LẠI, so với trận engine chọn,
  // rồi loại 4 người engine đã dùng khỏi pool (đúng thứ tự greedy production).
  const used = new Set<string>()
  let totalDelta = 0
  let suboptimalCourts = 0

  for (const cm of dump.chosen_matches) {
    const avail = pool.filter((id) => !used.has(id))
    const chosenPlayers = [...cm.team_a, ...cm.team_b]

    // kiểm trận engine chọn có nằm trong pool available không (sanity)
    const allInPool = chosenPlayers.every((id) => avail.includes(id))
    const chosenScore = scoreChosen(cm.team_a, cm.team_b, state, tolerance)
    const best = bruteForceBest(avail, state, tolerance)

    console.log(`── Sân ${cm.court_idx} (pool ${avail.length} người) ──`)
    console.log(`  Engine chọn : ${fmtMatch(cm.team_a, cm.team_b, state)}  | score=${chosenScore.toFixed(3)}${allInPool ? '' : '  ⚠️ KHÔNG nằm trong pool available!'}`)
    if (best) {
      const delta = chosenScore - best.score
      totalDelta += Math.max(0, delta)
      const isOptimal = delta <= 0.01
      console.log(`  Tối ưu nhất : ${fmtMatch(best.teamA, best.teamB, state)}  | score=${best.score.toFixed(3)}`)
      console.log(`  DELTA = ${delta.toFixed(3)}  ${isOptimal ? '✅ engine tối ưu' : '⚠️ engine BỎ LỠ (' + delta.toFixed(3) + ' điểm)'}`)
      if (!isOptimal) suboptimalCourts++
    } else {
      console.log(`  Brute-force không tìm được trận hợp lệ nào (pool quá nhỏ?).`)
    }
    console.log('')

    // loại người engine đã dùng (greedy order)
    chosenPlayers.forEach((id) => used.add(id))
  }

  console.log('═══════════════════════════════════')
  console.log(`Tổng kết: ${dump.chosen_matches.length} sân | ${suboptimalCourts} sân engine bỏ lỡ | tổng delta = ${totalDelta.toFixed(3)}`)
  if (suboptimalCourts === 0) {
    console.log('✅ Engine ra trận TỐI ƯU tuyệt đối ở mọi sân (theo per-court). Gợn còn lại = giới hạn toán / greedy-corner toàn cục.')
  } else {
    console.log('⚠️ Engine bỏ lỡ ở vài sân — xem chi tiết trên. Có thể do beam-3 / rescue / weights.')
  }
}

main()
