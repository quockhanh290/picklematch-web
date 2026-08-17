// Ap migration 20260816000001 (tra panel danh doi ve duong ghi) roi tu xac minh.
//
//   node scratch/apply-panel-metadata-migration.mjs --dry-run   <- chay THAT roi ROLLBACK, khong de lai gi
//   node scratch/apply-panel-metadata-migration.mjs             <- ap that
//   node scratch/apply-panel-metadata-migration.mjs --rollback  <- nap lai ban truoc khi sua
//
// --dry-run di qua DUNG duong cua lan ap that (parse than ham, kiem quyen so huu ham, khop chu ky
// de REPLACE chu khong tao overload), vi Postgres cho phep DDL nam trong transaction. Chay no truoc.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT_REF = 'mzqsxgfvtgmsscbqugni'
const MIGRATION = 'supabase/migrations/20260816000001_restore_suggestion_metadata_on_persist.sql'
const ROLLBACK = 'scratch/rollback-replace-rpc-pre-20260816.sql'
const FN = 'replace_live_session_suggestions_versioned'

const token = readFileSync(join(homedir(), '.supabase', 'access-token'), 'utf8').trim()

async function run(query, readOnly = false) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 900)}`)
  return JSON.parse(text)
}

// Doc trang thai that: co o metadata chua, va co bao nhieu ban cua ham (overload = ap hong am tham).
async function probe() {
  const rows = await run(
    `select
       count(*)::int as so_ban,
       bool_or(position('suggestion_metadata' in pg_get_functiondef(p.oid)) > 0) as co_cot
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '${FN}'`,
    true,
  )
  return { soBan: rows[0]?.so_ban ?? 0, coCot: rows[0]?.co_cot === true }
}

const mode = process.argv.includes('--dry-run') ? 'dry-run'
  : process.argv.includes('--rollback') ? 'rollback'
  : 'apply'
const file = mode === 'rollback' ? ROLLBACK : MIGRATION
const sql = readFileSync(file, 'utf8')

const truoc = await probe()
console.log(`che do        : ${mode}`)
console.log(`tep           : ${file}`)
console.log(`truoc khi chay: so ban ham = ${truoc.soBan}, co o metadata = ${truoc.coCot}`)
if (truoc.soBan !== 1) {
  console.log(`DUNG LAI - dang co ${truoc.soBan} ban cua ham, phai xu ly overload truoc khi ap`)
  process.exit(1)
}

if (mode === 'dry-run') {
  // Neu than ham sai cu phap, hoac khong du quyen thay ham cua postgres, buoc nay nem loi.
  await run(`begin;\n${sql}\nrollback;`)
  const sau = await probe()
  console.log(`sau khi chay  : so ban ham = ${sau.soBan}, co o metadata = ${sau.coCot}`)
  if (sau.coCot) {
    console.log('LOI NGHIEM TRONG - rollback KHONG an, ham that da bi doi. Chay --rollback ngay.')
    process.exitCode = 1
  } else if (sau.soBan !== 1) {
    console.log('LOI - so ban ham thay doi sau rollback')
    process.exitCode = 1
  } else {
    console.log('DRY-RUN QUA: than ham hop le, du quyen thay, chu ky khop (van 1 ban), da rollback sach.')
    console.log('Chay that: node scratch/apply-panel-metadata-migration.mjs')
  }
} else {
  await run(sql)
  const sau = await probe()
  console.log(`sau khi chay  : so ban ham = ${sau.soBan}, co o metadata = ${sau.coCot}`)
  const mongDoi = mode === 'rollback' ? false : true
  if (sau.soBan !== 1) {
    console.log(`LOI - co ${sau.soBan} ban cua ham, da tao overload thay vi thay the`)
    process.exitCode = 1
  } else if (sau.coCot !== mongDoi) {
    console.log(mode === 'rollback' ? 'LUI THAT BAI' : 'AP THAT BAI - ham chua co o metadata')
    process.exitCode = 1
  } else {
    console.log(mode === 'rollback'
      ? 'DA LUI VE TRANG THAI CU'
      : 'AP THANH CONG - chay tiep: npm run check:rpc-markers (phai XANH)')
  }
}
