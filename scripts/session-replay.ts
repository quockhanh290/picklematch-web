/**
 * Replay toàn bộ diễn biến thực tế của session.
 * Với mỗi sân từng vòng: match thực tế, alternatives, và lý do algorithm chọn.
 *
 * Chạy: npx tsx scripts/session-replay.ts <session_id> [court_count=6]
 */
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextMatch, type ExhaustiveFallbackDiagnostic } from '../lib/next-round-suggester/suggest'
import {
  pickGuardedLiveAlternative,
  getAlternativeIntraTeamGap,
  getAlternativePvnaGap,
  getAlternativeRepeatMetrics,
  getProjectedCountViolation,
  getProjectedTargetRangeAfter,
  buildLiveSelectionGuard,
  buildProjectedStateAfterLiveMatch,
  buildProjectedStateAfterCompletedLiveRound,
} from '../lib/next-round-suggester/live-preview'
import { PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT, INTRA_TEAM_PVNA_GAP_LIMIT } from '../lib/next-round-suggester/score'
import type { SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'

async function query(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

// ──── Weights (mirrors pickGuardedLiveAlternative early-round policy) ────
const W_PVNA = 90, W_INTRA = 12, W_REPEAT_OVER = 55, W_REPEAT_AFF = 8
const W_QUOTA_OVER = 35, W_QUOTA_UNDER = 5, W_TRADEOFF = 20

type AltMetrics = {
  pvnaGap: number; pvnaOver: number
  intraGap: number; intraOver: number
  isClean: boolean; isHardOk: boolean
  quota: { over: number; under: number }
  repeatOver: number; repeatAffected: number
  tradeoffs: number
  score: number   // guarded score (recent cost omitted — minor, ×0.9)
}

function computeMetrics(alt: SuggestionAlternative, state: SessionState, nextMatchIndex: number, pvnaTol: number): AltMetrics {
  const pvnaGap = getAlternativePvnaGap(alt)
  const intraGap = getAlternativeIntraTeamGap(alt, state)
  const { min, max } = getProjectedTargetRangeAfter(state, nextMatchIndex)
  const quota = getProjectedCountViolation(alt, state, max, min)
  const repeat = getAlternativeRepeatMetrics(alt, state)
  const pvnaOver = Math.max(0, pvnaGap - pvnaTol)
  const intraOver = Math.max(0, intraGap - PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT)
  const tradeoffs = alt.tradeoffs?.length ?? 0
  const score = pvnaOver * W_PVNA + intraOver * W_INTRA + repeat.repeat_over_by * W_REPEAT_OVER +
    repeat.affected_players * W_REPEAT_AFF + quota.over * W_QUOTA_OVER + quota.under * W_QUOTA_UNDER +
    tradeoffs * W_TRADEOFF
  return { pvnaGap, pvnaOver, intraGap, intraOver, isClean: intraGap <= PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
    isHardOk: intraGap <= INTRA_TEAM_PVNA_GAP_LIMIT, quota, repeatOver: repeat.repeat_over_by,
    repeatAffected: repeat.affected_players, tradeoffs, score }
}

function scoreBreakdown(m: AltMetrics): string {
  const parts: string[] = []
  if (m.pvnaOver > 0) parts.push(`pvna +${(m.pvnaOver * W_PVNA).toFixed(0)}`)
  if (m.intraOver > 0) parts.push(`intra +${(m.intraOver * W_INTRA).toFixed(0)}`)
  if (m.repeatOver > 0) parts.push(`repeat +${(m.repeatOver * W_REPEAT_OVER).toFixed(0)}`)
  if (m.quota.over > 0) parts.push(`quota.over +${(m.quota.over * W_QUOTA_OVER).toFixed(0)}`)
  if (m.quota.under > 0) parts.push(`quota.under +${(m.quota.under * W_QUOTA_UNDER).toFixed(0)}`)
  if (m.tradeoffs > 0) parts.push(`tradeoffs +${(m.tradeoffs * W_TRADEOFF).toFixed(0)}`)
  return parts.length ? `= ${m.score.toFixed(1)} (${parts.join(', ')})` : '= 0.0 (perfect)'
}

// playerLabel: "3.50(a4b2)" — pvna + first 4 chars of player_id
function pLabel(id: string, state: SessionState, names: Map<string, string>): string {
  const p = state.players.get(id)
  const pvna = p ? p.pvna.toFixed(2) : '?.??'
  const name = names.get(id)
  return name ? `${pvna}·${name.split(' ').pop()}` : `${pvna}(${id.slice(0, 4)})`
}

function teamLabel(ids: string[], state: SessionState, names: Map<string, string>): string {
  return ids.map(id => pLabel(id, state, names)).join(' + ')
}

function altLabel(alt: SuggestionAlternative, state: SessionState, names: Map<string, string>): string {
  const m = alt.matches[0]
  if (!m) return '(no match)'
  return `[${teamLabel(m.team_a, state, names)}] vs [${teamLabel(m.team_b, state, names)}]`
}

// Verify whether 4 actual players form a valid match (pvna_diff + intra checks)
function computeActualComboValidity(
  teamA: string[], teamB: string[], state: SessionState, pvnaTol: number,
): { pvnaGap: number; intraGap: number; isValid: boolean; isClean: boolean } {
  const allIds = [...teamA, ...teamB]
  const players = allIds.map(id => state.players.get(id)).filter(Boolean) as { pvna: number }[]
  if (players.length !== 4) return { pvnaGap: Infinity, intraGap: Infinity, isValid: false, isClean: false }
  const s = [...players].sort((a, b) => a.pvna - b.pvna)
  const pvnaGap = Math.abs(s[0].pvna + s[3].pvna - s[1].pvna - s[2].pvna) / 2
  const intraGap = Math.max(Math.abs(s[0].pvna - s[3].pvna), Math.abs(s[1].pvna - s[2].pvna))
  return {
    pvnaGap, intraGap,
    isValid: pvnaGap <= pvnaTol && intraGap <= INTRA_TEAM_PVNA_GAP_LIMIT,
    isClean: intraGap <= PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  }
}

// Check if actual match players match those of an alternative (regardless of team split)
function altMatchesActual(alt: SuggestionAlternative, actualA: string[], actualB: string[]): boolean {
  const altPlayers = new Set(alt.matches.flatMap(m => [...m.team_a, ...m.team_b]))
  const actualPlayers = new Set([...actualA, ...actualB])
  if (altPlayers.size !== actualPlayers.size) return false
  for (const id of actualPlayers) if (!altPlayers.has(id)) return false
  return true
}

// Build initial state: reset runtime counters, keep static data
function buildInitialState(rawPlayerRows: any[], sessionId: string, courtCount: number, pvnaTolerance: number): SessionState {
  const resetRows = rawPlayerRows.map((row: any) => ({
    ...row,
    matches_played: 0,
    consecutive_rest: 0,
    consecutive_play: 0,
    last_played_round: null,
    opted_rest: false,
  }))
  return mapRowsToSessionState({
    sessionId,
    playerRows: resetRows,
    pairRows: [],   // Partner/opponent counts built up through buildProjectedStateAfterLiveMatch
    roundRows: [],
    courts: courtCount,
    pvnaTolerance,
  })
}

async function main() {
  const sessionId = process.argv[2]
  const courtCount = parseInt(process.argv[3] ?? '6', 10)
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/session-replay.ts <session_id> [court_count=6]')
    process.exit(1)
  }

  // ──── Fetch data ────
  const [rawPlayerRows, pairRows, roundRows, rawMatchRows] = await Promise.all([
    query('session_player_state', { session_id: `eq.${sessionId}`, select: '*,players(pvna,elo,current_elo,gender,name)' }),
    query('session_pair_history', { session_id: `eq.${sessionId}`, select: '*' }),
    query('session_rounds', { session_id: `eq.${sessionId}`, select: '*' }),
    query('session_live_matches', { session_id: `eq.${sessionId}`, select: '*', status: 'neq.cancelled', order: 'round_no.asc,court_idx.asc' }),
  ])

  // Enrich playerRows với effective_pvna
  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    players: {
      pvna: row.effective_pvna ?? row.players?.pvna ?? null,
      elo: row.players?.elo ?? row.players?.current_elo ?? null,
      gender: row.players?.gender ?? null,
      name: row.players?.name ?? null,
    },
  }))

  // Player name lookup
  const playerNames = new Map<string, string>()
  for (const row of rawPlayerRows as any[]) {
    const name = row.players?.name
    if (name) playerNames.set(row.player_id, name)
  }

  // Filter to played/live matches only (skip suggested-but-not-started)
  const matches = (rawMatchRows as any[])
    .filter(m => m.status === 'completed' || m.status === 'live')
    .sort((a, b) => {
      if (a.round_no !== b.round_no) return a.round_no - b.round_no
      return a.court_idx - b.court_idx
    })

  if (matches.length === 0) {
    console.log('Không có match nào completed/live trong session này.')
    process.exit(0)
  }

  // Build initial state (before any matches)
  const pvnaTolerance = 0.5
  let currentState = buildInitialState(playerRows, sessionId, courtCount, pvnaTolerance)

  console.log(`\n${'═'.repeat(65)}`)
  console.log(`SESSION REPLAY: ${sessionId}`)
  console.log(`Players: ${playerRows.length} | Courts: ${courtCount} | Matches: ${matches.length}`)
  console.log(`${'═'.repeat(65)}`)

  // Show player roster
  const sortedPlayers = [...currentState.players.values()]
    .filter(p => p.checked_out_at === null)
    .sort((a, b) => a.pvna - b.pvna)
  console.log(`\nROSTER (${sortedPlayers.length} người):`)
  const byLine = []
  for (let i = 0; i < sortedPlayers.length; i += 6) {
    byLine.push(sortedPlayers.slice(i, i + 6).map(p => {
      const name = playerNames.get(p.player_id)
      const label = name ? name.split(' ').pop() : p.player_id.slice(0, 6)
      return `${p.pvna.toFixed(2)}·${label}`
    }).join('  '))
  }
  console.log(byLine.join('\n'))

  // ──── Group matches by round ────
  const rounds = new Map<number, typeof matches>()
  for (const m of matches) {
    if (!rounds.has(m.round_no)) rounds.set(m.round_no, [])
    rounds.get(m.round_no)!.push(m)
  }

  let globalMatchIndex = 0   // tracks nextMatchIndex across rounds
  let totalOptimal = 0, totalTradeoff = 0, totalMismatch = 0, totalManual = 0

  for (const [roundNo, roundMatches] of [...rounds.entries()].sort((a, b) => a[0] - b[0])) {
    const displayRound = roundNo + 1
    console.log(`\n${'─'.repeat(65)}`)
    console.log(`VÒNG ${displayRound} — ${roundMatches.length} sân  (round_no=${roundNo} trong DB)`)
    console.log(`${'─'.repeat(65)}`)

    // Count required players at start of round
    const requiredAtRoundStart = [...currentState.players.values()]
      .filter(p => p.checked_out_at === null && !p.opted_rest && p.consecutive_rest >= 1)
    console.log(`Required (rest≥1): ${requiredAtRoundStart.length} người`)

    const roundBusyIds = new Set<string>()
    const sortedCourts = [...roundMatches].sort((a, b) => a.court_idx - b.court_idx)

    for (const actualMatch of sortedCourts) {
      globalMatchIndex++
      const courtLabel = `Sân ${actualMatch.court_idx + 1}`
      const nextMatchIndex = globalMatchIndex

      // Build court-specific busyIds (from previous courts in same round)
      const courtBusyIds = new Set(roundBusyIds)

      // Apply liveSelectionGuard (replicate UI quota protection)
      const guard = buildLiveSelectionGuard({ state: currentState, busyIds: new Set(courtBusyIds), nextMatchIndex })
      guard.protectedIds.forEach(id => courtBusyIds.add(id))

      const eligible = [...currentState.players.values()].filter(p =>
        p.checked_out_at === null && !p.opted_rest && !courtBusyIds.has(p.player_id)
      )
      const totalAvailable = [...currentState.players.values()].filter(p =>
        p.checked_out_at === null && !p.opted_rest && !roundBusyIds.has(p.player_id)
      )
      const guardedCount = totalAvailable.length - eligible.length
      const requiredInPool = eligible.filter(p => p.consecutive_rest >= 1)

      console.log(`\n  ── ${courtLabel} (Vòng ${displayRound}, #${nextMatchIndex}) ──`)
      const guardStr = guardedCount > 0 ? `, guarded=${guardedCount}` : ''
      console.log(`  Pool: ${eligible.length} eligible${guardStr} | Required(rest≥1): ${requiredInPool.length}`)

      // Run algorithm
      const exhaustiveDiag: ExhaustiveFallbackDiagnostic = {
        ran: false, timedOut: false, eligibleCount: 0,
        combinationsEvaluated: 0, bestPvnaDiff: null, bestHasTradeoffs: false, spentUnits: 0,
      }
      const result = suggestNextMatch(currentState, {
        busy_player_ids: [...courtBusyIds],
        court_idx: actualMatch.court_idx,
        max_alternatives: 80,
        _exhaustiveDiag: exhaustiveDiag,
      })

      const allAlts = result.alternatives
      const picked = allAlts.length > 0
        ? pickGuardedLiveAlternative(allAlts, currentState, pvnaTolerance, nextMatchIndex)
        : null

      // Find actual match in alternatives
      const actualTeamA = actualMatch.team_a as string[]
      const actualTeamB = actualMatch.team_b as string[]
      const actualAltIdx = allAlts.findIndex(a => altMatchesActual(a, actualTeamA, actualTeamB))
      const isManualOverride = actualAltIdx === -1
      const matchesUiPick = picked && !isManualOverride && altMatchesActual(picked, actualTeamA, actualTeamB)

      // Print actual match
      console.log(`  Actual:   [${teamLabel(actualTeamA, currentState, playerNames)}] vs [${teamLabel(actualTeamB, currentState, playerNames)}]`)

      if (picked) {
        const pickedMetrics = computeMetrics(picked, currentState, nextMatchIndex, pvnaTolerance)
        const intraTag = pickedMetrics.isClean ? 'CLEAN' : pickedMetrics.isHardOk ? `intra=${pickedMetrics.intraGap.toFixed(2)}` : `HARD=${pickedMetrics.intraGap.toFixed(2)}`
        console.log(`  UI pick:  ${altLabel(picked, currentState, playerNames)}`)
        console.log(`            pvna_diff=${pickedMetrics.pvnaGap.toFixed(2)}  ${intraTag}  quota.over=${pickedMetrics.quota.over}  score ${scoreBreakdown(pickedMetrics)}`)

        const notableWarns = (picked.warnings ?? []).filter(w => !['MUST_PLAY_OVER_CAPACITY'].includes(w))
        if (notableWarns.length) console.log(`            warnings: ${notableWarns.join(', ')}`)
        if (picked.tradeoffs?.length) console.log(`            tradeoffs: ${picked.tradeoffs.map((t: any) => t.type).join(', ')}`)
      }

      // Verdict
      if (isManualOverride) {
        const validity = computeActualComboValidity(actualTeamA, actualTeamB, currentState, pvnaTolerance)
        const intraTag = validity.isClean ? 'CLEAN' : `intra=${validity.intraGap.toFixed(2)}`
        const diagStr = exhaustiveDiag.ran
          ? `exhaustive: ${exhaustiveDiag.combinationsEvaluated} combos, ${exhaustiveDiag.spentUnits} units`
          : 'exhaustive: không chạy (primary tìm thấy clean combo)'
        if (validity.isValid) {
          console.log(`  ⚠️  VALID COMBO không trong pool — pvna=${validity.pvnaGap.toFixed(2)} ${intraTag} (${diagStr})`)
          console.log(`      Algorithm không explore combo này — có thể operator chọn alt trong UI khác với replay.`)
        } else {
          console.log(`  ❌  INVALID COMBO — pvna=${validity.pvnaGap.toFixed(2)} intra=${validity.intraGap.toFixed(2)} (vượt giới hạn) | ${diagStr}`)
        }
        totalManual++
      } else if (matchesUiPick) {
        console.log(`  ✅ Khớp UI pick`)
        totalOptimal++
      } else {
        // Actual was an alternative but not the top pick
        const actualMetrics = allAlts[actualAltIdx]
          ? computeMetrics(allAlts[actualAltIdx], currentState, nextMatchIndex, pvnaTolerance)
          : null
        const pickedMetrics = picked ? computeMetrics(picked, currentState, nextMatchIndex, pvnaTolerance) : null
        if (actualMetrics && pickedMetrics) {
          if (actualMetrics.score < pickedMetrics.score - 0.01) {
            console.log(`  🔵 Actual tốt hơn UI pick (score ${actualMetrics.score.toFixed(1)} < ${pickedMetrics.score.toFixed(1)}) — có thể operator đã chọn thủ công`)
            totalMismatch++
          } else if (actualMetrics.score > pickedMetrics.score + 0.01) {
            console.log(`  🟡 Actual kém hơn UI pick (score ${actualMetrics.score.toFixed(1)} > ${pickedMetrics.score.toFixed(1)}) — operator chọn alt thấp hơn`)
            totalMismatch++
          } else {
            console.log(`  🟢 Actual là alt cùng score với UI pick (tie)`)
            totalTradeoff++
          }
        }
      }

      // Top alternatives
      if (allAlts.length > 0) {
        console.log(`  Top alts (${allAlts.length} total):`)
        const topN = Math.min(5, allAlts.length)
        for (let i = 0; i < topN; i++) {
          const a = allAlts[i]
          const m = computeMetrics(a, currentState, nextMatchIndex, pvnaTolerance)
          const isUiPick = picked && altMatchesActual(picked, a.matches[0]?.team_a ?? [], a.matches[0]?.team_b ?? [])
          const isActual = altMatchesActual(a, actualTeamA, actualTeamB)
          const tags = [isUiPick ? '← UI pick' : '', isActual ? '← actual' : ''].filter(Boolean).join(' ')
          const cleanTag = m.isClean ? 'CLEAN' : m.isHardOk ? `intra=${m.intraGap.toFixed(2)}` : `HARD=${m.intraGap.toFixed(2)}`
          console.log(`    [${i}] ${altLabel(a, currentState, playerNames)} | pvna=${m.pvnaGap.toFixed(2)} ${cleanTag} q.over=${m.quota.over} score=${m.score.toFixed(1)}${tags ? '  ' + tags : ''}`)
        }
      } else {
        console.log(`  Không có alternatives — algorithm không thể suggest`)
      }

      // Mark actual players busy for subsequent courts in this round
      for (const id of [...actualTeamA, ...actualTeamB]) roundBusyIds.add(id)
    }

    // ──── Advance state after round ────
    // 1. Apply each match (updates matches_played, partner/opponent counts)
    const playedInRound = new Set<string>()
    for (const match of roundMatches) {
      currentState = buildProjectedStateAfterLiveMatch(
        currentState,
        {
          id: match.id,
          session_id: sessionId,
          court_idx: match.court_idx,
          team_a: match.team_a,
          team_b: match.team_b,
          status: match.status,
          round_no: match.round_no,
          sequence_no: match.sequence_no,
          started_at: match.started_at,
          ended_at: match.ended_at,
          suggested_at: match.suggested_at,
          score_a: 0,
          score_b: 0,
          resting: [],
        },
        match.round_no,
      )
      for (const id of [...match.team_a, ...match.team_b]) playedInRound.add(id)
    }
    // 2. Increment consecutive_rest for those who didn't play
    currentState = buildProjectedStateAfterCompletedLiveRound(currentState, playedInRound)

    // Print round summary
    const roundPlayers = [...currentState.players.values()].filter(p => p.checked_out_at === null)
    const avgMatches = roundPlayers.reduce((s, p) => s + p.matches_played, 0) / Math.max(1, roundPlayers.length)
    const maxRest = Math.max(...roundPlayers.map(p => p.consecutive_rest))
    const newRequired = roundPlayers.filter(p => !p.opted_rest && p.consecutive_rest >= 1).length
    console.log(`\n  Sau vòng ${displayRound}: avg matches=${avgMatches.toFixed(1)} | max consecutive_rest=${maxRest} | required cho vòng sau: ${newRequired}`)
  }

  // ──── Summary ────
  console.log(`\n${'═'.repeat(65)}`)
  console.log(`TỔNG KẾT REPLAY`)
  console.log(`  ✅ Khớp UI pick:   ${totalOptimal}`)
  console.log(`  🟢/🟡 Alt khác:    ${totalMismatch + totalTradeoff}  (operator chọn alt thay vì UI pick)`)
  console.log(`  ⚠️  Không trong pool: ${totalManual}  (valid combo nhưng algorithm không explore trong replay)`)
  console.log()
  console.log('Mỗi sân: actual (DB) so với UI pick (algorithm + pickGuardedLiveAlternative).')
  console.log('"Không trong pool" = combo hợp lệ nhưng algorithm không explore (UUID-sort bias hoặc version khác).')
}

main().catch(console.error)
