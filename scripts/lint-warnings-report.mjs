import fs from 'node:fs'

const reportPath = '.lint-report.json'
if (!fs.existsSync(reportPath)) {
  console.error('Missing .lint-report.json')
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const warningMap = new Map()
let totalWarnings = 0

for (const file of report) {
  for (const msg of file.messages ?? []) {
    if (msg.severity !== 1) continue
    totalWarnings += 1
    const rule = msg.ruleId ?? 'unknown'
    warningMap.set(rule, (warningMap.get(rule) ?? 0) + 1)
  }
}

const topRules = [...warningMap.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)

console.log(`Total lint warnings: ${totalWarnings}`)
console.log('Top warning rules:')
for (const [rule, count] of topRules) {
  console.log(`- ${rule}: ${count}`)
}
