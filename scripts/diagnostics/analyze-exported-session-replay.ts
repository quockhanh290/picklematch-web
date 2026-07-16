import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { summarizeRollingHorizonDetails } from '../../lib/next-round-suggester/planner/rolling-diagnostics'

type AnyRow = Record<string, any>

const dir = process.argv[2]

if (!dir) {
  console.error('Usage: npx tsx scripts/diagnostics/analyze-exported-session-replay.ts <export-dir>')
  process.exit(1)
}

function file(name: string) {
  return path.join(dir, name)
}

async function readJsonl<T = AnyRow>(filePath: string): Promise<T[]> {
  const rows: T[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    rows.push(JSON.parse(trimmed))
  }
  return rows
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const key = keyFn(row)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function minute(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 16)
}

function arr(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function num(value: any): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function missingOpenCourts(row: AnyRow): any[] {
  return arr(row.payload?.missing_open_courts ?? row.missing_courts)
}

function missingTargetCourts(row: AnyRow): any[] {
  const payload = row.payload ?? {}
  if (Array.isArray(payload.missing_target_courts)) return payload.missing_target_courts
  if (payload.partial_full_board_request === true) return []
  return missingOpenCourts(row)
}

function targetCountShortfall(row: AnyRow): number {
  return Math.max(0, num(row.payload?.target_count_shortfall) ?? 0)
}

function hasTargetIssue(row: AnyRow): boolean {
  return missingTargetCourts(row).length > 0 || targetCountShortfall(row) > 0
}

function summarizeWarnings(dumps: AnyRow[]) {
  const warnings: Record<string, number> = {}
  const tradeoffs: Record<string, number> = {}
  for (const dump of dumps) {
    for (const match of arr(dump.chosen_matches)) {
      for (const warning of arr(match.warnings)) {
        const key = typeof warning === 'string' ? warning : warning?.type ?? warning?.code ?? JSON.stringify(warning)
        warnings[key] = (warnings[key] ?? 0) + 1
      }
      for (const tradeoff of arr(match.tradeoffs)) {
        const key = typeof tradeoff === 'string' ? tradeoff : tradeoff?.type ?? tradeoff?.code ?? JSON.stringify(tradeoff)
        tradeoffs[key] = (tradeoffs[key] ?? 0) + 1
      }
    }
    for (const warning of arr(dump.payload?.fairness?.warnings)) {
      const key = warning?.type ?? warning?.code ?? warning?.message ?? JSON.stringify(warning)
      warnings[`fairness:${key}`] = (warnings[`fairness:${key}`] ?? 0) + 1
    }
  }
  return { warnings: countObject(warnings), tradeoffs: countObject(tradeoffs) }
}

function countObject(input: Record<string, number>) {
  return Object.fromEntries(Object.entries(input).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function compactDump(row: AnyRow) {
  const payload = row.payload ?? {}
  const derived = payload.derived_state_summary ?? {}
  const engine = payload.engine_decision ?? {}
  const selection = arr(payload.selection_debug)
  const selectionCount = selection.length || num(payload.selection_debug_count) || 0
  const finalBoardCount = arr(payload.final_preview_board).length || num(payload.final_preview_board_count) || 0
  const rawPayloadCount = arr(payload.raw_payloads_before_final_board).length || num(payload.raw_payloads_before_final_board_count) || 0
  const liveMatchRowsCount = arr(payload.live_match_rows).length || num(payload.live_match_summary?.total) || 0
  const busyIdsCount = arr(payload.busy_player_ids).length || (num(payload.derived_state_summary?.live_busy_players) ?? 0) + (num(payload.derived_state_summary?.suggested_busy_players) ?? 0)
  const eligibleCounts = selection.map((entry) => arr(entry.eligible_players).length)
  const busyCounts = selection.map((entry) => num(entry.busy_count) ?? 0)
  const selectedCourts = selection.map((entry) => ({
    court_idx: entry.court_idx,
    busy_count: entry.busy_count,
    eligible_count: arr(entry.eligible_players).length,
    selected_count: arr(entry.selected).length,
  }))
  return {
    id: row.id,
    created_at: row.created_at,
    source: row.decision_source,
    dump_level: payload.dump_level ?? 'legacy_full',
    full_dump_reason: payload.full_dump_reason ?? null,
    current_round: payload.current_round ?? derived.current_round ?? null,
    court_count: payload.court_count ?? null,
    chosen: arr(row.chosen_matches).length,
    missing: arr(row.missing_courts),
    missing_open: missingOpenCourts(row),
    missing_target: missingTargetCourts(row),
    target_count_shortfall: targetCountShortfall(row),
    partial_full_board_request: payload.partial_full_board_request ?? false,
    target_court_idxs: arr(payload.target_court_idxs),
    open_court_idxs: arr(payload.open_court_idxs),
    filled_court_idxs: arr(payload.filled_court_idxs),
    rounds_returned: arr(row.rounds).length,
    final_board: finalBoardCount,
    raw_payloads: rawPayloadCount,
    live_match_rows: liveMatchRowsCount,
    busy_ids: busyIdsCount,
    derived,
    engine,
    selection_debug_count: selectionCount,
    max_busy_count: busyCounts.length ? Math.max(...busyCounts) : 0,
    min_eligible_count: eligibleCounts.length ? Math.min(...eligibleCounts) : null,
    max_eligible_count: eligibleCounts.length ? Math.max(...eligibleCounts) : null,
    selectedCourts,
  }
}

async function main() {
  const [dumps, audit, instr, liveMatches, rounds, playerState, pairHistory] = await Promise.all([
    readJsonl<AnyRow>(file('debug_dumps.jsonl')),
    readJsonl<AnyRow>(file('session_audit_events.jsonl')),
    readJsonl<AnyRow>(file('engine_instrumentation.jsonl')),
    readJsonl<AnyRow>(file('session_live_matches.jsonl')),
    readJsonl<AnyRow>(file('session_rounds.jsonl')),
    readJsonl<AnyRow>(file('session_player_state.jsonl')),
    readJsonl<AnyRow>(file('session_pair_history.jsonl')),
  ])

  const missing = dumps.filter((row) => missingOpenCourts(row).length > 0)
  const complete = dumps.filter((row) => missingOpenCourts(row).length === 0)
  const targetMissing = dumps.filter(hasTargetIssue)
  const targetComplete = dumps.filter((row) => !hasTargetIssue(row))
  const engineMissing = missing.filter((row) => row.decision_source === 'engine_auto')
  const hostMissing = missing.filter((row) => row.decision_source === 'host_replacement')
  const engineTargetMissing = targetMissing.filter((row) => row.decision_source === 'engine_auto')
  const hostTargetMissing = targetMissing.filter((row) => row.decision_source === 'host_replacement')

  const repeatedClientRequests = Object.entries(countBy(dumps, (row) => row.payload?.client_request_id ?? 'none'))
    .filter(([key, count]) => key !== 'none' && count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  const requestIds = Object.entries(countBy(dumps, (row) => row.payload?.suggestion_request_id ?? 'none'))
    .filter(([key, count]) => key !== 'none' && count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  const missingByMinute = countBy(missing, (row) => minute(row.created_at))
  const targetMissingByMinute = countBy(targetMissing, (row) => minute(row.created_at))
  const allByMinute = countBy(dumps, (row) => minute(row.created_at))

  const chosenDist = countBy(dumps, (row) => String(arr(row.chosen_matches).length))
  const missingDist = countBy(dumps, (row) => String(missingOpenCourts(row).length))
  const targetMissingDist = countBy(dumps, (row) => String(missingTargetCourts(row).length + targetCountShortfall(row)))
  const currentRoundDist = countBy(dumps, (row) => String(row.payload?.current_round ?? row.payload?.derived_state_summary?.current_round ?? 'unknown'))
  const courtCountDist = countBy(dumps, (row) => String(row.payload?.court_count ?? 'unknown'))

  const auditEventCounts = countBy(audit, (row) => `${row.edge_function ?? 'unknown'}:${row.event_type ?? 'unknown'}`)
  const auditByMinute = countBy(audit, (row) => minute(row.created_at))
  const errorEvents = audit.filter((row) => String(row.event_type ?? '').includes('error') || String(row.event_type ?? '').includes('fallback') || String(row.event_type ?? '').includes('timeout'))

  const instrCounts = countBy(instr, (row) => row.event ?? 'unknown')
  const instrDetails = countBy(instr, (row) => `${row.event ?? 'unknown'}:${row.detail ?? ''}`)
  const rollingHorizonSummary = summarizeRollingHorizonDetails(instr
    .filter(row => row.event === 'rolling_horizon' && typeof row.detail === 'string')
    .map(row => row.detail))

  const liveStatus = countBy(liveMatches, (row) => row.status ?? 'unknown')
  const liveRound = countBy(liveMatches, (row) => String(row.round_no ?? 'unknown'))
  const activeRounds = rounds.filter((row) => !row.ended_at)
  const checkedIn = playerState.filter((row) => !row.checked_out_at)
  const optedRest = playerState.filter((row) => row.opted_rest)

  const worstMissing = [...missing]
    .sort((a, b) => missingOpenCourts(b).length - missingOpenCourts(a).length || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 12)
    .map(compactDump)

  const recentMissing = [...missing]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 12)
    .map(compactDump)

  const worstTargetMissing = [...targetMissing]
    .sort((a, b) => {
      const left = missingTargetCourts(a).length + targetCountShortfall(a)
      const right = missingTargetCourts(b).length + targetCountShortfall(b)
      return right - left || String(b.created_at).localeCompare(String(a.created_at))
    })
    .slice(0, 12)
    .map(compactDump)

  const recentTargetMissing = [...targetMissing]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 12)
    .map(compactDump)

  const sampleCompleteRecent = [...complete]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 5)
    .map(compactDump)

  const warnings = summarizeWarnings(dumps)

  const result = {
    files: {
      debug_dumps: dumps.length,
      session_audit_events: audit.length,
      engine_instrumentation: instr.length,
      session_live_matches: liveMatches.length,
      session_rounds: rounds.length,
      session_player_state: playerState.length,
      session_pair_history: pairHistory.length,
    },
    session_state: {
      live_status: liveStatus,
      live_round: liveRound,
      rounds_total: rounds.length,
      active_rounds: activeRounds.map((row) => ({ id: row.id, round_no: row.round_no, started_at: row.started_at, ended_at: row.ended_at })),
      checked_in_players: checkedIn.length,
      opted_rest_players: optedRest.length,
      pair_history_rows: pairHistory.length,
    },
    dump_summary: {
      total: dumps.length,
      complete: complete.length,
      missing: missing.length,
      engine_missing: engineMissing.length,
      host_replacement_missing: hostMissing.length,
      target_complete: targetComplete.length,
      target_missing: targetMissing.length,
      engine_target_missing: engineTargetMissing.length,
      host_replacement_target_missing: hostTargetMissing.length,
      by_decision_source: countBy(dumps, (row) => row.decision_source ?? 'unknown'),
      chosen_match_count_distribution: chosenDist,
      missing_court_count_distribution: missingDist,
      target_missing_court_count_distribution: targetMissingDist,
      current_round_distribution: currentRoundDist,
      court_count_distribution: courtCountDist,
      missing_by_minute_top: Object.fromEntries(Object.entries(missingByMinute).slice(0, 20)),
      target_missing_by_minute_top: Object.fromEntries(Object.entries(targetMissingByMinute).slice(0, 20)),
      all_dumps_by_minute_top: Object.fromEntries(Object.entries(allByMinute).slice(0, 20)),
      repeated_client_request_ids: repeatedClientRequests,
      repeated_suggestion_request_ids: requestIds,
    },
    audit_summary: {
      by_event_top: Object.fromEntries(Object.entries(auditEventCounts).slice(0, 40)),
      by_minute_top: Object.fromEntries(Object.entries(auditByMinute).slice(0, 20)),
      error_like_count: errorEvents.length,
      error_like_by_event: countBy(errorEvents, (row) => `${row.edge_function ?? 'unknown'}:${row.event_type ?? 'unknown'}`),
      recent_error_like: errorEvents
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 20)
        .map((row) => ({
          id: row.id,
          created_at: row.created_at,
          event_type: row.event_type,
          edge_function: row.edge_function,
          client_request_id: row.client_request_id,
          request_id: row.request_id,
          detail: row.detail,
        })),
    },
    engine_instrumentation_summary: {
      by_event: instrCounts,
      by_event_detail_top: Object.fromEntries(Object.entries(instrDetails).slice(0, 40)),
      rolling_horizon: rollingHorizonSummary,
    },
    warnings,
    worst_missing: worstMissing,
    recent_missing: recentMissing,
    worst_target_missing: worstTargetMissing,
    recent_target_missing: recentTargetMissing,
    sample_recent_complete: sampleCompleteRecent,
  }

  const outPath = path.join(dir, 'analysis-summary.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
