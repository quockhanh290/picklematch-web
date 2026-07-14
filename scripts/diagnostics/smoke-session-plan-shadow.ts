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

async function invokePlan(
  client: ReturnType<typeof createClient>,
  sessionId: string,
  plannedRoundCount: number,
  persist: boolean,
) {
  const startedAt = performance.now()
  const { data, error } = await client.functions.invoke('session-plan-shadow', {
    body: {
      session_id: sessionId,
      planned_round_count: plannedRoundCount,
      persist,
    },
  })
  return {
    data,
    error: error?.message ?? null,
    wall_ms: Math.round(performance.now() - startedAt),
  }
}

async function loadPersistedSummary(
  client: ReturnType<typeof createClient>,
  jobId: string,
) {
  const [{ data: job, error: jobError }, { data: version, error: versionError }] = await Promise.all([
    client
      .from('session_plan_jobs')
      .select('court_count, planned_round_count, input_payload')
      .eq('id', jobId)
      .single(),
    client
      .from('session_plan_versions')
      .select('id, quality_summary, runtime_summary')
      .eq('job_id', jobId)
      .single(),
  ])
  if (jobError || !job) throw new Error(jobError?.message ?? 'Unable to load persisted plan job')
  if (versionError || !version) throw new Error(versionError?.message ?? 'Unable to load persisted plan version')

  const { data: rounds, error: roundsError } = await client
    .from('session_plan_rounds')
    .select('round_no, matches, resting_ids')
    .eq('plan_version_id', version.id)
    .order('round_no', { ascending: true })
  if (roundsError) throw new Error(roundsError.message)

  const state = job.input_payload?.state ?? {}
  const players = Array.isArray(state.players) ? state.players : []
  return {
    plan_version_id: version.id,
    source: {
      court_count: job.court_count,
      planned_round_count: job.planned_round_count,
      current_round: state.current_round ?? null,
      status: state.status ?? null,
      roster_players: players.length,
      active_players: players.filter((player: any) => player.checked_out_at === null && !player.opted_rest).length,
      opted_rest_players: players.filter((player: any) => player.checked_out_at === null && player.opted_rest).length,
      checked_out_players: players.filter((player: any) => player.checked_out_at !== null).length,
    },
    rounds: (rounds ?? []).map((round: any) => ({
      round_no: round.round_no,
      matches: Array.isArray(round.matches) ? round.matches.length : 0,
      resting: Array.isArray(round.resting_ids) ? round.resting_ids.length : 0,
    })),
    quality_summary: version.quality_summary,
    runtime_summary: version.runtime_summary,
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
  const requestedRounds = argument('--rounds')
  const plannedRoundCount = requestedRounds === undefined ? 2 : Number(requestedRounds)
  if (!Number.isInteger(plannedRoundCount) || plannedRoundCount <= 0) {
    throw new Error('--rounds must be a positive integer')
  }
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
    const result = await invokePlan(client, sessionId, plannedRoundCount, false)
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
    ? await invokePlan(client, selectedSessionId, plannedRoundCount, true)
    : null
  if (persisted && !persisted.data?.ok) {
    throw new Error(`Persisted shadow smoke failed: ${persisted.data?.error ?? persisted.error}`)
  }
  const persistedSummary = persisted?.data?.job_id
    ? await loadPersistedSummary(client, persisted.data.job_id)
    : null

  console.log(JSON.stringify({
    session_id: selectedSessionId,
    planned_round_count: plannedRoundCount,
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
      reused: persisted.data.reused === true,
      plan_version_id: persistedSummary?.plan_version_id ?? persisted.data.plan_version_id,
      active_compute_ms: persisted.data.runtime_summary?.total_ms,
      stored: persistedSummary,
    } : null,
    rejected_before_selection: rejected.length,
  }, null, 2))
}

main()
