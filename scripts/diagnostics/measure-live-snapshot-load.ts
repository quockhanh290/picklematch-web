import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const sessionId = process.argv.find(arg => arg.startsWith('--session-id='))?.slice('--session-id='.length)
  ?? 'a57ed2f9-54c4-4b08-b4c6-d8e7aa7be8b0'
const iterations = Math.max(1, Number(process.argv.find(arg => arg.startsWith('--iterations='))?.slice('--iterations='.length) ?? '8'))
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

if (!url || !anon) throw new Error('Missing Supabase env')

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function round(value: number) {
  return Math.round(value)
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return {
    min: round(sorted[0] ?? 0),
    p50: round(sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0),
    p95: round(sorted[Math.ceil((sorted.length - 1) * 0.95)] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    avg: round(avg),
  }
}

async function main() {
  const client = createClient(url!, anon!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signIn.error) throw signIn.error

  const snapshotMs: number[] = []
  const multiQueryMs: number[] = []
  let rowCounts: Record<string, number> | null = null

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const snapshotStarted = now()
    const snapshot = await client.rpc('get_live_session_snapshot_versioned', {
      p_session_id: sessionId,
    })
    snapshotMs.push(now() - snapshotStarted)
    if (snapshot.error) throw snapshot.error
    const data = snapshot.data as any
    rowCounts = {
      players: data.player_rows?.length ?? 0,
      pairs: data.pair_rows?.length ?? 0,
      rounds: data.round_rows?.length ?? 0,
      liveMatches: data.live_match_rows?.length ?? 0,
    }

    const multiStarted = now()
    const beforeRes = await client.from('sessions').select('live_state_version').eq('id', sessionId).single()
    const [playerRes, pairRes, roundRes, liveMatchRes, afterRes] = await Promise.all([
      client.from('session_player_state').select('*').eq('session_id', sessionId).order('checked_in_at', { ascending: true }),
      client.from('session_pair_history').select('*').eq('session_id', sessionId).order('player_a', { ascending: true }),
      client.from('session_rounds').select('*').eq('session_id', sessionId).order('round_no', { ascending: true }),
      client.from('session_live_matches').select('*').eq('session_id', sessionId).order('sequence_no', { ascending: true }),
      client.from('sessions').select('live_state_version').eq('id', sessionId).single(),
    ])
    multiQueryMs.push(now() - multiStarted)
    const error = beforeRes.error ?? playerRes.error ?? pairRes.error ?? roundRes.error ?? liveMatchRes.error ?? afterRes.error
    if (error) throw error
  }

  console.log(JSON.stringify({
    sessionId,
    iterations,
    rowCounts,
    snapshotMs: summarize(snapshotMs),
    multiQueryMs: summarize(multiQueryMs),
    savedMsAvg: round(summarize(multiQueryMs).avg - summarize(snapshotMs).avg),
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
