import fs from 'node:fs'
import path from 'node:path'

const contextPath = path.resolve(process.cwd(), 'e2e/.auth/session-context.json')

export default async function globalTeardown() {
  if (!fs.existsSync(contextPath)) return
  const context = JSON.parse(fs.readFileSync(contextPath, 'utf8')) as {
    sessionId?: string | null
    slotId?: string | null
    source?: string
  }
  if (context.source !== 'disposable' || !context.sessionId) return
  const serviceRoleKey = readFromDotEnv('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = readFromDotEnv('EXPO_PUBLIC_SUPABASE_URL') ?? process.env.EXPO_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) return
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  const sessionRes = await fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${context.sessionId}`, { method: 'DELETE', headers })
  if (!sessionRes.ok) throw new Error(`Could not delete disposable session (${sessionRes.status})`)
  if (context.slotId) {
    const slotRes = await fetch(`${supabaseUrl}/rest/v1/court_slots?id=eq.${context.slotId}`, { method: 'DELETE', headers })
    if (!slotRes.ok) throw new Error(`Could not delete disposable slot (${slotRes.status})`)
  }
}

function readFromDotEnv(key: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const [name, ...value] = line.split('=')
      if (name?.trim() === key) return value.join('=').trim().replace(/^"(.*)"$/, '$1')
    }
  } catch { /* optional local env */ }
  return undefined
}
