/**
 * Kiểm tra chất lượng suggest cho từng sân trong session.
 * Simulate ĐÚNG như UI: dùng pickGuardedLiveAlternative để pick alternative.
 * So sánh alternative được pick với tất cả alternatives khác cùng pool.
 *
 * Chạy: npx tsx scripts/check-suggest-quality.ts [session_id] [court_count=6]
 */
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import {
  pickGuardedLiveAlternative,
  getAlternativeIntraTeamGap,
  getAlternativePvnaGap,
  getAlternativeRepeatMetrics,
  getProjectedCountViolation,
  getProjectedTargetRangeAfter,
  buildLiveSelectionGuard,
} from '../lib/next-round-suggester/live-preview'
import {
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  INTRA_TEAM_PVNA_GAP_LIMIT,
} from '../lib/next-round-suggester/score'
import type { SuggestionAlternative, SessionState } from '../lib/next-round-suggester/types'

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'

async function query(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`Query ${table} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// Weights from pickGuardedLiveAlternative (early round / 'current' policy)
const PVNA_OVER_W = 90
const INTRA_OVER_W = 12
const REPEAT_OVER_W = 55
const REPEAT_AFFECTED_W = 8
const QUOTA_OVER_W = 35
const QUOTA_UNDER_W = 5
const TRADEOFF_W = 20

type AltMetrics = {
  pvnaGap: number
  intraGap: number
  pvnaOver: number
  intraOver: number
  isClean: boolean        // intra <= PREFERRED (0.75)
  isHardOk: boolean       // intra <= HARD (1.0)
  quota: { over: number; under: number; total: number }
  repeatOver: number
  repeatAffected: number
  warnings: string[]
  tradeoffCount: number
  // Guarded score (same formula as pickGuardedLiveAlternative, excluding minor 'recent' cost)
  guardedScore: number
}

function computeAltMetrics(
  alt: SuggestionAlternative,
  state: SessionState,
  nextMatchIndex: number,
  pvnaTolerance: number,
): AltMetrics {
  const pvnaGap = getAlternativePvnaGap(alt)
  const intraGap = getAlternativeIntraTeamGap(alt, state)
  const { min: targetMin, max: targetMax } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const quota = getProjectedCountViolation(alt, state, targetMax, targetMin)
  const repeat = getAlternativeRepeatMetrics(alt, state)
  const pvnaOver = Math.max(0, pvnaGap - pvnaTolerance)
  const intraOver = Math.max(0, intraGap - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
  const tradeoffCount = alt.tradeoffs?.length ?? 0
  // Mirrors pickGuardedLiveAlternative scoring (recent cost omitted — minor, ~0.9×)
  const guardedScore =
    pvnaOver * PVNA_OVER_W +
    intraOver * INTRA_OVER_W +
    repeat.repeat_over_by * REPEAT_OVER_W +
    repeat.affected_players * REPEAT_AFFECTED_W +
    quota.over * QUOTA_OVER_W +
    quota.under * QUOTA_UNDER_W +
    tradeoffCount * TRADEOFF_W
  return {
    pvnaGap,
    intraGap,
    pvnaOver,
    intraOver,
    isClean: intraGap <= PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
    isHardOk: intraGap <= INTRA_TEAM_PVNA_GAP_LIMIT,
    quota,
    repeatOver: repeat.repeat_over_by,
    repeatAffected: repeat.affected_players,
    warnings: alt.warnings ?? [],
    tradeoffCount,
    guardedScore,
  }
}

function pvnaLabel(playerIds: string[], state: SessionState) {
  return playerIds.map(id => {
    const p = state.players.get(id)
    return p ? p.pvna.toFixed(2) : '?'
  }).join('+')
}

function altLabel(alt: SuggestionAlternative, state: SessionState) {
  const m = alt.matches[0]
  if (!m) return '(no match)'
  return `[${pvnaLabel(m.team_a, state)}] vs [${pvnaLabel(m.team_b, state)}]`
}

async function main() {
  const argSessionId = process.argv[2]
  const argCourtCount = parseInt(process.argv[3] ?? '6', 10)

  if (!argSessionId) {
    console.error('Usage: npx tsx scripts/check-suggest-quality.ts <session_id> [court_count=6]')
    process.exit(1)
  }

  console.log(`\n=== SUGGEST QUALITY CHECK (v2) ===`)
  console.log(`Session: ${argSessionId}`)
  console.log(`Court count: ${argCourtCount}`)
  console.log()

  const [rawPlayerRows, pairRows, legacyRoundRows, liveMatchRows] = await Promise.all([
    query('session_player_state', {
      session_id: `eq.${argSessionId}`,
      select: '*,players(pvna,elo,current_elo,gender,name)',
    }),
    query('session_pair_history', { session_id: `eq.${argSessionId}`, select: '*' }),
    query('session_rounds', { session_id: `eq.${argSessionId}`, select: '*', order: 'round_no.asc' }),
    query('session_live_matches', {
      session_id: `eq.${argSessionId}`,
      select: '*',
      status: 'neq.cancelled',
    }),
  ])

  const nameMap = new Map<string, string>((rawPlayerRows as any[]).map((r: any) => [r.player_id, r.players?.name ?? r.player_id]))

  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    players: {
      pvna: row.effective_pvna ?? row.players?.pvna ?? null,
      elo: row.players?.elo ?? row.players?.current_elo ?? null,
      gender: row.players?.gender ?? null,
    },
  }))

  // Build virtual round rows từ completed live matches — giống hệt buildCompletedLiveCycleRows trong UI
  const baseRoundNo = (legacyRoundRows as any[]).reduce((max: number, r: any) => Math.max(max, r.round_no), -1) + 1
  const presentPlayerIds = (rawPlayerRows as any[])
    .filter((p: any) => !p.checked_out_at)
    .map((p: any) => p.player_id)
  const completedLive = (liveMatchRows as any[])
    .filter((m: any) => m.status === 'completed')
    .sort((a: any, b: any) => a.sequence_no !== b.sequence_no ? a.sequence_no - b.sequence_no : (a.court_idx ?? 0) - (b.court_idx ?? 0))

  const virtualRoundRows: any[] = []
  const hasReliableRoundNo = completedLive.length === 0 || completedLive.every((m: any) => m.round_no != null)

  if (hasReliableRoundNo && completedLive.length > 0) {
    const byRound = new Map<number, any[]>()
    for (const match of completedLive) {
      const roundNo = Number(match.round_no)
      const rows = byRound.get(roundNo) ?? []
      rows.push(match)
      byRound.set(roundNo, rows)
    }
    for (const [roundNo, matches] of [...byRound.entries()].sort(([a], [b]) => a - b)) {
      if (matches.length < argCourtCount) continue  // partial round — skip
      const playedIds = new Set(matches.flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])]))
      virtualRoundRows.push({
        id: matches[0].id,
        session_id: argSessionId,
        round_no: baseRoundNo + roundNo,
        status: 'completed',
        matches: matches.map((m: any) => ({ court_idx: m.court_idx ?? 0, team_a: m.team_a, team_b: m.team_b })),
        resting: presentPlayerIds.filter((id: string) => !playedIds.has(id)),
        started_at: null,
        ended_at: null,
      })
    }
  } else {
    for (let i = 0; i + argCourtCount <= completedLive.length; i += argCourtCount) {
      const matches = completedLive.slice(i, i + argCourtCount)
      const playedIds = new Set(matches.flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])]))
      virtualRoundRows.push({
        id: matches[0].id,
        session_id: argSessionId,
        round_no: baseRoundNo + virtualRoundRows.length,
        status: 'completed',
        matches: matches.map((m: any) => ({ court_idx: m.court_idx ?? 0, team_a: m.team_a, team_b: m.team_b })),
        resting: presentPlayerIds.filter((id: string) => !playedIds.has(id)),
        started_at: null,
        ended_at: null,
      })
    }
  }

  const roundRows = [...(legacyRoundRows as any[]), ...virtualRoundRows]

  const existingMatchCount = (liveMatchRows as any[]).filter(
    (m: any) => m.status === 'completed' || m.status === 'live',
  ).length

  console.log(`Data: ${playerRows.length} players, ${pairRows.length} pairs, ${(legacyRoundRows as any[]).length} db_rounds + ${virtualRoundRows.length} virtual_rounds, ${liveMatchRows.length} live matches`)
  console.log(`Existing countable matches: ${existingMatchCount}`)
  console.log()

  const state = mapRowsToSessionState({
    sessionId: argSessionId,
    playerRows,
    pairRows,
    roundRows,
    courts: argCourtCount,
    pvnaTolerance: 0.5,
  })

  const pvnaTolerance = state.config.pvna_tolerance ?? 0.5

  // Busy từ live (đang đánh) và suggested (đã confirm)
  const globalBusyIds = new Set<string>()
  for (const m of liveMatchRows as any[]) {
    if (m.status === 'live' || m.status === 'suggested') {
      if (m.team_a) for (const id of m.team_a) globalBusyIds.add(id)
      if (m.team_b) for (const id of m.team_b) globalBusyIds.add(id)
    }
  }
  console.log(`Global busy (live/suggested): ${globalBusyIds.size}`)

  // Print live match details
  const liveMatches = (liveMatchRows as any[]).filter((m: any) => m.status === 'live' || m.status === 'suggested')
  if (liveMatches.length > 0) {
    const fmt = (ids: string[]) => (ids ?? []).map((id: string) => {
      const p = state.players.get(id)
      return `${nameMap.get(id) ?? id}(${p?.pvna?.toFixed(2) ?? '?'})`
    }).join(' + ')
    console.log(`Live courts (round_no = 0-indexed):`)
    for (const m of liveMatches.sort((a: any, b: any) => (a.court_idx ?? 0) - (b.court_idx ?? 0))) {
      console.log(`  Sân ${(m.court_idx ?? 0) + 1} [round ${m.round_no}]: ${fmt(m.team_a)} vs ${fmt(m.team_b)}`)
    }
  }
  console.log()

  // ===== SIMULATE COURTS SEQUENTIALLY =====
  const sequentialBusyIds = new Set(globalBusyIds)
  let optimalCount = 0
  let tradeoffCount = 0
  let suboptimalCount = 0
  let noMatchCount = 0

  for (let courtIdx = 0; courtIdx < argCourtCount; courtIdx++) {
    const eligible = [...state.players.values()].filter(p =>
      p.checked_out_at === null && !p.opted_rest && !sequentialBusyIds.has(p.player_id)
    )

    const courtLabel = `Sân ${courtIdx + 1}`

    if (eligible.length < 4) {
      console.log(`${courtLabel}: chỉ ${eligible.length} eligible — bỏ qua`)
      noMatchCount++
      continue
    }

    // nextMatchIndex: simulates how many matches have been "placed" before this court
    const nextMatchIndex = existingMatchCount + courtIdx + 1

    // Replicate UI: buildLiveSelectionGuard adds quota-protected players to busyIds
    // (players who played >= target.max matches are blocked, not just lower priority)
    const courtBusyIds = new Set(sequentialBusyIds)
    const guard = buildLiveSelectionGuard({ state, busyIds: new Set(courtBusyIds), nextMatchIndex })
    guard.protectedIds.forEach(id => courtBusyIds.add(id))

    const guardedEligible = [...state.players.values()].filter(p =>
      p.checked_out_at === null && !p.opted_rest && !courtBusyIds.has(p.player_id)
    )

    // Chạy suggest với max_alternatives lớn để có nhiều lựa chọn
    const result = suggestNextMatch(state, {
      busy_player_ids: [...courtBusyIds],
      court_idx: courtIdx,
      max_alternatives: 80,
    })

    const allAlts = result.alternatives
    if (allAlts.length === 0) {
      console.log(`${courtLabel}: không có alternative — NO MATCH`)
      noMatchCount++
      continue
    }

    // Dùng pickGuardedLiveAlternative để chọn đúng như UI
    const picked = pickGuardedLiveAlternative(allAlts, state, pvnaTolerance, nextMatchIndex)
    if (!picked || !picked.matches[0]) {
      console.log(`${courtLabel}: pickGuardedLiveAlternative trả về null — NO MATCH`)
      noMatchCount++
      continue
    }

    // Mark busy cho court tiếp theo
    for (const id of [...picked.matches[0].team_a, ...picked.matches[0].team_b]) {
      sequentialBusyIds.add(id)
    }

    const pickedMetrics = computeAltMetrics(picked, state, nextMatchIndex, pvnaTolerance)

    // Tính metrics + guardedScore cho tất cả alternatives
    const allWithMetrics = allAlts.map(alt => ({
      alt,
      metrics: computeAltMetrics(alt, state, nextMatchIndex, pvnaTolerance),
    }))

    // ===== VERDICT LOGIC =====
    // 1. SUBOPTIMAL: có alt khác có guardedScore THẤP HƠN picked — pickGuarded đã chọn sai
    // 2. TRADEOFF: picked là best by guardedScore nhưng intra > PREFERRED; clean alt tồn tại
    //    với guardedScore cao hơn (pvna cost > intra savings) — intentional
    // 3. OPTIMAL: picked là best by guardedScore VÀ (clean hoặc không có clean alt nào)

    const betterByScore = allWithMetrics
      .filter(({ alt, metrics }) => alt !== picked && metrics.guardedScore < pickedMetrics.guardedScore - 0.01)

    const bestCleanAlt = allWithMetrics
      .filter(({ alt, metrics }) => alt !== picked && metrics.isClean)
      .sort((a, b) => a.metrics.guardedScore - b.metrics.guardedScore)[0]

    const bestHardOkAlt = allWithMetrics
      .filter(({ alt, metrics }) => alt !== picked && metrics.isHardOk)
      .sort((a, b) => a.metrics.guardedScore - b.metrics.guardedScore)[0]

    let verdict: 'OPTIMAL' | 'SUBOPTIMAL' | 'TRADEOFF'
    let verdictDetail = ''

    if (betterByScore.length > 0) {
      // pickGuardedLiveAlternative đã bỏ qua alt có score thấp hơn — genuine bug
      const best = betterByScore.sort((a, b) => a.metrics.guardedScore - b.metrics.guardedScore)[0]
      verdict = 'SUBOPTIMAL'
      verdictDetail = `có alt score thấp hơn (${best.metrics.guardedScore.toFixed(1)} vs ${pickedMetrics.guardedScore.toFixed(1)}): intra=${best.metrics.intraGap.toFixed(2)}, pvna=${best.metrics.pvnaGap.toFixed(2)}`
    } else if (pickedMetrics.isClean) {
      verdict = 'OPTIMAL'
    } else if (bestCleanAlt) {
      // Picked tốt nhất theo guarded score, nhưng có clean alt tốn nhiều pvna hơn
      const scoreDelta = bestCleanAlt.metrics.guardedScore - pickedMetrics.guardedScore
      verdict = 'TRADEOFF'
      verdictDetail = `clean alt có guardedScore cao hơn +${scoreDelta.toFixed(1)} (pvna ${bestCleanAlt.metrics.pvnaGap.toFixed(2)} vs ${pickedMetrics.pvnaGap.toFixed(2)}) — algorithm đúng, pool bị giới hạn`
    } else if (!pickedMetrics.isHardOk && bestHardOkAlt) {
      // Không clean, không có clean alt, nhưng có hard-ok alt với score thấp hơn
      const scoreDelta = bestHardOkAlt.metrics.guardedScore - pickedMetrics.guardedScore
      if (scoreDelta >= 0) {
        verdict = 'TRADEOFF'
        verdictDetail = `hard-ok alt (intra=${bestHardOkAlt.metrics.intraGap.toFixed(2)}) có score cao hơn +${scoreDelta.toFixed(1)} — picked là best by score`
      } else {
        // Không nên xảy ra (đã check betterByScore ở trên)
        verdict = 'SUBOPTIMAL'
        verdictDetail = `hard-ok alt có score thấp hơn (lỗi logic)`
      }
    } else {
      verdict = 'OPTIMAL'
    }

    // ===== PRINT =====
    const verdictTag = verdict === 'OPTIMAL' ? '✅ OPTIMAL' : verdict === 'SUBOPTIMAL' ? '❌ SUBOPTIMAL' : '⚠️  TRADEOFF'
    const intraTag = pickedMetrics.isClean ? '✓ CLEAN' : pickedMetrics.isHardOk ? `⚠ ${pickedMetrics.intraGap.toFixed(2)}>pref` : `❌ ${pickedMetrics.intraGap.toFixed(2)}>HARD`

    if (verdict === 'OPTIMAL') optimalCount++
    else if (verdict === 'SUBOPTIMAL') suboptimalCount++
    else tradeoffCount++

    const protectedCount = guard.protectedIds.size - globalBusyIds.size - (eligible.length - guardedEligible.length)
    const guardInfo = guard.protectedIds.size > 0
      ? ` guarded=${eligible.length - guardedEligible.length}/${eligible.length}`
      : ''
    console.log(`${courtLabel} (eligible=${guardedEligible.length}${guardInfo}, alts=${allAlts.length})  ${verdictTag}`)
    console.log(`  UI pick: ${altLabel(picked, state)}`)
    console.log(`    pvna_diff=${pickedMetrics.pvnaGap.toFixed(2)}  intra=${pickedMetrics.intraGap.toFixed(2)}  ${intraTag}  quota.over=${pickedMetrics.quota.over}`)

    const notableWarnings = pickedMetrics.warnings.filter(w =>
      !['MUST_PLAY_OVER_CAPACITY'].includes(w)
    )
    if (notableWarnings.length > 0) console.log(`    warnings: ${notableWarnings.join(', ')}`)
    if (picked.tradeoffs?.length) console.log(`    tradeoffs: ${picked.tradeoffs.map((t: any) => t.type).join(', ')}`)

    if (verdict !== 'OPTIMAL') {
      const ref = verdict === 'SUBOPTIMAL'
        ? betterByScore.sort((a, b) => a.metrics.guardedScore - b.metrics.guardedScore)[0]
        : bestCleanAlt
      if (ref && ref.alt !== picked) {
        const refCleanTag = ref.metrics.isClean ? '✓ CLEAN' : `intra=${ref.metrics.intraGap.toFixed(2)}`
        console.log(`  Ref alt: ${altLabel(ref.alt, state)}  (score=${ref.metrics.guardedScore.toFixed(1)})`)
        console.log(`    pvna_diff=${ref.metrics.pvnaGap.toFixed(2)}  ${refCleanTag}  quota.over=${ref.metrics.quota.over}`)
      }
      console.log(`  [score picked=${pickedMetrics.guardedScore.toFixed(1)}]  Lý do: ${verdictDetail}`)
    }

    // Hiển thị top 5 alternatives (đã sorted theo score từ suggest)
    if (allAlts.length > 1) {
      console.log(`  Top alts (max 5):`)
      for (let i = 0; i < Math.min(5, allAlts.length); i++) {
        const a = allAlts[i]
        const m = computeAltMetrics(a, state, nextMatchIndex, pvnaTolerance)
        const isPickedMark = a === picked ? ' ← UI pick' : ''
        const cleanTag = m.isClean ? 'CLEAN' : m.isHardOk ? `intra=${m.intraGap.toFixed(2)}` : `HARD_OVER=${m.intraGap.toFixed(2)}`
        console.log(`    [${i}] ${altLabel(a, state)} | pvna=${m.pvnaGap.toFixed(2)} ${cleanTag} q.over=${m.quota.over} score=${m.guardedScore.toFixed(1)}${isPickedMark}`)
      }
    }

    console.log()
  }

  // ===== SUMMARY =====
  console.log('='.repeat(55))
  console.log(`TỔNG KẾT: ${argCourtCount} sân`)
  console.log(`  ✅ Optimal:   ${optimalCount}`)
  console.log(`  ⚠️  Tradeoff:  ${tradeoffCount}  (fairness tradeoff — intentional)`)
  console.log(`  ❌ Suboptimal: ${suboptimalCount}  (algorithm có thể làm tốt hơn)`)
  if (noMatchCount > 0) console.log(`  — No match:  ${noMatchCount}`)
  console.log()
  console.log('So sánh trong pool alternatives cùng lần suggest (không so với brute-force ngoài pool).')
  console.log('TRADEOFF = UI đã chọn fairness/quota thay vì quality — có thể intentional.')
  console.log('SUBOPTIMAL = có alt tốt hơn VÀ cùng quota tier — có thể là bug.')
}

main().catch(console.error)
