import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const DEFAULT_SESSION_ID = 'a57ed2f9-54c4-4b08-b4c6-d8e7aa7be8b0'
const sessionId = process.argv.find(arg => arg.startsWith('--session-id='))?.slice('--session-id='.length) ?? DEFAULT_SESSION_ID
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

if (!url || !anon) {
  throw new Error('Missing Supabase env')
}

async function main() {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })

  const signIn = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signIn.error) throw signIn.error

  const [sessionRes, countBeforeRes, sourceMatchRes] = await Promise.all([
    client.from('sessions').select('id, live_state_version, status').eq('id', sessionId).single(),
    client.from('session_live_matches').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
    client
      .from('session_live_matches')
      .select('court_idx, round_no, team_a, team_b, resting')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: false })
      .limit(1)
      .single(),
  ])

  if (sessionRes.error) throw sessionRes.error
  if (countBeforeRes.error) throw countBeforeRes.error
  if (sourceMatchRes.error) throw sourceMatchRes.error

  const liveStateVersion = Number(sessionRes.data.live_state_version)
  const stalePreviewVersion = Math.max(0, liveStateVersion - 1)
  const sourceMatch = sourceMatchRes.data as any
  const matchPayload = {
    court_idx: sourceMatch.court_idx ?? 0,
    team_a: sourceMatch.team_a,
    team_b: sourceMatch.team_b,
    resting: sourceMatch.resting ?? [],
    round_no: sourceMatch.round_no ?? -1,
  }

  const startedAt = Date.now()
  const { data, error } = await client.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: sessionId,
    p_expected_live_state_version: liveStateVersion,
    p_match: matchPayload,
    p_audit_payload: {
      source: 'client-preview-start-live-match',
      preview_id: 'integration-stale-preview-test',
      preview_live_state_version: stalePreviewVersion,
      client_request_id: `stale_preview_test_${Date.now()}`,
    },
  })
  const elapsedMs = Date.now() - startedAt

  const countAfterRes = await client
    .from('session_live_matches')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
  if (countAfterRes.error) throw countAfterRes.error

  const rejected = Boolean(error)
  const message = error?.message ?? null
  const staleRejected = rejected && /Preview is stale|Preview version/i.test(message ?? '')
  const countBefore = countBeforeRes.count ?? 0
  const countAfter = countAfterRes.count ?? 0

  console.log(JSON.stringify({
    sessionId,
    liveStateVersion,
    stalePreviewVersion,
    elapsedMs,
    rejected,
    message,
    staleRejected,
    countBefore,
    countAfter,
    noWrite: countBefore === countAfter,
    unexpectedData: data ?? null,
  }, null, 2))

  if (!staleRejected || countBefore !== countAfter) {
    process.exitCode = 1
  }
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
