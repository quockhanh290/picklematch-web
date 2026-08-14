// Các trận thật có kết thúc gần nhau không?
//
// Đo được (corpus, REFILL_BATCH=2): lấp 2 sân một lượt cho board tốt hơn hẳn lấp từng sân — lặp-3
// 1.98%→1.13%, vượt tol 11.43%→4.63%, NGAY CẢ KHI optimizer tắt. Nhưng client không tự tạo ra sân
// trống thứ hai: muốn gộp thì phải CHỜ, và giá là sân đầu nằm không lâu hơn.
//
// Nên câu hỏi quyết định là: nếu chờ X giây, bao nhiêu phần trăm lần lấp sẽ gộp được ≥2 sân?
// Chạy: npx tsx scratch/p22-completion-gaps.ts [số kèo]

import fs from 'node:fs'

const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
const BASE = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
const KEY = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]

async function query<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(`${BASE}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error(`${table}: ${JSON.stringify(json).slice(0, 200)}`)
  return json as T[]
}

async function main() {
  const wanted = Number(process.argv[2] ?? 53)
  const ids: string[] = []
  const PAGE = 1000
  for (let offset = 0; offset < 40_000 && ids.length < wanted; offset += PAGE) {
    const page = await query<any>('session_live_matches', {
      select: 'session_id,ended_at', status: 'eq.completed', order: 'ended_at.desc',
      limit: String(PAGE), offset: String(offset),
    })
    if (page.length === 0) break
    for (const row of page) {
      if (!ids.includes(row.session_id)) ids.push(row.session_id)
      if (ids.length >= wanted) break
    }
  }

  const gaps: number[] = []
  let completions = 0
  for (const sessionId of ids) {
    const rows = await query<any>('session_live_matches', {
      session_id: `eq.${sessionId}`, status: 'eq.completed', select: 'ended_at', order: 'ended_at.asc', limit: '500',
    })
    const times = rows.map(r => new Date(r.ended_at).getTime()).filter(Number.isFinite).sort((a, b) => a - b)
    completions += times.length
    for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 1000)
  }

  gaps.sort((a, b) => a - b)
  const pctl = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0
  const within = (s: number) => gaps.filter(g => g <= s).length
  console.log(`${ids.length} kèo · ${completions} lần kết thúc · ${gaps.length} khoảng cách\n`)
  console.log(`trung vị     : ${pctl(0.5).toFixed(1)}s`)
  console.log(`p25 / p75    : ${pctl(0.25).toFixed(1)}s / ${pctl(0.75).toFixed(1)}s\n`)
  for (const window of [2, 3, 5, 8, 10, 15, 20, 30]) {
    const n = within(window)
    console.log(`chờ ${String(window).padStart(2)}s → gộp được ${String(n).padStart(4)}/${gaps.length} lần (${(100 * n / gaps.length).toFixed(1)}%)`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
