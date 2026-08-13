import fs from 'node:fs'
async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const sid = process.argv[2] ?? '260878a4-d69c-4332-97f2-2211d5ae77dd'
  const url = new URL(`${baseUrl}/rest/v1/session_live_matches`)
  url.searchParams.set('session_id', `eq.${sid}`)
  url.searchParams.set('select', 'court_idx,status,sequence_no,suggested_at,started_at,ended_at')
  url.searchParams.set('order', 'sequence_no.asc')
  url.searchParams.set('limit', '2000')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 300)); return }
  // A real completion = a match that was actually played and finished.
  const completions = rows
    .filter((r: any) => r.status === 'completed' && r.ended_at)
    .map((r: any) => r.ended_at as string)
    .sort()
  // A cancelled suggestion that never started = a lineup replaced before the host used it.
  const replaced = rows.filter((r: any) => r.status === 'cancelled' && !r.started_at && r.ended_at)
  let wasted = 0
  const wastedRows: string[] = []
  for (const r of replaced) {
    const born = r.suggested_at as string
    const killed = r.ended_at as string
    const completionBetween = completions.some(t => t > born && t < killed)
    if (!completionBetween) {
      wasted++
      wastedRows.push(`seq=${r.sequence_no} court=${r.court_idx} ${born.slice(11, 19)} -> ${killed.slice(11, 19)}`)
    }
  }
  console.log(`replaced-before-start suggestions: ${replaced.length}`)
  console.log(`of which NO completion landed in between (wasted re-roll): ${wasted}`)
  wastedRows.forEach(line => console.log('  ' + line))
}
main().catch(e => { console.error(e); process.exit(1) })
