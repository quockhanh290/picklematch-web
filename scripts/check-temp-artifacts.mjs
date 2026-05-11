import { execSync } from 'child_process'
import path from 'path'

const FORBIDDEN_EXTENSIONS = ['*.tmp', '*.bak', '*.raw', '*.old', '*_utf8.tsx']

function checkTempFiles() {
  console.log('🔍 Checking for forbidden temporary/backup artifacts...')
  
  let foundFiles = []
  
  for (const pattern of FORBIDDEN_EXTENSIONS) {
    try {
      // Use 'git ls-files' to only check tracked files, or just check the whole directory
      // The user wants to prevent them in main branches, so checking tracked files is key.
      const output = execSync(`git ls-files "${pattern}"`).toString().trim()
      if (output) {
        foundFiles.push(...output.split('\n'))
      }
    } catch (e) {
      // Pattern not found
    }
  }

  if (foundFiles.length > 0) {
    console.error('\n❌ Forbidden artifacts found in the codebase:')
    foundFiles.forEach(file => console.error(`   - ${file}`))
    console.error('\nAction required: Please remove these files or add them to .gitignore if they are local-only.')
    process.exit(1)
  }

  console.log('✅ No forbidden artifacts found.')
}

checkTempFiles()
