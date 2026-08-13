import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const sid = process.argv[2]
  const u = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  u.searchParams.set('session_id', `eq.${sid}`)
  u.searchParams.set('select', 'created_at,event_type,detail')
  u.searchParams.set('order', 'created_at.asc')
  u.searchParams.set('limit', '2000')
  const rows = await (await fetch(u, { headers: H })).json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.event_type, (counts.get(r.event_type) ?? 0) + 1)
  console.log(`all events: ${rows.length}, window ${rows[0]?.created_at.slice(11, 19)} -> ${rows[rows.length - 1]?.created_at.slice(11, 19)}`)
  ;[...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${String(n).padStart(4)}  ${t}`))
  const flagged = rows.filter(r => /conflict|blocked|stale|error|fallback|discarded/.test(r.event_type))
  console.log(`\nerror-ish events: ${flagged.length}`)
  flagged.slice(0, 10).forEach(r => console.log(`  ${r.created_at.slice(11, 19)} ${r.event_type} ${JSON.stringify(r.detail ?? {}).slice(0, 160)}`))
}
main().catch(e => { console.error(e); process.exit(1) })
