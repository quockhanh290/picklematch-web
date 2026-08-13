import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const url = new URL(`${baseUrl}/rest/v1/session_audit_events`)
  url.searchParams.set('event_type', 'like.client_preview_persist_assignment_conflict%')
  url.searchParams.set('select', 'created_at,session_id,event_type,detail')
  url.searchParams.set('order', 'created_at.desc')
  url.searchParams.set('limit', '500')
  const rows = await (await fetch(url, { headers: H })).json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  console.log(`total conflict events: ${rows.length}`)
  const byDay = new Map<string, number>()
  const bySession = new Map<string, number>()
  const byErr = new Map<string, number>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
    bySession.set(r.session_id, (bySession.get(r.session_id) ?? 0) + 1)
    const err = String((r.detail ?? {}).error ?? '').slice(0, 90)
    byErr.set(err, (byErr.get(err) ?? 0) + 1)
  }
  console.log('\nby day:'); [...byDay.entries()].sort().forEach(([d, n]) => console.log(`  ${d}  ${n}`))
  console.log('\ntop sessions:'); [...bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([s, n]) => console.log(`  ${String(s).slice(0, 8)}  ${n}`))
  console.log('\nerror strings:'); [...byErr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([e, n]) => console.log(`  ${n}x  ${e}`))
  console.log('\nlatest 6:')
  for (const r of rows.slice(0, 6)) {
    const d = r.detail ?? {}
    console.log(`  ${r.created_at.slice(0, 19)} ${String(r.session_id).slice(0, 8)} ${r.event_type.replace('client_preview_persist_assignment_', '')} req=${JSON.stringify(d.requested_replacement_courts)} conflictPlayers=${JSON.stringify(d.conflicting_player_ids)} conflictCourts=${JSON.stringify(d.conflicting_court_idxs)} authV=${d.authoritative_live_state_version} retry=${d.retry_count}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
