import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const url = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  url.searchParams.set('event_type', 'eq.client_start_blocked_untrusted_preview')
  url.searchParams.set('select', 'created_at,session_id,detail,response_payload')
  url.searchParams.set('order', 'created_at.desc')
  url.searchParams.set('limit', '200')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 400)); return }
  console.log(`blocked-start events: ${rows.length}`)
  const byReason = new Map<string, number>()
  const bySource = new Map<string, number>()
  for (const r of rows) {
    const reason = String((r.detail ?? {}).reason ?? '?')
    const source = String((r.response_payload ?? {}).preview_source ?? '?')
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
    bySource.set(source, (bySource.get(source) ?? 0) + 1)
  }
  console.log('by reason:', JSON.stringify([...byReason.entries()]))
  console.log('by preview_source:', JSON.stringify([...bySource.entries()]))
  for (const r of rows.slice(0, 8)) {
    const d = r.detail ?? {}
    console.log(`${r.created_at.slice(0, 19)} sess=${String(r.session_id).slice(0, 8)} reason=${d.reason} batch_count=${d.committed_batch_match_count} batch_key=${String(d.committed_batch_key ?? 'null').slice(0, 12)} src=${(r.response_payload ?? {}).preview_source} court=${(r.response_payload ?? {}).court_idx}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
