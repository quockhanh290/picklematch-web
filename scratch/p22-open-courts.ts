// Có bao nhiêu sân trống tại thời điểm client hỏi, và nó hỏi cho mấy sân?
//
// Nếu số sân trống thường > số sân được hỏi thì trần LIVE_PREVIEW_REPLACEMENT_MAX_COUNT = 2 đang
// chia nhỏ một lần hỏi thành nhiều lần — và gộp lại KHÔNG tốn gì (khác với việc chờ, đã đo: muốn
// gộp một nửa số lần phải chờ ~8s).

import fs from 'node:fs'

const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
const BASE = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
const KEY = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]

const SESSIONS = [
  '2ef92e06-aa39-4709-9c68-0f1c7a7a9634',
  'ff0ea657-b25c-48ed-a060-e29ae3099340',
  '260878a4-d69c-4332-97f2-2211d5ae77dd',
]

async function fetchSession(sessionId: string): Promise<any[]> {
  const url = new URL(`${BASE}/rest/v1/debug_dumps`)
  url.searchParams.set('session_id', `eq.${sessionId}`)
  // JSON-path trong select làm request đứt; lấy nguyên payload theo từng kèo là cách đã chạy được.
  url.searchParams.set('select', 'created_at,payload')
  url.searchParams.set('order', 'created_at.asc')
  url.searchParams.set('limit', '400')
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  const json = await res.json()
  return Array.isArray(json) ? json : []
}

async function main() {
  const url = new URL(`${BASE}/rest/v1/debug_dumps`)
  // Chỉ lấy ba trường thay vì cả payload: kéo 1000 payload đầy đủ làm đứt kết nối.
  // Lọc theo session: query không lọc quét cả bảng debug_dumps và server ngắt kết nối.
  const rows: any[] = []
  for (const sessionId of SESSIONS) rows.push(...await fetchSession(sessionId))

  const openHist = new Map<number, number>()
  const askedHist = new Map<number, number>()
  let capped = 0
  let total = 0
  for (const row of rows) {
    const p = row.payload ?? {}
    const open = Array.isArray(p.open_court_idxs) ? p.open_court_idxs.length : null
    const asked = Array.isArray(p.requested_court_idxs) ? p.requested_court_idxs.length : 0
    const mode = 'replace_courts'
    if (open === null) continue
    total += 1
    openHist.set(open, (openHist.get(open) ?? 0) + 1)
    askedHist.set(asked, (askedHist.get(asked) ?? 0) + 1)
    // "bị trần cắt": có nhiều sân trống hơn số sân được hỏi, ở chế độ replace_courts
    if (mode === 'replace_courts' && asked > 0 && open > asked) capped += 1
  }

  const fmt = (m: Map<number, number>) =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  ')
  console.log(`${total} request có dữ liệu sân trống\n`)
  console.log(`số SÂN TRỐNG lúc hỏi (sân:lần) : ${fmt(openHist)}`)
  console.log(`số sân ĐƯỢC HỎI    (sân:lần) : ${fmt(askedHist)}`)
  console.log(`\nreplace_courts mà sân trống > sân được hỏi: ${capped}/${total} (${(100 * capped / Math.max(1, total)).toFixed(1)}%)`)
}

main().catch(e => { console.error(e); process.exit(1) })
