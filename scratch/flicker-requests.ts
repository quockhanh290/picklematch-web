import fs from 'node:fs'

async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const sid = process.argv[2] ?? '260878a4-d69c-4332-97f2-2211d5ae77dd'
  const url = new URL(`${baseUrl}/rest/v1/debug_dumps`)
  url.searchParams.set('session_id', `eq.${sid}`)
  url.searchParams.set('select', 'created_at,payload')
  url.searchParams.set('order', 'created_at.asc')
  url.searchParams.set('limit', '400')
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = await res.json()
  if (!Array.isArray(rows)) { console.log('ERR', JSON.stringify(rows).slice(0, 500)); return }
  console.log(`dumps: ${rows.length}`)
  for (const r of rows) {
    const p = r.payload ?? {}
    const req = p.request ?? {}
    const board = Array.isArray(req.current_preview_board) ? req.current_preview_board : []
    const boardCourts = board.map((m: any) => `${m.court_idx}${m.degraded_reason ? `!${m.degraded_reason}` : ''}${m.id?.startsWith?.('preview') ? 'p' : 'P'}`).join(' ')
    const chosen = Array.isArray(p.chosen_matches) ? p.chosen_matches : []
    const chosenCourts = chosen.map((m: any) => `${m.court_idx}${m.degraded_reason ? `!${m.degraded_reason}` : ''}`).join(' ')
    console.log([
      r.created_at.slice(11, 23),
      `mode=${req.mode}`,
      `cnt=${req.count}/${req.requested_count}`,
      `courts=${JSON.stringify(req.court_idxs)}`,
      `v=${req.live_state_version}`,
      `cid=${String(p.client_request_id ?? '').slice(0, 34)}`,
      `req_target=${JSON.stringify(p.requested_court_idxs)}`,
      `filled=${JSON.stringify(p.filled_court_idxs)}`,
      `missing=${JSON.stringify(p.missing_open_courts)}`,
      `board=[${boardCourts}]`,
      `chosen=[${chosenCourts}]`,
    ].join(' | '))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
