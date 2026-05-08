import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const includeExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.sql',
  '.css',
  '.mjs',
  '.cjs',
])

const ignoreDirs = new Set([
  '.git',
  '.expo',
  'node_modules',
  'playwright-report',
  'test-results',
  'web-build',
  'docs',
  'scratch',
])

const suspiciousTokens = [
  // Keep only hard corruption markers to avoid false positives with Vietnamese text.
  String.fromCodePoint(0xef, 0xbf, 0xbd),
  String.fromCodePoint(0xfffd),
]

const issues = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }

    if (!includeExtensions.has(path.extname(entry.name))) continue

    const buffer = fs.readFileSync(fullPath)
    const text = buffer.toString('utf8')

    if (text.charCodeAt(0) === 0xfeff) {
      issues.push(`${path.relative(root, fullPath)}: UTF-8 BOM`)
    }

    for (const token of suspiciousTokens) {
      if (text.includes(token)) {
        issues.push(`${path.relative(root, fullPath)}: suspicious token "${token}"`)
        break
      }
    }
  }
}

walk(root)

if (issues.length > 0) {
  console.error('Encoding check failed:\n')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log('Encoding check passed.')
