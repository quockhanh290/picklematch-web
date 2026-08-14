// Replay N kèo thật gần nhất qua engine, hai nhánh cờ tắt / cờ bật, cùng input.
//
// Khác với corpus 60 phiên: state ở đây là state THẬT (có check-out giữa phiên, PVNA override,
// lịch sử gặp nhau thật), không phải sinh tổng hợp từ bàn trắng.
//
// Giới hạn phải nhớ khi đọc kết quả: vòng replay này lấp CẢ BÀN một lượt mỗi vòng, còn kèo thật là
// rolling (lấp từng sân khi có sân xong). Nên nó chưa chạm đúng đường mà repeatPool sống.
//
// Chạy: npx tsx scratch/p22-replay-many.ts [số kèo]

import fs from 'node:fs'
// @ts-ignore
import { mapRowsToSessionState } from '../lib/next-round-suggester/state.ts'
// @ts-ignore
import { rebuildStateThroughRound } from '../lib/next-round-suggester/history.ts'
// @ts-ignore
import { buildSuggestedMatchPayloads } from '../lib/next-round-suggester/live-preview.ts'
// @ts-ignore
import { __setBoardOptimizerOverrideForTests } from '../lib/next-round-suggester/board-optimizer-flag.ts'
// @ts-ignore
import { getMatchPvnaGap } from '../lib/next-round-suggester/state.ts'
// @ts-ignore
import { getPayloadIntraTeamGap, getPayloadProjectedMaxMeeting } from '../lib/next-round-suggester/board-metrics.ts'
import { buildCompletedLiveCycleRows } from '../features/host/session-detail/next-round-v2/live-cycle-rows'
// @ts-ignore
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector.ts'
// @ts-ignore
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector.ts'
// @ts-ignore
import type { SessionState, SuggestedMatchPayload } from '../lib/next-round-suggester/types.ts'

const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
const BASE = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
const KEY = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]

async function query<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(`${BASE}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error(`${table}: ${JSON.stringify(json).slice(0, 200)}`)
  return json as T[]
}

type Stats = { boards: number; overTolCourts: number; overTolTotal: number; repeat3: number; intraOver: number; ms: number }
const zero = (): Stats => ({ boards: 0, overTolCourts: 0, overTolTotal: 0, repeat3: 0, intraOver: 0, ms: 0 })

function tally(into: Stats, payloads: SuggestedMatchPayload[], state: SessionState, tolerance: number, ms: number) {
  for (const payload of payloads) {
    const over = getMatchPvnaGap(payload.team_a, payload.team_b, state) - tolerance
    if (over > 0) { into.overTolCourts += 1; into.overTolTotal += over }
    if (getPayloadProjectedMaxMeeting(payload, state) >= 3) into.repeat3 += 1
    into.intraOver += Math.max(0, getPayloadIntraTeamGap(payload, state) - 1.0)
  }
  into.boards += payloads.length
  into.ms += ms
}

async function replaySession(sessionId: string) {
  const [settings, rawPlayerRows, pairRows, roundRows, rawMatchRows] = await Promise.all([
    query<any>('session_next_round_settings', { session_id: `eq.${sessionId}`, select: '*' }),
    query<any>('session_player_state', {
      session_id: `eq.${sessionId}`,
      select: '*,players(pvna,elo,current_elo,gender,name,partner_gender_pref,opponent_gender_pref)',
    }),
    query<any>('session_pair_history', { session_id: `eq.${sessionId}`, select: '*' }),
    query<any>('session_rounds', { session_id: `eq.${sessionId}`, select: '*', order: 'round_no.asc' }),
    query<any>('session_live_matches', {
      session_id: `eq.${sessionId}`, select: '*', status: 'neq.cancelled', order: 'sequence_no.asc',
    }),
  ])
  if (rawPlayerRows.length < 8) return null

  const courtCount = Number(settings[0]?.court_count_override ?? Math.max(1, Math.floor(rawPlayerRows.length / 4)))
  const pvnaTolerance = Number(settings[0]?.pvna_tolerance ?? 0.5)
  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    pvna: row.effective_pvna ?? row.players?.pvna ?? row.pvna ?? 0,
    gender: row.players?.gender ?? row.gender ?? null,
  }))
  const stateRoundRows = buildCompletedLiveCycleRows({
    liveMatchRows: rawMatchRows,
    legacyRoundRows: roundRows.filter((r: any) => r.status !== 'active'),
    playerRows, sessionId, courtCount,
  })
  const fullState: SessionState = mapRowsToSessionState({
    sessionId, playerRows, pairRows, roundRows: stateRoundRows, courts: courtCount, pvnaTolerance,
  })
  const maxRound = fullState.rounds.length
  if (maxRound < 2) return null

  const off = zero(), on = zero()
  for (let round = 0; round < maxRound; round++) {
    const stateBefore = rebuildStateThroughRound(fullState, round)
    for (const arm of ['off', 'on'] as const) {
      __setBoardOptimizerOverrideForTests(arm === 'on')
      const started = process.hrtime.bigint()
      let payloads: SuggestedMatchPayload[] = []
      try {
        payloads = (buildSuggestedMatchPayloads({
          count: courtCount, sessionId, courtCount, state: stateBefore,
          rows: { liveMatchRows: [], liveStateVersion: 0 },
          completingLiveMatchIds: new Set<string>(),
          fairnessAdjustment: correctForFairness(stateBefore),
          fairnessWarnings: detectFairnessIssues(stateBefore),
          playersById: new Map([...stateBefore.players.keys()].map(id => [id, { name: id }])) as never,
          pvnaTolerance,
          options: {
            courtIdxs: Array.from({ length: courtCount }, (_, i) => i),
            ignoreCapacityLock: true, rollingHorizon: false, rollingPlanTarget: null, blowoutRescue: true,
          },
        } as never) ?? []) as SuggestedMatchPayload[]
      } catch { return null }
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      tally(arm === 'off' ? off : on, payloads, stateBefore, pvnaTolerance, ms)
    }
  }
  __setBoardOptimizerOverrideForTests(null)
  return { sessionId, players: fullState.players.size, courts: courtCount, rounds: maxRound, off, on }
}

async function main() {
  const wanted = Number(process.argv[2] ?? 30)
  // Phân trang chứ không tăng `limit`: PostgREST cắt âm thầm ở trần của nó, và đếm trên mẫu bị cắt
  // là đúng cái bẫy đã làm sai bảng thống kê lỗi hôm qua.
  const ids: string[] = []
  const PAGE = 1000
  for (let offset = 0; offset < 40_000 && ids.length < wanted; offset += PAGE) {
    const page = await query<any>('session_live_matches', {
      select: 'session_id,ended_at', status: 'eq.completed', order: 'ended_at.desc',
      limit: String(PAGE), offset: String(offset),
    })
    if (page.length === 0) break
    for (const row of page) {
      if (!ids.includes(row.session_id)) ids.push(row.session_id)
      if (ids.length >= wanted) break
    }
  }
  console.log(`replay ${ids.length} kèo gần nhất\n`)

  const totalOff = zero(), totalOn = zero()
  let used = 0
  for (const sessionId of ids) {
    const result = await replaySession(sessionId).catch(() => null)
    if (!result) { console.log(`${sessionId.slice(0, 8)}  (bỏ qua: không đủ dữ liệu)`); continue }
    used += 1
    for (const key of ['boards', 'overTolCourts', 'overTolTotal', 'repeat3', 'intraOver', 'ms'] as const) {
      totalOff[key] += result.off[key]
      totalOn[key] += result.on[key]
    }
    const delta = (a: number, b: number) => (b === a ? '=' : b < a ? `-${(a - b).toFixed(a % 1 ? 2 : 0)}` : `+${(b - a).toFixed(a % 1 ? 2 : 0)}`)
    console.log(
      `${result.sessionId.slice(0, 8)}  ${String(result.players).padStart(2)}ng/${result.courts}sân/${result.rounds}vòng` +
      `  board=${String(result.off.boards).padStart(3)}` +
      `  vượt-tol ${result.off.overTolCourts}->${result.on.overTolCourts} (${delta(result.off.overTolCourts, result.on.overTolCourts)})` +
      `  lặp3 ${result.off.repeat3}->${result.on.repeat3} (${delta(result.off.repeat3, result.on.repeat3)})` +
      `  intra ${result.off.intraOver.toFixed(1)}->${result.on.intraOver.toFixed(1)}`,
    )
  }

  const pct = (n: number, d: number) => d === 0 ? '0.00' : (n / d * 100).toFixed(2)
  console.log(`\n=== TỔNG ${used} kèo ===`)
  console.log(`board đo        : ${totalOff.boards}`)
  console.log(`vượt tolerance  : ${totalOff.overTolCourts} (${pct(totalOff.overTolCourts, totalOff.boards)}%) -> ${totalOn.overTolCourts} (${pct(totalOn.overTolCourts, totalOn.boards)}%)`)
  console.log(`tổng mức vượt   : ${totalOff.overTolTotal.toFixed(2)} -> ${totalOn.overTolTotal.toFixed(2)}`)
  console.log(`lặp-3           : ${totalOff.repeat3} (${pct(totalOff.repeat3, totalOff.boards)}%) -> ${totalOn.repeat3} (${pct(totalOn.repeat3, totalOn.boards)}%)`)
  console.log(`intra vượt trần : ${totalOff.intraOver.toFixed(2)} -> ${totalOn.intraOver.toFixed(2)}`)
  console.log(`thời gian       : ${(totalOff.ms / 1000).toFixed(1)}s -> ${(totalOn.ms / 1000).toFixed(1)}s`)
}

main().catch(e => { console.error(e); process.exit(1) })
