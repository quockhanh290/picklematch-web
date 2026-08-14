// "Canary trên kèo lịch sử": dựng lại state THẬT của một kèo đã kết thúc từ DB, rồi bắn qua engine
// hai lần trên cùng input — cờ tắt và cờ bật — và so từng board.
//
// Vì sao không replay từ debug_dumps: dump đang ở mức `lite`, không mang khối state đầy đủ, nên
// partner_counts/opponent_counts phải suy ra từ bản rút gọn. Kết luận về lặp-3 sẽ sai mà vẫn trông
// hợp lệ. DB của kèo thì còn nguyên, và repo đã có sẵn đường dựng state mà `npm run diagnose` dùng.
//
// Vì sao đáng làm dù đã có corpus 60 phiên: corpus luôn bắt đầu từ bàn trắng và không có check-out
// giữa phiên — spec §10 tự ghi đó là giới hạn. Kèo thật có cả hai.
//
// Chạy: npx tsx scratch/p22-replay-real.ts <session_id>

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

type BoardStats = { courts: number; overTolCourts: number; overTolTotal: number; repeat3: number; intraOver: number }

function statsOf(payloads: SuggestedMatchPayload[], state: SessionState, tolerance: number): BoardStats {
  let overTolCourts = 0, overTolTotal = 0, repeat3 = 0, intraOver = 0
  for (const payload of payloads) {
    const over = getMatchPvnaGap(payload.team_a, payload.team_b, state) - tolerance
    if (over > 0) { overTolCourts += 1; overTolTotal += over }
    if (getPayloadProjectedMaxMeeting(payload, state) >= 3) repeat3 += 1
    intraOver += Math.max(0, getPayloadIntraTeamGap(payload, state) - 1.0)
  }
  return { courts: payloads.length, overTolCourts, overTolTotal, repeat3, intraOver }
}

async function main() {
  const sessionId = process.argv[2] ?? '2ef92e06-aa39-4709-9c68-0f1c7a7a9634'

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

  const courtCount = Number(settings[0]?.court_count_override ?? 6)
  const pvnaTolerance = Number(settings[0]?.pvna_tolerance ?? 0.5)
  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    pvna: row.effective_pvna ?? row.players?.pvna ?? row.pvna ?? 0,
    gender: row.players?.gender ?? row.gender ?? null,
  }))
  const stateRoundRows = buildCompletedLiveCycleRows({
    liveMatchRows: rawMatchRows,
    legacyRoundRows: roundRows.filter((r: any) => r.status !== 'active'),
    playerRows,
    sessionId,
    courtCount,
  })
  const fullState: SessionState = mapRowsToSessionState({
    sessionId, playerRows, pairRows, roundRows: stateRoundRows, courts: courtCount, pvnaTolerance,
  })

  const maxRound = fullState.rounds.length
  console.log(`kèo ${sessionId.slice(0, 8)} · ${courtCount} sân · tol ${pvnaTolerance} · ${fullState.players.size} người · ${maxRound} vòng hoàn tất\n`)

  const totals: Record<'off' | 'on', BoardStats & { ms: number }> = {
    off: { courts: 0, overTolCourts: 0, overTolTotal: 0, repeat3: 0, intraOver: 0, ms: 0 },
    on: { courts: 0, overTolCourts: 0, overTolTotal: 0, repeat3: 0, intraOver: 0, ms: 0 },
  }

  for (let round = 0; round < maxRound; round++) {
    // State ngay TRƯỚC vòng `round` — đúng thứ engine thấy khi được hỏi cho vòng đó.
    const stateBefore = rebuildStateThroughRound(fullState, round)
    for (const arm of ['off', 'on'] as const) {
      __setBoardOptimizerOverrideForTests(arm === 'on')
      const started = process.hrtime.bigint()
      const payloads = buildSuggestedMatchPayloads({
        count: courtCount,
        sessionId,
        courtCount,
        state: stateBefore,
        rows: { liveMatchRows: [], liveStateVersion: 0 },
        completingLiveMatchIds: new Set<string>(),
        fairnessAdjustment: correctForFairness(stateBefore),
        fairnessWarnings: detectFairnessIssues(stateBefore),
        playersById: new Map([...stateBefore.players.keys()].map(id => [id, { name: id }])) as never,
        pvnaTolerance,
        options: {
          courtIdxs: Array.from({ length: courtCount }, (_, i) => i),
          ignoreCapacityLock: true,
          rollingHorizon: false,
          rollingPlanTarget: null,
          blowoutRescue: true,
        },
      } as never) as SuggestedMatchPayload[]
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const stats = statsOf(payloads ?? [], stateBefore, pvnaTolerance)
      totals[arm].courts += stats.courts
      totals[arm].overTolCourts += stats.overTolCourts
      totals[arm].overTolTotal += stats.overTolTotal
      totals[arm].repeat3 += stats.repeat3
      totals[arm].intraOver += stats.intraOver
      totals[arm].ms += ms
    }
  }
  __setBoardOptimizerOverrideForTests(null)

  const row = (label: string, t: typeof totals.off) =>
    `${label.padEnd(10)} sân=${String(t.courts).padStart(3)}  vượt-tol=${String(t.overTolCourts).padStart(3)}` +
    `  tổng-vượt=${t.overTolTotal.toFixed(2).padStart(6)}  lặp3=${String(t.repeat3).padStart(3)}` +
    `  intra-vượt=${t.intraOver.toFixed(2).padStart(6)}  ${t.ms.toFixed(0)}ms`
  console.log(row('cờ TẮT', totals.off))
  console.log(row('cờ BẬT', totals.on))
}

main().catch(e => { console.error(e); process.exit(1) })
