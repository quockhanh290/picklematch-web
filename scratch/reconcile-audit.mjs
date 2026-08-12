import fs from 'node:fs'

// The 'both' defect fixed today was in the raw sweep and never reached the curated table of 43, so the
// table is not the complete set. This lists raw findings whose location appears nowhere in the document.
const raw = JSON.parse(fs.readFileSync('scratch/audit-final.json', 'utf8')).allFindings ?? []
const doc = fs.readFileSync('docs/ENGINE_FRAGMENTATION_AUDIT.md', 'utf8')

// A location is "carried" if the file basename AND at least one of its line numbers appear in the doc.
const carried = (location = '') => {
  const file = (location.match(/[\w.-]+\.(ts|tsx|sql)/) ?? [])[0]
  if (!file) return doc.includes(location.slice(0, 40))
  if (!doc.includes(file)) return false
  const lines = [...location.matchAll(/:(\d{2,5})/g)].map(m => m[1])
  return lines.length === 0 ? true : lines.some(n => doc.includes(n))
}

const missing = raw.filter(f => !carried(f.location))
const bySeverity = { HIGH: [], MEDIUM: [], LOW: [], other: [] }
for (const f of missing) (bySeverity[(f.severity ?? '').toUpperCase()] ?? bySeverity.other).push(f)

console.log(`thô ${raw.length} | không thấy trong tài liệu: ${missing.length}`)
for (const [sev, list] of Object.entries(bySeverity)) {
  if (list.length === 0) continue
  console.log(`\n=== ${sev} (${list.length}) ===`)
  for (const f of list) {
    console.log(`- ${f.title}`)
    console.log(`  ${f.location}`)
    console.log(`  root=${f.root_class ?? '?'} | area=${f.area ?? '?'}`)
  }
}
