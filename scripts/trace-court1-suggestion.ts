/**
 * Trace suggest của một sân cụ thể trong session
 * Chạy: npx tsx scripts/trace-court1-suggestion.ts [session_id] [court_idx=0]
 */
import { mapRowsToSessionState, getBenchDepth } from '../lib/next-round-suggester/state'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { bestTeamSplit } from '../lib/next-round-suggester/pair'
import { computeAvailabilityMetrics } from '../lib/next-round-suggester/fairness/metrics'
import { computeDynamicThresholds, classifyPlayer, getAverageMatches, Tier } from '../lib/next-round-suggester/classify'
import { sortPlayersForStrategy } from '../lib/next-round-suggester/select'
import { PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'

async function query(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Query ${table} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function findActiveSession(sessionId?: string) {
  if (sessionId) return sessionId
  // Tìm session có live matches gần nhất
  const liveMatches = await query('session_live_matches', {
    status: 'eq.live',
    select: 'session_id',
    order: 'started_at.desc',
    limit: '1',
  })
  if (!liveMatches.length) {
    const suggested = await query('session_live_matches', {
      status: 'eq.suggested',
      select: 'session_id',
      order: 'created_at.desc',
      limit: '1',
    })
    return suggested[0]?.session_id
  }
  return liveMatches[0]?.session_id
}

function getAllCombinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  function walk(start: number, selected: T[]) {
    if (selected.length === size) { result.push([...selected]); return }
    for (let i = start; i < items.length; i++) {
      selected.push(items[i]); walk(i + 1, selected); selected.pop()
    }
  }
  walk(0, [])
  return result
}

async function main() {
  const argSessionId = process.argv[2]
  const argCourtIdx = parseInt(process.argv[3] ?? '0', 10)
  const sessionId = await findActiveSession(argSessionId)
  if (!sessionId) { console.error('Không tìm thấy session active'); process.exit(1) }
  console.log(`\n=== SESSION: ${sessionId} | COURT IDX: ${argCourtIdx} ===\n`)

  // Fetch data — join players table để lấy PVNA thực
  const [rawPlayerRows, pairRows, sessionRoundRows, liveMatchRows] = await Promise.all([
    query('session_player_state', { session_id: `eq.${sessionId}`, select: '*,players(pvna,elo,current_elo,gender)' }),
    query('session_pair_history', { session_id: `eq.${sessionId}`, select: '*' }),
    query('session_rounds', { session_id: `eq.${sessionId}`, select: '*' }),
    query('session_live_matches', { session_id: `eq.${sessionId}`, select: '*', status: 'neq.cancelled' }),
  ])

  // Fallback: derive round_rows từ completed live matches (giống RPC mới)
  // session_rounds rỗng với sessions dùng live-match-only flow
  let roundRows = sessionRoundRows
  if (roundRows.length === 0) {
    const completedMatches = liveMatchRows.filter((m: any) => m.status === 'completed')
    const byRound = new Map<number, any[]>()
    for (const m of completedMatches) {
      if (!byRound.has(m.round_no)) byRound.set(m.round_no, [])
      byRound.get(m.round_no)!.push(m)
    }
    const activePlayerIds = new Set(
      rawPlayerRows.filter((p: any) => !p.checked_out_at).map((p: any) => p.player_id)
    )
    roundRows = [...byRound.entries()].sort(([a], [b]) => a - b).map(([round_no, matches]) => {
      const playingIds = new Set(matches.flatMap((m: any) => [...m.team_a, ...m.team_b]))
      return {
        id: matches[0].id,
        session_id: sessionId,
        round_no,
        status: 'completed',
        matches: matches.map((m: any) => ({ court_idx: m.court_idx, team_a: m.team_a, team_b: m.team_b })),
        resting: [...activePlayerIds].filter(id => !playingIds.has(id)),
        started_at: matches[0].started_at,
        ended_at: matches[matches.length - 1].ended_at,
      }
    })
    console.log(`[fallback] session_rounds rỗng → derived ${roundRows.length} rounds từ live matches`)
  }

  // Enrich player rows với effective_pvna ưu tiên, rồi players.pvna, rồi players.elo
  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    players: {
      pvna: row.effective_pvna ?? row.players?.pvna ?? null,
      elo: row.players?.elo ?? row.players?.current_elo ?? null,
      gender: row.players?.gender ?? null,
      partner_gender_pref: row.players?.metadata?.partner_gender_pref ?? null,
      opponent_gender_pref: row.players?.metadata?.opponent_gender_pref ?? null,
    },
  }))

  console.log(`Players: ${playerRows.length}, Pairs: ${pairRows.length}, Rounds: ${roundRows.length}, Live: ${liveMatchRows.length}`)

  const state = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows,
    roundRows,
    courts: 6,
    pvnaTolerance: 0.5,
  })

  // Xác định busy IDs — live (đang đánh) + suggested (đã assign courts khác)
  const busyIds = new Set<string>()
  const suggestedByCourtIdx = new Map<number, any>()
  for (const m of liveMatchRows) {
    if (m.status === 'live') {
      if (m.team_a) for (const id of m.team_a) busyIds.add(id)
      if (m.team_b) for (const id of m.team_b) busyIds.add(id)
    }
    if (m.status === 'suggested') {
      suggestedByCourtIdx.set(m.court_idx, m)
    }
  }
  console.log(`\nBusy (live): ${busyIds.size} người`)
  console.log(`Suggested courts: ${[...suggestedByCourtIdx.keys()].sort().join(', ')}`)

  // Simulate: court argCourtIdx trong replace_courts mode
  // → courts khác đã suggested mark thêm vào busy
  const TARGET_COURT_IDX = argCourtIdx
  const busyIdsForCourt1 = new Set(busyIds)
  for (const [courtIdx, m] of suggestedByCourtIdx) {
    if (courtIdx === TARGET_COURT_IDX) continue // không count chính nó
    if (m.team_a) for (const id of m.team_a) busyIdsForCourt1.add(id)
    if (m.team_b) for (const id of m.team_b) busyIdsForCourt1.add(id)
  }
  console.log(`Busy (live + other suggested courts): ${busyIdsForCourt1.size} người`)

  // Eligible players cho sân 1 (không bận, không checked out, không opted rest)
  const eligible = [...state.players.values()].filter(p =>
    p.checked_out_at === null && !p.opted_rest && !busyIdsForCourt1.has(p.player_id)
  ).sort((a, b) => a.pvna - b.pvna)

  console.log(`\nEligible players (${eligible.length}):`)
  for (const p of eligible) {
    const required = p.consecutive_rest >= 1 ? ' [MUST_PLAY]' : ''
    console.log(`  ${p.player_id.slice(0, 8)} pvna=${p.pvna.toFixed(2)} rest=${p.consecutive_rest} played=${p.matches_played}${required}`)
  }

  const requiredIds = new Set(eligible.filter(p => p.consecutive_rest >= 1).map(p => p.player_id))
  console.log(`\nRequired (consecutive_rest >= 1): ${requiredIds.size} người`)

  // Tìm tất cả combos 4 người và sort theo pvna_diff lý thuyết tốt nhất
  const combos = getAllCombinations(eligible, 4).sort((a, b) => {
    const diff = (g: typeof a) => {
      const s = [...g].sort((x, y) => x.pvna - y.pvna)
      return Math.abs(s[0].pvna + s[3].pvna - s[1].pvna - s[2].pvna) / 2
    }
    return diff(a) - diff(b)
  })

  console.log(`\nTổng combos C(${eligible.length},4) = ${combos.length}`)

  // Tìm 10 combo tốt nhất theo score thực từ bestTeamSplit
  let cleanCount = 0
  let relaxedCount = 0
  const TOP_N = 10
  const results: Array<{
    players: string; pvnas: string; chênh: number; intraMax: number; score: number; clean: boolean
  }> = []

  for (const combo of combos) {
    // Enforce required
    if (requiredIds.size > 0 && ![...requiredIds].every(id => combo.some(p => p.player_id === id))) continue

    const split = bestTeamSplit(combo, state)
    if (!split) continue

    const pvnas = combo.map(p => p.pvna.toFixed(2)).join(', ')
    const names = combo.map(p => p.player_id.slice(0, 6)).join(' | ')
    const teamA = state.players.get(split.match.team_a[0])!
    const teamB0 = state.players.get(split.match.team_b[0])!
    const teamA1 = state.players.get(split.match.team_a[1])!
    const teamB1 = state.players.get(split.match.team_b[1])!
    const intraA = Math.abs(teamA.pvna - teamA1.pvna)
    const intraB = Math.abs(teamB0.pvna - teamB1.pvna)
    const intraMax = Math.max(intraA, intraB)
    const clean = intraMax <= PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT

    if (clean) cleanCount++
    else relaxedCount++

    if (results.length < TOP_N) {
      results.push({
        players: names,
        pvnas,
        chênh: split.stats.pvna_diff,
        intraMax,
        score: split.score,
        clean,
      })
    }

    if (results.length >= TOP_N && (cleanCount + relaxedCount) > 200) break
  }

  console.log(`\nTop ${results.length} combos (tối đa enforce required):\n`)
  for (const r of results) {
    const tag = r.clean ? '✓ CLEAN' : '⚠ INTRA>'
    console.log(`  ${tag}  chênh=${r.chênh.toFixed(2)} intra=${r.intraMax.toFixed(2)} score=${r.score.toFixed(1)}`)
    console.log(`    players: ${r.players}`)
    console.log(`    pvnas:   ${r.pvnas}`)
  }

  // Tóm tắt
  const totalValid = cleanCount + relaxedCount
  console.log(`\n=== TÓM TẮT (${totalValid} combos đầu đã xét) ===`)
  console.log(`  Clean (intra <= 0.75): ${cleanCount}`)
  console.log(`  Relaxed (intra > 0.75): ${relaxedCount}`)

  if (cleanCount === 0) {
    console.log(`\n=> KHÔNG CÓ combo nào thỏa intra <= 0.75 với required constraint.`)
    console.log(`   Suggest hiện tại là optimal có thể được.`)
  } else {
    console.log(`\n=> CÓ combo clean tồn tại — thuật toán có thể đang bỏ sót.`)
  }

  // Tier classification của mỗi player
  const metrics = computeAvailabilityMetrics(state)
  const thresholds = computeDynamicThresholds(getBenchDepth(state), eligible.length, undefined)
  const classCtx = {
    avgMatches: getAverageMatches(eligible),
    thresholds,
    matchBalance: new Map(metrics.per_player.map((p: any) => [p.player_id, p.delta_from_expected])),
  }

  console.log(`\nTier classification (eligible cho sân 1):`)
  const tierNames = { [Tier.MUST_PLAY]: 'MUST_PLAY', [Tier.SHOULD_PLAY]: 'SHOULD_PLAY', [Tier.FLEXIBLE]: 'FLEXIBLE', [Tier.SHOULD_REST]: 'SHOULD_REST' }
  for (const p of eligible) {
    const tier = classifyPlayer(p, classCtx, undefined)
    console.log(`  ${p.player_id.slice(0,8)} pvna=${p.pvna.toFixed(2)} played=${p.matches_played} rest=${p.consecutive_rest} → ${tierNames[tier]}`)
  }

  const sorted = sortPlayersForStrategy(eligible, 'fairness', {}, classCtx)
  console.log(`\nThứ tự fairness sort (top 12):`)
  sorted.slice(0, 12).forEach((p, i) => {
    const tier = classifyPlayer(p, classCtx, undefined)
    console.log(`  #${i+1} ${p.player_id.slice(0,8)} pvna=${p.pvna.toFixed(2)} played=${p.matches_played} ${tierNames[tier]}`)
  })
  console.log(`  → first candidate = [${sorted.slice(0,4).map(p => p.pvna.toFixed(2)).join(', ')}]`)

  // Chạy suggestNextMatch chính thức
  // Debug: top 8 combos sorted by pvna_diff và bestTeamSplit kết quả
  const eligibleByPvna = [...eligible].sort((a, b) => a.pvna - b.pvna)
  const allCombos = getAllCombinations(eligibleByPvna, 4).sort((a, b) => {
    const dA = Math.abs(a[0].pvna + a[3].pvna - a[1].pvna - a[2].pvna) / 2
    const dB = Math.abs(b[0].pvna + b[3].pvna - b[1].pvna - b[2].pvna) / 2
    return dA - dB
  })
  console.log(`\nTop 8 combos (sorted pvna_diff) và bestTeamSplit:`)
  for (let i = 0; i < Math.min(8, allCombos.length); i++) {
    const c = allCombos[i]
    const theoreticalDiff = Math.abs(c[0].pvna + c[3].pvna - c[1].pvna - c[2].pvna) / 2
    const split = bestTeamSplit(c, state)
    if (split) {
      const aP = [state.players.get(split.match.team_a[0])!, state.players.get(split.match.team_a[1])!]
      const bP = [state.players.get(split.match.team_b[0])!, state.players.get(split.match.team_b[1])!]
      const intraA = Math.abs(aP[0].pvna - aP[1].pvna)
      const intraB = Math.abs(bP[0].pvna - bP[1].pvna)
      const clean = Math.max(intraA, intraB) <= PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT
      console.log(`  #${i+1} [${c.map(p => p.pvna.toFixed(2)).join(',')}] theorDiff=${theoreticalDiff.toFixed(3)}`)
      console.log(`       split: [${aP.map(p=>p.pvna.toFixed(2)).join('+')}] vs [${bP.map(p=>p.pvna.toFixed(2)).join('+')}] chênh=${split.stats.pvna_diff.toFixed(2)} intra=${Math.max(intraA,intraB).toFixed(2)} ${clean ? 'CLEAN' : 'RELAXED'}`)
    } else {
      console.log(`  #${i+1} [${c.map(p => p.pvna.toFixed(2)).join(',')}] theorDiff=${theoreticalDiff.toFixed(3)} → null (no valid split)`)
    }
  }

  console.log(`\nbusy_player_ids truyền vào: ${[...busyIdsForCourt1].length} players:`)
  console.log(`  ${[...busyIdsForCourt1].join(', ')}`)

  console.log(`\n=== SuggestNextMatch kết quả chính thức ===`)
  const diag: any = {}
  const result = suggestNextMatch(state, {
    busy_player_ids: [...busyIdsForCourt1],  // convert Set → array
    court_idx: TARGET_COURT_IDX,
    max_alternatives: 3,
    exhaustive_fallback: true,
    _exhaustiveDiag: diag,
  })
  console.log(`Exhaustive fallback: ran=${diag.ran} eligible=${diag.eligibleCount} combos=${diag.combinationsEvaluated} seenAfterStage1=${diag._seenAfterStage1} timedOut=${diag.timedOut} ms=${diag.elapsedMs}`)
  console.log(`Fallback eligible players (pvna sorted):`)
  for (const p of (diag._eligiblePvnas ?? [])) console.log(`  ${p}`)
  console.log(`Fallback alternatives (trước merge):`)
  for (const fa of (diag._alternatives ?? [])) {
    const aP = (fa.teamA ?? []).map((id: string) => state.players.get(id)?.pvna.toFixed(2)).join('+')
    const bP = (fa.teamB ?? []).map((id: string) => state.players.get(id)?.pvna.toFixed(2)).join('+')
    console.log(`  [${aP}] vs [${bP}] tradeoffs=[${fa.tradeoffs?.join(',')}]`)
  }
  console.log(`result.alternatives.length = ${result.alternatives.length}`)
  for (const alt of result.alternatives) {
    const m = alt.matches[0]
    if (!m) continue
    const a0 = state.players.get(m.team_a[0])
    const a1 = state.players.get(m.team_a[1])
    const b0 = state.players.get(m.team_b[0])
    const b1 = state.players.get(m.team_b[1])
    console.log(`  [${m.team_a[0].slice(0,6)}(${a0?.pvna.toFixed(2)})+${m.team_a[1].slice(0,6)}(${a1?.pvna.toFixed(2)})] vs [${m.team_b[0].slice(0,6)}(${b0?.pvna.toFixed(2)})+${m.team_b[1].slice(0,6)}(${b1?.pvna.toFixed(2)})]`)
    console.log(`    chênh=${m.stats?.pvna_diff?.toFixed(2)} warnings=${alt.warnings.join(',')} tradeoffs=${alt.tradeoffs?.map(t => t.type).join(',')}`)
  }
}

main().catch(console.error)
