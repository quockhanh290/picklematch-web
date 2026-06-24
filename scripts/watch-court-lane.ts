/**
 * Watch court lane board flow in real-time, then reconcile with engine on Ctrl+C.
 *
 * Usage:  npx tsx scripts/watch-court-lane.ts [session_id]
 * Ctrl+C: stops watching, prints reconcile report
 */
import { writeFileSync, readFileSync } from 'fs'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import {
  getAlternativeIntraTeamGap,
  getAlternativePvnaGap,
  getAlternativeRepeatMetrics,
} from '../lib/next-round-suggester/live-preview'
import { calculateOptimalCourts } from '../lib/court-calculator/calculator'
import type { SessionState, SuggestionAlternative } from '../lib/next-round-suggester/types'

// Inline copy of lib/skillAssessment.ts#eloToPvna — cannot import that module (transitively pulls react-native).
function eloToPvna(elo: number): number {
  if (elo <= 800) return 2.1
  if (elo <= 1000) return 2.1 + (elo - 800) * (0.5 / 200)
  if (elo <= 1150) return 2.6 + (elo - 1000) * (0.5 / 150)
  if (elo <= 1300) return 3.1 + (elo - 1150) * (0.5 / 150)
  if (elo <= 1450) return 3.6 + (elo - 1300) * (1.0 / 150)
  if (elo <= 1600) return 4.6 + (elo - 1450) * (0.9 / 150)
  return 5.5 + (elo - 1600) * (0.1 / 200)
}

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'
const SESSION_ID = process.argv[2] ?? '045379a0-b186-42f3-be23-7d243702aa1c'
const SNAPSHOT_ARG = process.argv.indexOf('--snapshot') !== -1 ? process.argv[process.argv.indexOf('--snapshot') + 1] : null
const FROM_SNAPSHOT_ARG = process.argv.indexOf('--from-snapshot') !== -1 ? process.argv[process.argv.indexOf('--from-snapshot') + 1] : null
const AUTO_SNAPSHOT_DIR = process.argv.indexOf('--auto-snapshot') !== -1 ? process.argv[process.argv.indexOf('--auto-snapshot') + 1] : null
const POLL_MS = 2500

async function query(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

function ts() {
  return new Date().toLocaleTimeString('vi-VN', { hour12: false })
}

function fmtTeam(ids: string[], nameMap: Map<string, string>, state: SessionState) {
  return ids.map(id => {
    const p = state.players.get(id)
    return `${nameMap.get(id) ?? id.slice(0, 6)}(${p?.pvna?.toFixed(1) ?? '?'})`
  }).join('+')
}

function qualityLabel(alt: SuggestionAlternative, state: SessionState) {
  const pvnaGap = getAlternativePvnaGap(alt)
  const intraGap = getAlternativeIntraTeamGap(alt, state)
  const repeat = getAlternativeRepeatMetrics(alt, state)
  const parts = [`pvna_gap=${pvnaGap.toFixed(2)}`, `intra=${intraGap.toFixed(2)}`]
  if (repeat.max_partner_pair > 0) parts.push(`partner_repeat=${repeat.max_partner_pair}`)
  if (repeat.max_opponent_pair > 0) parts.push(`opp_repeat=${repeat.max_opponent_pair}`)
  return parts.join(' ')
}

interface MatchRecord {
  id: string
  status: string
  court_idx: number | null
  round_no: number | null
  sequence_no: number
  team_a: string[]
  team_b: string[]
  started_at: string | null
  ended_at: string | null
  score_a: number | null
  score_b: number | null
}

const seenStatus = new Map<string, string>()
const matchLog: Array<{ event: string; match: MatchRecord }> = []
let nameMap = new Map<string, string>()
let lastState: SessionState | null = null
let courts = 6
let pvnaTolerance = 0.5
let lastEngineKey = ''
let lastFetchedData: { playerRows: any[]; pairRows: any[]; liveMatchRows: any[]; avoidPairs: any[]; settings: any } | null = null
let autoSnapshotCount = 0

// Replicate get_live_session_snapshot_versioned: no minimum court count filter,
// resting computed from checked_in_at <= round.started_at (not from current presence).
function buildRoundRows(completedLive: any[], rawPlayerRows: any[]): any[] {
  if (completedLive.length === 0) return []
  if (!completedLive.every((m: any) => m.round_no != null)) return []

  const byRound = new Map<number, any[]>()
  for (const m of completedLive) {
    const rows = byRound.get(m.round_no) ?? []; rows.push(m); byRound.set(m.round_no, rows)
  }

  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, matches]) => {
      const roundStartedAt = matches.reduce((min: string | null, m: any) =>
        m.started_at && (!min || m.started_at < min) ? m.started_at : min, null as string | null)
      const roundEndedAt = matches.reduce((max: string | null, m: any) =>
        m.ended_at && (!max || m.ended_at > max) ? m.ended_at : max, null as string | null)
      const playedIds = new Set(matches.flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])]))
      const resting = rawPlayerRows
        .filter((p: any) => !p.checked_out_at)
        .filter((p: any) => !roundStartedAt || !p.checked_in_at || p.checked_in_at <= roundStartedAt)
        .filter((p: any) => !playedIds.has(p.player_id))
        .map((p: any) => p.player_id)
      return {
        id: matches[0].id,
        session_id: SESSION_ID,
        round_no: matches[0].round_no,
        status: 'completed',
        matches: [...matches]
          .sort((a: any, b: any) => (a.court_idx ?? 0) - (b.court_idx ?? 0))
          .map((m: any) => ({ court_idx: m.court_idx ?? 0, team_a: m.team_a, team_b: m.team_b })),
        resting,
        started_at: roundStartedAt,
        ended_at: roundEndedAt,
      }
    })
}

// Simulate the UI's exact iterative call sequence: count=2 per call, replace_courts for subsequent.
// Each call has different liveMatchRows (retained previews from previous calls) → different seed → same partners as UI.
// targetCourtIdxs: specific courts to fill (mid-round). undefined = all courts (full_board start).
async function callEdgeSuggestIterative(
  rawPlayerRows: any[],
  pairRows: any[],
  roundRows: any[],
  baseLiveMatchRows: any[],
  avoidPairs: any[],
  targetCourtIdxs?: number[],
  // Existing preview board to build upon — mid-round continuity, same as UI's current_preview_board base.
  initialPreviewBoard: Array<{ court_idx: number; team_a: string[]; team_b: string[] }> = [],
  targetRounds?: number,
  courtPreset?: string,
): Promise<Array<{ court_idx: number; team_a: string[]; team_b: string[] }>> {
  const allTarget = targetCourtIdxs ?? Array.from({ length: courts }, (_, i) => i)
  if (allTarget.length === 0) return []

  const BATCH_SIZE = 2
  const players = rawPlayerRows.map((r: any) => ({ id: r.player_id, name: r.players?.name ?? r.player_id.slice(0, 6) }))
  const countableCount = baseLiveMatchRows.filter((r: any) => r.status !== 'cancelled').length
  let previewBoard = [...initialPreviewBoard]

  for (let iter = 0; iter <= Math.ceil(allTarget.length / BATCH_SIZE) + 1; iter++) {
    const filledIdxs = new Set(previewBoard.map(m => m.court_idx))
    const missing = allTarget.filter(idx => !filledIdxs.has(idx))
    if (missing.length === 0) break

    const nowIso = new Date().toISOString()
    const retained = previewBoard.map((m, i) => ({
      ...m, id: `retained-preview-busy-${i}`, sequence_no: countableCount + i, status: 'suggested', suggested_at: nowIso,
    }))
    const res = await fetch(`${SUPABASE_URL}/functions/v1/session-live-matches-suggest/sessions/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        mode: 'replace_courts',
        count: Math.min(BATCH_SIZE, missing.length),
        court_count: courts,
        pvna_tolerance: pvnaTolerance,
        court_idxs: missing.slice(0, BATCH_SIZE),
        current_preview_board: previewBoard,
        live_match_rows: [...baseLiveMatchRows, ...retained],
        live_state_version: null,
        completing_live_match_ids: [],
        players,
        player_rows: rawPlayerRows,
        pair_rows: pairRows,
        round_rows: roundRows,
        current_courts: courts,
        avoid_pairs: avoidPairs.length > 0 ? avoidPairs : undefined,
        planned_total_rounds: targetRounds,
        court_preset: courtPreset,
      }),
    })
    if (!res.ok) throw new Error(`Edge function iter${iter}: ${res.status} ${await res.text()}`)
    const result = await res.json() as { ok: boolean; final_preview_board: Array<{ court_idx: number; team_a: string[]; team_b: string[] }>; error?: string }
    if (!result.ok) throw new Error(result.error ?? 'edge function returned ok=false')
    for (const p of result.final_preview_board) {
      if (!filledIdxs.has(p.court_idx)) previewBoard.push(p)
    }
    if (result.final_preview_board.length === 0) break
  }

  return previewBoard.sort((a, b) => a.court_idx - b.court_idx)
}

async function poll() {
  const [rawPlayerRowsRaw, sessionPlayersRows, pairRows, [settings], liveMatchRows, avoidPairs] = await Promise.all([
    query('session_player_state', { session_id: `eq.${SESSION_ID}`, select: '*,players(pvna,elo,current_elo,gender,name,partner_gender_pref,opponent_gender_pref)' }),
    query('session_players', { session_id: `eq.${SESSION_ID}`, select: 'player_id,status,check_in_status,metadata' }),
    query('session_pair_history', { session_id: `eq.${SESSION_ID}`, select: '*' }),
    query('session_next_round_settings', { session_id: `eq.${SESSION_ID}`, select: 'court_count_override,pvna_tolerance,target_rounds,court_preset' }),
    query('session_live_matches', { session_id: `eq.${SESSION_ID}`, select: '*', order: 'sequence_no.asc' }),
    query('session_avoid_pairs', { session_id: `eq.${SESSION_ID}`, select: '*' }),
  ])
  const sessionPlayersMap = new Map((sessionPlayersRows as any[]).map((sp: any) => [sp.player_id, sp]))
  // Merge session_players into player rows to match snapshot RPC format (needed for gender pref metadata).
  // Also apply the same pvna override as UI (getPlayerPvna): prefer players.pvna, else eloToPvna(current_elo ?? elo).
  // This avoids normalizePvna's toFixed(2) rounding inside the edge function producing a different previewSeedBase.
  const rawPlayerRows = (rawPlayerRowsRaw as any[]).map((row: any) => {
    const sp = sessionPlayersMap.get(row.player_id)
    const rawPvna: number | null = row.players?.pvna ?? null
    const resolvedPvna: number | null = rawPvna != null ? rawPvna
      : (row.players?.current_elo ?? row.players?.elo) != null
        ? eloToPvna(Number(row.players?.current_elo ?? row.players?.elo))
        : null
    return {
      ...row,
      players: resolvedPvna != null ? { ...row.players, pvna: resolvedPvna } : row.players,
      ...(sp ? { session_players: { status: sp.status, check_in_status: sp.check_in_status, metadata: sp.metadata } } : {}),
    }
  })

  lastFetchedData = { playerRows: rawPlayerRows, pairRows: pairRows as any[], liveMatchRows: liveMatchRows as any[], avoidPairs: avoidPairs as any[], settings }

  const n = (rawPlayerRows as any[]).filter((r: any) => !r.checked_out_at).length
  courts = Number(settings?.court_count_override ?? calculateOptimalCourts({ n_players: n, session_duration_min: 90, match_duration_min: 15, preset: 'balanced' }).recommended.courts)
  pvnaTolerance = Number(settings?.pvna_tolerance ?? 0.5)
  const targetRounds: number | undefined = settings?.target_rounds ?? undefined
  const courtPreset: string | undefined = settings?.court_preset ?? undefined

  nameMap = new Map(rawPlayerRows.map((r: any) => [r.player_id, r.players?.name ?? r.player_id.slice(0, 6)]))

  const completedLive = (liveMatchRows as any[])
    .filter((m: any) => m.status === 'completed')
    .sort((a: any, b: any) => a.sequence_no - b.sequence_no)
  const roundRows = buildRoundRows(completedLive, rawPlayerRows)

  // Local state — only for quality labels in event log (pvna, partner history)
  const playerRowsForState = (rawPlayerRows as any[]).map((row: any) => ({
    ...row,
    players: {
      pvna: row.effective_pvna ?? row.players?.pvna ?? null,
      elo: row.players?.elo ?? row.players?.current_elo ?? null,
      gender: row.players?.gender ?? null,
      partner_gender_pref: row.players?.partner_gender_pref ?? null,
      opponent_gender_pref: row.players?.opponent_gender_pref ?? null,
    },
  }))
  lastState = mapRowsToSessionState({ sessionId: SESSION_ID, playerRows: playerRowsForState, pairRows, roundRows, courts, pvnaTolerance })

  // Detect which courts are currently occupied by live (in-progress) matches.
  const liveCourts = new Set(
    (liveMatchRows as any[])
      .filter((m: any) => m.status === 'live')
      .map((m: any) => m.court_idx)
      .filter((idx: any) => idx != null),
  )
  const allCourtIdxs = Array.from({ length: courts }, (_, i) => i)
  const emptyCourts = allCourtIdxs.filter(i => !liveCourts.has(i))

  // Detect courts that just completed this poll (were live last poll, now empty).
  // These need a fresh edge call — reusing their pre-round suggestion would silently show stale data
  // and produce an identical engineKey to before they went live, suppressing the print.
  // Show DB-suggested matches first (mirrors what UI displays).
  // Only call engine for empty courts that have no suggestion in DB.
  const dbSuggested = (liveMatchRows as any[])
    .filter((m: any) => m.status === 'suggested' && m.court_idx != null && emptyCourts.includes(m.court_idx))
    .sort((a: any, b: any) => a.court_idx - b.court_idx)
  const dbSuggestedCourtIdxs = new Set(dbSuggested.map((m: any) => m.court_idx))
  const missingCourtIdxs = emptyCourts.filter(idx => !dbSuggestedCourtIdxs.has(idx))

  let engineLines: string[] = []
  try {
    let edgeBoard: Array<{ court_idx: number; team_a: string[]; team_b: string[] }> = [
      ...dbSuggested.map((m: any) => ({ court_idx: m.court_idx, team_a: m.team_a, team_b: m.team_b })),
    ]

    if (missingCourtIdxs.length > 0) {
      const retainedBoard = dbSuggested.map((m: any) => ({ court_idx: m.court_idx, team_a: m.team_a, team_b: m.team_b }))
      const filled = await callEdgeSuggestIterative(
        rawPlayerRows, pairRows, roundRows, liveMatchRows, avoidPairs,
        missingCourtIdxs, retainedBoard, targetRounds, courtPreset,
      )
      edgeBoard = filled
    }

    for (const p of edgeBoard) {
      const alt: SuggestionAlternative = { matches: [{ court_idx: p.court_idx, team_a: p.team_a as [string, string], team_b: p.team_b as [string, string] }], resting: [], score: 0, warnings: [], stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 } }
      const pvnaGap = getAlternativePvnaGap(alt)
      const intraGap = getAlternativeIntraTeamGap(alt, lastState!)
      const repeat = getAlternativeRepeatMetrics(alt, lastState!)
      const flags = [repeat.max_partner_pair > 0 ? `partner×${repeat.max_partner_pair}` : ''].filter(Boolean).join(' ')
      engineLines.push(`  Sân ${p.court_idx + 1}: ${fmtTeam(p.team_a, nameMap, lastState!)} vs ${fmtTeam(p.team_b, nameMap, lastState!)}  [pvna_gap=${pvnaGap.toFixed(2)} intra=${intraGap.toFixed(2)}${flags ? ' ' + flags : ''}]`)
    }
    if (engineLines.length === 0) engineLines.push('  no suggestions (engine returned empty board)')
  } catch (e) {
    engineLines = [`  ENGINE ERROR: ${e instanceof Error ? e.stack : e}`]
  }

  const engineKey = engineLines.join('|')
  if (engineKey !== lastEngineKey) {
    lastEngineKey = engineKey
    const liveCount = liveCourts.size
    const label = liveCount > 0 ? `filling courts [${emptyCourts.map(i => i + 1).join(',')}]` : `${courts} courts`
    const activePlayers = [...lastState!.players.values()].filter(p => p.checked_out_at === null && !p.opted_rest)
    console.log(`\n[${ts()}] ENGINE SUGGEST (${liveCount} live, ${lastState!.players.size} players, ${label}):`)
    console.log(`  Active pool (${activePlayers.length}): ${activePlayers.map(p => nameMap.get(p.player_id) ?? p.player_id.slice(0,6)).sort().join(', ')}`)
    for (const line of engineLines) console.log(line)
    if (AUTO_SNAPSHOT_DIR && lastFetchedData) {
      autoSnapshotCount++
      const fname = `${AUTO_SNAPSHOT_DIR}/snap-${autoSnapshotCount.toString().padStart(2, '0')}-live${liveCount}-empty${emptyCourts.map(i => i + 1).join('')}.json`
      writeFileSync(fname, JSON.stringify({ session_id: SESSION_ID, captured_at: new Date().toISOString(), ...lastFetchedData }, null, 2), 'utf-8')
      console.log(`  → snapshot saved: ${fname}`)
    }
  } else {
    process.stdout.write(`[${ts()}] poll: ${(liveMatchRows as any[]).length} DB matches (no change)\r`)
  }

  for (const m of liveMatchRows as MatchRecord[]) {
    const prev = seenStatus.get(m.id)
    if (prev === m.status) continue

    const courtLabel = m.court_idx != null ? `Sân ${m.court_idx + 1}` : 'Sân ?'
    const roundLabel = m.round_no != null ? `R${m.round_no}` : ''

    if (m.status === 'suggested') {
      const alt: SuggestionAlternative = { matches: [{ court_idx: m.court_idx ?? 0, team_a: m.team_a as [string, string], team_b: m.team_b as [string, string] }], resting: [], score: 0, warnings: [], stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 } }
      const q = qualityLabel(alt, lastState!)
      console.log(`[${ts()}] ${courtLabel} ${roundLabel} SUGGEST  ${fmtTeam(m.team_a, nameMap, lastState!)} vs ${fmtTeam(m.team_b, nameMap, lastState!)}  [${q}]`)
      matchLog.push({ event: 'suggested', match: m })
    } else if (m.status === 'live') {
      const alt: SuggestionAlternative = { matches: [{ court_idx: m.court_idx ?? 0, team_a: m.team_a as [string, string], team_b: m.team_b as [string, string] }], resting: [], score: 0, warnings: [], stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 } }
      const q = qualityLabel(alt, lastState!)
      const wasSwapped = prev === 'suggested' ? '' : prev === undefined ? ' [DIRECT]' : ' [?]'
      console.log(`[${ts()}] ${courtLabel} ${roundLabel} STARTED${wasSwapped}  ${fmtTeam(m.team_a, nameMap, lastState!)} vs ${fmtTeam(m.team_b, nameMap, lastState!)}  [${q}]`)
      matchLog.push({ event: 'started', match: m })
    } else if (m.status === 'completed') {
      const score = `${m.score_a ?? '?'}-${m.score_b ?? '?'}`
      console.log(`[${ts()}] ${courtLabel} ${roundLabel} DONE     ${fmtTeam(m.team_a, nameMap, lastState!)} vs ${fmtTeam(m.team_b, nameMap, lastState!)}  ${score}`)
      matchLog.push({ event: 'completed', match: m })
    } else if (m.status === 'cancelled') {
      console.log(`[${ts()}] ${courtLabel} ${roundLabel} CANCEL   ${fmtTeam(m.team_a, nameMap, lastState!)} vs ${fmtTeam(m.team_b, nameMap, lastState!)}`)
      matchLog.push({ event: 'cancelled', match: m })
    }

    seenStatus.set(m.id, m.status)
  }
}

function reconcile() {
  if (!lastState) { console.log('\nNo data collected.'); return }

  console.log('\n' + '='.repeat(60))
  console.log('RECONCILE REPORT')
  console.log('='.repeat(60))

  const completed = matchLog.filter(e => e.event === 'completed').map(e => e.match)
  const cancelled = matchLog.filter(e => e.event === 'cancelled').length
  console.log(`\nMatches completed: ${completed.length}  |  Cancelled/swapped: ${cancelled}`)

  if (completed.length > 0) {
    console.log('\n--- Quality per completed match ---')
    let totalPvnaGap = 0, totalIntra = 0
    for (const m of completed.sort((a, b) => a.sequence_no - b.sequence_no)) {
      const alt: SuggestionAlternative = { matches: [{ court_idx: m.court_idx ?? 0, team_a: m.team_a as [string, string], team_b: m.team_b as [string, string] }], resting: [], score: 0, warnings: [], stats: { pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0, group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0 } }
      const pvnaGap = getAlternativePvnaGap(alt)
      const intraGap = getAlternativeIntraTeamGap(alt, lastState!)
      const repeat = getAlternativeRepeatMetrics(alt, lastState!)
      totalPvnaGap += pvnaGap; totalIntra += intraGap
      const courtLabel = m.court_idx != null ? `Sân ${m.court_idx + 1}` : 'Sân ?'
      const roundLabel = m.round_no != null ? `R${m.round_no}` : ''
      const flags = [
        pvnaGap > 1.5 ? '⚠ pvna_gap' : '',
        intraGap > 1.2 ? '⚠ intra' : '',
        repeat.max_partner_pair > 0 ? `⚠ partner_repeat×${repeat.max_partner_pair}` : '',
      ].filter(Boolean).join(' ')
      console.log(`  ${courtLabel} ${roundLabel}: pvna_gap=${pvnaGap.toFixed(2)} intra=${intraGap.toFixed(2)} ${flags || '✓'}`)
      console.log(`    ${fmtTeam(m.team_a, nameMap, lastState!)} vs ${fmtTeam(m.team_b, nameMap, lastState!)}`)
    }
    console.log(`\nAvg pvna_gap: ${(totalPvnaGap / completed.length).toFixed(2)}  avg_intra: ${(totalIntra / completed.length).toFixed(2)}`)
  }

  console.log('\n' + '='.repeat(60))
}

async function fetchSessionData() {
  const [rawPlayerRowsRaw, sessionPlayersRows, pairRows, [settings], liveMatchRows, avoidPairs] = await Promise.all([
    query('session_player_state', { session_id: `eq.${SESSION_ID}`, select: '*,players(pvna,elo,current_elo,gender,name,partner_gender_pref,opponent_gender_pref)' }),
    query('session_players', { session_id: `eq.${SESSION_ID}`, select: 'player_id,status,check_in_status,metadata' }),
    query('session_pair_history', { session_id: `eq.${SESSION_ID}`, select: '*' }),
    query('session_next_round_settings', { session_id: `eq.${SESSION_ID}`, select: 'court_count_override,pvna_tolerance,target_rounds,court_preset' }),
    query('session_live_matches', { session_id: `eq.${SESSION_ID}`, select: '*', order: 'sequence_no.asc' }),
    query('session_avoid_pairs', { session_id: `eq.${SESSION_ID}`, select: '*' }),
  ])
  const sessionPlayersMap = new Map((sessionPlayersRows as any[]).map((sp: any) => [sp.player_id, sp]))
  const playerRows = (rawPlayerRowsRaw as any[]).map((row: any) => {
    const sp = sessionPlayersMap.get(row.player_id)
    const rawPvna: number | null = row.players?.pvna ?? null
    const resolvedPvna: number | null = rawPvna != null ? rawPvna
      : (row.players?.current_elo ?? row.players?.elo) != null
        ? eloToPvna(Number(row.players?.current_elo ?? row.players?.elo))
        : null
    return {
      ...row,
      players: resolvedPvna != null ? { ...row.players, pvna: resolvedPvna } : row.players,
      ...(sp ? { session_players: { status: sp.status, check_in_status: sp.check_in_status, metadata: sp.metadata } } : {}),
    }
  })
  const data = { playerRows, pairRows: pairRows as any[], liveMatchRows: liveMatchRows as any[], avoidPairs: avoidPairs as any[], settings }
  lastFetchedData = data
  return data
}

async function snapshotMode(outFile: string) {
  console.log(`Fetching session ${SESSION_ID}…`)
  const data = await fetchSessionData()
  const snapshot = { session_id: SESSION_ID, captured_at: new Date().toISOString(), ...data }
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf-8')
  const live = data.liveMatchRows.filter((m: any) => m.status === 'live').length
  const completed = data.liveMatchRows.filter((m: any) => m.status === 'completed').length
  const players = data.playerRows.filter((r: any) => !r.checked_out_at).length
  console.log(`Saved snapshot → ${outFile}`)
  console.log(`  ${players} active players  |  ${live} live  |  ${completed} completed  |  ${data.pairRows.length} pair history rows`)
}

async function fromSnapshotMode(snapshotFile: string) {
  const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf-8'))
  const { playerRows, pairRows, liveMatchRows, avoidPairs, settings } = snapshot
  console.log(`Loaded snapshot: ${snapshot.session_id} @ ${snapshot.captured_at}`)

  const n = (playerRows as any[]).filter((r: any) => !r.checked_out_at).length
  const courtCount = Number(settings?.court_count_override ?? calculateOptimalCourts({ n_players: n, session_duration_min: 90, match_duration_min: 15, preset: 'balanced' }).recommended.courts)
  const pvnaTol = Number(settings?.pvna_tolerance ?? 0.5)
  const targetRounds: number | undefined = settings?.target_rounds ?? undefined
  const courtPreset: string | undefined = settings?.court_preset ?? undefined

  nameMap = new Map((playerRows as any[]).map((r: any) => [r.player_id, r.players?.name ?? r.player_id.slice(0, 6)]))

  const completedLive = (liveMatchRows as any[]).filter((m: any) => m.status === 'completed').sort((a: any, b: any) => a.sequence_no - b.sequence_no)
  const roundRows = buildRoundRows(completedLive, playerRows)

  const playerRowsForState = (playerRows as any[]).map((row: any) => ({
    ...row,
    players: { pvna: row.effective_pvna ?? row.players?.pvna ?? null, ...row.players },
  }))
  lastState = mapRowsToSessionState({ playerRows: playerRowsForState as any, pairRows: pairRows as any, roundRows })

  const liveCourts = new Set((liveMatchRows as any[]).filter((m: any) => m.status === 'live').map((m: any) => m.court_idx))
  const emptyCourts = Array.from({ length: courtCount }, (_, i) => i).filter(i => !liveCourts.has(i))

  console.log(`  ${n} active players | ${courtCount} courts | ${liveCourts.size} live | empty: [${emptyCourts.map(i => i + 1).join(',')}]`)

  const board = await callEdgeSuggestIterative(playerRows, pairRows, roundRows, liveMatchRows, avoidPairs, emptyCourts, [], targetRounds, courtPreset)

  console.log(`\n[FROM SNAPSHOT] Engine suggestions:`)
  for (const p of board) {
    const fmtIds = (ids: string[]) => ids.map(id => {
      const st = lastState!.players.get(id)
      return `${nameMap.get(id) ?? id.slice(0, 6)}(${st?.pvna?.toFixed(1) ?? '?'})`
    }).join('+')
    console.log(`  Sân ${p.court_idx + 1}: ${fmtIds(p.team_a)} vs ${fmtIds(p.team_b)}`)
  }
}

async function main() {
  if (SNAPSHOT_ARG) { await snapshotMode(SNAPSHOT_ARG); return }
  if (FROM_SNAPSHOT_ARG) { await fromSnapshotMode(FROM_SNAPSHOT_ARG); return }

  console.log(`Watching session ${SESSION_ID} — Ctrl+C to stop and reconcile`)
  if (AUTO_SNAPSHOT_DIR) console.log(`Auto-snapshot → ${AUTO_SNAPSHOT_DIR}/snap-NN-*.json`)
  console.log(`Polling every ${POLL_MS}ms...\n`)

  await poll()

  const timer = setInterval(async () => {
    try { await poll() } catch (e) { console.error(`Poll error: ${e}`) }
  }, POLL_MS)

  process.on('SIGINT', () => {
    clearInterval(timer)
    reconcile()
    process.exit(0)
  })
}

main().catch(console.error)
