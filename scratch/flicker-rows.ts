import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const sid = process.argv[2] ?? '260878a4-d69c-4332-97f2-2211d5ae77dd'
  const url = new URL(`${baseUrl}/rest/v1/session_live_matches`)
  url.searchParams.set('session_id', `eq.${sid}`)
  url.searchParams.set('select', 'court_idx,status,round_no,sequence_no,score_a,score_b,suggested_at,started_at,ended_at,updated_at')
  
  url.searchParams.set('order', 'sequence_no.asc')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 400)); return }
  for (const r of rows) {
    console.log(`seq=${String(r.sequence_no).padStart(3)} court=${r.court_idx} r=${r.round_no} ${String(r.status).padEnd(9)} sug=${r.suggested_at?.slice(11,23)} start=${r.started_at?.slice(11,23) ?? '-'} end=${r.ended_at?.slice(11,23) ?? '-'} score=${r.score_a}-${r.score_b} upd=${r.updated_at?.slice(11,23)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
