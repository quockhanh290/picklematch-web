/**
 * verify-suggest-quality.ts
 *
 * Kiểm chứng OFFLINE: trận engine đã chọn có phải tối ưu tuyệt đối cho từng sân không.
 * V2: phân tách engine_auto vs host_replacement + invariant nghỉ-2-vòng.
 *
 * Cách dùng:
 *   1. Lấy 1 dòng dump từ debug_dumps (SQL Editor):
 *        select json_build_object(
 *          'decision_source', decision_source,
 *          'payload', payload,
 *          'chosen_matches', chosen_matches,
 *          'rounds', rounds,
 *          'pvna_tolerance', pvna_tolerance
 *        )
 *        from debug_dumps order by created_at desc limit 1;
 *      Lưu kết quả vào 1 file .json, vd dump.json
 *
 *   2. Chạy:
 *        npx tsx --tsconfig tsconfig.sandbox.json scripts/diagnostics/verify-suggest-quality.ts dump.json
 *
 * Ý nghĩa kết quả:
 *   delta = chosen_score - brute_best_score (số CÀNG NHỎ càng tốt)
 *     delta ≈ 0  → engine ra ĐÚNG trận tốt nhất.
 *     delta > 0  → engine BỎ LỠ.
 *
 *   Chỉ TÍNH ENGINE QUALITY cho trận decision_source='engine_auto' và is_replacement=false.
 *   Trận host_replacement báo riêng, KHÔNG tính engine bỏ lỡ.
 */

// @ts-ignore
import { scoreMatch } from '@/lib/next-round-suggester/score.ts'
// @ts-ignore
import { DEFAULT_SCORING_WEIGHTS } from '@/lib/next-round-suggester/state.ts'
import type { PlayerSessionState, SessionState, Team, RoundRecord } from '@/lib/next-round-suggester/types.ts'
import { readFileSync } from 'node:fs'

export type DumpPlayer = {
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

export type ChosenMatch = {
  court_idx: number
  team_a: Team
  team_b: Team
  is_replacement?: boolean
  warnings?: string[]
}

export type Dump = {
  decision_source?: string
  players: DumpPlayer[]
  court_count: number
  current_round: number
  busy_player_ids: string[]
  missing_courts?: number[]
  missing_target_courts?: number[]
  target_count_shortfall?: number
  target_expected_count?: number
  avoid_pairs?: Array<{ player_a: string; player_b: string }>
  pvna_tolerance?: number
  rounds?: RoundRecord[]
  chosen_matches?: ChosenMatch[]
}

export function normalizeDump(raw: any): Dump {
  const payload = raw.payload ?? raw
  const chosen = raw.chosen_matches ?? payload.chosen_matches
  const decision_source = raw.decision_source ?? payload.decision_source
  const rounds = raw.rounds ?? payload.rounds
  const pvna_tolerance = raw.pvna_tolerance ?? payload.pvna_tolerance
  return { ...payload, chosen_matches: chosen, decision_source, rounds, pvna_tolerance }
}

export function loadDump(path: string): Dump {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // chấp nhận { payload, chosen_matches } hoặc payload phẳng
  return normalizeDump(raw)
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

export function buildState(dump: Dump): SessionState {
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

// Kiểm xem player có thể xếp vào 1 trận bất kỳ từ pool available không
export function canPlace(playerId: string, available: string[], state: SessionState, tolerance: number): boolean {
  const others = available.filter(id => id !== playerId)
  for (const three of combinations(others, 3)) {
    const four = [playerId, ...three]
    for (const [teamA, teamB] of splits(four)) {
      const r = scoreMatch(teamA, teamB, state, {
        tolerance,
        allowRepeatOverflow: true,
        allowIntraTeamGapOverflow: true,
        allowRecentGroupRematch: true,
      })
      if (Number.isFinite(r.score)) return true
    }
  }
  return false
}

// Brute-force: tìm trận điểm thấp nhất (tốt nhất) từ pool available cho 1 sân
export function bruteForceBest(available: string[], state: SessionState, tolerance: number) {
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

export type EngineBoardAnalysis = {
  match: ChosenMatch
  poolSize: number
  chosenScore: number
  best: { score: number; teamA: Team; teamB: Team } | null
  delta: number | null
  allInPool: boolean
  isSuboptimal: boolean
}

export type RestRiskAnalysis = {
  player: DumpPlayer
  placeable: boolean
  priorityMiss: boolean
  capacityDeferred: boolean
}

export type SuggestQualityAnalysis = {
  dump: Dump
  state: SessionState
  tolerance: number
  decisionSource: string
  busy: Set<string>
  pool: string[]
  engineMatches: ChosenMatch[]
  replacementMatches: ChosenMatch[]
  engineBoards: EngineBoardAnalysis[]
  engineQualitySkippedReason: string | null
  restRiskCases: RestRiskAnalysis[]
  restRiskSkippedReason: string | null
  missingCourts: number[]
}

export function analyzeSuggestQuality(dump: Dump): SuggestQualityAnalysis {
  const state = buildState(dump)
  const tolerance = dump.pvna_tolerance ?? 0.5
  const decisionSource = dump.decision_source ?? 'unknown'
  const chosenMatches = dump.chosen_matches ?? []
  const busy = new Set(dump.busy_player_ids ?? [])
  const pool = dump.players
    .filter((p) => !p.checked_out && !p.opted_rest && !busy.has(p.id))
    .map((p) => p.id)

  // Phân loại: engine_auto vs host_replacement
  const engineMatches = chosenMatches.filter(m => !m.is_replacement && decisionSource !== 'host_replacement')
  const replacementMatches = chosenMatches.filter(m => m.is_replacement || decisionSource === 'host_replacement')

  const chosenPlayerIds = new Set(
    chosenMatches.flatMap(m => [...m.team_a, ...m.team_b])
  )
  const engineDecision = (dump as any).engine_decision ?? {}
  const requestedCourts = Number(
    dump.target_expected_count
      ?? engineDecision.input_count
      ?? chosenMatches.length
  )
  const maxCourtsWithFree = Number(
    engineDecision.max_courts_with_free_players
      ?? Math.floor(pool.length / 4)
  )
  const expectedCoverageCourts = Math.min(
    Math.max(0, dump.court_count),
    Number.isFinite(maxCourtsWithFree) ? Math.max(0, maxCourtsWithFree) : Math.floor(pool.length / 4),
  )
  const hasExplicitTargetMetadata = Array.isArray(dump.missing_target_courts)
    || dump.target_count_shortfall !== undefined
  const isLegacyPartialPreview = !hasExplicitTargetMetadata
    && Number.isFinite(requestedCourts)
    && requestedCourts > 0
    && requestedCourts < expectedCoverageCourts
  const chosenSlotBudget = isLegacyPartialPreview
    ? 0
    : chosenPlayerIds.size
  const partialPreviewSkipReason = isLegacyPartialPreview
    ? `legacy_partial_preview: requested=${requestedCourts}, expected=${expectedCoverageCourts}`
    : null

  const used = new Set<string>()
  const engineBoards: EngineBoardAnalysis[] = []
  if (!partialPreviewSkipReason) {
    for (const cm of engineMatches) {
      const avail = pool.filter((id) => !used.has(id))
      const chosenPlayers = [...cm.team_a, ...cm.team_b]
      const allInPool = chosenPlayers.every((id) => avail.includes(id))
      const chosenScore = scoreChosen(cm.team_a, cm.team_b, state, tolerance)
      const best = bruteForceBest(avail, state, tolerance)
      const delta = best ? chosenScore - best.score : null
      engineBoards.push({
        match: cm,
        poolSize: avail.length,
        chosenScore,
        best,
        delta,
        allInPool,
        isSuboptimal: delta !== null && delta > 0.01,
      })
      chosenPlayers.forEach((id) => used.add(id))
    }
  }
  const allRestRiskPlayers = dump.players
    .filter(p => {
      if (p.checked_out || p.opted_rest || busy.has(p.id)) return false
      const threshold = p.matches_played === 0 ? 2 : 1
      return p.consecutive_rest >= threshold
    })
    .sort((left, right) => {
      if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
      if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
      return left.id.localeCompare(right.id)
    })
  const requiredRestRiskIds = new Set(allRestRiskPlayers.slice(0, chosenSlotBudget).map(player => player.id))

  // late-arrival threshold: matches_played===0 -> consecutive_rest >= 2, others >= 1.
  // Count true misses only inside the rest-priority cohort that fits the chosen slot budget.
  const restRiskCases = isLegacyPartialPreview
    ? []
    : allRestRiskPlayers
        .filter(p => !chosenPlayerIds.has(p.id))
        .map(player => ({
          player,
          placeable: canPlace(player.id, pool, state, tolerance),
          priorityMiss: requiredRestRiskIds.has(player.id),
          capacityDeferred: !requiredRestRiskIds.has(player.id),
        }))
  const restRiskSkippedReason = partialPreviewSkipReason

  const missingCourts: number[] = Array.isArray(dump.missing_target_courts)
    ? [...dump.missing_target_courts]
    : Array.isArray(dump.missing_courts)
      ? [...dump.missing_courts]
    : []
  const targetCountShortfall = Number(dump.target_count_shortfall ?? 0)
  if (Number.isFinite(targetCountShortfall) && targetCountShortfall > 0) {
    for (let index = 0; index < targetCountShortfall; index += 1) missingCourts.push(-1)
  }
  if (!Array.isArray(dump.missing_target_courts) && !Array.isArray(dump.missing_courts)) {
    const filledCourts = new Set(chosenMatches.map(m => m.court_idx))
    for (let courtIdx = 0; courtIdx < dump.court_count; courtIdx++) {
      if (!filledCourts.has(courtIdx)) missingCourts.push(courtIdx)
    }
  }

  return {
    dump,
    state,
    tolerance,
    decisionSource,
    busy,
    pool,
    engineMatches,
    replacementMatches,
    engineBoards,
    engineQualitySkippedReason: partialPreviewSkipReason,
    restRiskCases,
    restRiskSkippedReason,
    missingCourts,
  }
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
  const decisionSource = dump.decision_source ?? 'unknown'

  if (!dump.chosen_matches || dump.chosen_matches.length === 0) {
    console.error('Dump KHÔNG có chosen_matches — cần thêm field này vào debug_dumps để verify.')
    process.exit(1)
  }
  if (!dump.rounds || dump.rounds.length === 0) {
    console.warn('⚠️  Dump không có `rounds` → recentRepeatCost bị bỏ qua (delta vẫn dùng được nhưng không tuyệt đối chính xác).\n')
  }

  const busy = new Set(dump.busy_player_ids ?? [])
  const pool = dump.players
    .filter((p) => !p.checked_out && !p.opted_rest && !busy.has(p.id))
    .map((p) => p.id)

  console.log(`State: ${dump.players.length} players, court_count=${dump.court_count}, round=${dump.current_round}`)
  console.log(`decision_source: ${decisionSource}`)
  console.log(`Available ban đầu: ${pool.length} | busy=${busy.size} | tolerance=${tolerance}`)
  console.log(`Engine chọn ${dump.chosen_matches.length} sân.\n`)

  // Phân loại: engine_auto vs host_replacement
  const engineMatches = dump.chosen_matches.filter(m => !m.is_replacement && decisionSource !== 'host_replacement')
  const replacementMatches = dump.chosen_matches.filter(m => m.is_replacement || decisionSource === 'host_replacement')

  // ── HOST REPLACEMENT ──────────────────────────────────────────────────────
  if (replacementMatches.length > 0) {
    console.log('══ HOST REPLACEMENT (host chủ động chọn — không tính engine bỏ lỡ) ══')
    for (const cm of replacementMatches) {
      const chosenPlayers = [...cm.team_a, ...cm.team_b]
      const allInPool = chosenPlayers.every((id) => pool.includes(id))
      console.log(`  Sân ${cm.court_idx}: ${fmtMatch(cm.team_a, cm.team_b, state)}${allInPool ? '' : '  ⚠️ KHÔNG nằm trong pool!'}`)
      if (cm.warnings && cm.warnings.length > 0) {
        console.log(`    warnings: ${cm.warnings.join(', ')}`)
      }
    }
    console.log('')
  }

  // ── ENGINE AUTO (greedy quality check) ───────────────────────────────────
  if (engineMatches.length > 0) {
    console.log('══ ENGINE AUTO — kiểm chất lượng greedy ══')
    const used = new Set<string>()
    let totalDelta = 0
    let suboptimalCourts = 0

    for (const cm of engineMatches) {
      const avail = pool.filter((id) => !used.has(id))
      const chosenPlayers = [...cm.team_a, ...cm.team_b]
      const allInPool = chosenPlayers.every((id) => avail.includes(id))
      const chosenScore = scoreChosen(cm.team_a, cm.team_b, state, tolerance)
      const best = bruteForceBest(avail, state, tolerance)

      console.log(`── Sân ${cm.court_idx} (pool ${avail.length} người) ──`)
      console.log(`  Engine chọn : ${fmtMatch(cm.team_a, cm.team_b, state)}  | score=${chosenScore.toFixed(3)}${allInPool ? '' : '  ⚠️ KHÔNG nằm trong pool!'}`)
      if (cm.warnings && cm.warnings.length > 0) {
        console.log(`  warnings: ${cm.warnings.join(', ')}`)
      }
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
      chosenPlayers.forEach((id) => used.add(id))
    }

    console.log('═══════════════════════════════════')
    console.log(`ENGINE: ${engineMatches.length} sân | ${suboptimalCourts} sân bỏ lỡ | tổng delta = ${totalDelta.toFixed(3)}`)
    if (suboptimalCourts === 0) {
      console.log('✅ Engine ra trận TỐI ƯU tuyệt đối ở mọi sân (greedy). Gợn còn lại = giới hạn toán / greedy-corner toàn cục.')
    } else {
      console.log('⚠️ Engine bỏ lỡ ở vài sân — xem chi tiết. Có thể do beam-3 / rescue / weights.')
    }
    console.log('')
  }

  // ── INVARIANT: không ai nghỉ 2 vòng khi tránh được ──────────────────────
  console.log('══ INVARIANT: nghỉ 2 vòng liên tiếp ══')

  const chosenPlayerIds = new Set(
    (dump.chosen_matches ?? []).flatMap(m => [...m.team_a, ...m.team_b])
  )

  // late-arrival threshold: matches_played===0 → consecutive_rest >= 2, others >= 1
  const restRiskPlayers = dump.players.filter(p => {
    if (p.checked_out || p.opted_rest || busy.has(p.id)) return false
    if (chosenPlayerIds.has(p.id)) return false
    const threshold = p.matches_played === 0 ? 2 : 1
    return p.consecutive_rest >= threshold
  })

  if (restRiskPlayers.length === 0) {
    console.log('✅ Không có ca nghỉ 2 vòng liên tiếp.\n')
  } else {
    let avoidable = 0
    let unavoidable = 0

    for (const p of restRiskPlayers) {
      const placeable = canPlace(p.id, pool, state, tolerance)
      if (placeable) {
        avoidable++
        console.log(`  ⚠️ TRÁNH ĐƯỢC  — ${short(p.id)} (consecutive_rest=${p.consecutive_rest}, pvna=${p.pvna.toFixed(1)}) có thể xếp vào nhưng bị bỏ qua.`)
      } else {
        unavoidable++
        console.log(`  ○ bất khả     — ${short(p.id)} (consecutive_rest=${p.consecutive_rest}, pvna=${p.pvna.toFixed(1)}) không ghép được trận hợp lệ nào.`)
      }
    }

    console.log('──────────────')
    console.log(`Tổng: ${restRiskPlayers.length} ca | ${avoidable} tránh được | ${unavoidable} bất khả`)
    if (avoidable > 0) {
      console.log('⚠️ Có ca TRÁNH ĐƯỢC — logic xếp trận cần xem lại.')
    } else {
      console.log('✅ Tất cả ca nghỉ-2 đều bất khả (đúng behavior).')
    }
    console.log('')
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/verify-suggest-quality.ts')) {
  main()
}
