import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

type Row = Record<string, any>

const dir = process.argv[2]

if (!dir) {
  console.error('Usage: npx tsx scripts/diagnostics/analyze-session-replay-lite.ts <lite-export-dir>')
  process.exit(1)
}

async function readJsonl(name: string): Promise<Row[]> {
  const filePath = path.join(dir, name)
  if (!fs.existsSync(filePath)) return []

  const rows: Row[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (trimmed) rows.push(JSON.parse(trimmed))
  }
  return rows
}

function countBy(rows: Row[], keyFn: (row: Row) => string | null | undefined) {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const key = keyFn(row) || 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function minute(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 16)
}

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function bytesSummary(rows: Row[], field: string) {
  const values = rows.map(row => num(row[field])).filter(value => value > 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    total,
    avg: values.length ? Math.round(total / values.length) : 0,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : 0,
  }
}

function repeated(rows: Row[], field: string, limit = 20) {
  return Object.entries(countBy(rows, row => row[field] || null))
    .filter(([key, count]) => key !== 'unknown' && count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
}

function span(rows: Row[]) {
  const times = rows
    .map(row => new Date(row.created_at).getTime())
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (times.length === 0) return null
  return {
    start: new Date(times[0]).toISOString(),
    end: new Date(times[times.length - 1]).toISOString(),
    minutes: Math.round((times[times.length - 1] - times[0]) / 60000),
  }
}

async function main() {
  const [dumps, audits, instrumentation] = await Promise.all([
    readJsonl('debug_dumps.lite.jsonl'),
    readJsonl('session_audit_events.lite.jsonl'),
    readJsonl('engine_instrumentation.lite.jsonl'),
  ])

  const dumpsByMinute = countBy(dumps, row => minute(row.created_at))
  const auditsByMinute = countBy(audits, row => minute(row.created_at))
  const instrumentationByMinute = countBy(instrumentation, row => minute(row.created_at))
  const totalLogRows = dumps.length + audits.length + instrumentation.length
  const dumpPayloadBytes = bytesSummary(dumps, 'payload_bytes')
  const auditDetailBytes = bytesSummary(audits, 'detail_bytes')
  const auditRequestBytes = bytesSummary(audits, 'request_payload_bytes')
  const auditResponseBytes = bytesSummary(audits, 'response_payload_bytes')

  const heavyDumps = [...dumps]
    .sort((a, b) => num(b.payload_bytes) - num(a.payload_bytes))
    .slice(0, 15)
    .map(row => ({
      id: row.id,
      created_at: row.created_at,
      decision_source: row.decision_source,
      payload_bytes: row.payload_bytes,
      chosen_matches_count: row.chosen_matches_count,
      missing_courts: row.missing_courts,
      client_request_id: row.client_request_id,
      suggestion_request_id: row.suggestion_request_id,
      selection_debug_count: row.selection_debug_count,
      final_preview_board_count: row.final_preview_board_count,
      raw_payloads_before_final_board_count: row.raw_payloads_before_final_board_count,
    }))

  const heavyAuditDetails = [...audits]
    .sort((a, b) => num(b.detail_bytes) - num(a.detail_bytes))
    .slice(0, 15)
    .map(row => ({
      id: row.id,
      created_at: row.created_at,
      event_type: row.event_type,
      edge_function: row.edge_function,
      detail_bytes: row.detail_bytes,
      request_payload_bytes: row.request_payload_bytes,
      response_payload_bytes: row.response_payload_bytes,
      client_request_id: row.client_request_id,
      request_id: row.request_id,
      detail_keys: row.detail_keys,
    }))

  const result = {
    files: {
      debug_dumps_lite: dumps.length,
      session_audit_events_lite: audits.length,
      engine_instrumentation_lite: instrumentation.length,
      total_log_rows: totalLogRows,
    },
    spans: {
      debug_dumps: span(dumps),
      session_audit_events: span(audits),
      engine_instrumentation: span(instrumentation),
    },
    rates: {
      debug_dumps_by_minute_top: Object.fromEntries(Object.entries(dumpsByMinute).slice(0, 20)),
      session_audit_events_by_minute_top: Object.fromEntries(Object.entries(auditsByMinute).slice(0, 20)),
      engine_instrumentation_by_minute_top: Object.fromEntries(Object.entries(instrumentationByMinute).slice(0, 20)),
    },
    sizes: {
      debug_dump_payload_bytes: dumpPayloadBytes,
      audit_detail_bytes: auditDetailBytes,
      audit_request_payload_bytes: auditRequestBytes,
      audit_response_payload_bytes: auditResponseBytes,
      estimated_exported_jsonb_bytes:
        dumpPayloadBytes.total + auditDetailBytes.total + auditRequestBytes.total + auditResponseBytes.total,
    },
    counts: {
      dumps_by_decision_source: countBy(dumps, row => row.decision_source),
      dumps_by_chosen_match_count: countBy(dumps, row => String(row.chosen_matches_count)),
      dumps_by_missing_court_count: countBy(dumps, row => String(Array.isArray(row.missing_courts) ? row.missing_courts.length : 0)),
      audit_by_event_top: Object.fromEntries(Object.entries(countBy(audits, row => `${row.edge_function}:${row.event_type}`)).slice(0, 50)),
      instrumentation_by_event_top: Object.fromEntries(Object.entries(countBy(instrumentation, row => row.event)).slice(0, 50)),
    },
    duplicate_ids: {
      dump_client_request_ids: repeated(dumps, 'client_request_id'),
      dump_suggestion_request_ids: repeated(dumps, 'suggestion_request_id'),
      audit_client_request_ids: repeated(audits, 'client_request_id'),
      audit_request_ids: repeated(audits, 'request_id'),
    },
    heavy_rows: {
      debug_dumps: heavyDumps,
      audit_details: heavyAuditDetails,
    },
  }

  fs.writeFileSync(path.join(dir, 'analysis-lite.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
