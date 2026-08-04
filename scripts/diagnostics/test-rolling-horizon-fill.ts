/**
 * TEST: rollingHorizon fix cho "silent stuck" (sân trống không fill dù còn người rảnh).
 *
 * Mô phỏng một session staggered MỚI (người giả, seed cố định) qua ĐÚNG code path
 * production live: buildSuggestedMatchPayloads. Mỗi khi 1 sân xong, refill sân đó
 * (count=1) — giống hệt rolling-lane thật.
 *
 * Phát hiện "SILENT STALL" = refill trả 0 trận NHƯNG vẫn còn >=4 người rảnh thật
 * (không live, không opted-rest, không checked-out). Đây chính là bug đã gặp.
 *
 * So sánh:
 *   - rollingHorizon OFF  = hành vi CŨ (kỳ vọng: có silent stall ở round cuối)
 *   - rollingHorizon ON   = SAU FIX (kỳ vọng: 0 silent stall)
 *
 * KHÔNG gọi Supabase / edge — chạy engine trực tiếp, deterministic, tái hiện được.
 * (Muốn test edge thật đã deploy thì tạo session trong app; script này để verify logic.)
 *
 * Chạy: npx tsx scripts/diagnostics/test-rolling-horizon-fill.ts
 */
import seedrandom from 'seedrandom'
import { correctForFairness } from '../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../lib/next-round-suggester/fairness/detector'
import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
  buildTightPoolQualityDeferUntilByCourt,
  type SuggestedMatchPayload,
} from '../../lib/next-round-suggester/live-preview'
import { generatePlayers, initState } from '../../tests/next-round-suggester/simulation/generators'
import type { SessionLiveMatchRow, SessionState } from '../../lib/next-round-suggester/types'

// im lặng cảnh báo drift monitor cho gọn output
const _warn = console.warn
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('live round projection drift monitor')) return
  _warn(...a)
}

type Mode = 'off' | 'on'
const ROUNDS = 9
const SEEDS = (process.argv[2] ? Number(process.argv[2]) : 4) > 0
  ? Array.from({ length: process.argv[2] ? Number(process.argv[2]) : 4 }, (_, i) => `s${i + 1}`)
  : ['s1', 's2', 's3', 's4']
// bench cao (người ÷ sân dư nhiều) = nơi bug dễ xảy ra nhất
const SCENARIOS = [
  { label: '24p/5c (bench 4)', n: 24, courts: 5 },
  { label: '28p/6c (bench 4)', n: 28, courts: 6 },
  { label: '30p/6c (bench 6)', n: 30, courts: 6 },
  { label: '32p/6c (bench 8)', n: 32, courts: 6 },
]

function asLiveRow(p: SuggestedMatchPayload, sessionId: string, seq: number, laneRound: number): SessionLiveMatchRow {
  const ts = new Date(seq * 1000).toISOString()
  return {
    id: `off-${seq}`, session_id: sessionId, sequence_no: seq, round_no: laneRound, cycle_no: laneRound,
    court_idx: p.court_idx, status: 'live', team_a: p.team_a, team_b: p.team_b, resting: p.resting,
    score_a: 0, score_b: 0, suggested_at: ts, started_at: ts, ended_at: null,
  }
}

// options KHỚP edge production (blowoutRescue + deferExtremeTightPool + tightPoolDefer)
function suggest(
  state: SessionState, liveRows: SessionLiveMatchRow[], count: number, courts: number,
  mode: Mode, courtIdxs?: number[],
): SuggestedMatchPayload[] {
  return buildSuggestedMatchPayloads({
    count, sessionId: state.session_id, courtCount: courts, state,
    rows: { liveMatchRows: liveRows, liveStateVersion: liveRows.length },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: correctForFairness(state),
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
    pvnaTolerance: 0.5,
    options: {
      courtIdxs, ignoreCapacityLock: true,
      deferExtremeTightPool: true, blowoutRescue: true,
      tightPoolQualityDeferUntilByCourt: buildTightPoolQualityDeferUntilByCourt(liveRows, courtIdxs),
      rollingHorizon: mode === 'on' && count === 1,
      rollingPlanTarget: null,
    },
  })
}

// người RẢNH THẬT lúc refill (giống freeCount ở edge): không live, không opted-rest, không checked-out
function idlePlayers(state: SessionState, liveRows: SessionLiveMatchRow[]) {
  const liveIds = new Set<string>(
    liveRows.filter(r => r.status === 'live').flatMap(r => [...r.team_a, ...r.team_b]),
  )
  return [...state.players.values()].filter(
    p => p.checked_out_at === null && !p.opted_rest && !liveIds.has(p.player_id),
  )
}

// stall "restCap" = mọi người rảnh đều đã chơi dồn (consecutive_play cao) → engine bắt nghỉ (arguably ĐÚNG)
// stall "hard"    = còn người rảnh KHÔNG bị dồn mà vẫn 0 trận → nghi ngờ bug thật (cần đào)
type Stall = { round: number; courtIdx: number; idleFree: number; freshIdle: number; kind: 'restCap' | 'hard' }
const FRESH_CPLAY_MAX = 2 // "chưa dồn" = consecutive_play <= 2

function simulate(seed: string, sc: { n: number; courts: number }, mode: Mode): { stalls: Stall[]; refills: number } {
  const players = generatePlayers(
    { n_players: sc.n, pvna_distribution: 'bimodal', gender_ratio: 0.4, gender_pref_rate: 0.3, group_count: 0, group_size_range: [2, 4] },
    seedrandom(seed),
  )
  let state = initState(players, { courts: sc.courts, pvna_tolerance: 0.5 })
  const courts = sc.courts
  let liveRows: SessionLiveMatchRow[] = []
  let seq = 0
  const stalls: Stall[] = []
  let refills = 0

  const initial = suggest(state, liveRows, courts, courts, mode)
  initial.forEach(p => liveRows.push(asLiveRow(p, state.session_id, seq++, 0)))

  const order = Array.from({ length: courts }, (_, i) => i)
  const rng = seedrandom(`${seed}-order`)

  for (let round = 0; round < ROUNDS; round++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.quick() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    const batchIds = new Set<string>()

    for (let rank = 0; rank < courts; rank++) {
      const courtIdx = order[rank]
      const live = liveRows.find(r => r.status === 'live' && r.court_idx === courtIdx)
      if (!live) continue
      const completed: SessionLiveMatchRow = { ...live, status: 'completed', ended_at: new Date((seq + 1) * 1000).toISOString() }
      state = buildProjectedStateAfterLiveMatch(state, completed, completed.round_no ?? round)
      ;[...completed.team_a, ...completed.team_b].forEach(id => batchIds.add(id))
      liveRows = liveRows.filter(r => r.id !== live.id)

      // refill sân vừa trống (count=1) — đúng lúc rolling-lane hoạt động
      refills++
      const idle = idlePlayers(state, liveRows)
      const next = suggest(state, liveRows, 1, courts, mode, [courtIdx])
      if (next.length !== 1) {
        // 0 trận: chỉ tính "stall" nếu THẬT SỰ còn >=4 người rảnh
        if (idle.length >= 4) {
          const fresh = idle.filter(p => p.consecutive_play <= FRESH_CPLAY_MAX).length
          stalls.push({
            round: round + 1, courtIdx, idleFree: idle.length, freshIdle: fresh,
            kind: fresh >= 4 ? 'hard' : 'restCap',
          })
        }
        continue
      }
      liveRows.push(asLiveRow(next[0], state.session_id, seq++, round + 1))
    }
    state = { ...buildProjectedStateAfterCompletedLiveRound(state, batchIds), current_round: round + 1 }
  }
  return { stalls, refills }
}

const tally = (ss: Stall[]) => ({
  total: ss.length,
  hard: ss.filter(s => s.kind === 'hard').length,
  restCap: ss.filter(s => s.kind === 'restCap').length,
})

console.log('=== TEST rollingHorizon fix: phát hiện sân trống kẹt (0 trận dù >=4 người rảnh) ===')
console.log(`rounds=${ROUNDS} seeds=${SEEDS.length}`)
console.log('  hard    = còn >=4 người CHƯA dồn (cPlay<=2) mà vẫn 0 trận → NGHI BUG (logical-round kiểu 938b9bde)')
console.log('  restCap = mọi người rảnh đều đã chơi dồn (cPlay cao) → engine bắt nghỉ, arguably ĐÚNG\n')

let anyHard = false
for (const sc of SCENARIOS) {
  const off: Stall[] = [], on: Stall[] = []
  let offRefills = 0, onRefills = 0
  for (const seed of SEEDS) {
    const o = simulate(seed, sc, 'off'); const n = simulate(seed, sc, 'on')
    off.push(...o.stalls); on.push(...n.stalls); offRefills += o.refills; onRefills += n.refills
  }
  const o = tally(off), n = tally(on)
  if (n.hard > 0) anyHard = true
  console.log(`### ${sc.label}   (${offRefills} refill/mode)`)
  console.log(`   OFF (cũ):  hard ${o.hard}  restCap ${o.restCap}  (tổng ${o.total})`)
  console.log(`   ON  (fix): hard ${n.hard}  restCap ${n.restCap}  (tổng ${n.total})   ${n.hard === 0 ? '✅ hết hard-stall' : '❌ còn hard-stall'}`)
  console.log()
}

console.log('=== KẾT LUẬN ===')
console.log(`ON hard-stall giảm về ${anyHard ? '>0 — CẦN ĐÀO' : '0 ở mọi scenario ✅ (fix logical-round hiệu quả)'}`)
console.log('restCap-stall còn lại = engine giữ người mệt nghỉ; nếu muốn ưu tiên flow thì bàn riêng (đổi ngưỡng consecutive-play).')
process.exit(anyHard ? 1 : 0)
