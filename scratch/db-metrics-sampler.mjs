// Lấy mẫu chỉ số DB trong lúc kèo chạy, để bắt tận tay cú IOwait thay vì mò dashboard sau khi nguội.
//
// Ngày 15/08 (UTC) một kèo thật gãy: 88% IOwait, SELECT một dòng mất 6,75s, host thấy sân giật ở vòng
// 7–8. Dashboard chỉ cho xem sau, và múi giờ hiển thị lệch 13 tiếng so với giờ VN nên rất dễ dò nhầm chỗ.
//
// Chạy:  SRK=<service_role_key> node scratch/db-metrics-sampler.mjs [giây/lần] [file-ra]
// Dừng:  Ctrl+C
const KEY = process.env.SRK
if (!KEY) { console.error('Thieu bien SRK (service_role key)'); process.exit(1) }
// Endpoint phuc vu ban scrape da cache, lam moi khoang 60s: poll day hon the thi mot nua so mau ra
// delta = 0 va khong doc duoc gi. Su co hom 15/08 keo dai ~6 phut, tuc ~6 mau o nhip nay.
const EVERY = Number(process.argv[2] || 60) * 1000
const OUT = process.argv[3] || 'scratch/out/db-metrics.tsv'
const URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co/customer/v1/privileged/metrics'

import fs from 'node:fs'
fs.mkdirSync('scratch/out', { recursive: true })

const num = (text, re) => { const m = text.match(re); return m ? Number(m[1]) : null }
const cpuMode = (text, mode) =>
  num(text, new RegExp(`node_cpu_seconds_total\\{[^}]*mode="${mode}"[^}]*\\}\\s+([0-9.e+]+)`))

let prev = null
const header = ['thoi_diem_utc', 'gio_VN', 'cpu_iowait_%', 'cpu_user_%', 'connections', 'disk_util_%', 'RAM_trong_MB', 'SWAP_dung_MB', 'swap_in_trang/s', 'load1']
if (!fs.existsSync(OUT)) fs.writeFileSync(OUT, header.join('\t') + '\n')
console.log(header.join('  |  '))

const tick = async () => {
  let text
  try {
    const res = await fetch(URL, {
      headers: { Authorization: 'Basic ' + Buffer.from(`service_role:${KEY}`).toString('base64') },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) { console.error(`HTTP ${res.status}`); return }
    text = await res.text()
  } catch (err) {
    console.error('loi lay mau:', String(err?.message ?? err))
    return
  }

  const now = Date.now()
  const cur = {
    t: now,
    iowait: cpuMode(text, 'iowait'),
    user: cpuMode(text, 'user'),
    system: cpuMode(text, 'system'),
    idle: cpuMode(text, 'idle'),
    io: num(text, /node_disk_io_time_seconds_total\{[^}]*device="nvme0n1"[^}]*\}\s+([0-9.e+]+)/),
    conn: num(text, /pg_stat_database_num_backends[^\s]*\s+([0-9.e+]+)/),
    swapTotal: num(text, /node_memory_SwapTotal_bytes\{[^}]*\}\s+([0-9.e+]+)/),
    swapFree: num(text, /node_memory_SwapFree_bytes\{[^}]*\}\s+([0-9.e+]+)/),
    memAvail: num(text, /node_memory_MemAvailable_bytes\{[^}]*\}\s+([0-9.e+]+)/),
    swpin: num(text, /node_vmstat_pswpin\{[^}]*\}\s+([0-9.e+]+)/),
    load1: num(text, /node_load1\s+([0-9.e+]+)/),
  }

  if (prev) {
    const dt = (cur.t - prev.t) / 1000
    // cpu_seconds_total la tich luy theo tung core; chia cho tong delta de ra ti le
    const d = (k) => Math.max(0, (cur[k] ?? 0) - (prev[k] ?? 0))
    const busy = d('iowait') + d('user') + d('system')
    const total = busy + d('idle')
    const pct = (k) => total > 0 ? (100 * d(k) / total).toFixed(1) : 'chua-doi'
    const utc = new Date(cur.t).toISOString().slice(11, 19)
    const vn = new Date(cur.t + 7 * 3600_000).toISOString().slice(11, 19)
    const mb = (b) => b == null ? '-' : Math.round(b / 1024 / 1024)
    const swapUsed = (cur.swapTotal != null && cur.swapFree != null) ? cur.swapTotal - cur.swapFree : null
    const row = [utc, vn, pct('iowait'), pct('user'), cur.conn ?? '-',
      dt > 0 ? (100 * d('io') / dt).toFixed(1) : '-', mb(cur.memAvail), mb(swapUsed),
      dt > 0 ? (d('swpin') / dt).toFixed(0) : '-', cur.load1 ?? '-']
    const line = row.join('\t')
    fs.appendFileSync(OUT, line + '\n')
    const swapRate = dt > 0 ? d('swpin') / dt : 0
    const alarm = (Number(pct('iowait')) > 20 ? '  <<< IOWAIT CAO' : '') + (swapRate > 50 ? '  <<< DANG THRASH SWAP' : '')
    console.log(row.map(v => String(v).padStart(8)).join('  ') + alarm)
  }
  prev = cur
}

await tick()
setInterval(tick, EVERY)
