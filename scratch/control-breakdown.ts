import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const u = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  u.searchParams.set('event_type', 'eq.client_preview_request_start')
  u.searchParams.set('created_at', 'gte.2026-08-09')
  u.searchParams.set('select', 'created_at,session_id')
  u.searchParams.set('order', 'created_at.asc')
  u.searchParams.set('limit', '1000')
  const rows = await (await fetch(u, { headers: H })).json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  console.log(`request_start rows fetched: ${rows.length}`)
  const byDay = new Map<string, number>()
  const bySession = new Map<string, { n: number; day: string }>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
    const cur = bySession.get(r.session_id) ?? { n: 0, day }
    bySession.set(r.session_id, { n: cur.n + 1, day: cur.day })
  }
  console.log('\nby day:'); [...byDay.entries()].sort().forEach(([d, n]) => console.log(`  ${d}  ${n}`))
  console.log('\nby session:'); [...bySession.entries()].sort((a, b) => b[1].n - a[1].n)
    .forEach(([s, v]) => console.log(`  ${String(s).slice(0, 8)}  ${String(v.n).padStart(4)}  (${v.day})`))
}
main().catch(e => { console.error(e); process.exit(1) })
