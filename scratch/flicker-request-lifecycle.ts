import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const sid = process.argv[2] ?? 'ff0ea657-b25c-48ed-a060-e29ae3099340'
  const url = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  url.searchParams.set('session_id', `eq.${sid}`)
  url.searchParams.set('event_type', 'like.client_preview%')
  url.searchParams.set('select', 'created_at,event_type,detail')
  url.searchParams.set('order', 'created_at.asc')
  url.searchParams.set('limit', '5000')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  const byType = new Map<string, number>()
  const serialsScheduled = new Set<number>()
  const serialsStarted = new Set<number>()
  const serialsAnswered = new Set<number>()
  const serialsStale = new Set<number>()
  for (const r of rows) {
    byType.set(r.event_type, (byType.get(r.event_type) ?? 0) + 1)
    const serial = (r.detail ?? {}).request_serial
    if (typeof serial !== 'number') continue
    if (r.event_type === 'client_preview_request_scheduled') serialsScheduled.add(serial)
    if (r.event_type === 'client_preview_request_start') serialsStarted.add(serial)
    if (r.event_type === 'client_preview_edge_response') serialsAnswered.add(serial)
    if (r.event_type === 'client_preview_request_stale_finally') serialsStale.add(serial)
  }
  console.log('event counts:')
  ;[...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, n]) => console.log(`  ${n.toString().padStart(4)}  ${type}`))
  console.log(`\nserials scheduled=${serialsScheduled.size} started=${serialsStarted.size} answered=${serialsAnswered.size} stale=${serialsStale.size}`)
  const staleAndStarted = [...serialsStale].filter(s => serialsStarted.has(s))
  console.log(`started requests whose answer was DISCARDED as stale: ${staleAndStarted.length}`)
  console.log(`  serials: ${staleAndStarted.sort((a, b) => a - b).join(', ')}`)
}
main().catch(e => { console.error(e); process.exit(1) })
