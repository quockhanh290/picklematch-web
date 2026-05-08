import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const secretPatterns = [
  {
    name: 'Supabase service role key',
    regex: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]?eyJ[A-Za-z0-9._-]{20,}/,
  },
  {
    name: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: 'AWS access key id',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
]

const ignoreFiles = new Set([
  '.env.example',
  '.gitignore',
])

const findings = []

for (const file of trackedFiles) {
  if (ignoreFiles.has(file)) continue

  let content = ''
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  for (const pattern of secretPatterns) {
    if (pattern.regex.test(content)) {
      findings.push({ file, pattern: pattern.name })
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed. Potential secrets found:')
  for (const finding of findings) {
    console.error(`- ${finding.pattern}: ${finding.file}`)
  }
  process.exit(1)
}

console.log('Secret scan passed.')
