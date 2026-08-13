import fs from 'node:fs'

async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const sid = process.argv[2] ?? '260878a4-d69c-4332-97f2-2211d5ae77dd'
  const url = new URL(`${baseUrl}/rest/v1/session_live_matches`)
  url.searchParams.set('session_id', `eq.${sid}`)
  url.searchParams.set('select', 'court_idx,status,round_no,sequence_no,created_at,started_at,ended_at,updated_at')
  url.searchParams.set('order', 'updated_at.asc')
  url.searchParams.set('limit', '500')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 500)); return }
  const events: { t: string; what: string }[] = []
  for (const r of rows) {
    if (r.started_at) events.push({ t: r.started_at, what: `START  court=${r.court_idx} r=${r.round_no} seq=${r.sequence_no}` })
    if (r.ended_at) events.push({ t: r.ended_at, what: `DONE  court=${r.court_idx} r=${r.round_no} seq=${r.sequence_no}` })
  }
  events.sort((a, b) => a.t.localeCompare(b.t))
  for (const e of events) {
    if (e.t < '2026-08-13T04:15:00') continue
    console.log(`${e.t.slice(11, 23)}  ${e.what}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
