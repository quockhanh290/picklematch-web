import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/inspect-live-match-round-events.ts <session-id>')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY')

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: authError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (authError) throw authError

  const matchesRes = await client
    .from('session_live_matches')
    .select('id, sequence_no, round_no, court_idx, status, team_a, team_b, suggested_at, started_at, ended_at')
    .eq('session_id', sessionId)
    .order('sequence_no')
  if (matchesRes.error) throw matchesRes.error

  const suspicious = (matchesRes.data ?? []).filter(row => Number(row.sequence_no) >= 18 && Number(row.sequence_no) <= 29)
  const ids = new Set(suspicious.map(row => String(row.id)))

  const eventsRes = await client
    .from('suggester_decision_events')
    .select('round_no, event_type, payload, created_at')
    .eq('session_id', sessionId)
    .in('event_type', ['live_match_started_from_payload', 'live_match_completed'])
    .order('created_at')
  if (eventsRes.error) throw eventsRes.error

  const events = (eventsRes.data ?? []).filter(event => {
    const match = (event.payload as any)?.match
    return match?.id && ids.has(String(match.id))
  }).map(event => {
    const match = (event.payload as any)?.match
    return {
      createdAt: event.created_at,
      eventType: event.event_type,
      eventRoundNo: event.round_no,
      matchId: match?.id,
      sequenceNo: match?.sequence_no,
      matchRoundNo: match?.round_no,
      courtIdx: match?.court_idx,
      source: (event.payload as any)?.source,
      previewLiveStateVersion: (event.payload as any)?.preview_live_state_version,
      previewCountableMatchCount: (event.payload as any)?.preview_countable_match_count,
      previewId: (event.payload as any)?.preview_id,
      clientRequestId: (event.payload as any)?.client_request_id,
      roundComplete: (event.payload as any)?.round_complete,
      expectedRoundMatches: (event.payload as any)?.expected_round_matches,
    }
  })

  console.log(JSON.stringify({ suspicious, events }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
