import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const u = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  u.searchParams.set('event_type', 'like.client_preview%')
  u.searchParams.set('created_at', 'gte.2026-08-13T08:00:00')
  u.searchParams.set('select', 'created_at,session_id,event_type')
  u.searchParams.set('order', 'created_at.desc')
  u.searchParams.set('limit', '1000')
  const rows = await (await fetch(u, { headers: H })).json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  const bySession = new Map<string, { n: number; first: string; last: string; starts: number }>()
  for (const r of rows) {
    const cur = bySession.get(r.session_id) ?? { n: 0, first: r.created_at, last: r.created_at, starts: 0 }
    cur.n += 1
    if (r.created_at < cur.first) cur.first = r.created_at
    if (r.created_at > cur.last) cur.last = r.created_at
    if (r.event_type === 'client_preview_request_start') cur.starts += 1
    bySession.set(r.session_id, cur)
  }
  console.log('sessions with preview activity since 08:00 today:')
  ;[...bySession.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first)).forEach(([s, v]) =>
    console.log(`  ${String(s).slice(0, 8)}  events=${String(v.n).padStart(4)} starts=${String(v.starts).padStart(3)}  ${v.first.slice(11, 19)} -> ${v.last.slice(11, 19)}`))
}
main().catch(e => { console.error(e); process.exit(1) })
