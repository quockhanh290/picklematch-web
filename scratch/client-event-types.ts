import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const url = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  url.searchParams.set('created_at', 'gte.2026-08-01')
  url.searchParams.set('select', 'event_type')
  url.searchParams.set('limit', '20000')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.event_type, (counts.get(r.event_type) ?? 0) + 1)
  ;[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([t, n]) => console.log(`${String(n).padStart(5)}  ${t}`))
}
main().catch(e => { console.error(e); process.exit(1) })
