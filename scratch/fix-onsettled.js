const fs = require('fs')
const file = 'd:/picklematch-web/features/host/session-detail/next-round-v2/mutations.ts'
let content = fs.readFileSync(file, 'utf8')
content = content.replace(/onSettled: \(\) => \{\s+queryClient\.invalidateQueries\(\{ queryKey: liveSessionQueryKeys\.detail\(sessionId\) \}\)\s+\},/g, '// onSettled removed to prevent race condition with Realtime')
fs.writeFileSync(file, content)
console.log('Fixed onSettled in mutations.ts')
