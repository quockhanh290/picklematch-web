import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/audit-session-match-gap.ts <session-id>')

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

async function main() {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const auth = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (auth.error) throw auth.error

  const [playersRes, matchesRes] = await Promise.all([
    client.from('session_player_state').select('player_id, matches_played, checked_in_at, checked_out_at, players(name)').eq('session_id', sessionId),
    client.from('session_live_matches').select('sequence_no, round_no, court_idx, status, team_a, team_b, suggested_at, started_at, ended_at').eq('session_id', sessionId).eq('status', 'completed').order('sequence_no'),
  ])
  if (playersRes.error) throw playersRes.error
  if (matchesRes.error) throw matchesRes.error

  const names = new Map((playersRes.data ?? []).map((row: any) => [String(row.player_id), String(row.players?.name ?? row.player_id)]))
  const counts = new Map([...names.keys()].map(id => [id, 0]))
  const timelines = new Map([...names.keys()].map(id => [id, [] as number[]]))
  const rows: any[] = []

  for (const row of matchesRes.data ?? []) {
    const selected = [...row.team_a, ...row.team_b].map(String)
    for (const id of selected) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
      timelines.get(id)?.push(Number(row.round_no) + 1)
    }
    const values = [...counts.values()]
    rows.push({
      sequence: Number(row.sequence_no),
      round: Number(row.round_no) + 1,
      court: Number(row.court_idx) + 1,
      rangeAfter: `${Math.min(...values)}-${Math.max(...values)}`,
      selected: selected.map(id => `${names.get(id)}:${counts.get(id)}`),
    })
  }

  const final = [...counts.entries()]
    .map(([id, count]) => ({
      player: names.get(id),
      count,
      roundsPlayed: timelines.get(id),
      roundsRested: Array.from({ length: 8 }, (_, index) => index + 1).filter(round => !timelines.get(id)?.includes(round)),
      dbCount: Number((playersRes.data ?? []).find((row: any) => String(row.player_id) === id)?.matches_played ?? -1),
    }))
    .sort((left, right) => left.count - right.count || String(left.player).localeCompare(String(right.player)))

  console.log(JSON.stringify({
    sessionId,
    final,
    firstRange2: rows.find(row => {
      const [min, max] = row.rangeAfter.split('-').map(Number)
      return max - min >= 2
    }),
    firstRange3: rows.find(row => {
      const [min, max] = row.rangeAfter.split('-').map(Number)
      return max - min >= 3
    }),
    lateSequence: rows.slice(-12),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
