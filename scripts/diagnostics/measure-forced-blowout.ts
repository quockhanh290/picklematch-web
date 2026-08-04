/**
 * Đo tần suất blowout sau fix chọn-người (anchor+nearest-skill).
 * Mô phỏng session staggered qua ĐÚNG code path live (buildSuggestedMatchPayloads), mỗi refill
 * ghi chênh-đội của trận được seat. Phân loại blowout (chênh > BLOWOUT_GAP):
 *   - FORCED  = pool rảnh lúc đó KHÔNG có cụm 4 người sát trình (spread <= TIGHT_SPREAD)
 *               → bimodal mới cứu được.
 *   - AVOIDABLE= pool CÓ cụm 4 sát trình mà vẫn seat blowout → còn lỗi chọn/ghép (bimodal ko liên quan).
 *
 * Chạy: npx tsx scripts/diagnostics/measure-forced-blowout.ts [numSeeds]
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
import { getEffectivePvna } from '../../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionState } from '../../lib/next-round-suggester/types'

const _w = console.warn
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('live round projection drift monitor')) return
  _w(...a)
}

const ROUNDS = 9
const BLOWOUT_GAP = 1.5   // ngưỡng engine gắn nhãn lệch trình
const TIGHT_SPREAD = 1.0  // 4 người "cùng tầm" nếu max-min pvna <= 1.0 (ghép được không gánh)
const SEEDS = Array.from({ length: process.argv[2] ? Number(process.argv[2]) : 6 }, (_, i) => `s${i + 1}`)
const SCENARIOS = [
  { label: '24p/5c', n: 24, courts: 5 },
  { label: '28p/6c', n: 28, courts: 6 },
  { label: '30p/6c', n: 30, courts: 6 },
  { label: '32p/6c', n: 32, courts: 6 },
]
// bimodal = phân bố trình rộng nhất (nhiều người cao + nhiều người thấp) = case ép pool-lệch khắc nghiệt nhất
const DISTS: Array<'bimodal' | 'tight'> = ['bimodal', 'tight']

function asLiveRow(p: SuggestedMatchPayload, sid: string, seq: number, r: number): SessionLiveMatchRow {
  const ts = new Date(seq * 1000).toISOString()
  return {
    id: `o-${seq}`, session_id: sid, sequence_no: seq, round_no: r, cycle_no: r, court_idx: p.court_idx,
    status: 'live', team_a: p.team_a, team_b: p.team_b, resting: p.resting, score_a: 0, score_b: 0,
    suggested_at: ts, started_at: ts, ended_at: null,
  }
}
function suggest(state: SessionState, rows: SessionLiveMatchRow[], count: number, courts: number, ci?: number[]) {
  return buildSuggestedMatchPayloads({
    count, sessionId: state.session_id, courtCount: courts, state,
    rows: { liveMatchRows: rows, liveStateVersion: rows.length }, completingLiveMatchIds: new Set(),
    fairnessAdjustment: correctForFairness(state), fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never, pvnaTolerance: 0.5,
    options: {
      courtIdxs: ci, ignoreCapacityLock: true, deferExtremeTightPool: true, blowoutRescue: true,
      tightPoolQualityDeferUntilByCourt: buildTightPoolQualityDeferUntilByCourt(rows, ci),
      rollingHorizon: count === 1, rollingPlanTarget: null,
    },
  })
}
const pv = (state: SessionState, id: string) => { const p = state.players.get(id); return p ? getEffectivePvna(p) : 0 }
function idlePvnas(state: SessionState, rows: SessionLiveMatchRow[]): number[] {
  const live = new Set(rows.filter(r => r.status === 'live').flatMap(r => [...r.team_a, ...r.team_b]))
  return [...state.players.values()]
    .filter(p => p.checked_out_at === null && !p.opted_rest && !live.has(p.player_id))
    .map(p => getEffectivePvna(p)).sort((a, b) => a - b)
}
// pool có cụm 4 người sát trình (spread<=TIGHT_SPREAD)?
function hasTightFour(sortedPvnas: number[]): boolean {
  for (let i = 0; i + 4 <= sortedPvnas.length; i++) {
    if (sortedPvnas[i + 3] - sortedPvnas[i] <= TIGHT_SPREAD) return true
  }
  return false
}

type Agg = { refills: number; blowouts: number; forced: number; avoidable: number }

function simulate(seed: string, sc: { n: number; courts: number }, dist: 'bimodal' | 'uniform', agg: Agg) {
  const players = generatePlayers({ n_players: sc.n, pvna_distribution: dist, gender_ratio: 0.4, gender_pref_rate: 0.3, group_count: 0, group_size_range: [2, 4] } as any, seedrandom(seed))
  let state = initState(players, { courts: sc.courts, pvna_tolerance: 0.5 })
  const courts = sc.courts
  let rows: SessionLiveMatchRow[] = []
  let seq = 0
  suggest(state, rows, courts, courts).forEach(p => rows.push(asLiveRow(p, state.session_id, seq++, 0)))
  const order = Array.from({ length: courts }, (_, i) => i)
  const rng = seedrandom(`${seed}-ord`)
  for (let round = 0; round < ROUNDS; round++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.quick() * (i + 1));[order[i], order[j]] = [order[j], order[i]] }
    const bids = new Set<string>()
    for (let rank = 0; rank < courts; rank++) {
      const ci = order[rank]
      const live = rows.find(r => r.status === 'live' && r.court_idx === ci)
      if (!live) continue
      const comp: SessionLiveMatchRow = { ...live, status: 'completed', ended_at: new Date((seq + 1) * 1000).toISOString() }
      state = buildProjectedStateAfterLiveMatch(state, comp, comp.round_no ?? round)
      ;[...comp.team_a, ...comp.team_b].forEach(id => bids.add(id))
      rows = rows.filter(r => r.id !== live.id)
      const poolSorted = idlePvnas(state, rows)
      const tightAvail = hasTightFour(poolSorted)
      const nx = suggest(state, rows, 1, courts, [ci])
      if (nx.length !== 1) continue
      const m = nx[0]
      agg.refills++
      const gap = Math.abs(pv(state, m.team_a[0]) + pv(state, m.team_a[1]) - pv(state, m.team_b[0]) - pv(state, m.team_b[1]))
      if (gap > BLOWOUT_GAP) {
        agg.blowouts++
        if (tightAvail) agg.avoidable++; else agg.forced++
      }
      rows.push(asLiveRow(m, state.session_id, seq++, round + 1))
    }
    state = { ...buildProjectedStateAfterCompletedLiveRound(state, bids), current_round: round + 1 }
  }
}

console.log(`=== Đo blowout sau fix chọn-người (chênh > ${BLOWOUT_GAP}) ===`)
console.log(`seeds=${SEEDS.length}  rounds=${ROUNDS}  TIGHT_SPREAD=${TIGHT_SPREAD}`)
console.log(`FORCED = pool KHÔNG có cụm 4 sát trình (bimodal mới cứu) | AVOIDABLE = có cụm mà vẫn blowout (lỗi khác)\n`)

for (const dist of DISTS) {
  console.log(`--- phân bố trình: ${dist} ---`)
  for (const sc of SCENARIOS) {
    const agg: Agg = { refills: 0, blowouts: 0, forced: 0, avoidable: 0 }
    for (const seed of SEEDS) simulate(seed, sc, dist, agg)
    const pct = (x: number) => agg.refills ? (x / agg.refills * 100).toFixed(1) + '%' : '0%'
    console.log(`  ${sc.label.padEnd(8)} refills=${String(agg.refills).padStart(4)}  blowout=${String(agg.blowouts).padStart(3)} (${pct(agg.blowouts)})  → FORCED ${agg.forced} (${pct(agg.forced)})  AVOIDABLE ${agg.avoidable} (${pct(agg.avoidable)})`)
  }
}
console.log('\n=== Đọc: FORCED cao → bimodal đáng làm. AVOIDABLE > 0 → còn lỗi chọn/ghép cần xem. Cả hai ~0 → không cần đụng scoring. ===')
