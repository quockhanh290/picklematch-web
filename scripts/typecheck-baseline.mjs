import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const baselinePath = path.join(root, 'typecheck-baseline.json')
const mode = process.argv.includes('--check') ? 'check' : 'update'
const tscPath = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

function runTypecheck() {
  const result = spawnSync(process.execPath, [tscPath, '--noEmit'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if (result.error) throw result.error
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/')
}

function buildReport(output) {
  const groups = new Map()
  const errorPattern = /^(.+?)\(\d+,\d+\): error (TS\d+):/gm
  let match

  while ((match = errorPattern.exec(output)) !== null) {
    const file = normalizePath(match[1])
    const code = match[2]
    const key = `${file}::${code}`
    const current = groups.get(key) ?? { file, code, count: 0 }
    current.count += 1
    groups.set(key, current)
  }

  const errors = [...groups.values()].sort((left, right) =>
    left.file.localeCompare(right.file) || left.code.localeCompare(right.code),
  )
  const byCode = {}
  const byFile = {}

  for (const error of errors) {
    byCode[error.code] = (byCode[error.code] ?? 0) + error.count
    byFile[error.file] = (byFile[error.file] ?? 0) + error.count
  }

  return {
    totalErrors: errors.reduce((total, error) => total + error.count, 0),
    filesWithErrors: Object.keys(byFile).length,
    byCode: Object.fromEntries(Object.entries(byCode).sort(([left], [right]) => left.localeCompare(right))),
    byFile: Object.fromEntries(Object.entries(byFile).sort(([left], [right]) => left.localeCompare(right))),
    groups: errors,
  }
}

function compareReports(baseline, current) {
  const baselineGroups = new Map(baseline.groups.map(group => [`${group.file}::${group.code}`, group]))
  const regressions = []

  for (const group of current.groups) {
    const key = `${group.file}::${group.code}`
    const previous = baselineGroups.get(key)
    if (!previous) {
      regressions.push(`${group.file} ${group.code}: new group with ${group.count} error(s)`)
      continue
    }
    if (group.count > previous.count) {
      regressions.push(`${group.file} ${group.code}: ${previous.count} -> ${group.count}`)
    }
  }

  return regressions
}

const current = buildReport(runTypecheck())

if (mode === 'update') {
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  console.log(`Typecheck baseline updated: ${current.totalErrors} errors across ${current.filesWithErrors} files.`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error('Missing typecheck-baseline.json. Run npm run typecheck:baseline first.')
  process.exit(1)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const regressions = compareReports(baseline, current)

console.log(`Typecheck baseline: ${baseline.totalErrors} errors across ${baseline.filesWithErrors} files.`)
console.log(`Typecheck current:  ${current.totalErrors} errors across ${current.filesWithErrors} files.`)

if (regressions.length > 0) {
  console.error('\nTypecheck regression detected:')
  for (const regression of regressions) console.error(`- ${regression}`)
  process.exit(1)
}

console.log('Typecheck regression guard passed.')
