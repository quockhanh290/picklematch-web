import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'

if (!supabaseUrl || !anonKey) throw new Error('Missing Supabase environment')

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

async function invokePlan(client: ReturnType<typeof createClient>, sessionId: string, persist: boolean) {
  const startedAt = performance.now()
  const { data, error } = await client.functions.invoke('session-plan-shadow', {
    body: {
      session_id: sessionId,
      planned_round_count: 2,
      persist,
    },
  })
  return {
    data,
    error: error?.message ?? null,
    wall_ms: Math.round(performance.now() - startedAt),
  }
}

async function main() {
  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError || !auth.user) throw new Error(authError?.message ?? 'Unable to sign in')

  const requestedSessionId = argument('--session-id')
  const sessionIds = requestedSessionId
    ? [requestedSessionId]
    : await (async () => {
        const { data, error } = await client
          .from('sessions')
          .select('id')
          .eq('host_id', auth.user.id)
          .order('created_at', { ascending: false })
          .limit(20)
        if (error) throw error
        return (data ?? []).map(row => String(row.id))
      })()

  let selectedSessionId: string | null = null
  let dryRun: Awaited<ReturnType<typeof invokePlan>> | null = null
  const rejected: Array<{ session_id: string; error: unknown }> = []
  for (const sessionId of sessionIds) {
    const result = await invokePlan(client, sessionId, false)
    if (result.data?.ok) {
      selectedSessionId = sessionId
      dryRun = result
      break
    }
    rejected.push({ session_id: sessionId, error: result.data?.error ?? result.error })
  }
  if (!selectedSessionId || !dryRun) {
    throw new Error(`No hosted session passed dry-run smoke: ${JSON.stringify(rejected.slice(0, 5))}`)
  }

  const persisted = process.argv.includes('--persist')
    ? await invokePlan(client, selectedSessionId, true)
    : null
  if (persisted && !persisted.data?.ok) {
    throw new Error(`Persisted shadow smoke failed: ${persisted.data?.error ?? persisted.error}`)
  }

  console.log(JSON.stringify({
    session_id: selectedSessionId,
    dry_run: {
      ok: dryRun.data.ok,
      wall_ms: dryRun.wall_ms,
      engine_version: dryRun.data.engine_version,
      invariants: dryRun.data.invariants,
      quality_summary: dryRun.data.quality_summary,
      active_compute_ms: dryRun.data.runtime_summary?.total_ms,
    },
    persisted: persisted ? {
      ok: persisted.data.ok,
      wall_ms: persisted.wall_ms,
      job_id: persisted.data.job_id,
      plan_version_id: persisted.data.plan_version_id,
      active_compute_ms: persisted.data.runtime_summary?.total_ms,
    } : null,
    rejected_before_selection: rejected.length,
  }, null, 2))
}

main()
