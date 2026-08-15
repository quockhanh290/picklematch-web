// Đo hướng (b): nếu can thiệp SỚM — ở tầng chọn ai ngồi chung sân, thay vì chỉ chia đội trong bộ tứ đã
// chốt — thì mua thêm được bao nhiêu ý-muốn-giới-tính, và trả bằng gì?
//
// Cách đo: giữ NGUYÊN tập người được ngồi mỗi vòng (không đụng luân phiên nghỉ, không đụng số trận), chỉ
// xếp lại họ vào sân và vào đội. So ba mức:
//   thực tế              — engine đang làm
//   xếp lại, GIỮ cân bằng — mọi đội intra ≤ 1.0 và mọi trận gap ≤ tolerance
//   xếp lại, BỎ cân bằng  — trần tuyệt đối, để biết mức trần ở đâu
//
// Thuật toán xếp lại là greedy + đổi-cặp, tức là cho ra CẬN DƯỚI: hướng (b) ít nhất được từng này.
import fs from 'node:fs'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads, type SuggestedMatchPayload } from '../lib/next-round-suggester/live-preview'
import { INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'
import type { PlayerSessionState, SessionLiveMatchRow, SessionState } from '../lib/next-round-suggester/types'

const FROZEN = 1_000_000
Date.now = () => FROZEN
if (typeof performance !== 'undefined') performance.now = () => FROZEN

const rd = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))
const gmap = (g: any) => g === 'female' ? 'F' : g === 'male' ? 'M' : null
const pmap = (p: any) => typeof p === 'string' && p.includes('female') ? 'F' : typeof p === 'string' && p.includes('male') ? 'M' : 'any'
const BASE_W = { pvna: 1, partner_repeat: 3, opponent_repeat: 1.5, group_bonus: 6, partner_gender_pref: 4, opponent_gender_pref: 2, consecutive_play: 4 }

const matches = rd('scratch/data/matches.json')
const roster = rd('scratch/data/roster2.json')
const settings: any[] = rd('scratch/data/settings.json')
const tolBySid: Record<string, number> = {}; for (const s of settings) tolBySid[s.sid] = Number(s.ptol) || 0.5
const mBySid: Record<string, any[]> = {}; for (const m of matches) (mBySid[m.sid] ??= []).push(m)
const rBySid: Record<string, any[]> = {}; for (const r of roster) (rBySid[r.sid] ??= []).push(r)

const NUM = Number(process.argv[2] || 20)
const ROUNDS = 8
const sids = Object.keys(mBySid)
  .filter(sid => (rBySid[sid] || []).length > 0 && !(rBySid[sid] || []).some(r => r.co != null))
  .sort()
  .slice(0, NUM)

function buildState(sid: string): { state: SessionState; courts: number } | null {
  const rost = rBySid[sid]; const ms = mBySid[sid]
  if (!rost || !ms) return null
  const courts = Math.max(...ms.map((m: any) => m.court_idx)) + 1
  const players: PlayerSessionState[] = rost.map((r: any) => ({
    player_id: r.pid, pvna: Number(r.pvna), gender: gmap(r.gender), group_id: r.group_id ?? null,
    partner_gender_pref: pmap(r.ppref), opponent_gender_pref: pmap(r.opref),
    checked_in_at: new Date('2026-05-15T12:00:00Z'), checked_out_at: null,
    matches_played: 0, last_played_round: -1, consecutive_play: 0, consecutive_rest: 0,
    partner_counts: new Map(), opponent_counts: new Map(), opted_rest: false, rounds_available: 0,
  })) as never
  return {
    state: {
      session_id: sid, current_round: 1, status: 'active',
      config: { courts, pvna_tolerance: tolBySid[sid] ?? 0.5, court_preset: 'balanced', weights: BASE_W, planned_total_rounds: 8, quality_cost_enabled: false },
      players: new Map(players.map(p => [p.player_id, p])), rounds: [],
    } as unknown as SessionState,
    courts,
  }
}

const suggest = (s: SessionState, courts: number) =>
  buildSuggestedMatchPayloads({
    count: courts, sessionId: s.session_id, courtCount: courts, state: s,
    rows: { liveMatchRows: [], liveStateVersion: 0 },
    completingLiveMatchIds: new Set(), fairnessAdjustment: correctForFairness(s),
    fairnessWarnings: detectFairnessIssues(s),
    playersById: new Map([...s.players.keys()].map(id => [id, { name: id }])) as never,
    pvnaTolerance: s.config.pvna_tolerance,
    options: { ignoreCapacityLock: true, rollingHorizon: false, rollingPlanTarget: null, blowoutRescue: true },
  } as never)

type P = {
  id: string; pvna: number; gender: string | null; want: string
  // Lịch sử ghép của chính người này. Thiếu nó thì leo dốc sẽ "mua" ý-muốn bằng cách đẻ ra lặp mà không
  // ai tính — đúng cái engine tốn phần lớn công sức để tránh.
  partners: ReadonlyMap<string, number>; opponents: ReadonlyMap<string, number>
}

const satisfiedBy = (self: P, mate: P) => self.want === 'any' ? 0 : (!mate.gender || mate.gender === self.want ? 1 : 0)
const pairScore = (a: P, b: P) => satisfiedBy(a, b) + satisfiedBy(b, a)
const demand = (p: P) => (p.want === 'any' ? 0 : 1)

// Greedy ghép cặp: ưu tiên cặp thoả được nhiều nhất, tie-break bằng lệch trình nhỏ nhất (để bước ghép
// sân sau còn đường sống). enforceIntra=false = bỏ giới hạn lệch trình trong đội.
function buildTeams(pool: P[], enforceIntra: boolean): [P, P][] {
  const remaining = new Set(pool.map(p => p.id))
  const byId = new Map(pool.map(p => [p.id, p]))
  const candidates: Array<{ a: string; b: string; score: number; gap: number }> = []
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const gap = Math.abs(pool[i].pvna - pool[j].pvna)
      if (enforceIntra && gap > INTRA_TEAM_PVNA_GAP_LIMIT) continue
      candidates.push({ a: pool[i].id, b: pool[j].id, score: pairScore(pool[i], pool[j]), gap })
    }
  }
  candidates.sort((x, y) => (y.score - x.score) || (x.gap - y.gap) || x.a.localeCompare(y.a))
  const teams: [P, P][] = []
  for (const c of candidates) {
    if (!remaining.has(c.a) || !remaining.has(c.b)) continue
    remaining.delete(c.a); remaining.delete(c.b)
    teams.push([byId.get(c.a)!, byId.get(c.b)!])
  }
  // ai còn lẻ thì ghép theo trình gần nhau
  const leftovers = [...remaining].map(id => byId.get(id)!).sort((a, b) => a.pvna - b.pvna)
  for (let i = 0; i + 1 < leftovers.length; i += 2) teams.push([leftovers[i], leftovers[i + 1]])
  return teams
}

// Ghép đội thành trận: xếp theo tổng trình rồi ghép hai đội liền kề — cách tối thiểu hoá chênh đội.
function pairTeamsIntoMatches(teams: [P, P][]) {
  const sorted = [...teams].sort((x, y) => (x[0].pvna + x[1].pvna) - (y[0].pvna + y[1].pvna))
  const out: Array<[[P, P], [P, P]]> = []
  for (let i = 0; i + 1 < sorted.length; i += 2) out.push([sorted[i], sorted[i + 1]])
  return out
}

// Leo dốc từ CHÍNH bàn engine đã chọn: đổi chỗ hai người (cùng sân hoặc khác sân), chỉ nhận nước đi nào
// tăng ý-muốn mà KHÔNG làm xấu đi cả hai thước cân bằng (số trận vượt tol, số đội vượt intra). Đây mới là
// "hướng (b) ở mức cân bằng không đổi" — khác hẳn xếp lại tự do ở trên.
type Board = Array<[[P, P], [P, P]]>
const boardStats = (board: Board, tol: number) => {
  let sat = 0, over = 0, intraOver = 0, repeats = 0, repeat3 = 0
  for (const [ta, tb] of board) {
    sat += pairScore(ta[0], ta[1]) + pairScore(tb[0], tb[1])
    if (Math.abs(ta[0].pvna + ta[1].pvna - tb[0].pvna - tb[1].pvna) > tol) over += 1
    if (Math.abs(ta[0].pvna - ta[1].pvna) > INTRA_TEAM_PVNA_GAP_LIMIT) intraOver += 1
    if (Math.abs(tb[0].pvna - tb[1].pvna) > INTRA_TEAM_PVNA_GAP_LIMIT) intraOver += 1
    for (const [x, y] of [[ta[0], ta[1]], [tb[0], tb[1]]] as const) {
      const n = x.partners.get(y.id) ?? 0
      repeats += n
      if (n + 1 >= 3) repeat3 += 1
    }
    for (const x of ta) for (const y of tb) {
      const n = x.opponents.get(y.id) ?? 0
      repeats += n
      if (n + 1 >= 3) repeat3 += 1
    }
  }
  return { sat, over, intraOver, repeats, repeat3 }
}
const cloneBoard = (b: Board): Board => b.map(([ta, tb]) => [[ta[0], ta[1]], [tb[0], tb[1]]])
function hillClimbGender(start: Board, tol: number): Board {
  let board = cloneBoard(start)
  let best = boardStats(board, tol)
  const slots: Array<[number, number, number]> = []
  for (let m = 0; m < board.length; m += 1) for (const t of [0, 1]) for (const k of [0, 1]) slots.push([m, t, k])
  for (let pass = 0; pass < 6; pass += 1) {
    let improved = false
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const [m1, t1, k1] = slots[i]; const [m2, t2, k2] = slots[j]
        const cand = cloneBoard(board)
        const tmp = cand[m1][t1][k1]; cand[m1][t1][k1] = cand[m2][t2][k2]; cand[m2][t2][k2] = tmp
        const st = boardStats(cand, tol)
        if (
          st.sat > best.sat && st.over <= best.over && st.intraOver <= best.intraOver
          && st.repeats <= best.repeats && st.repeat3 <= best.repeat3
        ) {
          board = cand; best = st; improved = true
        }
      }
    }
    if (!improved) break
  }
  return board
}

let actualSat = 0, actualChecked = 0, actualOverTol = 0, actualMatches = 0
let keepSat = 0, keepOverTol = 0
let freeSat = 0, freeOverTol = 0
let climbSat = 0, climbOverTol = 0, climbIntraOver = 0, actualIntraOver = 0
let climbRepeats = 0, actualRepeats = 0, climbRepeat3 = 0, actualRepeat3 = 0

for (const sid of sids) {
  const built = buildState(sid); if (!built) continue
  let { state } = built
  const { courts } = built
  const tol = state.config.pvna_tolerance

  for (let round = 1; round <= ROUNDS; round += 1) {
    const payloads: SuggestedMatchPayload[] = suggest(state, courts)
    if (payloads.length === 0) break

    const asP = (id: string): P => {
      const p = state.players.get(String(id))!
      return {
        id: String(id), pvna: p.pvna, gender: p.gender as never, want: p.partner_gender_pref as never,
        partners: p.partner_counts, opponents: p.opponent_counts,
      }
    }
    const seated = payloads.flatMap(p => [...p.team_a, ...p.team_b]).map(asP)

    for (const p of payloads) {
      const [a0, a1] = p.team_a.map(asP); const [b0, b1] = p.team_b.map(asP)
      actualChecked += demand(a0) + demand(a1) + demand(b0) + demand(b1)
      actualSat += pairScore(a0, a1) + pairScore(b0, b1)
      actualMatches += 1
      if (Math.abs(a0.pvna + a1.pvna - b0.pvna - b1.pvna) > tol) actualOverTol += 1
    }

    {
      const startBoard: Board = payloads.map(p => {
        const [a0, a1] = p.team_a.map(asP); const [b0, b1] = p.team_b.map(asP)
        return [[a0, a1], [b0, b1]] as [[P, P], [P, P]]
      })
      const before = boardStats(startBoard, tol)
      actualIntraOver += before.intraOver; actualRepeats += before.repeats; actualRepeat3 += before.repeat3
      const after = boardStats(hillClimbGender(startBoard, tol), tol)
      climbSat += after.sat; climbOverTol += after.over; climbIntraOver += after.intraOver
      climbRepeats += after.repeats; climbRepeat3 += after.repeat3
    }

    for (const [label, enforceIntra] of [['keep', true], ['free', false]] as const) {
      const teams = buildTeams(seated, enforceIntra)
      const sat = teams.reduce((sum, [a, b]) => sum + pairScore(a, b), 0)
      let over = 0
      for (const [ta, tb] of pairTeamsIntoMatches(teams)) {
        if (Math.abs(ta[0].pvna + ta[1].pvna - tb[0].pvna - tb[1].pvna) > tol) over += 1
      }
      if (label === 'keep') { keepSat += sat; keepOverTol += over } else { freeSat += sat; freeOverTol += over }
    }

    // tiến state y như engine đã tiến: seat rồi cập nhật lịch sử
    const players = new Map(state.players)
    const seatedIds = new Set(seated.map(p => p.id))
    for (const [id, player] of players) {
      const isSeated = seatedIds.has(id)
      players.set(id, {
        ...player,
        matches_played: player.matches_played + (isSeated ? 1 : 0),
        last_played_round: isSeated ? round : player.last_played_round,
        consecutive_play: isSeated ? player.consecutive_play + 1 : 0,
        consecutive_rest: isSeated ? 0 : player.consecutive_rest + 1,
      })
    }
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
    for (const p of payloads) {
      for (const team of [p.team_a, p.team_b]) {
        const [a, b] = team.map(String)
        const pa = players.get(a)!; const pb = players.get(b)!
        const ca = new Map(pa.partner_counts); bump(ca, b)
        const cb = new Map(pb.partner_counts); bump(cb, a)
        players.set(a, { ...pa, partner_counts: ca }); players.set(b, { ...pb, partner_counts: cb })
      }
      for (const a of p.team_a.map(String)) for (const b of p.team_b.map(String)) {
        const pa = players.get(a)!; const pb = players.get(b)!
        const ca = new Map(pa.opponent_counts); bump(ca, b)
        const cb = new Map(pb.opponent_counts); bump(cb, a)
        players.set(a, { ...pa, opponent_counts: ca }); players.set(b, { ...pb, opponent_counts: cb })
      }
    }
    state = { ...state, players, current_round: round + 1 } as never
  }
}

const pct = (n: number) => `${(100 * n / Math.max(1, actualChecked)).toFixed(2)}%`
const overPct = (n: number) => `${(100 * n / Math.max(1, actualMatches)).toFixed(2)}%`
console.log(`${sids.length} kèo · ${actualMatches} trận · ${actualChecked} lượt kiểm ý muốn`)
console.log('')
console.log(`thực tế (engine)                   thoả ${pct(actualSat)}  vượt-tol ${overPct(actualOverTol)}  intra ${actualIntraOver}  lặp ${actualRepeats}  lặp-3 ${actualRepeat3}`)
console.log(`(b) đổi chỗ, KHÔNG xấu đi thứ nào  thoả ${pct(climbSat)}  vượt-tol ${overPct(climbOverTol)}  intra ${climbIntraOver}  lặp ${climbRepeats}  lặp-3 ${climbRepeat3}`)
console.log(`(b) xếp lại, GIỮ giới hạn lệch    thoả ${pct(keepSat)}   vượt-tol ${overPct(keepOverTol)}`)
console.log(`(b) xếp lại, BỎ mọi giới hạn      thoả ${pct(freeSat)}   vượt-tol ${overPct(freeOverTol)}`)
console.log('')
console.log('greedy = CẬN DƯỚI: hướng (b) ít nhất được từng này, có thể hơn nếu tối ưu tử tế.')
