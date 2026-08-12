import fs from 'node:fs'
import { execSync } from 'node:child_process'

// Triage the HIGH raw findings the curated table dropped. For each, pull the symbols its location names
// and show whether they still exist and what sits around them — enough to classify, not enough to
// conclude. Anything that looks alive still gets read by hand: four wrong calls today came from trusting
// a signal instead of reading the path.
const raw = JSON.parse(fs.readFileSync('scratch/audit-final.json', 'utf8')).allFindings ?? []
const doc = fs.readFileSync('docs/ENGINE_FRAGMENTATION_AUDIT.md', 'utf8')

const carried = (location = '') => {
  const file = (location.match(/[\w.-]+\.(ts|tsx|sql)/) ?? [])[0]
  if (!file) return doc.includes(location.slice(0, 40))
  if (!doc.includes(file)) return false
  const lines = [...location.matchAll(/:(\d{2,5})/g)].map(m => m[1])
  return lines.length === 0 ? true : lines.some(n => doc.includes(n))
}

const high = raw.filter(f => !carried(f.location) && (f.severity ?? '').toUpperCase() === 'HIGH')

// The identifier a finding is really about is usually the longest camelCase name in its title or
// location — good enough to locate the code today, whatever the line numbers have done since.
const symbolOf = (f) => {
  const pool = `${f.title} ${f.location}`
  const names = [...pool.matchAll(/\b([a-z][A-Za-z0-9]{6,})\b/g)].map(m => m[1])
  return names.sort((a, b) => b.length - a.length)[0] ?? null
}

for (const [i, f] of high.entries()) {
  const sym = symbolOf(f)
  let hits = '(không tìm được symbol)'
  if (sym) {
    try {
      hits = execSync(
        `grep -rnw --include=*.ts --include=*.tsx "${sym}" lib features supabase/functions | head -3`,
        { encoding: 'utf8' },
      ).trim()
    } catch { hits = '(grep không khớp — KIỂM TAY, đừng tin dòng này)' }
  }
  console.log(`\n### ${i + 1}. ${f.title}`)
  console.log(`    thô: ${f.location}`)
  console.log(`    symbol: ${sym}`)
  console.log(hits.split('\n').slice(0, 3).map(l => `    ${l}`).join('\n'))
}
console.log(`\n(${high.length} mục HIGH bị rơi)`)
