import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

async function generateEvidenceTemplate() {
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD').toString().trim()
  } catch (e) {
    console.warn('Could not get git SHA')
  }

  const date = new Date().toISOString().split('T')[0]
  const filename = `EVIDENCE_${sha}_${date}.md`
  const filepath = path.join(process.cwd(), 'docs', 'evidence', filename)

  // Ensure directory exists
  const dir = path.join(process.cwd(), 'docs', 'evidence')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const template = `# Release Evidence: ${sha}
Date: ${date}
Tester: ____________________

## Physical Device Matrix
| Environment | Device | OS Version | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| iOS Safari | | | [ ] | |
| Zalo IAB (iOS) | | | [ ] | |
| Messenger IAB (iOS) | | | [ ] | |
| Chrome Android | | | [ ] | |
| FB IAB (Android) | | | [ ] | |

## Must-Pass Checks & Evidence
### 1. Auth Persistence (Private Mode / IAB)
- [ ] Login -> Close Tab -> Re-open link.
- **Expected**: Persistence warning shown, session cleared on tab close (IAB).
- **Evidence**: [Attach Screenshot]

### 2. Deep-linking from Social Apps
- [ ] Send \`/session/[id]\` link in Zalo/Messenger.
- [ ] Click link and verify direct landing on session detail.
* **Evidence**: [Attach Screenshot]

### 3. iOS Input Zoom Regression
- [ ] Focus any TextInput in \`AppInput\` or \`DevLogin\`.
* **Expected**: No auto-zoom (font size 16px).
* **Evidence**: [Attach Screenshot]

### 4. Degraded Network UI
- [ ] Toggle Airplane mode during fetch.
* **Expected**: "Bạn đang ngoại tuyến" banner appears.
* **Evidence**: [Attach Screenshot]

### 5. Quick-start Isolation
- [ ] Verify \`/host/web-quick-start\` redirects to login in production build.
* **Expected**: No access to dev tools.

## Sign-off
Approved for Release: [ ] Yes / [ ] No
`

  fs.writeFileSync(filepath, template)
  console.log(`✅ Evidence template generated at: ${filepath}`)
  console.log(`Please use this file to document your physical device testing.`)
}

generateEvidenceTemplate()
