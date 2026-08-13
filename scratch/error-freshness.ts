import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const H = { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' }
  const types = [
    'client_preview_persist_assignment_conflict_terminal',
    'client_preview_persist_assignment_conflict_retry_scheduled',
    'client_preview_fallback_not_committed',
    'client_start_blocked_untrusted_preview',
    'client_preview_request_start',
  ]
  for (const t of types) {
    const u = new URL(`${baseUrl}/rest/v1/session_audit_events`)
    u.searchParams.set('event_type', `eq.${t}`)
    u.searchParams.set('select', 'created_at')
    u.searchParams.set('order', 'created_at.desc')
    u.searchParams.set('limit', '1')
    const res = await fetch(u, { headers: H })
    const total = res.headers.get('content-range')?.split('/')[1] ?? '?'
    const rows = await res.json()
    const newest = Array.isArray(rows) && rows[0] ? rows[0].created_at.slice(0, 19) : 'none'
    // count in the last 5 days
    const u2 = new URL(`${baseUrl}/rest/v1/session_audit_events`)
    u2.searchParams.set('event_type', `eq.${t}`)
    u2.searchParams.set('created_at', 'gte.2026-08-09')
    u2.searchParams.set('select', 'created_at')
    u2.searchParams.set('limit', '1')
    const res2 = await fetch(u2, { headers: H })
    const since9 = res2.headers.get('content-range')?.split('/')[1] ?? '?'
    console.log(`${t.padEnd(58)} total=${String(total).padStart(6)}  since 09/08=${String(since9).padStart(5)}  newest=${newest}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
